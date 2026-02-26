import { CompiledProgram } from './fast-types.js';
import { VmProgram, vmCompile, vmCompileTree, VmOp } from './vm-compile.js';
import { RuleMatch } from '../types/result.js';

const BC_BASE    = 0x00040;
const DATA_BASE  = 0x10040;
const INPUT_BASE = 0x20040;
const BT_BASE    = 0x120040;
const CALL_BASE  = 0x130040;

const BT_FRAME_SIZE = 12;

function uleb(v: number): number[] {
  const o: number[] = [];
  do { let b = v & 0x7F; v >>>= 7; if (v) b |= 0x80; o.push(b); } while (v);
  return o;
}

function sleb(v: number): number[] {
  const o: number[] = [];
  let m = true;
  while (m) {
    let b = v & 0x7F;
    v >>= 7;
    if ((v === 0 && (b & 0x40) === 0) || (v === -1 && (b & 0x40) !== 0)) m = false;
    else b |= 0x80;
    o.push(b);
  }
  return o;
}

function sec(id: number, c: number[]): number[] {
  return [id, ...uleb(c.length), ...c];
}

const I32 = 0x7F;
const I32_CONST = 0x41;
const I32_ADD = 0x6A;
const I32_SUB = 0x6B;
const I32_MUL = 0x6C;
const I32_AND = 0x71;
const I32_OR = 0x72;
const I32_SHL = 0x74;
const I32_SHR_U = 0x76;
const I32_EQ = 0x46;
const I32_NE = 0x47;
const I32_LT_S = 0x48;
const I32_LT_U = 0x49;
const I32_GT_S = 0x4A;
const I32_GT_U = 0x4B;
const I32_LE_S = 0x4C;
const I32_LE_U = 0x4D;
const I32_GE_S = 0x4E;
const I32_GE_U = 0x4F;
const LOCAL_GET = 0x20;
const LOCAL_SET = 0x21;
const LOCAL_TEE = 0x22;
const I32_LOAD = 0x28;
const I32_STORE = 0x36;
const I32_LOAD8_U = 0x2D;
const I32_LOAD16_U = 0x2F;
const BLOCK = 0x02;
const LOOP = 0x03;
const BR = 0x0C;
const BR_IF = 0x0D;
const BR_TABLE = 0x0E;
const IF = 0x04;
const ELSE = 0x05;
const END = 0x0B;
const RETURN = 0x0F;
const VOID = 0x40;

const L_BC_LEN = 0;
const L_IN_LEN = 1;
const L_PC = 2;
const L_POS = 3;
const L_BT_SP = 4;
const L_CALL_SP = 5;
const L_TMP = 6;
const L_TMP2 = 7;
const L_TMP3 = 8;
const L_OP = 9;

const NUM_OPCODES = 20;

function lget(w: number[], l: number) { w.push(LOCAL_GET, ...uleb(l)); }
function lset(w: number[], l: number) { w.push(LOCAL_SET, ...uleb(l)); }
function ltee(w: number[], l: number) { w.push(LOCAL_TEE, ...uleb(l)); }
function iconst(w: number[], v: number) { w.push(I32_CONST, ...sleb(v)); }

function emitBsCheck(w: number[], dataIdxLocal: number, byteLocal: number) {
  lget(w, byteLocal); iconst(w, 5); w.push(I32_SHR_U); iconst(w, 2); w.push(I32_SHL);
  lget(w, dataIdxLocal); w.push(I32_ADD); iconst(w, DATA_BASE); w.push(I32_ADD);
  w.push(I32_LOAD, ...uleb(2), ...uleb(0));
  iconst(w, 1); lget(w, byteLocal); iconst(w, 31); w.push(I32_AND); w.push(I32_SHL);
  w.push(I32_AND);
}

function emitLoadInputByte(w: number[]) {
  iconst(w, INPUT_BASE); lget(w, L_POS); w.push(I32_ADD);
  w.push(I32_LOAD8_U, ...uleb(0), ...uleb(0));
}

function emitLoadBcByte(w: number[]) {
  iconst(w, BC_BASE); lget(w, L_PC); w.push(I32_ADD);
  w.push(I32_LOAD8_U, ...uleb(0), ...uleb(0));
}

function emitLoadBc16(w: number[]) {
  iconst(w, BC_BASE); lget(w, L_PC); w.push(I32_ADD);
  w.push(I32_LOAD16_U, ...uleb(0), ...uleb(0));
}

function emitLoadBc32(w: number[]) {
  iconst(w, BC_BASE); lget(w, L_PC); w.push(I32_ADD);
  w.push(I32_LOAD, ...uleb(2), ...uleb(0));
}

function emitAdvPc(w: number[], n: number) {
  lget(w, L_PC); iconst(w, n); w.push(I32_ADD); lset(w, L_PC);
}

function emitBoundsCheck(w: number[]) {
  lget(w, L_POS); lget(w, L_IN_LEN); w.push(I32_GE_U);
}

function emitFail(w: number[], loopBr: number) {
  lget(w, L_BT_SP); iconst(w, 0); w.push(I32_LE_S);
  w.push(IF, VOID);
    iconst(w, -1); w.push(RETURN);
  w.push(END);
  emitBtPop(w);
  w.push(BR, ...uleb(loopBr));
}

function emitBtPush(w: number[]) {
  iconst(w, BT_BASE); lget(w, L_BT_SP); w.push(I32_ADD);
  lget(w, L_TMP);
  w.push(I32_STORE, ...uleb(2), ...uleb(0));
  iconst(w, BT_BASE); lget(w, L_BT_SP); w.push(I32_ADD); iconst(w, 4); w.push(I32_ADD);
  lget(w, L_POS);
  w.push(I32_STORE, ...uleb(2), ...uleb(0));
  iconst(w, BT_BASE); lget(w, L_BT_SP); w.push(I32_ADD); iconst(w, 8); w.push(I32_ADD);
  lget(w, L_CALL_SP);
  w.push(I32_STORE, ...uleb(2), ...uleb(0));
  lget(w, L_BT_SP); iconst(w, BT_FRAME_SIZE); w.push(I32_ADD); lset(w, L_BT_SP);
}

function emitBtPop(w: number[]) {
  lget(w, L_BT_SP); iconst(w, BT_FRAME_SIZE); w.push(I32_SUB); lset(w, L_BT_SP);
  iconst(w, BT_BASE); lget(w, L_BT_SP); w.push(I32_ADD);
  w.push(I32_LOAD, ...uleb(2), ...uleb(0));
  lset(w, L_PC);
  iconst(w, BT_BASE); lget(w, L_BT_SP); w.push(I32_ADD); iconst(w, 4); w.push(I32_ADD);
  w.push(I32_LOAD, ...uleb(2), ...uleb(0));
  lset(w, L_POS);
  iconst(w, BT_BASE); lget(w, L_BT_SP); w.push(I32_ADD); iconst(w, 8); w.push(I32_ADD);
  w.push(I32_LOAD, ...uleb(2), ...uleb(0));
  lset(w, L_CALL_SP);
}

export function buildVmWasm(): Uint8Array {
  const body: number[] = [];
  body.push(1, 10, I32);

  iconst(body, 0); lset(body, L_PC);
  iconst(body, 0); lset(body, L_POS);
  iconst(body, 0); lset(body, L_BT_SP);
  iconst(body, 0); lset(body, L_CALL_SP);

  body.push(BLOCK, VOID);
  body.push(LOOP, VOID);

  lget(body, L_PC); lget(body, L_BC_LEN); body.push(I32_GE_U);
  body.push(BR_IF, ...uleb(1));

  emitLoadBcByte(body);
  lset(body, L_OP);

  for (let i = 0; i < NUM_OPCODES; i++) {
    body.push(BLOCK, VOID);
  }

  lget(body, L_OP);
  body.push(BR_TABLE, ...uleb(NUM_OPCODES));
  for (let i = 0; i < NUM_OPCODES; i++) body.push(...uleb(i));
  body.push(...uleb(NUM_OPCODES - 1));

  for (let i = 0; i < NUM_OPCODES; i++) {
    body.push(END);
    const loopDepth = NUM_OPCODES - 1 - i;
    const exitDepth = loopDepth + 1;
    emitHandler(body, i, loopDepth, exitDepth);
  }

  body.push(END, END);
  iconst(body, -2); body.push(RETURN);
  body.push(END);

  const funcType: number[] = [1, 0x60, 2, I32, I32, 1, I32];
  const funcSec: number[] = [1, 0];
  const memSec: number[] = [1, 0x01, ...uleb(20), ...uleb(256)];
  const exportSec: number[] = [
    2,
    7, 0x76, 0x6D, 0x5F, 0x65, 0x78, 0x65, 0x63, 0x00, 0,
    6, 0x6D, 0x65, 0x6D, 0x6F, 0x72, 0x79, 0x02, 0,
  ];
  const codeSec: number[] = [1, ...uleb(body.length), ...body];

  const out: number[] = [0x00, 0x61, 0x73, 0x6D, 0x01, 0x00, 0x00, 0x00];
  out.push(...sec(1, funcType));
  out.push(...sec(3, funcSec));
  out.push(...sec(5, memSec));
  out.push(...sec(7, exportSec));
  out.push(...sec(10, codeSec));

  return new Uint8Array(out);
}

function emitHandler(w: number[], opIdx: number, loopDepth: number, exitDepth: number): void {
  switch (opIdx) {
    case VmOp.BYTE: {
      emitAdvPc(w, 1);
      w.push(BLOCK, VOID);
      emitBoundsCheck(w);
      w.push(BR_IF, ...uleb(0));
      emitLoadInputByte(w);
      emitLoadBcByte(w);
      w.push(I32_NE);
      w.push(BR_IF, ...uleb(0));
      emitAdvPc(w, 1);
      lget(w, L_POS); iconst(w, 1); w.push(I32_ADD); lset(w, L_POS);
      w.push(BR, ...uleb(loopDepth + 1));
      w.push(END);
      emitFail(w, loopDepth);
      break;
    }
    case VmOp.BITSET: {
      emitAdvPc(w, 1);
      w.push(BLOCK, VOID);
      emitBoundsCheck(w);
      w.push(BR_IF, ...uleb(0));
      emitLoadBc16(w); lset(w, L_TMP);
      emitAdvPc(w, 2);
      emitLoadInputByte(w); lset(w, L_TMP2);
      emitBsCheck(w, L_TMP, L_TMP2);
      iconst(w, 0); w.push(I32_EQ);
      w.push(BR_IF, ...uleb(0));
      lget(w, L_POS); iconst(w, 1); w.push(I32_ADD); lset(w, L_POS);
      w.push(BR, ...uleb(loopDepth + 1));
      w.push(END);
      emitFail(w, loopDepth);
      break;
    }
    case VmOp.NOT_BITSET: {
      emitAdvPc(w, 1);
      w.push(BLOCK, VOID);
      emitBoundsCheck(w);
      w.push(BR_IF, ...uleb(0));
      emitLoadBc16(w); lset(w, L_TMP);
      emitAdvPc(w, 2);
      emitLoadInputByte(w); lset(w, L_TMP2);
      emitBsCheck(w, L_TMP, L_TMP2);
      iconst(w, 0); w.push(I32_NE);
      w.push(BR_IF, ...uleb(0));
      lget(w, L_POS); iconst(w, 1); w.push(I32_ADD); lset(w, L_POS);
      w.push(BR, ...uleb(loopDepth + 1));
      w.push(END);
      emitFail(w, loopDepth);
      break;
    }
    case VmOp.TEXT: {
      emitAdvPc(w, 1);
      emitLoadBc16(w); lset(w, L_TMP);
      emitAdvPc(w, 2);
      emitLoadBc16(w); lset(w, L_TMP2);
      emitAdvPc(w, 2);
      w.push(BLOCK, VOID);
      lget(w, L_POS); lget(w, L_TMP2); w.push(I32_ADD); lget(w, L_IN_LEN); w.push(I32_GT_U);
      w.push(BR_IF, ...uleb(0));
      iconst(w, 0); lset(w, L_TMP3);
      w.push(BLOCK, VOID);
      w.push(LOOP, VOID);
      lget(w, L_TMP3); lget(w, L_TMP2); w.push(I32_GE_U);
      w.push(BR_IF, ...uleb(1));
      iconst(w, INPUT_BASE); lget(w, L_POS); w.push(I32_ADD); lget(w, L_TMP3); w.push(I32_ADD);
      w.push(I32_LOAD8_U, ...uleb(0), ...uleb(0));
      iconst(w, DATA_BASE); lget(w, L_TMP); w.push(I32_ADD); lget(w, L_TMP3); w.push(I32_ADD);
      w.push(I32_LOAD8_U, ...uleb(0), ...uleb(0));
      w.push(I32_NE);
      w.push(BR_IF, ...uleb(2));
      lget(w, L_TMP3); iconst(w, 1); w.push(I32_ADD); lset(w, L_TMP3);
      w.push(BR, ...uleb(0));
      w.push(END, END);
      lget(w, L_POS); lget(w, L_TMP2); w.push(I32_ADD); lset(w, L_POS);
      w.push(BR, ...uleb(loopDepth + 1));
      w.push(END);
      emitFail(w, loopDepth);
      break;
    }
    case VmOp.ANY: {
      emitAdvPc(w, 1);
      w.push(BLOCK, VOID);
      emitBoundsCheck(w);
      w.push(BR_IF, ...uleb(0));
      emitLoadInputByte(w); lset(w, L_TMP);
      lget(w, L_TMP); iconst(w, 0x80); w.push(I32_LT_U);
      w.push(IF, VOID);
        lget(w, L_POS); iconst(w, 1); w.push(I32_ADD); lset(w, L_POS);
      w.push(ELSE);
        lget(w, L_TMP); iconst(w, 0xE0); w.push(I32_LT_U);
        w.push(IF, VOID);
          lget(w, L_POS); iconst(w, 2); w.push(I32_ADD); lset(w, L_POS);
        w.push(ELSE);
          lget(w, L_TMP); iconst(w, 0xF0); w.push(I32_LT_U);
          w.push(IF, VOID);
            lget(w, L_POS); iconst(w, 3); w.push(I32_ADD); lset(w, L_POS);
          w.push(ELSE);
            lget(w, L_POS); iconst(w, 4); w.push(I32_ADD); lset(w, L_POS);
          w.push(END);
        w.push(END);
      w.push(END);
      lget(w, L_POS); lget(w, L_IN_LEN); w.push(I32_GT_U);
      w.push(BR_IF, ...uleb(0));
      w.push(BR, ...uleb(loopDepth + 1));
      w.push(END);
      emitFail(w, loopDepth);
      break;
    }
    case VmOp.RANGE: {
      emitAdvPc(w, 1);
      w.push(BLOCK, VOID);
      emitBoundsCheck(w);
      w.push(BR_IF, ...uleb(0));
      emitLoadInputByte(w); lset(w, L_TMP);
      emitLoadBcByte(w); lset(w, L_TMP2);
      emitAdvPc(w, 1);
      emitLoadBcByte(w); lset(w, L_TMP3);
      emitAdvPc(w, 1);
      lget(w, L_TMP); lget(w, L_TMP2); w.push(I32_SUB);
      lget(w, L_TMP3); lget(w, L_TMP2); w.push(I32_SUB);
      w.push(I32_GT_U);
      w.push(BR_IF, ...uleb(0));
      lget(w, L_POS); iconst(w, 1); w.push(I32_ADD); lset(w, L_POS);
      w.push(BR, ...uleb(loopDepth + 1));
      w.push(END);
      emitFail(w, loopDepth);
      break;
    }
    case VmOp.CHOICE: {
      emitAdvPc(w, 1);
      emitLoadBc32(w); lset(w, L_TMP);
      emitAdvPc(w, 4);
      emitBtPush(w);
      w.push(BR, ...uleb(loopDepth));
      break;
    }
    case VmOp.COMMIT: {
      emitAdvPc(w, 1);
      emitLoadBc32(w); lset(w, L_TMP);
      emitAdvPc(w, 4);
      lget(w, L_BT_SP); iconst(w, BT_FRAME_SIZE); w.push(I32_SUB); lset(w, L_BT_SP);
      lget(w, L_TMP); lset(w, L_PC);
      w.push(BR, ...uleb(loopDepth));
      break;
    }
    case VmOp.FAIL: {
      lget(w, L_BT_SP); iconst(w, 0); w.push(I32_LE_S);
      w.push(IF, VOID);
        iconst(w, -1); w.push(RETURN);
      w.push(END);
      emitBtPop(w);
      w.push(BR, ...uleb(loopDepth));
      break;
    }
    case VmOp.JUMP: {
      emitAdvPc(w, 1);
      emitLoadBc32(w); lset(w, L_PC);
      w.push(BR, ...uleb(loopDepth));
      break;
    }
    case VmOp.CALL: {
      emitAdvPc(w, 1);
      emitLoadBc32(w); lset(w, L_TMP);
      emitAdvPc(w, 4);
      iconst(w, CALL_BASE); lget(w, L_CALL_SP); iconst(w, 4); w.push(I32_MUL); w.push(I32_ADD);
      lget(w, L_PC);
      w.push(I32_STORE, ...uleb(2), ...uleb(0));
      lget(w, L_CALL_SP); iconst(w, 1); w.push(I32_ADD); lset(w, L_CALL_SP);
      lget(w, L_TMP); lset(w, L_PC);
      w.push(BR, ...uleb(loopDepth));
      break;
    }
    case VmOp.RET: {
      lget(w, L_CALL_SP); iconst(w, 0); w.push(I32_LE_S);
      w.push(IF, VOID);
        lget(w, L_POS); w.push(RETURN);
      w.push(END);
      lget(w, L_CALL_SP); iconst(w, 1); w.push(I32_SUB); lset(w, L_CALL_SP);
      iconst(w, CALL_BASE); lget(w, L_CALL_SP); iconst(w, 4); w.push(I32_MUL); w.push(I32_ADD);
      w.push(I32_LOAD, ...uleb(2), ...uleb(0));
      lset(w, L_PC);
      w.push(BR, ...uleb(loopDepth));
      break;
    }
    case VmOp.MATCH: {
      lget(w, L_POS); w.push(RETURN);
      break;
    }
    case VmOp.REP_BITSET: {
      emitAdvPc(w, 1);
      emitLoadBc16(w); lset(w, L_TMP);
      emitAdvPc(w, 2);
      emitLoadBc16(w); lset(w, L_TMP2);
      emitAdvPc(w, 2);
      emitLoadBc16(w); lset(w, L_TMP3);
      emitAdvPc(w, 2);
      lget(w, L_POS); lset(w, L_OP);
      w.push(BLOCK, VOID);
      w.push(LOOP, VOID);
      lget(w, L_POS); lget(w, L_IN_LEN); w.push(I32_GE_U);
      w.push(BR_IF, ...uleb(1));
      lget(w, L_TMP3); iconst(w, 0xFFFF); w.push(I32_NE);
      w.push(IF, VOID);
        lget(w, L_POS); lget(w, L_OP); w.push(I32_SUB);
        lget(w, L_TMP3); w.push(I32_GE_U);
        w.push(BR_IF, ...uleb(2));
      w.push(END);
      emitLoadInputByte(w); ltee(w, L_CALL_SP);
      iconst(w, 5); w.push(I32_SHR_U); iconst(w, 2); w.push(I32_SHL);
      lget(w, L_TMP); w.push(I32_ADD); iconst(w, DATA_BASE); w.push(I32_ADD);
      w.push(I32_LOAD, ...uleb(2), ...uleb(0));
      iconst(w, 1); lget(w, L_CALL_SP); iconst(w, 31); w.push(I32_AND); w.push(I32_SHL);
      w.push(I32_AND);
      iconst(w, 0); w.push(I32_EQ);
      w.push(BR_IF, ...uleb(1));
      lget(w, L_POS); iconst(w, 1); w.push(I32_ADD); lset(w, L_POS);
      w.push(BR, ...uleb(0));
      w.push(END, END);
      lget(w, L_POS); lget(w, L_OP); w.push(I32_SUB);
      lget(w, L_TMP2); w.push(I32_LT_U);
      w.push(IF, VOID);
        emitFail(w, loopDepth + 1);
      w.push(END);
      w.push(BR, ...uleb(loopDepth));
      break;
    }
    case VmOp.REP_BYTE: {
      emitAdvPc(w, 1);
      emitLoadBcByte(w); lset(w, L_TMP);
      emitAdvPc(w, 1);
      emitLoadBc16(w); lset(w, L_TMP2);
      emitAdvPc(w, 2);
      emitLoadBc16(w); lset(w, L_TMP3);
      emitAdvPc(w, 2);
      lget(w, L_POS); lset(w, L_OP);
      w.push(BLOCK, VOID);
      w.push(LOOP, VOID);
      lget(w, L_POS); lget(w, L_IN_LEN); w.push(I32_GE_U);
      w.push(BR_IF, ...uleb(1));
      lget(w, L_TMP3); iconst(w, 0xFFFF); w.push(I32_NE);
      w.push(IF, VOID);
        lget(w, L_POS); lget(w, L_OP); w.push(I32_SUB);
        lget(w, L_TMP3); w.push(I32_GE_U);
        w.push(BR_IF, ...uleb(2));
      w.push(END);
      emitLoadInputByte(w);
      lget(w, L_TMP); w.push(I32_NE);
      w.push(BR_IF, ...uleb(1));
      lget(w, L_POS); iconst(w, 1); w.push(I32_ADD); lset(w, L_POS);
      w.push(BR, ...uleb(0));
      w.push(END, END);
      lget(w, L_POS); lget(w, L_OP); w.push(I32_SUB);
      lget(w, L_TMP2); w.push(I32_LT_U);
      w.push(IF, VOID);
        emitFail(w, loopDepth + 1);
      w.push(END);
      w.push(BR, ...uleb(loopDepth));
      break;
    }
    case VmOp.REP_RANGE: {
      emitAdvPc(w, 1);
      emitLoadBcByte(w); lset(w, L_TMP);
      emitAdvPc(w, 1);
      emitLoadBcByte(w); lset(w, L_TMP2);
      emitAdvPc(w, 1);
      emitLoadBc16(w); lset(w, L_TMP3);
      emitAdvPc(w, 2);
      emitLoadBc16(w); lset(w, L_OP);
      emitAdvPc(w, 2);
      lget(w, L_POS); lset(w, L_CALL_SP);
      w.push(BLOCK, VOID);
      w.push(LOOP, VOID);
      lget(w, L_POS); lget(w, L_IN_LEN); w.push(I32_GE_U);
      w.push(BR_IF, ...uleb(1));
      lget(w, L_OP); iconst(w, 0xFFFF); w.push(I32_NE);
      w.push(IF, VOID);
        lget(w, L_POS); lget(w, L_CALL_SP); w.push(I32_SUB);
        lget(w, L_OP); w.push(I32_GE_U);
        w.push(BR_IF, ...uleb(2));
      w.push(END);
      emitLoadInputByte(w);
      lget(w, L_TMP); w.push(I32_SUB);
      lget(w, L_TMP2); lget(w, L_TMP); w.push(I32_SUB);
      w.push(I32_GT_U);
      w.push(BR_IF, ...uleb(1));
      lget(w, L_POS); iconst(w, 1); w.push(I32_ADD); lset(w, L_POS);
      w.push(BR, ...uleb(0));
      w.push(END, END);
      lget(w, L_POS); lget(w, L_CALL_SP); w.push(I32_SUB);
      lget(w, L_TMP3); w.push(I32_LT_U);
      w.push(IF, VOID);
        emitFail(w, loopDepth + 1);
      w.push(END);
      w.push(BR, ...uleb(loopDepth));
      break;
    }
    case VmOp.JOINED_BYTE_BITSET: {
      emitAdvPc(w, 1);
      emitLoadBc16(w); lset(w, L_TMP);
      emitAdvPc(w, 2);
      emitLoadBcByte(w); lset(w, L_TMP2);
      emitAdvPc(w, 1);
      emitLoadBc16(w); lset(w, L_TMP3);
      emitAdvPc(w, 2);
      w.push(BLOCK, VOID);
      emitBoundsCheck(w);
      w.push(BR_IF, ...uleb(0));
      emitLoadInputByte(w); ltee(w, L_OP);
      iconst(w, 5); w.push(I32_SHR_U); iconst(w, 2); w.push(I32_SHL);
      lget(w, L_TMP); w.push(I32_ADD); iconst(w, DATA_BASE); w.push(I32_ADD);
      w.push(I32_LOAD, ...uleb(2), ...uleb(0));
      iconst(w, 1); lget(w, L_OP); iconst(w, 31); w.push(I32_AND); w.push(I32_SHL);
      w.push(I32_AND);
      iconst(w, 0); w.push(I32_EQ);
      w.push(BR_IF, ...uleb(0));
      lget(w, L_POS); iconst(w, 1); w.push(I32_ADD); lset(w, L_POS);
      w.push(BLOCK, VOID);
      w.push(LOOP, VOID);
      lget(w, L_POS); lget(w, L_IN_LEN); w.push(I32_GE_U);
      w.push(BR_IF, ...uleb(1));
      emitLoadInputByte(w); ltee(w, L_OP);
      iconst(w, 5); w.push(I32_SHR_U); iconst(w, 2); w.push(I32_SHL);
      lget(w, L_TMP); w.push(I32_ADD); iconst(w, DATA_BASE); w.push(I32_ADD);
      w.push(I32_LOAD, ...uleb(2), ...uleb(0));
      iconst(w, 1); lget(w, L_OP); iconst(w, 31); w.push(I32_AND); w.push(I32_SHL);
      w.push(I32_AND);
      iconst(w, 0); w.push(I32_NE);
      w.push(IF, VOID);
        lget(w, L_POS); iconst(w, 1); w.push(I32_ADD); lset(w, L_POS);
        w.push(BR, ...uleb(1));
      w.push(END);
      lget(w, L_OP); lget(w, L_TMP2); w.push(I32_NE);
      w.push(BR_IF, ...uleb(1));
      lget(w, L_POS); iconst(w, 1); w.push(I32_ADD); lget(w, L_IN_LEN); w.push(I32_GE_U);
      w.push(BR_IF, ...uleb(1));
      iconst(w, INPUT_BASE); lget(w, L_POS); w.push(I32_ADD); iconst(w, 1); w.push(I32_ADD);
      w.push(I32_LOAD8_U, ...uleb(0), ...uleb(0));
      ltee(w, L_CALL_SP);
      iconst(w, 5); w.push(I32_SHR_U); iconst(w, 2); w.push(I32_SHL);
      lget(w, L_TMP); w.push(I32_ADD); iconst(w, DATA_BASE); w.push(I32_ADD);
      w.push(I32_LOAD, ...uleb(2), ...uleb(0));
      iconst(w, 1); lget(w, L_CALL_SP); iconst(w, 31); w.push(I32_AND); w.push(I32_SHL);
      w.push(I32_AND);
      iconst(w, 0); w.push(I32_EQ);
      w.push(BR_IF, ...uleb(1));
      lget(w, L_POS); iconst(w, 2); w.push(I32_ADD); lset(w, L_POS);
      w.push(BR, ...uleb(0));
      w.push(END, END);
      w.push(BR, ...uleb(loopDepth + 1));
      w.push(END);
      emitFail(w, loopDepth);
      break;
    }
    case VmOp.PARTIAL_COMMIT: {
      emitAdvPc(w, 1);
      emitLoadBc32(w); lset(w, L_TMP);
      emitAdvPc(w, 4);
      iconst(w, BT_BASE); lget(w, L_BT_SP); w.push(I32_ADD);
      iconst(w, BT_FRAME_SIZE); w.push(I32_SUB);
      iconst(w, 4); w.push(I32_ADD);
      lget(w, L_POS);
      w.push(I32_STORE, ...uleb(2), ...uleb(0));
      iconst(w, BT_BASE); lget(w, L_BT_SP); w.push(I32_ADD);
      iconst(w, BT_FRAME_SIZE); w.push(I32_SUB);
      iconst(w, 8); w.push(I32_ADD);
      lget(w, L_CALL_SP);
      w.push(I32_STORE, ...uleb(2), ...uleb(0));
      lget(w, L_TMP); lset(w, L_PC);
      w.push(BR, ...uleb(loopDepth));
      break;
    }
    case VmOp.BACK_COMMIT: {
      emitAdvPc(w, 1);
      emitLoadBc32(w); lset(w, L_TMP);
      emitAdvPc(w, 4);
      lget(w, L_BT_SP); iconst(w, BT_FRAME_SIZE); w.push(I32_SUB); lset(w, L_BT_SP);
      iconst(w, BT_BASE); lget(w, L_BT_SP); w.push(I32_ADD); iconst(w, 4); w.push(I32_ADD);
      w.push(I32_LOAD, ...uleb(2), ...uleb(0));
      lset(w, L_POS);
      iconst(w, BT_BASE); lget(w, L_BT_SP); w.push(I32_ADD); iconst(w, 8); w.push(I32_ADD);
      w.push(I32_LOAD, ...uleb(2), ...uleb(0));
      lset(w, L_CALL_SP);
      lget(w, L_TMP); lset(w, L_PC);
      w.push(BR, ...uleb(loopDepth));
      break;
    }
    case VmOp.SPAN_BITSET: {
      emitAdvPc(w, 1);
      emitLoadBc16(w); lset(w, L_TMP);
      emitAdvPc(w, 2);
      w.push(BLOCK, VOID);
      w.push(LOOP, VOID);
      lget(w, L_POS); lget(w, L_IN_LEN); w.push(I32_GE_U);
      w.push(BR_IF, ...uleb(1));
      emitLoadInputByte(w); ltee(w, L_TMP2);
      iconst(w, 5); w.push(I32_SHR_U); iconst(w, 2); w.push(I32_SHL);
      lget(w, L_TMP); w.push(I32_ADD); iconst(w, DATA_BASE); w.push(I32_ADD);
      w.push(I32_LOAD, ...uleb(2), ...uleb(0));
      iconst(w, 1); lget(w, L_TMP2); iconst(w, 31); w.push(I32_AND); w.push(I32_SHL);
      w.push(I32_AND);
      iconst(w, 0); w.push(I32_EQ);
      w.push(BR_IF, ...uleb(1));
      lget(w, L_POS); iconst(w, 1); w.push(I32_ADD); lset(w, L_POS);
      w.push(BR, ...uleb(0));
      w.push(END, END);
      w.push(BR, ...uleb(loopDepth));
      break;
    }
    default:
      iconst(w, -2); w.push(RETURN);
      break;
  }
}

let vmModule: WebAssembly.Module | null = null;
let vmInstance: WebAssembly.Instance | null = null;
let vmMemory: WebAssembly.Memory | null = null;
let vmExecFn: ((bcLen: number, inLen: number) => number) | null = null;
let vmView: Uint8Array | null = null;
let vmBufLen = 0;

function ensureVm(): boolean {
  if (vmExecFn) return true;
  try {
    const binary = buildVmWasm();
    vmModule = new WebAssembly.Module(binary as BufferSource);
    vmInstance = new WebAssembly.Instance(vmModule);
    vmMemory = vmInstance.exports.memory as WebAssembly.Memory;
    vmExecFn = vmInstance.exports.vm_exec as (bcLen: number, inLen: number) => number;
    vmView = new Uint8Array(vmMemory.buffer);
    vmBufLen = vmMemory.buffer.byteLength;
    return true;
  } catch {
    return false;
  }
}

function ensureCapacity(needed: number): boolean {
  if (needed <= vmBufLen) return true;
  try {
    vmMemory!.grow(Math.ceil((needed - vmBufLen) / 65536) + 1);
    vmView = new Uint8Array(vmMemory!.buffer);
    vmBufLen = vmMemory!.buffer.byteLength;
    return true;
  } catch {
    return false;
  }
}

const vmProgramCache = new WeakMap<CompiledProgram, VmProgram>();

export function vmMatch(cp: CompiledProgram, input: Uint8Array): number {
  if (!ensureVm()) return -2;

  let vp = (cp as any).__vmProg as VmProgram | undefined;
  if (!vp) {
    vp = vmProgramCache.get(cp);
    if (!vp) {
      try { vp = vmCompile(cp); } catch { return -2; }
      vmProgramCache.set(cp, vp);
    }
    try { (cp as any).__vmProg = vp; } catch {}
  }

  const bcLen = vp.bytecode.length;
  const dataLen = vp.data.length;
  const inLen = input.length;
  const totalNeeded = INPUT_BASE + inLen + 0x40000;
  if (!ensureCapacity(totalNeeded)) return -2;

  vmView!.set(vp.bytecode, BC_BASE);
  if (dataLen > 0) vmView!.set(vp.data, DATA_BASE);
  vmView!.set(input, INPUT_BASE);

  return vmExecFn!(bcLen, inLen);
}

export function vmMatchString(cp: CompiledProgram, input: string): number {
  const enc = new TextEncoder();
  const bytes = enc.encode(input);
  const consumed = vmMatch(cp, bytes);
  if (consumed === bytes.length) return input.length;
  return consumed;
}

const TREE_OUT_BASE = 0x140040;
const TREE_SP_ADDR = 0x30;
const TREE_BT_FRAME_SIZE = 16;

const TL_BC_LEN = 0;
const TL_IN_LEN = 1;
const TL_PC = 2;
const TL_POS = 3;
const TL_BT_SP = 4;
const TL_CALL_SP = 5;
const TL_TMP = 6;
const TL_TMP2 = 7;
const TL_TMP3 = 8;
const TL_OP = 9;
const TL_TREE_SP = 10;

const TREE_NUM_OPCODES = 24;

function tlget(w: number[], l: number) { w.push(LOCAL_GET, ...uleb(l)); }
function tlset(w: number[], l: number) { w.push(LOCAL_SET, ...uleb(l)); }
function tltee(w: number[], l: number) { w.push(LOCAL_TEE, ...uleb(l)); }
function ticonst(w: number[], v: number) { w.push(I32_CONST, ...sleb(v)); }

function emitTreeLoadInputByte(w: number[]) {
  ticonst(w, INPUT_BASE); tlget(w, TL_POS); w.push(I32_ADD);
  w.push(I32_LOAD8_U, ...uleb(0), ...uleb(0));
}

function emitTreeLoadBcByte(w: number[]) {
  ticonst(w, BC_BASE); tlget(w, TL_PC); w.push(I32_ADD);
  w.push(I32_LOAD8_U, ...uleb(0), ...uleb(0));
}

function emitTreeLoadBc16(w: number[]) {
  ticonst(w, BC_BASE); tlget(w, TL_PC); w.push(I32_ADD);
  w.push(I32_LOAD16_U, ...uleb(0), ...uleb(0));
}

function emitTreeLoadBc32(w: number[]) {
  ticonst(w, BC_BASE); tlget(w, TL_PC); w.push(I32_ADD);
  w.push(I32_LOAD, ...uleb(2), ...uleb(0));
}

function emitTreeAdvPc(w: number[], n: number) {
  tlget(w, TL_PC); ticonst(w, n); w.push(I32_ADD); tlset(w, TL_PC);
}

function emitTreeBoundsCheck(w: number[]) {
  tlget(w, TL_POS); tlget(w, TL_IN_LEN); w.push(I32_GE_U);
}

function emitTreeBsCheck(w: number[], dataIdxLocal: number, byteLocal: number) {
  tlget(w, byteLocal); ticonst(w, 5); w.push(I32_SHR_U); ticonst(w, 2); w.push(I32_SHL);
  tlget(w, dataIdxLocal); w.push(I32_ADD); ticonst(w, DATA_BASE); w.push(I32_ADD);
  w.push(I32_LOAD, ...uleb(2), ...uleb(0));
  ticonst(w, 1); tlget(w, byteLocal); ticonst(w, 31); w.push(I32_AND); w.push(I32_SHL);
  w.push(I32_AND);
}

function emitTreeBtPush(w: number[]) {
  ticonst(w, BT_BASE); tlget(w, TL_BT_SP); w.push(I32_ADD);
  tlget(w, TL_TMP);
  w.push(I32_STORE, ...uleb(2), ...uleb(0));
  ticonst(w, BT_BASE); tlget(w, TL_BT_SP); w.push(I32_ADD); ticonst(w, 4); w.push(I32_ADD);
  tlget(w, TL_POS);
  w.push(I32_STORE, ...uleb(2), ...uleb(0));
  ticonst(w, BT_BASE); tlget(w, TL_BT_SP); w.push(I32_ADD); ticonst(w, 8); w.push(I32_ADD);
  tlget(w, TL_CALL_SP);
  w.push(I32_STORE, ...uleb(2), ...uleb(0));
  ticonst(w, BT_BASE); tlget(w, TL_BT_SP); w.push(I32_ADD); ticonst(w, 12); w.push(I32_ADD);
  tlget(w, TL_TREE_SP);
  w.push(I32_STORE, ...uleb(2), ...uleb(0));
  tlget(w, TL_BT_SP); ticonst(w, TREE_BT_FRAME_SIZE); w.push(I32_ADD); tlset(w, TL_BT_SP);
}

function emitTreeBtPop(w: number[]) {
  tlget(w, TL_BT_SP); ticonst(w, TREE_BT_FRAME_SIZE); w.push(I32_SUB); tlset(w, TL_BT_SP);
  ticonst(w, BT_BASE); tlget(w, TL_BT_SP); w.push(I32_ADD);
  w.push(I32_LOAD, ...uleb(2), ...uleb(0));
  tlset(w, TL_PC);
  ticonst(w, BT_BASE); tlget(w, TL_BT_SP); w.push(I32_ADD); ticonst(w, 4); w.push(I32_ADD);
  w.push(I32_LOAD, ...uleb(2), ...uleb(0));
  tlset(w, TL_POS);
  ticonst(w, BT_BASE); tlget(w, TL_BT_SP); w.push(I32_ADD); ticonst(w, 8); w.push(I32_ADD);
  w.push(I32_LOAD, ...uleb(2), ...uleb(0));
  tlset(w, TL_CALL_SP);
  ticonst(w, BT_BASE); tlget(w, TL_BT_SP); w.push(I32_ADD); ticonst(w, 12); w.push(I32_ADD);
  w.push(I32_LOAD, ...uleb(2), ...uleb(0));
  tlset(w, TL_TREE_SP);
}

function emitTreeFail(w: number[], loopBr: number) {
  tlget(w, TL_BT_SP); ticonst(w, 0); w.push(I32_LE_S);
  w.push(IF, VOID);
    ticonst(w, -1); w.push(RETURN);
  w.push(END);
  emitTreeBtPop(w);
  w.push(BR, ...uleb(loopBr));
}

function emitTreeEvent(w: number[], evType: number) {
  ticonst(w, TREE_OUT_BASE); tlget(w, TL_TREE_SP); w.push(I32_ADD);
  ticonst(w, evType);
  w.push(I32_STORE, ...uleb(2), ...uleb(0));
  ticonst(w, TREE_OUT_BASE); tlget(w, TL_TREE_SP); w.push(I32_ADD); ticonst(w, 4); w.push(I32_ADD);
  tlget(w, TL_POS);
  w.push(I32_STORE, ...uleb(2), ...uleb(0));
  tlget(w, TL_TREE_SP); ticonst(w, 8); w.push(I32_ADD); tlset(w, TL_TREE_SP);
}

function emitTreeEventWithRule(w: number[], evType: number) {
  emitTreeAdvPc(w, 1);
  emitTreeLoadBc16(w); tlset(w, TL_TMP);
  emitTreeAdvPc(w, 2);
  ticonst(w, TREE_OUT_BASE); tlget(w, TL_TREE_SP); w.push(I32_ADD);
  ticonst(w, evType); tlget(w, TL_TMP); ticonst(w, 16); w.push(I32_SHL); w.push(I32_OR);
  w.push(I32_STORE, ...uleb(2), ...uleb(0));
  ticonst(w, TREE_OUT_BASE); tlget(w, TL_TREE_SP); w.push(I32_ADD); ticonst(w, 4); w.push(I32_ADD);
  tlget(w, TL_POS);
  w.push(I32_STORE, ...uleb(2), ...uleb(0));
  tlget(w, TL_TREE_SP); ticonst(w, 8); w.push(I32_ADD); tlset(w, TL_TREE_SP);
}

function emitTreeHandler(w: number[], opIdx: number, loopDepth: number, _exitDepth: number): void {
  switch (opIdx) {
    case VmOp.BYTE: {
      emitTreeAdvPc(w, 1);
      w.push(BLOCK, VOID);
      emitTreeBoundsCheck(w);
      w.push(BR_IF, ...uleb(0));
      emitTreeLoadInputByte(w);
      emitTreeLoadBcByte(w);
      w.push(I32_NE);
      w.push(BR_IF, ...uleb(0));
      emitTreeAdvPc(w, 1);
      tlget(w, TL_POS); ticonst(w, 1); w.push(I32_ADD); tlset(w, TL_POS);
      w.push(BR, ...uleb(loopDepth + 1));
      w.push(END);
      emitTreeFail(w, loopDepth);
      break;
    }
    case VmOp.BITSET: {
      emitTreeAdvPc(w, 1);
      w.push(BLOCK, VOID);
      emitTreeBoundsCheck(w);
      w.push(BR_IF, ...uleb(0));
      emitTreeLoadBc16(w); tlset(w, TL_TMP);
      emitTreeAdvPc(w, 2);
      emitTreeLoadInputByte(w); tlset(w, TL_TMP2);
      emitTreeBsCheck(w, TL_TMP, TL_TMP2);
      ticonst(w, 0); w.push(I32_EQ);
      w.push(BR_IF, ...uleb(0));
      tlget(w, TL_POS); ticonst(w, 1); w.push(I32_ADD); tlset(w, TL_POS);
      w.push(BR, ...uleb(loopDepth + 1));
      w.push(END);
      emitTreeFail(w, loopDepth);
      break;
    }
    case VmOp.NOT_BITSET: {
      emitTreeAdvPc(w, 1);
      w.push(BLOCK, VOID);
      emitTreeBoundsCheck(w);
      w.push(BR_IF, ...uleb(0));
      emitTreeLoadBc16(w); tlset(w, TL_TMP);
      emitTreeAdvPc(w, 2);
      emitTreeLoadInputByte(w); tlset(w, TL_TMP2);
      emitTreeBsCheck(w, TL_TMP, TL_TMP2);
      ticonst(w, 0); w.push(I32_NE);
      w.push(BR_IF, ...uleb(0));
      tlget(w, TL_POS); ticonst(w, 1); w.push(I32_ADD); tlset(w, TL_POS);
      w.push(BR, ...uleb(loopDepth + 1));
      w.push(END);
      emitTreeFail(w, loopDepth);
      break;
    }
    case VmOp.TEXT: {
      emitTreeAdvPc(w, 1);
      emitTreeLoadBc16(w); tlset(w, TL_TMP);
      emitTreeAdvPc(w, 2);
      emitTreeLoadBc16(w); tlset(w, TL_TMP2);
      emitTreeAdvPc(w, 2);
      w.push(BLOCK, VOID);
      tlget(w, TL_POS); tlget(w, TL_TMP2); w.push(I32_ADD); tlget(w, TL_IN_LEN); w.push(I32_GT_U);
      w.push(BR_IF, ...uleb(0));
      ticonst(w, 0); tlset(w, TL_TMP3);
      w.push(BLOCK, VOID);
      w.push(LOOP, VOID);
      tlget(w, TL_TMP3); tlget(w, TL_TMP2); w.push(I32_GE_U);
      w.push(BR_IF, ...uleb(1));
      ticonst(w, INPUT_BASE); tlget(w, TL_POS); w.push(I32_ADD); tlget(w, TL_TMP3); w.push(I32_ADD);
      w.push(I32_LOAD8_U, ...uleb(0), ...uleb(0));
      ticonst(w, DATA_BASE); tlget(w, TL_TMP); w.push(I32_ADD); tlget(w, TL_TMP3); w.push(I32_ADD);
      w.push(I32_LOAD8_U, ...uleb(0), ...uleb(0));
      w.push(I32_NE);
      w.push(BR_IF, ...uleb(2));
      tlget(w, TL_TMP3); ticonst(w, 1); w.push(I32_ADD); tlset(w, TL_TMP3);
      w.push(BR, ...uleb(0));
      w.push(END, END);
      tlget(w, TL_POS); tlget(w, TL_TMP2); w.push(I32_ADD); tlset(w, TL_POS);
      w.push(BR, ...uleb(loopDepth + 1));
      w.push(END);
      emitTreeFail(w, loopDepth);
      break;
    }
    case VmOp.ANY: {
      emitTreeAdvPc(w, 1);
      w.push(BLOCK, VOID);
      emitTreeBoundsCheck(w);
      w.push(BR_IF, ...uleb(0));
      emitTreeLoadInputByte(w); tlset(w, TL_TMP);
      tlget(w, TL_TMP); ticonst(w, 0x80); w.push(I32_LT_U);
      w.push(IF, VOID);
        tlget(w, TL_POS); ticonst(w, 1); w.push(I32_ADD); tlset(w, TL_POS);
      w.push(ELSE);
        tlget(w, TL_TMP); ticonst(w, 0xE0); w.push(I32_LT_U);
        w.push(IF, VOID);
          tlget(w, TL_POS); ticonst(w, 2); w.push(I32_ADD); tlset(w, TL_POS);
        w.push(ELSE);
          tlget(w, TL_TMP); ticonst(w, 0xF0); w.push(I32_LT_U);
          w.push(IF, VOID);
            tlget(w, TL_POS); ticonst(w, 3); w.push(I32_ADD); tlset(w, TL_POS);
          w.push(ELSE);
            tlget(w, TL_POS); ticonst(w, 4); w.push(I32_ADD); tlset(w, TL_POS);
          w.push(END);
        w.push(END);
      w.push(END);
      tlget(w, TL_POS); tlget(w, TL_IN_LEN); w.push(I32_GT_U);
      w.push(BR_IF, ...uleb(0));
      w.push(BR, ...uleb(loopDepth + 1));
      w.push(END);
      emitTreeFail(w, loopDepth);
      break;
    }
    case VmOp.RANGE: {
      emitTreeAdvPc(w, 1);
      w.push(BLOCK, VOID);
      emitTreeBoundsCheck(w);
      w.push(BR_IF, ...uleb(0));
      emitTreeLoadInputByte(w); tlset(w, TL_TMP);
      emitTreeLoadBcByte(w); tlset(w, TL_TMP2);
      emitTreeAdvPc(w, 1);
      emitTreeLoadBcByte(w); tlset(w, TL_TMP3);
      emitTreeAdvPc(w, 1);
      tlget(w, TL_TMP); tlget(w, TL_TMP2); w.push(I32_SUB);
      tlget(w, TL_TMP3); tlget(w, TL_TMP2); w.push(I32_SUB);
      w.push(I32_GT_U);
      w.push(BR_IF, ...uleb(0));
      tlget(w, TL_POS); ticonst(w, 1); w.push(I32_ADD); tlset(w, TL_POS);
      w.push(BR, ...uleb(loopDepth + 1));
      w.push(END);
      emitTreeFail(w, loopDepth);
      break;
    }
    case VmOp.CHOICE: {
      emitTreeAdvPc(w, 1);
      emitTreeLoadBc32(w); tlset(w, TL_TMP);
      emitTreeAdvPc(w, 4);
      emitTreeBtPush(w);
      w.push(BR, ...uleb(loopDepth));
      break;
    }
    case VmOp.COMMIT: {
      emitTreeAdvPc(w, 1);
      emitTreeLoadBc32(w); tlset(w, TL_TMP);
      emitTreeAdvPc(w, 4);
      tlget(w, TL_BT_SP); ticonst(w, TREE_BT_FRAME_SIZE); w.push(I32_SUB); tlset(w, TL_BT_SP);
      tlget(w, TL_TMP); tlset(w, TL_PC);
      w.push(BR, ...uleb(loopDepth));
      break;
    }
    case VmOp.FAIL: {
      tlget(w, TL_BT_SP); ticonst(w, 0); w.push(I32_LE_S);
      w.push(IF, VOID);
        ticonst(w, -1); w.push(RETURN);
      w.push(END);
      emitTreeBtPop(w);
      w.push(BR, ...uleb(loopDepth));
      break;
    }
    case VmOp.JUMP: {
      emitTreeAdvPc(w, 1);
      emitTreeLoadBc32(w); tlset(w, TL_PC);
      w.push(BR, ...uleb(loopDepth));
      break;
    }
    case VmOp.CALL: {
      emitTreeAdvPc(w, 1);
      emitTreeLoadBc32(w); tlset(w, TL_TMP);
      emitTreeAdvPc(w, 4);
      ticonst(w, CALL_BASE); tlget(w, TL_CALL_SP); ticonst(w, 4); w.push(I32_MUL); w.push(I32_ADD);
      tlget(w, TL_PC);
      w.push(I32_STORE, ...uleb(2), ...uleb(0));
      tlget(w, TL_CALL_SP); ticonst(w, 1); w.push(I32_ADD); tlset(w, TL_CALL_SP);
      tlget(w, TL_TMP); tlset(w, TL_PC);
      w.push(BR, ...uleb(loopDepth));
      break;
    }
    case VmOp.RET: {
      tlget(w, TL_CALL_SP); ticonst(w, 0); w.push(I32_LE_S);
      w.push(IF, VOID);
        tlget(w, TL_POS); w.push(RETURN);
      w.push(END);
      tlget(w, TL_CALL_SP); ticonst(w, 1); w.push(I32_SUB); tlset(w, TL_CALL_SP);
      ticonst(w, CALL_BASE); tlget(w, TL_CALL_SP); ticonst(w, 4); w.push(I32_MUL); w.push(I32_ADD);
      w.push(I32_LOAD, ...uleb(2), ...uleb(0));
      tlset(w, TL_PC);
      w.push(BR, ...uleb(loopDepth));
      break;
    }
    case VmOp.MATCH: {
      ticonst(w, TREE_SP_ADDR);
      tlget(w, TL_TREE_SP);
      w.push(I32_STORE, ...uleb(2), ...uleb(0));
      tlget(w, TL_POS); w.push(RETURN);
      break;
    }
    case VmOp.REP_BITSET: {
      emitTreeAdvPc(w, 1);
      emitTreeLoadBc16(w); tlset(w, TL_TMP);
      emitTreeAdvPc(w, 2);
      emitTreeLoadBc16(w); tlset(w, TL_TMP2);
      emitTreeAdvPc(w, 2);
      emitTreeLoadBc16(w); tlset(w, TL_TMP3);
      emitTreeAdvPc(w, 2);
      tlget(w, TL_POS); tlset(w, TL_OP);
      w.push(BLOCK, VOID);
      w.push(LOOP, VOID);
      tlget(w, TL_POS); tlget(w, TL_IN_LEN); w.push(I32_GE_U);
      w.push(BR_IF, ...uleb(1));
      tlget(w, TL_TMP3); ticonst(w, 0xFFFF); w.push(I32_NE);
      w.push(IF, VOID);
        tlget(w, TL_POS); tlget(w, TL_OP); w.push(I32_SUB);
        tlget(w, TL_TMP3); w.push(I32_GE_U);
        w.push(BR_IF, ...uleb(2));
      w.push(END);
      emitTreeLoadInputByte(w); tltee(w, TL_CALL_SP);
      ticonst(w, 5); w.push(I32_SHR_U); ticonst(w, 2); w.push(I32_SHL);
      tlget(w, TL_TMP); w.push(I32_ADD); ticonst(w, DATA_BASE); w.push(I32_ADD);
      w.push(I32_LOAD, ...uleb(2), ...uleb(0));
      ticonst(w, 1); tlget(w, TL_CALL_SP); ticonst(w, 31); w.push(I32_AND); w.push(I32_SHL);
      w.push(I32_AND);
      ticonst(w, 0); w.push(I32_EQ);
      w.push(BR_IF, ...uleb(1));
      tlget(w, TL_POS); ticonst(w, 1); w.push(I32_ADD); tlset(w, TL_POS);
      w.push(BR, ...uleb(0));
      w.push(END, END);
      tlget(w, TL_POS); tlget(w, TL_OP); w.push(I32_SUB);
      tlget(w, TL_TMP2); w.push(I32_LT_U);
      w.push(IF, VOID);
        emitTreeFail(w, loopDepth + 1);
      w.push(END);
      w.push(BR, ...uleb(loopDepth));
      break;
    }
    case VmOp.REP_BYTE: {
      emitTreeAdvPc(w, 1);
      emitTreeLoadBcByte(w); tlset(w, TL_TMP);
      emitTreeAdvPc(w, 1);
      emitTreeLoadBc16(w); tlset(w, TL_TMP2);
      emitTreeAdvPc(w, 2);
      emitTreeLoadBc16(w); tlset(w, TL_TMP3);
      emitTreeAdvPc(w, 2);
      tlget(w, TL_POS); tlset(w, TL_OP);
      w.push(BLOCK, VOID);
      w.push(LOOP, VOID);
      tlget(w, TL_POS); tlget(w, TL_IN_LEN); w.push(I32_GE_U);
      w.push(BR_IF, ...uleb(1));
      tlget(w, TL_TMP3); ticonst(w, 0xFFFF); w.push(I32_NE);
      w.push(IF, VOID);
        tlget(w, TL_POS); tlget(w, TL_OP); w.push(I32_SUB);
        tlget(w, TL_TMP3); w.push(I32_GE_U);
        w.push(BR_IF, ...uleb(2));
      w.push(END);
      emitTreeLoadInputByte(w);
      tlget(w, TL_TMP); w.push(I32_NE);
      w.push(BR_IF, ...uleb(1));
      tlget(w, TL_POS); ticonst(w, 1); w.push(I32_ADD); tlset(w, TL_POS);
      w.push(BR, ...uleb(0));
      w.push(END, END);
      tlget(w, TL_POS); tlget(w, TL_OP); w.push(I32_SUB);
      tlget(w, TL_TMP2); w.push(I32_LT_U);
      w.push(IF, VOID);
        emitTreeFail(w, loopDepth + 1);
      w.push(END);
      w.push(BR, ...uleb(loopDepth));
      break;
    }
    case VmOp.REP_RANGE: {
      emitTreeAdvPc(w, 1);
      emitTreeLoadBcByte(w); tlset(w, TL_TMP);
      emitTreeAdvPc(w, 1);
      emitTreeLoadBcByte(w); tlset(w, TL_TMP2);
      emitTreeAdvPc(w, 1);
      emitTreeLoadBc16(w); tlset(w, TL_TMP3);
      emitTreeAdvPc(w, 2);
      emitTreeLoadBc16(w); tlset(w, TL_OP);
      emitTreeAdvPc(w, 2);
      tlget(w, TL_POS); tlset(w, TL_CALL_SP);
      w.push(BLOCK, VOID);
      w.push(LOOP, VOID);
      tlget(w, TL_POS); tlget(w, TL_IN_LEN); w.push(I32_GE_U);
      w.push(BR_IF, ...uleb(1));
      tlget(w, TL_OP); ticonst(w, 0xFFFF); w.push(I32_NE);
      w.push(IF, VOID);
        tlget(w, TL_POS); tlget(w, TL_CALL_SP); w.push(I32_SUB);
        tlget(w, TL_OP); w.push(I32_GE_U);
        w.push(BR_IF, ...uleb(2));
      w.push(END);
      emitTreeLoadInputByte(w);
      tlget(w, TL_TMP); w.push(I32_SUB);
      tlget(w, TL_TMP2); tlget(w, TL_TMP); w.push(I32_SUB);
      w.push(I32_GT_U);
      w.push(BR_IF, ...uleb(1));
      tlget(w, TL_POS); ticonst(w, 1); w.push(I32_ADD); tlset(w, TL_POS);
      w.push(BR, ...uleb(0));
      w.push(END, END);
      tlget(w, TL_POS); tlget(w, TL_CALL_SP); w.push(I32_SUB);
      tlget(w, TL_TMP3); w.push(I32_LT_U);
      w.push(IF, VOID);
        emitTreeFail(w, loopDepth + 1);
      w.push(END);
      w.push(BR, ...uleb(loopDepth));
      break;
    }
    case VmOp.JOINED_BYTE_BITSET: {
      emitTreeAdvPc(w, 1);
      emitTreeLoadBc16(w); tlset(w, TL_TMP);
      emitTreeAdvPc(w, 2);
      emitTreeLoadBcByte(w); tlset(w, TL_TMP2);
      emitTreeAdvPc(w, 1);
      emitTreeLoadBc16(w); tlset(w, TL_TMP3);
      emitTreeAdvPc(w, 2);
      w.push(BLOCK, VOID);
      emitTreeBoundsCheck(w);
      w.push(BR_IF, ...uleb(0));
      emitTreeLoadInputByte(w); tltee(w, TL_OP);
      ticonst(w, 5); w.push(I32_SHR_U); ticonst(w, 2); w.push(I32_SHL);
      tlget(w, TL_TMP); w.push(I32_ADD); ticonst(w, DATA_BASE); w.push(I32_ADD);
      w.push(I32_LOAD, ...uleb(2), ...uleb(0));
      ticonst(w, 1); tlget(w, TL_OP); ticonst(w, 31); w.push(I32_AND); w.push(I32_SHL);
      w.push(I32_AND);
      ticonst(w, 0); w.push(I32_EQ);
      w.push(BR_IF, ...uleb(0));
      tlget(w, TL_POS); ticonst(w, 1); w.push(I32_ADD); tlset(w, TL_POS);
      w.push(BLOCK, VOID);
      w.push(LOOP, VOID);
      tlget(w, TL_POS); tlget(w, TL_IN_LEN); w.push(I32_GE_U);
      w.push(BR_IF, ...uleb(1));
      emitTreeLoadInputByte(w); tltee(w, TL_OP);
      ticonst(w, 5); w.push(I32_SHR_U); ticonst(w, 2); w.push(I32_SHL);
      tlget(w, TL_TMP); w.push(I32_ADD); ticonst(w, DATA_BASE); w.push(I32_ADD);
      w.push(I32_LOAD, ...uleb(2), ...uleb(0));
      ticonst(w, 1); tlget(w, TL_OP); ticonst(w, 31); w.push(I32_AND); w.push(I32_SHL);
      w.push(I32_AND);
      ticonst(w, 0); w.push(I32_NE);
      w.push(IF, VOID);
        tlget(w, TL_POS); ticonst(w, 1); w.push(I32_ADD); tlset(w, TL_POS);
        w.push(BR, ...uleb(1));
      w.push(END);
      tlget(w, TL_OP); tlget(w, TL_TMP2); w.push(I32_NE);
      w.push(BR_IF, ...uleb(1));
      tlget(w, TL_POS); ticonst(w, 1); w.push(I32_ADD); tlget(w, TL_IN_LEN); w.push(I32_GE_U);
      w.push(BR_IF, ...uleb(1));
      ticonst(w, INPUT_BASE); tlget(w, TL_POS); w.push(I32_ADD); ticonst(w, 1); w.push(I32_ADD);
      w.push(I32_LOAD8_U, ...uleb(0), ...uleb(0));
      tltee(w, TL_CALL_SP);
      ticonst(w, 5); w.push(I32_SHR_U); ticonst(w, 2); w.push(I32_SHL);
      tlget(w, TL_TMP); w.push(I32_ADD); ticonst(w, DATA_BASE); w.push(I32_ADD);
      w.push(I32_LOAD, ...uleb(2), ...uleb(0));
      ticonst(w, 1); tlget(w, TL_CALL_SP); ticonst(w, 31); w.push(I32_AND); w.push(I32_SHL);
      w.push(I32_AND);
      ticonst(w, 0); w.push(I32_EQ);
      w.push(BR_IF, ...uleb(1));
      tlget(w, TL_POS); ticonst(w, 2); w.push(I32_ADD); tlset(w, TL_POS);
      w.push(BR, ...uleb(0));
      w.push(END, END);
      w.push(BR, ...uleb(loopDepth + 1));
      w.push(END);
      emitTreeFail(w, loopDepth);
      break;
    }
    case VmOp.PARTIAL_COMMIT: {
      emitTreeAdvPc(w, 1);
      emitTreeLoadBc32(w); tlset(w, TL_TMP);
      emitTreeAdvPc(w, 4);
      ticonst(w, BT_BASE); tlget(w, TL_BT_SP); w.push(I32_ADD);
      ticonst(w, TREE_BT_FRAME_SIZE); w.push(I32_SUB);
      ticonst(w, 4); w.push(I32_ADD);
      tlget(w, TL_POS);
      w.push(I32_STORE, ...uleb(2), ...uleb(0));
      ticonst(w, BT_BASE); tlget(w, TL_BT_SP); w.push(I32_ADD);
      ticonst(w, TREE_BT_FRAME_SIZE); w.push(I32_SUB);
      ticonst(w, 8); w.push(I32_ADD);
      tlget(w, TL_CALL_SP);
      w.push(I32_STORE, ...uleb(2), ...uleb(0));
      ticonst(w, BT_BASE); tlget(w, TL_BT_SP); w.push(I32_ADD);
      ticonst(w, TREE_BT_FRAME_SIZE); w.push(I32_SUB);
      ticonst(w, 12); w.push(I32_ADD);
      tlget(w, TL_TREE_SP);
      w.push(I32_STORE, ...uleb(2), ...uleb(0));
      tlget(w, TL_TMP); tlset(w, TL_PC);
      w.push(BR, ...uleb(loopDepth));
      break;
    }
    case VmOp.BACK_COMMIT: {
      emitTreeAdvPc(w, 1);
      emitTreeLoadBc32(w); tlset(w, TL_TMP);
      emitTreeAdvPc(w, 4);
      tlget(w, TL_BT_SP); ticonst(w, TREE_BT_FRAME_SIZE); w.push(I32_SUB); tlset(w, TL_BT_SP);
      ticonst(w, BT_BASE); tlget(w, TL_BT_SP); w.push(I32_ADD); ticonst(w, 4); w.push(I32_ADD);
      w.push(I32_LOAD, ...uleb(2), ...uleb(0));
      tlset(w, TL_POS);
      ticonst(w, BT_BASE); tlget(w, TL_BT_SP); w.push(I32_ADD); ticonst(w, 8); w.push(I32_ADD);
      w.push(I32_LOAD, ...uleb(2), ...uleb(0));
      tlset(w, TL_CALL_SP);
      ticonst(w, BT_BASE); tlget(w, TL_BT_SP); w.push(I32_ADD); ticonst(w, 12); w.push(I32_ADD);
      w.push(I32_LOAD, ...uleb(2), ...uleb(0));
      tlset(w, TL_TREE_SP);
      tlget(w, TL_TMP); tlset(w, TL_PC);
      w.push(BR, ...uleb(loopDepth));
      break;
    }
    case VmOp.SPAN_BITSET: {
      emitTreeAdvPc(w, 1);
      emitTreeLoadBc16(w); tlset(w, TL_TMP);
      emitTreeAdvPc(w, 2);
      w.push(BLOCK, VOID);
      w.push(LOOP, VOID);
      tlget(w, TL_POS); tlget(w, TL_IN_LEN); w.push(I32_GE_U);
      w.push(BR_IF, ...uleb(1));
      emitTreeLoadInputByte(w); tltee(w, TL_TMP2);
      ticonst(w, 5); w.push(I32_SHR_U); ticonst(w, 2); w.push(I32_SHL);
      tlget(w, TL_TMP); w.push(I32_ADD); ticonst(w, DATA_BASE); w.push(I32_ADD);
      w.push(I32_LOAD, ...uleb(2), ...uleb(0));
      ticonst(w, 1); tlget(w, TL_TMP2); ticonst(w, 31); w.push(I32_AND); w.push(I32_SHL);
      w.push(I32_AND);
      ticonst(w, 0); w.push(I32_EQ);
      w.push(BR_IF, ...uleb(1));
      tlget(w, TL_POS); ticonst(w, 1); w.push(I32_ADD); tlset(w, TL_POS);
      w.push(BR, ...uleb(0));
      w.push(END, END);
      w.push(BR, ...uleb(loopDepth));
      break;
    }
    case VmOp.RULE_ENTER: {
      emitTreeEventWithRule(w, 0);
      w.push(BR, ...uleb(loopDepth));
      break;
    }
    case VmOp.RULE_EXIT: {
      emitTreeAdvPc(w, 1);
      emitTreeEvent(w, 1);
      w.push(BR, ...uleb(loopDepth));
      break;
    }
    case VmOp.EXTRACT_ENTER: {
      emitTreeAdvPc(w, 1);
      emitTreeEvent(w, 2);
      w.push(BR, ...uleb(loopDepth));
      break;
    }
    case VmOp.EXTRACT_EXIT: {
      emitTreeAdvPc(w, 1);
      emitTreeEvent(w, 3);
      w.push(BR, ...uleb(loopDepth));
      break;
    }
    default:
      ticonst(w, -2); w.push(RETURN);
      break;
  }
}

export function buildVmTreeWasm(): Uint8Array {
  const body: number[] = [];
  body.push(1, 11, I32);

  ticonst(body, 0); tlset(body, TL_PC);
  ticonst(body, 0); tlset(body, TL_POS);
  ticonst(body, 0); tlset(body, TL_BT_SP);
  ticonst(body, 0); tlset(body, TL_CALL_SP);
  ticonst(body, 0); tlset(body, TL_TREE_SP);

  body.push(BLOCK, VOID);
  body.push(LOOP, VOID);

  tlget(body, TL_PC); tlget(body, TL_BC_LEN); body.push(I32_GE_U);
  body.push(BR_IF, ...uleb(1));

  emitTreeLoadBcByte(body);
  tlset(body, TL_OP);

  for (let i = 0; i < TREE_NUM_OPCODES; i++) {
    body.push(BLOCK, VOID);
  }

  tlget(body, TL_OP);
  body.push(BR_TABLE, ...uleb(TREE_NUM_OPCODES));
  for (let i = 0; i < TREE_NUM_OPCODES; i++) body.push(...uleb(i));
  body.push(...uleb(TREE_NUM_OPCODES - 1));

  for (let i = 0; i < TREE_NUM_OPCODES; i++) {
    body.push(END);
    const loopDepth = TREE_NUM_OPCODES - 1 - i;
    const exitDepth = loopDepth + 1;
    emitTreeHandler(body, i, loopDepth, exitDepth);
  }

  body.push(END, END);
  ticonst(body, -2); body.push(RETURN);
  body.push(END);

  const funcType: number[] = [1, 0x60, 2, I32, I32, 1, I32];
  const funcSec: number[] = [1, 0];
  const memSec: number[] = [1, 0x01, ...uleb(30), ...uleb(256)];
  const exportSec: number[] = [
    2,
    7, 0x76, 0x6D, 0x5F, 0x65, 0x78, 0x65, 0x63, 0x00, 0,
    6, 0x6D, 0x65, 0x6D, 0x6F, 0x72, 0x79, 0x02, 0,
  ];
  const codeSec: number[] = [1, ...uleb(body.length), ...body];

  const out: number[] = [0x00, 0x61, 0x73, 0x6D, 0x01, 0x00, 0x00, 0x00];
  out.push(...sec(1, funcType));
  out.push(...sec(3, funcSec));
  out.push(...sec(5, memSec));
  out.push(...sec(7, exportSec));
  out.push(...sec(10, codeSec));

  return new Uint8Array(out);
}

let vmtModule: WebAssembly.Module | null = null;
let vmtInstance: WebAssembly.Instance | null = null;
let vmtMemory: WebAssembly.Memory | null = null;
let vmtExecFn: ((bcLen: number, inLen: number) => number) | null = null;
let vmtView: Uint8Array | null = null;
let vmtView32: Uint32Array | null = null;
let vmtBufLen = 0;

function ensureVmTree(): boolean {
  if (vmtExecFn) return true;
  try {
    const binary = buildVmTreeWasm();
    vmtModule = new WebAssembly.Module(binary as BufferSource);
    vmtInstance = new WebAssembly.Instance(vmtModule);
    vmtMemory = vmtInstance.exports.memory as WebAssembly.Memory;
    vmtExecFn = vmtInstance.exports.vm_exec as (bcLen: number, inLen: number) => number;
    vmtView = new Uint8Array(vmtMemory.buffer);
    vmtView32 = new Uint32Array(vmtMemory.buffer);
    vmtBufLen = vmtMemory.buffer.byteLength;
    return true;
  } catch {
    return false;
  }
}

function ensureTreeCapacity(needed: number): boolean {
  if (needed <= vmtBufLen) return true;
  try {
    vmtMemory!.grow(Math.ceil((needed - vmtBufLen) / 65536) + 1);
    vmtView = new Uint8Array(vmtMemory!.buffer);
    vmtView32 = new Uint32Array(vmtMemory!.buffer);
    vmtBufLen = vmtMemory!.buffer.byteLength;
    return true;
  } catch {
    return false;
  }
}

const vmTreeProgramCache = new WeakMap<CompiledProgram, VmProgram>();
const treeEnc = new TextEncoder();

export interface VmTreeResult {
  consumed: number;
  tree: RuleMatch;
  extracted: RuleMatch[];
}

function buildByteToCharMap(str: string, bytes: Uint8Array): Int32Array | null {
  if (str.length === bytes.length) return null;
  const map = new Int32Array(bytes.length + 1);
  let byteIdx = 0;
  for (let charIdx = 0; charIdx < str.length; charIdx++) {
    map[byteIdx] = charIdx;
    const code = str.codePointAt(charIdx)!;
    let byteLen: number;
    if (code <= 0x7F) byteLen = 1;
    else if (code <= 0x7FF) byteLen = 2;
    else if (code <= 0xFFFF) byteLen = 3;
    else { byteLen = 4; charIdx++; }
    for (let j = 1; j < byteLen; j++) {
      map[byteIdx + j] = charIdx;
    }
    byteIdx += byteLen;
  }
  map[byteIdx] = str.length;
  return map;
}

export function vmMatchTree(cp: CompiledProgram, input: Uint8Array, inputStr: string): VmTreeResult | null {
  if (cp.needsMemo) return null;
  if (!ensureVmTree()) return null;

  let vp = (cp as any).__vmTreeProg as VmProgram | undefined;
  if (!vp) {
    vp = vmTreeProgramCache.get(cp);
    if (!vp) {
      try { vp = vmCompileTree(cp); } catch { return null; }
      vmTreeProgramCache.set(cp, vp);
    }
    try { (cp as any).__vmTreeProg = vp; } catch {}
  }

  const bcLen = vp.bytecode.length;
  const dataLen = vp.data.length;
  const inLen = input.length;
  const totalNeeded = TREE_OUT_BASE + 0x80000;
  if (!ensureTreeCapacity(totalNeeded)) return null;

  vmtView!.set(vp.bytecode, BC_BASE);
  if (dataLen > 0) vmtView!.set(vp.data, DATA_BASE);
  vmtView!.set(input, INPUT_BASE);

  const v32 = vmtView32!;
  v32[TREE_SP_ADDR >>> 2] = 0;

  const consumed = vmtExecFn!(bcLen, inLen);
  if (consumed < 0) return null;

  const ruleNames = cp.ruleNames;
  const treeOutBytes = TREE_OUT_BASE;
  const treeSp = v32[TREE_SP_ADDR >>> 2];
  const eventCount = treeSp >>> 3;

  if (eventCount === 0) {
    return {
      consumed,
      tree: {
        rule: cp.entryPoint,
        start: 0,
        end: consumed,
        text: inputStr.slice(0, consumed),
        children: [],
      },
      extracted: [],
    };
  }

  const b2c = buildByteToCharMap(inputStr, input);
  return rebuildTree(v32, treeOutBytes, eventCount, ruleNames, input, inputStr, consumed, cp.entryPoint, b2c);
}

function rebuildTree(
  v32: Uint32Array, baseBytes: number, eventCount: number,
  ruleNames: string[], input: Uint8Array, inputStr: string,
  consumed: number, entryPoint: string, b2c: Int32Array | null
): VmTreeResult {
  const base32 = baseBytes >>> 2;
  const extracted: RuleMatch[] = [];
  const charPos = (bytePos: number) => b2c ? (b2c[bytePos] ?? bytePos) : bytePos;

  interface StackEntry {
    ruleIdx: number;
    startPos: number;
    children: RuleMatch[];
    isExtract: boolean;
  }

  const stack: StackEntry[] = [];
  let rootTree: RuleMatch | null = null;

  for (let e = 0; e < eventCount; e++) {
    const idx = base32 + e * 2;
    const w0 = v32[idx];
    const pos = v32[idx + 1];
    const evType = w0 & 0xFF;
    const ruleIdx = (w0 >>> 16) & 0xFFFF;

    switch (evType) {
      case 0: {
        stack.push({ ruleIdx, startPos: pos, children: [], isExtract: false });
        break;
      }
      case 1: {
        if (stack.length === 0) break;
        const entry = stack.pop()!;
        const name = ruleNames[entry.ruleIdx] || `rule_${entry.ruleIdx}`;
        const cStart = charPos(entry.startPos);
        const cEnd = charPos(pos);
        const text = inputStr.slice(cStart, cEnd);
        const node: RuleMatch = {
          rule: name,
          start: cStart,
          end: cEnd,
          text,
          children: entry.children,
        };
        if (stack.length > 0) {
          stack[stack.length - 1].children.push(node);
        } else {
          rootTree = node;
        }
        if (entry.isExtract) {
          extracted.push(node);
        }
        break;
      }
      case 2: {
        if (stack.length > 0) {
          stack[stack.length - 1].isExtract = true;
        }
        break;
      }
      case 3: {
        break;
      }
    }
  }

  if (!rootTree) {
    rootTree = {
      rule: entryPoint,
      start: 0,
      end: charPos(consumed),
      text: inputStr.slice(0, charPos(consumed)),
      children: [],
    };
  }

  return { consumed, tree: rootTree, extracted };
}

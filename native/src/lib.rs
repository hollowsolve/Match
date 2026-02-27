#[macro_use]
extern crate napi_derive;

use napi::bindgen_prelude::*;
use napi::{JsObject, JsString, JsUnknown};

const OP_BYTE: u32 = 0;
const OP_BYTE_RANGE: u32 = 1;
const OP_BITSET: u32 = 2;
const OP_NOT_BITSET: u32 = 3;
const OP_TEXT: u32 = 4;
const OP_CC_LETTER: u32 = 5;
const OP_CC_DIGIT: u32 = 6;
const OP_CC_PRINTABLE: u32 = 7;
const OP_CC_VISIBLE: u32 = 8;
const OP_CC_WHITESPACE: u32 = 9;
const OP_CC_ALPHANUM: u32 = 10;
const OP_CC_WORD: u32 = 11;
const OP_CC_ANY: u32 = 12;
const OP_CC_UPPER: u32 = 13;
const OP_CC_LOWER: u32 = 14;
const OP_CC_HEX: u32 = 15;
const OP_SEQ: u32 = 16;
const OP_ALT: u32 = 17;
const OP_REP_ONE_OR_MORE: u32 = 18;
const OP_REP_ZERO_OR_MORE: u32 = 19;
const OP_REP_OPTIONAL: u32 = 20;
const OP_REP_EXACTLY: u32 = 21;
const OP_REP_BETWEEN: u32 = 22;
const OP_JOINED_BY: u32 = 23;
const OP_JOINED_BY_LENIENT: u32 = 24;
const OP_RULE_REF: u32 = 25;
const OP_EXCEPT: u32 = 26;
const OP_NONE_OF: u32 = 27;
const OP_FAST_REPEAT_BITSET: u32 = 28;
const OP_FAST_EXACTLY_BITSET: u32 = 29;
const OP_FAST_BETWEEN_BITSET: u32 = 30;
const OP_FAST_JOINED_BYTE: u32 = 31;
const OP_EXTRACT: u32 = 32;
const OP_UNTIL_INCL: u32 = 33;
const OP_UNTIL_EXCL: u32 = 34;
const OP_ISNT: u32 = 35;
const OP_FAST_SEQ_BYTES: u32 = 36;
const OP_FAST_JOINED_BS_BYTE: u32 = 37;
const OP_FAST_SEQ2: u32 = 38;
const OP_FAST_SEQ3: u32 = 39;
const OP_FAST_REP_BS_ALT: u32 = 40;
const OP_FAST_SEQ_FLAT: u32 = 41;
const OP_FAST_ALT_BYTE_FIRST: u32 = 42;
const OP_FAST_ALT_LEAD_DISPATCH: u32 = 43;

const FOP_BYTE: u32 = 0;
const FOP_BITSET: u32 = 1;
const FOP_EXACTLY_BITSET: u32 = 2;
const FOP_SEQ_BYTES: u32 = 3;
const FOP_BETWEEN_BITSET: u32 = 4;
const FOP_REPEAT_BITSET: u32 = 5;
const FOP_REP_OPTIONAL: u32 = 6;
const FOP_EXEC: u32 = 7;
const FOP_JOINED_BS_BYTE: u32 = 8;
const FOP_JOINED_BYTE: u32 = 9;
const FOP_LITERAL_REPEAT_BS: u32 = 10;
const FOP_MULTI_LITERAL_REPEAT_BS: u32 = 11;

#[derive(Clone)]
struct Bitset([u32; 8]);

impl Bitset {
    #[inline(always)]
    fn check(&self, b: u8) -> bool {
        unsafe {
            (*self.0.get_unchecked((b >> 5) as usize) & (1 << (b & 31))) != 0
        }
    }
}

#[derive(Clone)]
struct LitRepSeg {
    text_bytes: Vec<u8>,
    bitset: Bitset,
    min: u32,
}

#[derive(Clone)]
enum FlatStep {
    Byte(u8),
    FBitset(Bitset),
    ExactlyBitset(Bitset, u32),
    SeqBytes(Vec<u8>),
    BetweenBitset(Bitset, u32, u32),
    RepeatBitset(Bitset, u32),
    RepOptional(usize),
    Exec(usize),
    JoinedBsByte(Bitset, u8),
    JoinedByte(usize, u8),
    LiteralRepeatBs(Vec<u8>, Bitset, u32),
    MultiLiteralRepeatBs(Vec<LitRepSeg>),
}

#[derive(Clone)]
enum CompiledOp {
    Byte(u8),
    ByteRange(u8, u8),
    OpBitset(Bitset),
    NotBitset(Bitset),
    Text(Vec<u8>),
    CharClass(u32),
    Seq(Vec<usize>),
    Alt(Vec<usize>),
    FastSeq2(usize, usize),
    FastSeq3(usize, usize, usize),
    RepOneOrMore(usize),
    RepZeroOrMore(usize),
    RepOptional(usize),
    RepExactly(usize, u32),
    RepBetween(usize, u32, u32),
    JoinedBy(usize, usize),
    FastJoinedByte(usize, u8),
    FastJoinedBsByte(Bitset, u8),
    FastRepeatBitset(Bitset, u32),
    FastExactlyBitset(Bitset, u32),
    FastBetweenBitset(Bitset, u32, u32),
    FastRepBsAlt(Bitset, usize, u32),
    RuleRef(u32),
    Extract(usize),
    Except { child: usize, excl_bitset: Option<Bitset>, excl_children: Vec<usize> },
    NoneOf(Vec<usize>),
    UntilIncl(usize, usize),
    UntilExcl(usize, usize),
    Isnt(usize, usize),
    FastSeqFlat { steps: Vec<FlatStep>, tail: Vec<usize> },
    FastAltByteFirst(Bitset, usize),
    FastAltLeadDispatch(Bitset, usize, usize),
    Fail,
}

enum LeadFilter {
    None,
    OneByte(u8),
    TwoBytes(u8, u8),
    ThreeBytes(u8, u8, u8),
    Bitset([u32; 8]),
    AnchorByte { anchor: u8, max_back: usize, lead_bs: [u32; 8] },
}

struct Program {
    ops: Vec<CompiledOp>,
    rules: Vec<usize>,
    entry_idx: usize,
    lead: LeadFilter,
}

fn read_bitset(_env: &Env, obj: &JsObject, key: &str) -> Option<Bitset> {
    let val: JsUnknown = obj.get_named_property(key).ok()?;
    if val.get_type().ok()? == napi::ValueType::Null || val.get_type().ok()? == napi::ValueType::Undefined {
        return None;
    }
    let arr: JsObject = val.coerce_to_object().ok()?;
    let mut bs = [0u32; 8];
    for i in 0..8 {
        let v: JsUnknown = arr.get_element(i as u32).ok()?;
        bs[i] = v.coerce_to_number().ok()?.get_uint32().ok()?;
    }
    Some(Bitset(bs))
}

fn read_text_bytes(obj: &JsObject, key: &str) -> Option<Vec<u8>> {
    let val: JsUnknown = obj.get_named_property(key).ok()?;
    if val.get_type().ok()? == napi::ValueType::Null || val.get_type().ok()? == napi::ValueType::Undefined {
        return None;
    }
    let arr: JsObject = val.coerce_to_object().ok()?;
    let len: u32 = arr.get_named_property::<JsUnknown>("length").ok()?.coerce_to_number().ok()?.get_uint32().ok()?;
    let mut bytes = Vec::with_capacity(len as usize);
    for i in 0..len {
        let v: JsUnknown = arr.get_element(i).ok()?;
        bytes.push(v.coerce_to_number().ok()?.get_uint32().ok()? as u8);
    }
    Some(bytes)
}

fn read_opt_u32(obj: &JsObject, key: &str) -> Option<u32> {
    let val: JsUnknown = obj.get_named_property(key).ok()?;
    let t = val.get_type().ok()?;
    if t == napi::ValueType::Null || t == napi::ValueType::Undefined { return None; }
    Some(val.coerce_to_number().ok()?.get_uint32().ok()?)
}

fn read_opt_i32(obj: &JsObject, key: &str) -> Option<i32> {
    let val: JsUnknown = obj.get_named_property(key).ok()?;
    let t = val.get_type().ok()?;
    if t == napi::ValueType::Null || t == napi::ValueType::Undefined { return None; }
    Some(val.coerce_to_number().ok()?.get_int32().ok()?)
}

fn deser_op(env: &Env, obj: &JsObject, prog: &mut Vec<CompiledOp>) -> usize {
    let op_num: u32 = obj.get_named_property::<JsUnknown>("op").unwrap()
        .coerce_to_number().unwrap().get_uint32().unwrap();

    let idx = prog.len();
    prog.push(CompiledOp::Fail);

    let compiled = match op_num {
        OP_BYTE => {
            let b = read_opt_u32(obj, "byte").unwrap_or(0) as u8;
            CompiledOp::Byte(b)
        }
        OP_BYTE_RANGE => {
            let lo = read_opt_u32(obj, "low").unwrap_or(0) as u8;
            let hi = read_opt_u32(obj, "high").unwrap_or(0) as u8;
            CompiledOp::ByteRange(lo, hi)
        }
        OP_BITSET => {
            let bs = read_bitset(env, obj, "bitset").unwrap_or(Bitset([0; 8]));
            CompiledOp::OpBitset(bs)
        }
        OP_NOT_BITSET => {
            let bs = read_bitset(env, obj, "bitset").unwrap_or(Bitset([0; 8]));
            CompiledOp::NotBitset(bs)
        }
        OP_TEXT | OP_FAST_SEQ_BYTES => {
            let bytes = read_text_bytes(obj, "textBytes").unwrap_or_default();
            CompiledOp::Text(bytes)
        }
        c @ (OP_CC_LETTER | OP_CC_DIGIT | OP_CC_PRINTABLE | OP_CC_VISIBLE |
             OP_CC_WHITESPACE | OP_CC_ALPHANUM | OP_CC_WORD | OP_CC_ANY |
             OP_CC_UPPER | OP_CC_LOWER | OP_CC_HEX) => {
            CompiledOp::CharClass(c)
        }
        OP_FAST_SEQ2 => {
            let c1 = deser_child(env, obj, "child", prog);
            let c2 = deser_child(env, obj, "child2", prog);
            CompiledOp::FastSeq2(c1, c2)
        }
        OP_FAST_SEQ3 => {
            let c1 = deser_child(env, obj, "child", prog);
            let c2 = deser_child(env, obj, "child2", prog);
            let c3 = deser_child(env, obj, "child3", prog);
            CompiledOp::FastSeq3(c1, c2, c3)
        }
        OP_SEQ => {
            let children = deser_children(env, obj, "children", prog);
            CompiledOp::Seq(children)
        }
        OP_ALT => {
            let children = deser_children(env, obj, "children", prog);
            CompiledOp::Alt(children)
        }
        OP_FAST_ALT_BYTE_FIRST => {
            let bs = read_bitset(env, obj, "bitset").unwrap_or(Bitset([0; 8]));
            let c = deser_child(env, obj, "child", prog);
            CompiledOp::FastAltByteFirst(bs, c)
        }
        OP_FAST_ALT_LEAD_DISPATCH => {
            let bs = read_bitset(env, obj, "bitset").unwrap_or(Bitset([0; 8]));
            let c1 = deser_child(env, obj, "child", prog);
            let c2 = deser_child(env, obj, "child2", prog);
            CompiledOp::FastAltLeadDispatch(bs, c1, c2)
        }
        OP_REP_ONE_OR_MORE => {
            let c = deser_child(env, obj, "child", prog);
            CompiledOp::RepOneOrMore(c)
        }
        OP_REP_ZERO_OR_MORE => {
            let c = deser_child(env, obj, "child", prog);
            CompiledOp::RepZeroOrMore(c)
        }
        OP_REP_OPTIONAL => {
            let c = deser_child(env, obj, "child", prog);
            CompiledOp::RepOptional(c)
        }
        OP_REP_EXACTLY => {
            let c = deser_child(env, obj, "child", prog);
            let n = read_opt_u32(obj, "min").unwrap_or(0);
            CompiledOp::RepExactly(c, n)
        }
        OP_REP_BETWEEN => {
            let c = deser_child(env, obj, "child", prog);
            let lo = read_opt_u32(obj, "min").unwrap_or(0);
            let hi = read_opt_u32(obj, "max").unwrap_or(0);
            CompiledOp::RepBetween(c, lo, hi)
        }
        OP_JOINED_BY | OP_JOINED_BY_LENIENT => {
            let c = deser_child(env, obj, "child", prog);
            let s = deser_child(env, obj, "separator", prog);
            CompiledOp::JoinedBy(c, s)
        }
        OP_FAST_JOINED_BYTE => {
            let c = deser_child(env, obj, "child", prog);
            let b = read_opt_u32(obj, "byte").unwrap_or(0) as u8;
            CompiledOp::FastJoinedByte(c, b)
        }
        OP_FAST_JOINED_BS_BYTE => {
            let bs = read_bitset(env, obj, "bitset").unwrap_or(Bitset([0; 8]));
            let b = read_opt_u32(obj, "byte").unwrap_or(0) as u8;
            CompiledOp::FastJoinedBsByte(bs, b)
        }
        OP_FAST_REPEAT_BITSET => {
            let bs = read_bitset(env, obj, "bitset").unwrap_or(Bitset([0; 8]));
            let min = read_opt_u32(obj, "min").unwrap_or(0);
            CompiledOp::FastRepeatBitset(bs, min)
        }
        OP_FAST_EXACTLY_BITSET => {
            let bs = read_bitset(env, obj, "bitset").unwrap_or(Bitset([0; 8]));
            let n = read_opt_u32(obj, "min").unwrap_or(0);
            CompiledOp::FastExactlyBitset(bs, n)
        }
        OP_FAST_BETWEEN_BITSET => {
            let bs = read_bitset(env, obj, "bitset").unwrap_or(Bitset([0; 8]));
            let lo = read_opt_u32(obj, "min").unwrap_or(0);
            let hi = read_opt_u32(obj, "max").unwrap_or(0);
            CompiledOp::FastBetweenBitset(bs, lo, hi)
        }
        OP_FAST_REP_BS_ALT => {
            let bs = read_bitset(env, obj, "bitset").unwrap_or(Bitset([0; 8]));
            let c = deser_child(env, obj, "child", prog);
            let min = read_opt_u32(obj, "min").unwrap_or(0);
            CompiledOp::FastRepBsAlt(bs, c, min)
        }
        OP_RULE_REF => {
            let ri = read_opt_i32(obj, "ruleIdx").unwrap_or(-1);
            if ri < 0 { CompiledOp::RuleRef(0xFFFFFFFF) } else { CompiledOp::RuleRef(ri as u32) }
        }
        OP_EXTRACT => {
            let c = deser_child(env, obj, "child", prog);
            CompiledOp::Extract(c)
        }
        OP_EXCEPT => {
            let c = deser_child(env, obj, "child", prog);
            let excl_bs = read_bitset(env, obj, "bitset");
            let excl_ch = if excl_bs.is_none() { deser_children(env, obj, "children", prog) } else { vec![] };
            CompiledOp::Except { child: c, excl_bitset: excl_bs, excl_children: excl_ch }
        }
        OP_NONE_OF => {
            let children = deser_children(env, obj, "children", prog);
            CompiledOp::NoneOf(children)
        }
        OP_UNTIL_INCL => {
            let c = deser_child(env, obj, "child", prog);
            let t = deser_child(env, obj, "terminator", prog);
            CompiledOp::UntilIncl(c, t)
        }
        OP_UNTIL_EXCL => {
            let c = deser_child(env, obj, "child", prog);
            let t = deser_child(env, obj, "terminator", prog);
            CompiledOp::UntilExcl(c, t)
        }
        OP_ISNT => {
            let c = deser_child(env, obj, "child", prog);
            let n = deser_child(env, obj, "negated", prog);
            CompiledOp::Isnt(c, n)
        }
        OP_FAST_SEQ_FLAT => {
            let steps = deser_flat_steps(env, obj, prog);
            let tail = deser_flat_tail(env, obj, prog);
            CompiledOp::FastSeqFlat { steps, tail }
        }
        _ => CompiledOp::Fail,
    };

    prog[idx] = compiled;
    idx
}

fn deser_child(env: &Env, obj: &JsObject, key: &str, prog: &mut Vec<CompiledOp>) -> usize {
    let val: Result<JsUnknown, _> = obj.get_named_property(key);
    match val {
        Ok(v) => {
            let t = v.get_type().unwrap_or(napi::ValueType::Undefined);
            if t == napi::ValueType::Object {
                let child_obj: JsObject = v.coerce_to_object().unwrap();
                deser_op(env, &child_obj, prog)
            } else {
                let fail_idx = prog.len();
                prog.push(CompiledOp::Fail);
                fail_idx
            }
        }
        Err(_) => {
            let fail_idx = prog.len();
            prog.push(CompiledOp::Fail);
            fail_idx
        }
    }
}

fn deser_children(env: &Env, obj: &JsObject, key: &str, prog: &mut Vec<CompiledOp>) -> Vec<usize> {
    let val: Result<JsUnknown, _> = obj.get_named_property(key);
    match val {
        Ok(v) => {
            let t = v.get_type().unwrap_or(napi::ValueType::Undefined);
            if t != napi::ValueType::Object { return vec![]; }
            let arr: JsObject = v.coerce_to_object().unwrap();
            let len: u32 = arr.get_named_property::<JsUnknown>("length")
                .and_then(|l| l.coerce_to_number())
                .and_then(|n| n.get_uint32())
                .unwrap_or(0);
            let mut indices = Vec::with_capacity(len as usize);
            for i in 0..len {
                let el: JsUnknown = arr.get_element(i).unwrap();
                if el.get_type().unwrap_or(napi::ValueType::Undefined) == napi::ValueType::Object {
                    let child_obj: JsObject = el.coerce_to_object().unwrap();
                    indices.push(deser_op(env, &child_obj, prog));
                }
            }
            indices
        }
        Err(_) => vec![],
    }
}

fn deser_flat_steps(env: &Env, obj: &JsObject, prog: &mut Vec<CompiledOp>) -> Vec<FlatStep> {
    let val: Result<JsUnknown, _> = obj.get_named_property("flatSteps");
    let v = match val {
        Ok(v) => v,
        Err(_) => return vec![],
    };
    let t = v.get_type().unwrap_or(napi::ValueType::Undefined);
    if t != napi::ValueType::Object { return vec![]; }
    let arr: JsObject = v.coerce_to_object().unwrap();
    let len: u32 = arr.get_named_property::<JsUnknown>("length")
        .and_then(|l| l.coerce_to_number())
        .and_then(|n| n.get_uint32())
        .unwrap_or(0);
    let mut steps = Vec::with_capacity(len as usize);
    for i in 0..len {
        let el: JsUnknown = arr.get_element(i).unwrap();
        if el.get_type().unwrap_or(napi::ValueType::Undefined) != napi::ValueType::Object { continue; }
        let step_obj: JsObject = el.coerce_to_object().unwrap();
        let fop: u32 = step_obj.get_named_property::<JsUnknown>("fop").unwrap()
            .coerce_to_number().unwrap().get_uint32().unwrap();
        let step = match fop {
            FOP_BYTE => {
                let b = read_opt_u32(&step_obj, "byte").unwrap_or(0) as u8;
                FlatStep::Byte(b)
            }
            FOP_BITSET => {
                let bs = read_bitset(env, &step_obj, "bitset").unwrap_or(Bitset([0; 8]));
                FlatStep::FBitset(bs)
            }
            FOP_EXACTLY_BITSET => {
                let bs = read_bitset(env, &step_obj, "bitset").unwrap_or(Bitset([0; 8]));
                let n = read_opt_u32(&step_obj, "min").unwrap_or(0);
                FlatStep::ExactlyBitset(bs, n)
            }
            FOP_SEQ_BYTES => {
                let bytes = read_text_bytes(&step_obj, "textBytes").unwrap_or_default();
                FlatStep::SeqBytes(bytes)
            }
            FOP_BETWEEN_BITSET => {
                let bs = read_bitset(env, &step_obj, "bitset").unwrap_or(Bitset([0; 8]));
                let lo = read_opt_u32(&step_obj, "min").unwrap_or(0);
                let hi = read_opt_u32(&step_obj, "max").unwrap_or(0);
                FlatStep::BetweenBitset(bs, lo, hi)
            }
            FOP_REPEAT_BITSET => {
                let bs = read_bitset(env, &step_obj, "bitset").unwrap_or(Bitset([0; 8]));
                let min = read_opt_u32(&step_obj, "min").unwrap_or(0);
                FlatStep::RepeatBitset(bs, min)
            }
            FOP_REP_OPTIONAL => {
                let c = deser_child(env, &step_obj, "child", prog);
                FlatStep::RepOptional(c)
            }
            FOP_EXEC => {
                let c = deser_child(env, &step_obj, "child", prog);
                FlatStep::Exec(c)
            }
            FOP_JOINED_BS_BYTE => {
                let bs = read_bitset(env, &step_obj, "bitset").unwrap_or(Bitset([0; 8]));
                let sep = read_opt_u32(&step_obj, "separator").unwrap_or(0) as u8;
                FlatStep::JoinedBsByte(bs, sep)
            }
            FOP_JOINED_BYTE => {
                let c = deser_child(env, &step_obj, "child", prog);
                let sep = read_opt_u32(&step_obj, "separator").unwrap_or(0) as u8;
                FlatStep::JoinedByte(c, sep)
            }
            FOP_LITERAL_REPEAT_BS => {
                let bytes = read_text_bytes(&step_obj, "textBytes").unwrap_or_default();
                let bs = read_bitset(env, &step_obj, "bitset").unwrap_or(Bitset([0; 8]));
                let min = read_opt_u32(&step_obj, "min").unwrap_or(0);
                FlatStep::LiteralRepeatBs(bytes, bs, min)
            }
            FOP_MULTI_LITERAL_REPEAT_BS => {
                let segs_val: Result<JsUnknown, _> = step_obj.get_named_property("segments");
                let mut segs = vec![];
                if let Ok(sv) = segs_val {
                    if sv.get_type().unwrap_or(napi::ValueType::Undefined) == napi::ValueType::Object {
                        let sa: JsObject = sv.coerce_to_object().unwrap();
                        let slen: u32 = sa.get_named_property::<JsUnknown>("length")
                            .and_then(|l| l.coerce_to_number())
                            .and_then(|n| n.get_uint32())
                            .unwrap_or(0);
                        for j in 0..slen {
                            let se: JsUnknown = sa.get_element(j).unwrap();
                            if se.get_type().unwrap_or(napi::ValueType::Undefined) == napi::ValueType::Object {
                                let so: JsObject = se.coerce_to_object().unwrap();
                                let tb = read_text_bytes(&so, "textBytes").unwrap_or_default();
                                let bs = read_bitset(env, &so, "bitset").unwrap_or(Bitset([0; 8]));
                                let min = read_opt_u32(&so, "min").unwrap_or(0);
                                segs.push(LitRepSeg { text_bytes: tb, bitset: bs, min });
                            }
                        }
                    }
                }
                FlatStep::MultiLiteralRepeatBs(segs)
            }
            _ => FlatStep::Byte(0),
        };
        steps.push(step);
    }
    steps
}

fn deser_flat_tail(env: &Env, obj: &JsObject, prog: &mut Vec<CompiledOp>) -> Vec<usize> {
    deser_children(env, obj, "flatTail", prog)
}

fn bitset_count(bs: &[u32; 8]) -> u32 {
    let mut count = 0u32;
    for w in bs { count += w.count_ones(); }
    count
}

fn bitset_to_lead_filter(bs: &[u32; 8]) -> LeadFilter {
    let mut count = 0u32;
    let mut bytes = [0u8; 3];
    for i in 0..256u32 {
        if (bs[(i >> 5) as usize] & (1 << (i & 31))) != 0 {
            if count < 3 { bytes[count as usize] = i as u8; }
            count += 1;
            if count > 3 { break; }
        }
    }
    match count {
        0 => LeadFilter::None,
        1 => LeadFilter::OneByte(bytes[0]),
        2 => LeadFilter::TwoBytes(bytes[0], bytes[1]),
        3 => LeadFilter::ThreeBytes(bytes[0], bytes[1], bytes[2]),
        _ => LeadFilter::Bitset(*bs),
    }
}

fn find_anchor_byte(prog: &Program, lead_bs: &[u32; 8]) -> Option<(u8, usize)> {
    if bitset_count(lead_bs) <= 3 { return None; }
    let entry_op = prog.rules[prog.entry_idx];
    match &prog.ops[entry_op] {
        CompiledOp::FastSeqFlat { steps, .. } => {
            let mut max_back: usize = 0;
            for step in steps {
                match step {
                    FlatStep::BetweenBitset(_, _lo, hi) => {
                        max_back += *hi as usize;
                    }
                    FlatStep::ExactlyBitset(_, n) => {
                        max_back += *n as usize;
                    }
                    FlatStep::RepeatBitset(_, _) => {
                        return None;
                    }
                    FlatStep::Byte(b) => {
                        if max_back > 0 && !((lead_bs[(*b >> 5) as usize] & (1 << (*b & 31))) != 0) {
                            return Some((*b, max_back));
                        }
                        max_back += 1;
                    }
                    FlatStep::SeqBytes(bytes) => {
                        if max_back > 0 && !bytes.is_empty() {
                            let b = bytes[0];
                            if !((lead_bs[(b >> 5) as usize] & (1 << (b & 31))) != 0) {
                                return Some((b, max_back));
                            }
                        }
                        max_back += bytes.len();
                    }
                    FlatStep::FBitset(bs) => {
                        if max_back > 0 && bitset_count(&bs.0) <= 3 {
                            for i in 0..256u32 {
                                if (bs.0[(i >> 5) as usize] & (1 << (i & 31))) != 0 {
                                    return Some((i as u8, max_back));
                                }
                            }
                        }
                        max_back += 1;
                    }
                    _ => return None,
                }
                if max_back > 8 { return None; }
            }
            None
        }
        _ => None,
    }
}

fn deser_program(env: &Env, cp: &JsObject) -> Program {
    let entry_idx: u32 = cp.get_named_property::<JsUnknown>("entryIdx").unwrap()
        .coerce_to_number().unwrap().get_uint32().unwrap();
    let rules_val: JsUnknown = cp.get_named_property("rules").unwrap();
    let rules_arr: JsObject = rules_val.coerce_to_object().unwrap();
    let rule_count: u32 = rules_arr.get_named_property::<JsUnknown>("length").unwrap()
        .coerce_to_number().unwrap().get_uint32().unwrap();

    let mut ops: Vec<CompiledOp> = Vec::new();
    let mut rule_indices = Vec::with_capacity(rule_count as usize);

    for i in 0..rule_count {
        let rule_val: JsUnknown = rules_arr.get_element(i).unwrap();
        let rule_obj: JsObject = rule_val.coerce_to_object().unwrap();
        let idx = deser_op(env, &rule_obj, &mut ops);
        rule_indices.push(idx);
    }

    let mut prog = Program {
        ops,
        rules: rule_indices,
        entry_idx: entry_idx as usize,
        lead: LeadFilter::None,
    };

    if let Some(bs) = compute_lead_bitset(&prog) {
        if let Some((anchor, max_back)) = find_anchor_byte(&prog, &bs) {
            prog.lead = LeadFilter::AnchorByte { anchor, max_back, lead_bs: bs };
        } else {
            prog.lead = bitset_to_lead_filter(&bs);
        }
    }

    prog
}

#[inline(always)]
fn cc_check(class_op: u32, b: u8) -> bool {
    match class_op {
        OP_CC_LETTER => (b >= 0x41 && b <= 0x5A) || (b >= 0x61 && b <= 0x7A),
        OP_CC_DIGIT => b >= 0x30 && b <= 0x39,
        OP_CC_PRINTABLE => b >= 0x20 && b <= 0x7E,
        OP_CC_VISIBLE => b >= 0x21 && b <= 0x7E,
        OP_CC_WHITESPACE => b == 0x20 || b == 0x09 || b == 0x0A || b == 0x0D,
        OP_CC_ALPHANUM => (b >= 0x41 && b <= 0x5A) || (b >= 0x61 && b <= 0x7A) || (b >= 0x30 && b <= 0x39),
        OP_CC_WORD => (b >= 0x41 && b <= 0x5A) || (b >= 0x61 && b <= 0x7A) || (b >= 0x30 && b <= 0x39) || b == 0x5F,
        OP_CC_UPPER => b >= 0x41 && b <= 0x5A,
        OP_CC_LOWER => b >= 0x61 && b <= 0x7A,
        OP_CC_HEX => (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x46) || (b >= 0x61 && b <= 0x66),
        _ => false,
    }
}

#[inline(always)]
unsafe fn exec_op(ops: *const CompiledOp, rules: *const usize, nrules: usize, ptr: *const u8, len: usize, pos: usize, op_idx: usize, depth: u32) -> isize {
    if depth > 256 { return -1; }
    match &*ops.add(op_idx) {
        CompiledOp::Byte(b) => {
            if pos >= len { return -1; }
            if *ptr.add(pos) != *b { return -1; }
            (pos + 1) as isize
        }
        CompiledOp::ByteRange(lo, hi) => {
            if pos >= len { return -1; }
            let v = *ptr.add(pos);
            if v < *lo || v > *hi { return -1; }
            (pos + 1) as isize
        }
        CompiledOp::OpBitset(bs) => {
            if pos >= len { return -1; }
            if !bs.check(*ptr.add(pos)) { return -1; }
            (pos + 1) as isize
        }
        CompiledOp::NotBitset(bs) => {
            if pos >= len { return -1; }
            if bs.check(*ptr.add(pos)) { return -1; }
            (pos + 1) as isize
        }
        CompiledOp::Text(bytes) => {
            let tlen = bytes.len();
            if pos + tlen > len { return -1; }
            let src = ptr.add(pos);
            let tb = bytes.as_ptr();
            for i in 0..tlen {
                if *src.add(i) != *tb.add(i) { return -1; }
            }
            (pos + tlen) as isize
        }
        CompiledOp::CharClass(c) => {
            if pos >= len { return -1; }
            let v = *ptr.add(pos);
            if *c == OP_CC_ANY {
                if v < 0x80 { (pos + 1) as isize }
                else if v < 0xE0 { (pos + 2) as isize }
                else if v < 0xF0 { (pos + 3) as isize }
                else { (pos + 4) as isize }
            } else {
                if !cc_check(*c, v) { return -1; }
                (pos + 1) as isize
            }
        }
        CompiledOp::FastSeq2(c1, c2) => {
            let p = exec_op(ops, rules, nrules, ptr, len, pos, *c1, depth + 1);
            if p < 0 { return -1; }
            exec_op(ops, rules, nrules, ptr, len, p as usize, *c2, depth + 1)
        }
        CompiledOp::FastSeq3(c1, c2, c3) => {
            let p = exec_op(ops, rules, nrules, ptr, len, pos, *c1, depth + 1);
            if p < 0 { return -1; }
            let p = exec_op(ops, rules, nrules, ptr, len, p as usize, *c2, depth + 1);
            if p < 0 { return -1; }
            exec_op(ops, rules, nrules, ptr, len, p as usize, *c3, depth + 1)
        }
        CompiledOp::Seq(children) => {
            let mut p = pos as isize;
            for &c in children { p = exec_op(ops, rules, nrules, ptr, len, p as usize, c, depth + 1); if p < 0 { return -1; } }
            p
        }
        CompiledOp::Alt(children) => {
            for &c in children { let p = exec_op(ops, rules, nrules, ptr, len, pos, c, depth + 1); if p >= 0 { return p; } }
            -1
        }
        CompiledOp::FastAltByteFirst(bs, child) => {
            if pos < len && bs.check(*ptr.add(pos)) { return (pos + 1) as isize; }
            exec_op(ops, rules, nrules, ptr, len, pos, *child, depth + 1)
        }
        CompiledOp::FastAltLeadDispatch(bs, c1, c2) => {
            if pos >= len { return -1; }
            if bs.check(*ptr.add(pos)) {
                exec_op(ops, rules, nrules, ptr, len, pos, *c1, depth + 1)
            } else {
                exec_op(ops, rules, nrules, ptr, len, pos, *c2, depth + 1)
            }
        }
        CompiledOp::RepOneOrMore(child) => {
            let mut p = pos;
            let mut count = 0u32;
            loop {
                let np = exec_op(ops, rules, nrules, ptr, len, p, *child, depth + 1);
                if np <= p as isize { break; }
                p = np as usize; count += 1;
            }
            if count < 1 { -1 } else { p as isize }
        }
        CompiledOp::RepZeroOrMore(child) => {
            let mut p = pos;
            loop {
                let np = exec_op(ops, rules, nrules, ptr, len, p, *child, depth + 1);
                if np <= p as isize { break; }
                p = np as usize;
            }
            p as isize
        }
        CompiledOp::RepOptional(child) => {
            let np = exec_op(ops, rules, nrules, ptr, len, pos, *child, depth + 1);
            if np >= 0 { np } else { pos as isize }
        }
        CompiledOp::RepExactly(child, n) => {
            let mut p = pos as isize;
            for _ in 0..*n { p = exec_op(ops, rules, nrules, ptr, len, p as usize, *child, depth + 1); if p < 0 { return -1; } }
            p
        }
        CompiledOp::RepBetween(child, lo, hi) => {
            let mut p = pos;
            let mut count = 0u32;
            for _ in 0..*lo {
                let np = exec_op(ops, rules, nrules, ptr, len, p, *child, depth + 1);
                if np < 0 { return -1; }
                p = np as usize; count += 1;
            }
            while count < *hi {
                let np = exec_op(ops, rules, nrules, ptr, len, p, *child, depth + 1);
                if np <= p as isize { break; }
                p = np as usize; count += 1;
            }
            p as isize
        }
        CompiledOp::JoinedBy(elem, sep) => {
            let mut p = exec_op(ops, rules, nrules, ptr, len, pos, *elem, depth + 1);
            if p < 0 { return -1; }
            loop {
                let sp = exec_op(ops, rules, nrules, ptr, len, p as usize, *sep, depth + 1);
                if sp < 0 { break; }
                let ep = exec_op(ops, rules, nrules, ptr, len, sp as usize, *elem, depth + 1);
                if ep <= sp { break; }
                p = ep;
            }
            p
        }
        CompiledOp::FastJoinedByte(child, sep_byte) => {
            let mut p = exec_op(ops, rules, nrules, ptr, len, pos, *child, depth + 1);
            if p < 0 { return -1; }
            loop {
                let pu = p as usize;
                if pu >= len || *ptr.add(pu) != *sep_byte { break; }
                let ep = exec_op(ops, rules, nrules, ptr, len, pu + 1, *child, depth + 1);
                if ep <= p + 1 { break; }
                p = ep;
            }
            p
        }
        CompiledOp::FastJoinedBsByte(bs, sep) => {
            if pos >= len { return -1; }
            if !bs.check(*ptr.add(pos)) { return -1; }
            let mut p = pos + 1;
            loop {
                if p >= len { break; }
                let v = *ptr.add(p);
                if bs.check(v) { p += 1; continue; }
                if v != *sep { break; }
                if p + 1 >= len { break; }
                if !bs.check(*ptr.add(p + 1)) { break; }
                p += 2;
            }
            p as isize
        }
        CompiledOp::FastRepeatBitset(bs, min) => {
            let mut p = pos;
            while p < len && bs.check(*ptr.add(p)) { p += 1; }
            if (p - pos) < *min as usize { return -1; }
            p as isize
        }
        CompiledOp::FastExactlyBitset(bs, n) => {
            let n = *n as usize;
            if pos + n > len { return -1; }
            for i in 0..n { if !bs.check(*ptr.add(pos + i)) { return -1; } }
            (pos + n) as isize
        }
        CompiledOp::FastBetweenBitset(bs, lo, hi) => {
            let mut count = 0u32;
            let mut p = pos;
            while p < len && count < *hi { if !bs.check(*ptr.add(p)) { break; } p += 1; count += 1; }
            if count < *lo { return -1; }
            p as isize
        }
        CompiledOp::FastRepBsAlt(bs, child, min) => {
            let mut count = 0u32;
            let mut p = pos;
            loop {
                if p >= len { break; }
                if bs.check(*ptr.add(p)) { p += 1; count += 1; continue; }
                let np = exec_op(ops, rules, nrules, ptr, len, p, *child, depth + 1);
                if np <= p as isize { break; }
                p = np as usize; count += 1;
            }
            if count < *min { return -1; }
            p as isize
        }
        CompiledOp::RuleRef(idx) => {
            if *idx == 0xFFFFFFFF { return -1; }
            let idx = *idx as usize;
            if idx >= nrules { return -1; }
            exec_op(ops, rules, nrules, ptr, len, pos, *rules.add(idx), depth + 1)
        }
        CompiledOp::Extract(child) => exec_op(ops, rules, nrules, ptr, len, pos, *child, depth + 1),
        CompiledOp::Except { child, excl_bitset, excl_children } => {
            if pos >= len { return -1; }
            if let Some(bs) = excl_bitset {
                if bs.check(*ptr.add(pos)) { return -1; }
            } else {
                for &ec in excl_children {
                    if exec_op(ops, rules, nrules, ptr, len, pos, ec, depth + 1) >= 0 { return -1; }
                }
            }
            exec_op(ops, rules, nrules, ptr, len, pos, *child, depth + 1)
        }
        CompiledOp::NoneOf(children) => {
            if pos >= len { return -1; }
            for &c in children { if exec_op(ops, rules, nrules, ptr, len, pos, c, depth + 1) >= 0 { return -1; } }
            let v = *ptr.add(pos);
            if v < 0x80 { (pos + 1) as isize } else if v < 0xE0 { (pos + 2) as isize } else if v < 0xF0 { (pos + 3) as isize } else { (pos + 4) as isize }
        }
        CompiledOp::UntilIncl(child, term) => {
            let mut p = pos;
            loop {
                let tp = exec_op(ops, rules, nrules, ptr, len, p, *term, depth + 1);
                if tp >= 0 { return tp; }
                let np = exec_op(ops, rules, nrules, ptr, len, p, *child, depth + 1);
                if np <= p as isize { return -1; }
                p = np as usize;
            }
        }
        CompiledOp::UntilExcl(child, term) => {
            let mut p = pos;
            loop {
                let tp = exec_op(ops, rules, nrules, ptr, len, p, *term, depth + 1);
                if tp >= 0 { return p as isize; }
                let np = exec_op(ops, rules, nrules, ptr, len, p, *child, depth + 1);
                if np <= p as isize { return -1; }
                p = np as usize;
            }
        }
        CompiledOp::Isnt(child, negated) => {
            let np = exec_op(ops, rules, nrules, ptr, len, pos, *negated, depth + 1);
            if np >= 0 { return -1; }
            exec_op(ops, rules, nrules, ptr, len, pos, *child, depth + 1)
        }
        CompiledOp::FastSeqFlat { steps, tail } => {
            let mut p = pos;
            for step in steps {
                p = match exec_flat(ops, rules, nrules, ptr, len, p, step, depth) {
                    r if r < 0 => return -1,
                    r => r as usize,
                };
            }
            for &t in tail {
                let r = exec_op(ops, rules, nrules, ptr, len, p, t, depth + 1);
                if r < 0 { return -1; }
                p = r as usize;
            }
            p as isize
        }
        CompiledOp::Fail => -1,
    }
}

#[inline(always)]
unsafe fn exec_flat(ops: *const CompiledOp, rules: *const usize, nrules: usize, ptr: *const u8, len: usize, pos: usize, step: &FlatStep, depth: u32) -> isize {
    match step {
        FlatStep::Byte(b) => {
            if pos >= len { return -1; }
            if *ptr.add(pos) != *b { return -1; }
            (pos + 1) as isize
        }
        FlatStep::FBitset(bs) => {
            if pos >= len { return -1; }
            if !bs.check(*ptr.add(pos)) { return -1; }
            (pos + 1) as isize
        }
        FlatStep::ExactlyBitset(bs, n) => {
            let n = *n as usize;
            if pos + n > len { return -1; }
            for i in 0..n { if !bs.check(*ptr.add(pos + i)) { return -1; } }
            (pos + n) as isize
        }
        FlatStep::SeqBytes(bytes) => {
            let tlen = bytes.len();
            if pos + tlen > len { return -1; }
            let src = ptr.add(pos);
            let tb = bytes.as_ptr();
            for i in 0..tlen { if *src.add(i) != *tb.add(i) { return -1; } }
            (pos + tlen) as isize
        }
        FlatStep::BetweenBitset(bs, lo, hi) => {
            let mut count = 0u32;
            let mut p = pos;
            while p < len && count < *hi { if !bs.check(*ptr.add(p)) { break; } p += 1; count += 1; }
            if count < *lo { return -1; }
            p as isize
        }
        FlatStep::RepeatBitset(bs, min) => {
            let mut p = pos;
            while p < len && bs.check(*ptr.add(p)) { p += 1; }
            if (p - pos) < *min as usize { return -1; }
            p as isize
        }
        FlatStep::RepOptional(child) => {
            let np = exec_op(ops, rules, nrules, ptr, len, pos, *child, depth + 1);
            if np >= 0 { np } else { pos as isize }
        }
        FlatStep::Exec(child) => {
            exec_op(ops, rules, nrules, ptr, len, pos, *child, depth + 1)
        }
        FlatStep::JoinedBsByte(bs, sep) => {
            if pos >= len { return -1; }
            if !bs.check(*ptr.add(pos)) { return -1; }
            let mut p = pos + 1;
            loop {
                if p >= len { break; }
                let v = *ptr.add(p);
                if bs.check(v) { p += 1; continue; }
                if v != *sep { break; }
                if p + 1 >= len { break; }
                if !bs.check(*ptr.add(p + 1)) { break; }
                p += 2;
            }
            p as isize
        }
        FlatStep::JoinedByte(child, sep) => {
            let mut p = exec_op(ops, rules, nrules, ptr, len, pos, *child, depth + 1);
            if p < 0 { return -1; }
            loop {
                let pu = p as usize;
                if pu >= len || *ptr.add(pu) != *sep { break; }
                let ep = exec_op(ops, rules, nrules, ptr, len, pu + 1, *child, depth + 1);
                if ep <= p + 1 { break; }
                p = ep;
            }
            p
        }
        FlatStep::LiteralRepeatBs(bytes, bs, min) => {
            let tlen = bytes.len();
            if pos + tlen > len { return -1; }
            let src = ptr.add(pos);
            let tb = bytes.as_ptr();
            for i in 0..tlen { if *src.add(i) != *tb.add(i) { return -1; } }
            let mut p = pos + tlen;
            let saved = p;
            while p < len && bs.check(*ptr.add(p)) { p += 1; }
            if (p - saved) < *min as usize { return -1; }
            p as isize
        }
        FlatStep::MultiLiteralRepeatBs(segs) => {
            let mut p = pos;
            for seg in segs {
                let tlen = seg.text_bytes.len();
                if p + tlen > len { return -1; }
                let src = ptr.add(p);
                let tb = seg.text_bytes.as_ptr();
                for i in 0..tlen { if *src.add(i) != *tb.add(i) { return -1; } }
                p += tlen;
                let saved = p;
                while p < len && seg.bitset.check(*ptr.add(p)) { p += 1; }
                if (p - saved) < seg.min as usize { return -1; }
            }
            p as isize
        }
    }
}

fn compute_lead_bitset(prog: &Program) -> Option<[u32; 8]> {
    let entry = prog.rules[prog.entry_idx];
    op_lead_bitset(prog, entry, 0)
}

fn op_lead_bitset(prog: &Program, op_idx: usize, depth: u32) -> Option<[u32; 8]> {
    if depth > 32 { return None; }
    match &prog.ops[op_idx] {
        CompiledOp::Byte(b) => { let mut bs = [0u32; 8]; bs[(*b >> 5) as usize] |= 1 << (*b & 31); Some(bs) }
        CompiledOp::ByteRange(lo, hi) => {
            let mut bs = [0u32; 8];
            for i in *lo..=*hi { bs[(i >> 5) as usize] |= 1 << (i & 31); }
            Some(bs)
        }
        CompiledOp::OpBitset(b) => Some(b.0),
        CompiledOp::NotBitset(b) => { let mut bs = b.0; for i in 0..8 { bs[i] = !bs[i]; } bs[0] &= !1; Some(bs) }
        CompiledOp::Text(bytes) if !bytes.is_empty() => { let mut bs = [0u32; 8]; bs[(bytes[0] >> 5) as usize] |= 1 << (bytes[0] & 31); Some(bs) }
        CompiledOp::CharClass(c) => {
            if *c == OP_CC_ANY { return None; }
            Some(char_class_bitset(*c))
        }
        CompiledOp::FastSeq2(c1, _) => op_lead_bitset(prog, *c1, depth + 1),
        CompiledOp::FastSeq3(c1, _, _) => op_lead_bitset(prog, *c1, depth + 1),
        CompiledOp::Seq(children) if !children.is_empty() => op_lead_bitset(prog, children[0], depth + 1),
        CompiledOp::Alt(children) => {
            let mut merged = [0u32; 8];
            for &c in children { match op_lead_bitset(prog, c, depth + 1) { Some(bs) => { for j in 0..8 { merged[j] |= bs[j]; } } None => return None, } }
            Some(merged)
        }
        CompiledOp::FastAltByteFirst(bs, _) | CompiledOp::FastAltLeadDispatch(bs, _, _) => Some(bs.0),
        CompiledOp::RepOneOrMore(c) | CompiledOp::RepZeroOrMore(c) | CompiledOp::RepOptional(c) |
        CompiledOp::RepExactly(c, _) | CompiledOp::RepBetween(c, _, _) => op_lead_bitset(prog, *c, depth + 1),
        CompiledOp::FastRepeatBitset(bs, _) | CompiledOp::FastExactlyBitset(bs, _) |
        CompiledOp::FastBetweenBitset(bs, _, _) | CompiledOp::FastJoinedBsByte(bs, _) => Some(bs.0),
        CompiledOp::FastRepBsAlt(bs, _, _) => Some(bs.0),
        CompiledOp::FastJoinedByte(child, _) | CompiledOp::Extract(child) => op_lead_bitset(prog, *child, depth + 1),
        CompiledOp::JoinedBy(elem, _) => op_lead_bitset(prog, *elem, depth + 1),
        CompiledOp::RuleRef(idx) => {
            if *idx == 0xFFFFFFFF { return None; }
            let idx = *idx as usize;
            if idx >= prog.rules.len() { return None; }
            op_lead_bitset(prog, prog.rules[idx], depth + 1)
        }
        CompiledOp::FastSeqFlat { steps, tail } => {
            if let Some(first) = steps.first() {
                match first {
                    FlatStep::Byte(b) => { let mut bs = [0u32; 8]; bs[(*b >> 5) as usize] |= 1 << (*b & 31); Some(bs) }
                    FlatStep::FBitset(b) | FlatStep::ExactlyBitset(b, _) | FlatStep::BetweenBitset(b, _, _) |
                    FlatStep::RepeatBitset(b, _) | FlatStep::JoinedBsByte(b, _) => Some(b.0),
                    FlatStep::SeqBytes(bytes) if !bytes.is_empty() => { let mut bs = [0u32; 8]; bs[(bytes[0] >> 5) as usize] |= 1 << (bytes[0] & 31); Some(bs) }
                    FlatStep::LiteralRepeatBs(bytes, _, _) if !bytes.is_empty() => { let mut bs = [0u32; 8]; bs[(bytes[0] >> 5) as usize] |= 1 << (bytes[0] & 31); Some(bs) }
                    FlatStep::Exec(c) | FlatStep::JoinedByte(c, _) | FlatStep::RepOptional(c) => op_lead_bitset(prog, *c, depth + 1),
                    _ => None,
                }
            } else if !tail.is_empty() {
                op_lead_bitset(prog, tail[0], depth + 1)
            } else { None }
        }
        _ => None,
    }
}

fn char_class_bitset(c: u32) -> [u32; 8] {
    let mut bs = [0u32; 8];
    match c {
        OP_CC_LETTER => { for i in 0x41u8..=0x5A { bs[(i>>5) as usize] |= 1<<(i&31); } for i in 0x61u8..=0x7A { bs[(i>>5) as usize] |= 1<<(i&31); } }
        OP_CC_DIGIT => { for i in 0x30u8..=0x39 { bs[(i>>5) as usize] |= 1<<(i&31); } }
        OP_CC_PRINTABLE => { for i in 0x20u8..=0x7E { bs[(i>>5) as usize] |= 1<<(i&31); } }
        OP_CC_VISIBLE => { for i in 0x21u8..=0x7E { bs[(i>>5) as usize] |= 1<<(i&31); } }
        OP_CC_WHITESPACE => { for b in [0x20u8, 0x09, 0x0A, 0x0D] { bs[(b>>5) as usize] |= 1<<(b&31); } }
        OP_CC_ALPHANUM => { for i in 0x41u8..=0x5A { bs[(i>>5) as usize] |= 1<<(i&31); } for i in 0x61u8..=0x7A { bs[(i>>5) as usize] |= 1<<(i&31); } for i in 0x30u8..=0x39 { bs[(i>>5) as usize] |= 1<<(i&31); } }
        OP_CC_WORD => { for i in 0x41u8..=0x5A { bs[(i>>5) as usize] |= 1<<(i&31); } for i in 0x61u8..=0x7A { bs[(i>>5) as usize] |= 1<<(i&31); } for i in 0x30u8..=0x39 { bs[(i>>5) as usize] |= 1<<(i&31); } bs[(0x5Fu8>>5) as usize] |= 1<<(0x5F&31); }
        OP_CC_UPPER => { for i in 0x41u8..=0x5A { bs[(i>>5) as usize] |= 1<<(i&31); } }
        OP_CC_LOWER => { for i in 0x61u8..=0x7A { bs[(i>>5) as usize] |= 1<<(i&31); } }
        OP_CC_HEX => { for i in 0x30u8..=0x39 { bs[(i>>5) as usize] |= 1<<(i&31); } for i in 0x41u8..=0x46 { bs[(i>>5) as usize] |= 1<<(i&31); } for i in 0x61u8..=0x66 { bs[(i>>5) as usize] |= 1<<(i&31); } }
        _ => {}
    }
    bs
}

#[inline(always)]
unsafe fn try_flat_match(steps: &[FlatStep], ptr: *const u8, len: usize, pos: usize) -> isize {
    let mut p = pos;
    for step in steps {
        match step {
            FlatStep::Byte(b) => {
                if p >= len || *ptr.add(p) != *b { return -1; }
                p += 1;
            }
            FlatStep::FBitset(bs) => {
                if p >= len || !bs.check(*ptr.add(p)) { return -1; }
                p += 1;
            }
            FlatStep::ExactlyBitset(bs, n) => {
                let n = *n as usize;
                if p + n > len { return -1; }
                for i in 0..n { if !bs.check(*ptr.add(p + i)) { return -1; } }
                p += n;
            }
            FlatStep::BetweenBitset(bs, lo, hi) => {
                let mut count = 0u32;
                let start = p;
                let max = *hi;
                while p < len && count < max {
                    if !bs.check(*ptr.add(p)) { break; }
                    p += 1; count += 1;
                }
                if count < *lo { return -1; }
                let _ = start;
            }
            FlatStep::SeqBytes(bytes) => {
                let tlen = bytes.len();
                if p + tlen > len { return -1; }
                let src = ptr.add(p);
                let tb = bytes.as_ptr();
                for i in 0..tlen { if *src.add(i) != *tb.add(i) { return -1; } }
                p += tlen;
            }
            FlatStep::RepeatBitset(bs, min) => {
                let start = p;
                while p < len && bs.check(*ptr.add(p)) { p += 1; }
                if (p - start) < *min as usize { return -1; }
            }
            _ => return -2,
        }
    }
    p as isize
}

fn is_pure_flat(steps: &[FlatStep], tail: &[usize]) -> bool {
    if !tail.is_empty() { return false; }
    for step in steps {
        match step {
            FlatStep::Byte(_) | FlatStep::FBitset(_) | FlatStep::ExactlyBitset(_, _) |
            FlatStep::SeqBytes(_) | FlatStep::BetweenBitset(_, _, _) | FlatStep::RepeatBitset(_, _) => {}
            _ => return false,
        }
    }
    true
}

fn scan_program(prog: &Program, input: &[u8]) -> Vec<(u32, u32)> {
    let entry_op = prog.rules[prog.entry_idx];
    let len = input.len();
    let ops_ptr = prog.ops.as_ptr();
    let rules_ptr = prog.rules.as_ptr();
    let nrules = prog.rules.len();
    let ptr = input.as_ptr();
    let mut results = Vec::new();

    if let CompiledOp::FastSeqFlat { steps, tail } = &prog.ops[entry_op] {
        if is_pure_flat(steps, tail) {
            return scan_pure_flat(prog, input, steps);
        }
    }

    match &prog.lead {
        LeadFilter::OneByte(b) => {
            let needle = *b;
            let mut pos = 0usize;
            while pos < len {
                match memchr::memchr(needle, &input[pos..]) {
                    None => break,
                    Some(offset) => {
                        pos += offset;
                        let end_pos = unsafe { exec_op(ops_ptr, rules_ptr, nrules, ptr, len, pos, entry_op, 0) };
                        if end_pos > pos as isize {
                            results.push((pos as u32, end_pos as u32));
                            pos = end_pos as usize;
                        } else {
                            pos += 1;
                        }
                    }
                }
            }
        }
        LeadFilter::TwoBytes(b1, b2) => {
            let mut pos = 0usize;
            while pos < len {
                match memchr::memchr2(*b1, *b2, &input[pos..]) {
                    None => break,
                    Some(offset) => {
                        pos += offset;
                        let end_pos = unsafe { exec_op(ops_ptr, rules_ptr, nrules, ptr, len, pos, entry_op, 0) };
                        if end_pos > pos as isize {
                            results.push((pos as u32, end_pos as u32));
                            pos = end_pos as usize;
                        } else {
                            pos += 1;
                        }
                    }
                }
            }
        }
        LeadFilter::ThreeBytes(b1, b2, b3) => {
            let mut pos = 0usize;
            while pos < len {
                match memchr::memchr3(*b1, *b2, *b3, &input[pos..]) {
                    None => break,
                    Some(offset) => {
                        pos += offset;
                        let end_pos = unsafe { exec_op(ops_ptr, rules_ptr, nrules, ptr, len, pos, entry_op, 0) };
                        if end_pos > pos as isize {
                            results.push((pos as u32, end_pos as u32));
                            pos = end_pos as usize;
                        } else {
                            pos += 1;
                        }
                    }
                }
            }
        }
        LeadFilter::AnchorByte { anchor, max_back, lead_bs } => {
            let needle = *anchor;
            let mb = *max_back;
            let mut search_from = 0usize;
            let mut last_match_end = 0usize;
            while search_from < len {
                match memchr::memchr(needle, &input[search_from..]) {
                    None => break,
                    Some(offset) => {
                        let anchor_pos = search_from + offset;
                        let ok = anchor_pos > 0 && anchor_pos + 1 < len && unsafe {
                            let prev = *ptr.add(anchor_pos - 1);
                            let next = *ptr.add(anchor_pos + 1);
                            (*lead_bs.get_unchecked((prev >> 5) as usize) & (1 << (prev & 31))) != 0
                            && (*lead_bs.get_unchecked((next >> 5) as usize) & (1 << (next & 31))) != 0
                        };
                        if !ok {
                            search_from = anchor_pos + 1;
                            continue;
                        }
                        let start_min = if anchor_pos >= mb { anchor_pos - mb } else { 0 };
                        let start_from = if start_min > last_match_end { start_min } else { last_match_end };
                        let mut found = false;
                        for try_pos in start_from..anchor_pos {
                            unsafe {
                                let v = *ptr.add(try_pos);
                                if (*lead_bs.get_unchecked((v >> 5) as usize) & (1 << (v & 31))) == 0 {
                                    continue;
                                }
                                let end_pos = exec_op(ops_ptr, rules_ptr, nrules, ptr, len, try_pos, entry_op, 0);
                                if end_pos > try_pos as isize {
                                    results.push((try_pos as u32, end_pos as u32));
                                    last_match_end = end_pos as usize;
                                    search_from = end_pos as usize;
                                    found = true;
                                    break;
                                }
                            }
                        }
                        if !found {
                            search_from = anchor_pos + 1;
                        }
                    }
                }
            }
        }
        LeadFilter::Bitset(lead_bs) => {
            let mut pos = 0usize;
            while pos < len {
                unsafe {
                    let v = *ptr.add(pos);
                    if (*lead_bs.get_unchecked((v >> 5) as usize) & (1 << (v & 31))) == 0 {
                        pos += 1;
                        continue;
                    }
                    let end_pos = exec_op(ops_ptr, rules_ptr, nrules, ptr, len, pos, entry_op, 0);
                    if end_pos > pos as isize {
                        results.push((pos as u32, end_pos as u32));
                        pos = end_pos as usize;
                    } else {
                        pos += 1;
                    }
                }
            }
        }
        LeadFilter::None => {
            let mut pos = 0usize;
            while pos < len {
                let end_pos = unsafe { exec_op(ops_ptr, rules_ptr, nrules, ptr, len, pos, entry_op, 0) };
                if end_pos > pos as isize {
                    results.push((pos as u32, end_pos as u32));
                    pos = end_pos as usize;
                } else {
                    pos += 1;
                }
            }
        }
    }

    results
}

fn scan_pure_flat(prog: &Program, input: &[u8], steps: &[FlatStep]) -> Vec<(u32, u32)> {
    let len = input.len();
    let ptr = input.as_ptr();
    let mut results = Vec::new();

    match &prog.lead {
        LeadFilter::AnchorByte { anchor, max_back, lead_bs } => {
            let needle = *anchor;
            let mb = *max_back;
            let mut search_from = 0usize;
            let mut last_match_end = 0usize;
            while search_from < len {
                match memchr::memchr(needle, &input[search_from..]) {
                    None => break,
                    Some(offset) => {
                        let anchor_pos = search_from + offset;
                        let ok = anchor_pos > 0 && anchor_pos + 1 < len && unsafe {
                            let prev = *ptr.add(anchor_pos - 1);
                            let next = *ptr.add(anchor_pos + 1);
                            (*lead_bs.get_unchecked((prev >> 5) as usize) & (1 << (prev & 31))) != 0
                            && (*lead_bs.get_unchecked((next >> 5) as usize) & (1 << (next & 31))) != 0
                        };
                        if !ok {
                            search_from = anchor_pos + 1;
                            continue;
                        }
                        let start_min = if anchor_pos >= mb { anchor_pos - mb } else { 0 };
                        let start_from = if start_min > last_match_end { start_min } else { last_match_end };
                        let mut found = false;
                        for try_pos in start_from..anchor_pos {
                            unsafe {
                                let v = *ptr.add(try_pos);
                                if (*lead_bs.get_unchecked((v >> 5) as usize) & (1 << (v & 31))) == 0 {
                                    continue;
                                }
                                let end_pos = try_flat_match(steps, ptr, len, try_pos);
                                if end_pos > try_pos as isize {
                                    results.push((try_pos as u32, end_pos as u32));
                                    last_match_end = end_pos as usize;
                                    search_from = end_pos as usize;
                                    found = true;
                                    break;
                                }
                            }
                        }
                        if !found {
                            search_from = anchor_pos + 1;
                        }
                    }
                }
            }
        }
        _ => {
            let lead = compute_lead_bitset(prog);
            let mut pos = 0usize;
            while pos < len {
                if let Some(ref lead_bs) = lead {
                    unsafe {
                        let v = *ptr.add(pos);
                        if (*lead_bs.get_unchecked((v >> 5) as usize) & (1 << (v & 31))) == 0 {
                            pos += 1;
                            continue;
                        }
                    }
                }
                let end_pos = unsafe { try_flat_match(steps, ptr, len, pos) };
                if end_pos > pos as isize {
                    results.push((pos as u32, end_pos as u32));
                    pos = end_pos as usize;
                } else {
                    pos += 1;
                }
            }
        }
    }

    results
}

#[napi(object)]
pub struct JsScanMatch {
    pub start: i32,
    pub end: i32,
    pub text: String,
}

#[napi]
pub fn native_scan(env: Env, compiled_program: JsObject, input: String) -> Vec<JsScanMatch> {
    let prog = deser_program(&env, &compiled_program);
    do_scan(&prog, &input)
}

#[napi(js_name = "NativeProgram")]
pub struct NativeProgramWrapper {
    prog: Program,
}

#[napi]
impl NativeProgramWrapper {
    #[napi(constructor)]
    pub fn new(env: Env, compiled_program: JsObject) -> Self {
        NativeProgramWrapper { prog: deser_program(&env, &compiled_program) }
    }

    #[napi]
    pub fn scan(&self, input: String) -> Vec<JsScanMatch> {
        do_scan(&self.prog, &input)
    }

    #[napi]
    pub fn scan_offsets(&self, input: Buffer) -> Buffer {
        let bytes = input.as_ref();
        let scan_results = scan_program(&self.prog, bytes);
        let mut out = Vec::with_capacity(scan_results.len() * 8);
        for (s, e) in &scan_results {
            out.extend_from_slice(&s.to_le_bytes());
            out.extend_from_slice(&e.to_le_bytes());
        }
        out.into()
    }

    #[napi]
    pub fn scan_utf8(&self, _env: Env, input: JsString) -> Result<Buffer> {
        let latin1 = input.into_latin1()?;
        let bytes = latin1.as_slice();
        let scan_results = scan_program(&self.prog, bytes);
        let mut out = Vec::with_capacity(scan_results.len() * 8);
        for (s, e) in &scan_results {
            out.extend_from_slice(&s.to_le_bytes());
            out.extend_from_slice(&e.to_le_bytes());
        }
        Ok(out.into())
    }
}

fn do_scan(prog: &Program, input: &str) -> Vec<JsScanMatch> {
    let utf8 = input.as_bytes();
    let scan_results = scan_program(prog, utf8);
    let is_ascii = utf8.len() == input.len();
    if is_ascii {
        scan_results.into_iter().map(|(s, e)| {
            let s = s as usize;
            let e = e as usize;
            JsScanMatch { start: s as i32, end: e as i32, text: input[s..e].to_string() }
        }).collect()
    } else {
        let byte_to_char = build_byte_to_char_map(utf8);
        scan_results.into_iter().map(|(s, e)| {
            let s = s as usize;
            let e = e as usize;
            let cs = byte_to_char[s];
            let ce = byte_to_char[e];
            let text: String = input.chars().skip(cs).take(ce - cs).collect();
            JsScanMatch { start: cs as i32, end: ce as i32, text }
        }).collect()
    }
}

fn build_byte_to_char_map(utf8: &[u8]) -> Vec<usize> {
    let mut map = vec![0usize; utf8.len() + 1];
    let mut bi = 0usize;
    let mut ci = 0usize;
    while bi < utf8.len() {
        map[bi] = ci;
        let b = utf8[bi];
        if b < 0x80 { bi += 1; }
        else if b < 0xE0 { bi += 2; }
        else if b < 0xF0 { bi += 3; }
        else { bi += 4; ci += 1; }
        ci += 1;
    }
    map[bi] = ci;
    map
}

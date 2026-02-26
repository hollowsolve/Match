function uleb(v) {
  const o = [];
  do { let b = v & 0x7F; v >>>= 7; if (v) b |= 0x80; o.push(b); } while (v);
  return o;
}

function sleb(v) {
  const o = [];
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

function sec(id, c) {
  return [id, ...uleb(c.length), ...c];
}

const I32 = 0x7F;

// Minimal function: (param i32 i32) (result i32) local.get 0 return end
const body = [
  0, // 0 local declaration groups
  0x20, 0x00, // local.get 0
  0x0F, // return
  0x0B, // end
];

const funcType = [1, 0x60, 2, I32, I32, 1, I32];
const funcSec = [1, 0];
const pages = 20;
const memSec = [1, 0x01, ...uleb(pages), ...uleb(256)];
const exportSec = [
  2,
  7, 0x76, 0x6D, 0x5F, 0x65, 0x78, 0x65, 0x63, 0x00, 0,
  6, 0x6D, 0x65, 0x6D, 0x6F, 0x72, 0x79, 0x02, 0,
];
const codeSec = [1, ...uleb(body.length), ...body];

const out = [0x00, 0x61, 0x73, 0x6D, 0x01, 0x00, 0x00, 0x00];
out.push(...sec(1, funcType));
out.push(...sec(3, funcSec));
out.push(...sec(5, memSec));
out.push(...sec(7, exportSec));
out.push(...sec(10, codeSec));

console.log('Binary length:', out.length);
console.log('Binary:', out.slice(0, 50));

try {
  const binary = new Uint8Array(out);
  const mod = new WebAssembly.Module(binary);
  const inst = new WebAssembly.Instance(mod);
  console.log('SUCCESS! vm_exec:', inst.exports.vm_exec(42, 10));
} catch(e) {
  console.log('ERROR:', e.message);
  // Try without memory limits
  const memSec2 = [1, 0x00, ...uleb(pages)]; // no max
  const out2 = [0x00, 0x61, 0x73, 0x6D, 0x01, 0x00, 0x00, 0x00];
  out2.push(...sec(1, funcType));
  out2.push(...sec(3, funcSec));
  out2.push(...sec(5, memSec2));
  out2.push(...sec(7, exportSec));
  out2.push(...sec(10, codeSec));
  try {
    const mod2 = new WebAssembly.Module(new Uint8Array(out2));
    const inst2 = new WebAssembly.Instance(mod2);
    console.log('SUCCESS without max! vm_exec:', inst2.exports.vm_exec(42, 10));
  } catch(e2) {
    console.log('ERROR2:', e2.message);
  }
}

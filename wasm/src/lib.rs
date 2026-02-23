#![no_std]

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

static mut HEAP: [u8; 1 << 20] = [0; 1 << 20];
static mut HEAP_PTR: usize = 0;

unsafe fn heap_alloc(size: usize) -> *mut u8 {
    let align = (HEAP_PTR + 3) & !3;
    let end = align + size;
    if end > HEAP.len() {
        return core::ptr::null_mut();
    }
    HEAP_PTR = end;
    HEAP.as_mut_ptr().add(align)
}

#[no_mangle]
pub unsafe extern "C" fn alloc(size: u32) -> *mut u8 {
    HEAP_PTR = 0;
    heap_alloc(size as usize)
}

#[no_mangle]
pub unsafe extern "C" fn get_heap_ptr() -> *mut u8 {
    HEAP.as_mut_ptr()
}

const OP_BYTE: u32 = 0;
const OP_BYTE_RANGE: u32 = 1;
const OP_BITSET: u32 = 2;
const OP_NOT_BITSET: u32 = 3;
const OP_TEXT: u32 = 4;
const OP_CHAR_CLASS_LETTER: u32 = 5;
const OP_CHAR_CLASS_DIGIT: u32 = 6;
const OP_CHAR_CLASS_PRINTABLE: u32 = 7;
const OP_CHAR_CLASS_VISIBLE: u32 = 8;
const OP_CHAR_CLASS_WHITESPACE: u32 = 9;
const OP_CHAR_CLASS_ALPHANUM: u32 = 10;
const OP_CHAR_CLASS_WORD: u32 = 11;
const OP_CHAR_CLASS_ANY: u32 = 12;
const OP_CHAR_CLASS_UPPER: u32 = 13;
const OP_CHAR_CLASS_LOWER: u32 = 14;
const OP_CHAR_CLASS_HEX: u32 = 15;
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
const OP_FAST_SEQ2: u32 = 37;
const OP_FAST_SEQ3: u32 = 38;
const OP_FAST_SEQ_FLAT: u32 = 39;
const OP_FAST_JOINED_BITSET_BYTE: u32 = 40;
const OP_FAST_REP_BITSET_ALT: u32 = 41;
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
const FOP_JOINED_BITSET_BYTE: u32 = 8;
const FOP_JOINED_BYTE: u32 = 9;
const FOP_LITERAL_REPEAT_BS: u32 = 10;
const FOP_MULTI_LITERAL_REPEAT_BS: u32 = 11;

#[inline(always)]
unsafe fn r32(buf: *const u8, off: usize) -> u32 {
    (buf.add(off) as *const u32).read_unaligned()
}

#[inline(always)]
fn bs_test(buf: *const u8, bs_off: usize, byte: u8) -> bool {
    let word_idx = (byte >> 5) as usize;
    let bit = byte & 31;
    let word = unsafe { r32(buf, bs_off + word_idx * 4) };
    (word & (1 << bit)) != 0
}

struct Ctx {
    prog: *const u8,
    input: *const u8,
    len: i32,
    rules_off: usize,
    num_rules: u32,
    memo: *mut i32,
    use_memo: bool,
    stride: i32,
}

unsafe fn exec(ctx: &Ctx, mut off: usize, mut pos: i32) -> i32 {
    let buf = ctx.prog;
    let inp = ctx.input;
    let len = ctx.len;

    loop {
        let tag = r32(buf, off);
        let body = off + 4;

        match tag {
            OP_BYTE => {
                let bv = r32(buf, body) as u8;
                return if pos < len && *inp.add(pos as usize) == bv { pos + 1 } else { -1 };
            }
            OP_BYTE_RANGE => {
                if pos >= len { return -1; }
                let b = *inp.add(pos as usize);
                let lo = r32(buf, body) as u8;
                let hi = r32(buf, body + 4) as u8;
                return if b >= lo && b <= hi { pos + 1 } else { -1 };
            }
            OP_BITSET => {
                if pos >= len { return -1; }
                let b = *inp.add(pos as usize);
                return if bs_test(buf, body, b) { pos + 1 } else { -1 };
            }
            OP_NOT_BITSET => {
                if pos >= len { return -1; }
                let b = *inp.add(pos as usize);
                return if !bs_test(buf, body, b) { pos + 1 } else { -1 };
            }
            OP_TEXT | OP_FAST_SEQ_BYTES => {
                let tlen = r32(buf, body) as i32;
                if pos + tlen > len { return -1; }
                let text = buf.add(body + 4);
                for i in 0..tlen {
                    if *inp.add((pos + i) as usize) != *text.add(i as usize) { return -1; }
                }
                return pos + tlen;
            }
            OP_CHAR_CLASS_LETTER => {
                if pos >= len { return -1; }
                let c = *inp.add(pos as usize);
                return if (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) { pos + 1 } else { -1 };
            }
            OP_CHAR_CLASS_DIGIT => {
                return if pos < len && *inp.add(pos as usize) >= 0x30 && *inp.add(pos as usize) <= 0x39 { pos + 1 } else { -1 };
            }
            OP_CHAR_CLASS_PRINTABLE => {
                return if pos < len && *inp.add(pos as usize) >= 0x20 && *inp.add(pos as usize) <= 0x7E { pos + 1 } else { -1 };
            }
            OP_CHAR_CLASS_VISIBLE => {
                return if pos < len && *inp.add(pos as usize) >= 0x21 && *inp.add(pos as usize) <= 0x7E { pos + 1 } else { -1 };
            }
            OP_CHAR_CLASS_WHITESPACE => {
                if pos >= len { return -1; }
                let c = *inp.add(pos as usize);
                return if c == 0x20 || c == 0x09 || c == 0x0A || c == 0x0D { pos + 1 } else { -1 };
            }
            OP_CHAR_CLASS_ALPHANUM => {
                if pos >= len { return -1; }
                let c = *inp.add(pos as usize);
                return if (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) || (c >= 0x30 && c <= 0x39) { pos + 1 } else { -1 };
            }
            OP_CHAR_CLASS_WORD => {
                if pos >= len { return -1; }
                let c = *inp.add(pos as usize);
                return if (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) || (c >= 0x30 && c <= 0x39) || c == 0x5F { pos + 1 } else { -1 };
            }
            OP_CHAR_CLASS_ANY => {
                if pos >= len { return -1; }
                let lb = *inp.add(pos as usize);
                let step = if lb < 0x80 { 1 } else if lb < 0xE0 { 2 } else if lb < 0xF0 { 3 } else { 4 };
                return if pos + step <= len { pos + step } else { -1 };
            }
            OP_CHAR_CLASS_UPPER => {
                return if pos < len && *inp.add(pos as usize) >= 0x41 && *inp.add(pos as usize) <= 0x5A { pos + 1 } else { -1 };
            }
            OP_CHAR_CLASS_LOWER => {
                return if pos < len && *inp.add(pos as usize) >= 0x61 && *inp.add(pos as usize) <= 0x7A { pos + 1 } else { -1 };
            }
            OP_CHAR_CLASS_HEX => {
                if pos >= len { return -1; }
                let c = *inp.add(pos as usize);
                return if (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66) { pos + 1 } else { -1 };
            }
            OP_FAST_SEQ2 => {
                let c1 = r32(buf, body) as usize;
                let c2 = r32(buf, body + 4) as usize;
                let p = exec(ctx, c1, pos);
                if p < 0 { return -1; }
                off = c2; pos = p; continue;
            }
            OP_FAST_SEQ3 => {
                let c1 = r32(buf, body) as usize;
                let c2 = r32(buf, body + 4) as usize;
                let c3 = r32(buf, body + 8) as usize;
                let p = exec(ctx, c1, pos);
                if p < 0 { return -1; }
                let p = exec(ctx, c2, p);
                if p < 0 { return -1; }
                off = c3; pos = p; continue;
            }
            OP_SEQ => {
                let n = r32(buf, body) as usize;
                if n == 0 { return pos; }
                let mut p = pos;
                for i in 0..n - 1 {
                    let c = r32(buf, body + 4 + i * 4) as usize;
                    p = exec(ctx, c, p);
                    if p < 0 { return -1; }
                }
                let c = r32(buf, body + 4 + (n - 1) * 4) as usize;
                off = c; pos = p; continue;
            }
            OP_ALT => {
                let n = r32(buf, body) as usize;
                if n == 0 { return -1; }
                for i in 0..n - 1 {
                    let c = r32(buf, body + 4 + i * 4) as usize;
                    let r = exec(ctx, c, pos);
                    if r >= 0 { return r; }
                }
                let c = r32(buf, body + 4 + (n - 1) * 4) as usize;
                off = c; continue;
            }
            OP_FAST_ALT_BYTE_FIRST => {
                let bs_off = body;
                let child_off = r32(buf, body + 32) as usize;
                if pos < len {
                    let b = *inp.add(pos as usize);
                    if bs_test(buf, bs_off, b) { return pos + 1; }
                }
                off = child_off; continue;
            }
            OP_FAST_ALT_LEAD_DISPATCH => {
                let bs_off = body;
                let c1 = r32(buf, body + 32) as usize;
                let c2 = r32(buf, body + 36) as usize;
                if pos < len {
                    let b = *inp.add(pos as usize);
                    if bs_test(buf, bs_off, b) { off = c1; continue; }
                }
                off = c2; continue;
            }
            OP_FAST_REPEAT_BITSET => {
                let bs_off = body;
                let min = r32(buf, body + 32) as i32;
                let start = pos;
                let mut p = pos;
                while p < len {
                    let b = *inp.add(p as usize);
                    if !bs_test(buf, bs_off, b) { break; }
                    p += 1;
                }
                return if p - start >= min { p } else { -1 };
            }
            OP_FAST_EXACTLY_BITSET => {
                let bs_off = body;
                let n = r32(buf, body + 32) as i32;
                if pos + n > len { return -1; }
                for i in 0..n {
                    let b = *inp.add((pos + i) as usize);
                    if !bs_test(buf, bs_off, b) { return -1; }
                }
                return pos + n;
            }
            OP_FAST_BETWEEN_BITSET => {
                let bs_off = body;
                let lo = r32(buf, body + 32) as i32;
                let hi = r32(buf, body + 36) as i32;
                let mut p = pos;
                let mut count = 0;
                while p < len && count < hi {
                    let b = *inp.add(p as usize);
                    if !bs_test(buf, bs_off, b) { break; }
                    p += 1;
                    count += 1;
                }
                return if count >= lo { p } else { -1 };
            }
            OP_FAST_JOINED_BITSET_BYTE => {
                let bs_off = body;
                let sep = r32(buf, body + 32) as u8;
                if pos >= len { return -1; }
                let mut p = pos;
                let b = *inp.add(p as usize);
                if !bs_test(buf, bs_off, b) { return -1; }
                p += 1;
                while p < len {
                    let b = *inp.add(p as usize);
                    if bs_test(buf, bs_off, b) { p += 1; continue; }
                    if b != sep { break; }
                    if p + 1 >= len { break; }
                    let nb = *inp.add((p + 1) as usize);
                    if !bs_test(buf, bs_off, nb) { break; }
                    p += 2;
                }
                return p;
            }
            OP_FAST_REP_BITSET_ALT => {
                let bs_off = body;
                let fb_off = r32(buf, body + 32) as usize;
                let min = r32(buf, body + 36) as i32;
                let mut p = pos;
                let mut count: i32 = 0;

                let fb_tag = r32(buf, fb_off);
                let fb_is_seq = fb_tag == OP_TEXT || fb_tag == OP_FAST_SEQ_BYTES;
                let fb_text_len = if fb_is_seq { r32(buf, fb_off + 4) as i32 } else { 0 };
                let fb_text_ptr = if fb_is_seq { buf.add(fb_off + 8) } else { core::ptr::null() };

                while p < len {
                    let b = *inp.add(p as usize);
                    if bs_test(buf, bs_off, b) {
                        p += 1; count += 1; continue;
                    }
                    if fb_is_seq {
                        if p + fb_text_len <= len {
                            let mut m = true;
                            for i in 0..fb_text_len {
                                if *inp.add((p + i) as usize) != *fb_text_ptr.add(i as usize) { m = false; break; }
                            }
                            if m { p += fb_text_len; count += 1; continue; }
                        }
                        break;
                    }
                    let r = exec(ctx, fb_off, p);
                    if r < 0 || r == p { break; }
                    p = r; count += 1;
                }
                return if count >= min { p } else { -1 };
            }
            OP_FAST_JOINED_BYTE => {
                let elem_off = r32(buf, body) as usize;
                let sep = r32(buf, body + 4) as u8;

                let elem_tag = r32(buf, elem_off);
                if elem_tag == OP_FAST_REPEAT_BITSET {
                    let ebs_off = elem_off + 4;
                    let emi = r32(buf, elem_off + 36) as i32;
                    let mut p = pos;
                    let s0 = p;
                    while p < len {
                        if !bs_test(buf, ebs_off, *inp.add(p as usize)) { break; }
                        p += 1;
                    }
                    if p - s0 < emi { return -1; }
                    while p < len && *inp.add(p as usize) == sep {
                        let s2 = p + 1;
                        let mut p2 = s2;
                        while p2 < len {
                            if !bs_test(buf, ebs_off, *inp.add(p2 as usize)) { break; }
                            p2 += 1;
                        }
                        if p2 - s2 < emi { break; }
                        p = p2;
                    }
                    return p;
                }
                if elem_tag == OP_FAST_EXACTLY_BITSET {
                    let ebs_off = elem_off + 4;
                    let en = r32(buf, elem_off + 36) as i32;
                    let mut p = pos;
                    if p + en > len { return -1; }
                    for i in 0..en {
                        if !bs_test(buf, ebs_off, *inp.add((p + i) as usize)) { return -1; }
                    }
                    p += en;
                    while p < len && *inp.add(p as usize) == sep {
                        if p + 1 + en > len { break; }
                        let mut ok = true;
                        for i in 0..en {
                            if !bs_test(buf, ebs_off, *inp.add((p + 1 + i) as usize)) { ok = false; break; }
                        }
                        if !ok { break; }
                        p += 1 + en;
                    }
                    return p;
                }
                if elem_tag == OP_FAST_BETWEEN_BITSET {
                    let ebs_off = elem_off + 4;
                    let elo = r32(buf, elem_off + 36) as i32;
                    let ehi = r32(buf, elem_off + 40) as i32;
                    let mut p = pos;
                    let mut cnt = 0i32;
                    while p < len && cnt < ehi {
                        if !bs_test(buf, ebs_off, *inp.add(p as usize)) { break; }
                        p += 1; cnt += 1;
                    }
                    if cnt < elo { return -1; }
                    while p < len && *inp.add(p as usize) == sep {
                        let mut p2 = p + 1;
                        let mut c2 = 0i32;
                        while p2 < len && c2 < ehi {
                            if !bs_test(buf, ebs_off, *inp.add(p2 as usize)) { break; }
                            p2 += 1; c2 += 1;
                        }
                        if c2 < elo { break; }
                        p = p2;
                    }
                    return p;
                }

                if elem_tag == OP_FAST_ALT_BYTE_FIRST {
                    let ebs_off = elem_off + 4;
                    let efb_off = r32(buf, elem_off + 36) as usize;
                    let mut p: i32;
                    if pos < len {
                        let b = *inp.add(pos as usize);
                        if bs_test(buf, ebs_off, b) { p = pos + 1; }
                        else { p = exec(ctx, efb_off, pos); }
                    } else { p = -1; }
                    if p < 0 { return -1; }
                    while p < len && *inp.add(p as usize) == sep {
                        let np = p + 1;
                        let ep: i32;
                        if np < len {
                            let b = *inp.add(np as usize);
                            if bs_test(buf, ebs_off, b) { ep = np + 1; }
                            else { ep = exec(ctx, efb_off, np); }
                        } else { ep = -1; }
                        if ep < 0 { break; }
                        p = ep;
                    }
                    return p;
                }
                if elem_tag == OP_FAST_ALT_LEAD_DISPATCH {
                    let dbs_off = elem_off + 4;
                    let dch1_off = r32(buf, elem_off + 36) as usize;
                    let dch2_off = r32(buf, elem_off + 40) as usize;

                    let dch1_tag = r32(buf, dch1_off);
                    let dch2_tag = r32(buf, dch2_off);
                    if dch1_tag == OP_FAST_SEQ3 && dch2_tag == OP_FAST_REPEAT_BITSET {
                        let sq_c1_off = r32(buf, dch1_off + 4) as usize;
                        let sq_c2_off = r32(buf, dch1_off + 8) as usize;
                        let sq_c3_off = r32(buf, dch1_off + 12) as usize;
                        let sq_c1_tag = r32(buf, sq_c1_off);
                        let sq_c2_tag = r32(buf, sq_c2_off);
                        let sq_c3_tag = r32(buf, sq_c3_off);
                        if sq_c1_tag == OP_BYTE && sq_c3_tag == OP_BYTE && sq_c2_tag == OP_FAST_REP_BITSET_ALT {
                            let q_open = r32(buf, sq_c1_off + 4) as u8;
                            let q_close = r32(buf, sq_c3_off + 4) as u8;
                            let rba_bs_off = sq_c2_off + 4;
                            let rba_fb_off = r32(buf, sq_c2_off + 36) as usize;
                            let rba_fb_tag = r32(buf, rba_fb_off);
                            let rba_fb_is_seq = rba_fb_tag == OP_TEXT || rba_fb_tag == OP_FAST_SEQ_BYTES;
                            let rba_fb_len = if rba_fb_is_seq { r32(buf, rba_fb_off + 4) as i32 } else { 0 };
                            let rba_fb_ptr = if rba_fb_is_seq { buf.add(rba_fb_off + 8) } else { core::ptr::null() };
                            let d2_bs_off = dch2_off + 4;
                            let d2_mi = r32(buf, dch2_off + 36) as i32;

                            let exec_quoted_inline = |sp: i32| -> i32 {
                                if sp >= len || *inp.add(sp as usize) != q_open { return -1; }
                                let mut qp = sp + 1;
                                while qp < len {
                                    let qb = *inp.add(qp as usize);
                                    if bs_test(buf, rba_bs_off, qb) { qp += 1; continue; }
                                    if rba_fb_is_seq {
                                        if qp + rba_fb_len <= len {
                                            let mut m = true;
                                            for fi in 0..rba_fb_len {
                                                if *inp.add((qp + fi) as usize) != *rba_fb_ptr.add(fi as usize) { m = false; break; }
                                            }
                                            if m { qp += rba_fb_len; continue; }
                                        }
                                    } else if !rba_fb_ptr.is_null() {
                                        let fr = exec(ctx, rba_fb_off, qp);
                                        if fr > qp { qp = fr; continue; }
                                    }
                                    break;
                                }
                                if qp >= len || *inp.add(qp as usize) != q_close { return -1; }
                                qp + 1
                            };
                            let exec_plain_inline = |sp: i32| -> i32 {
                                let s0 = sp;
                                let mut pp = sp;
                                while pp < len {
                                    if !bs_test(buf, d2_bs_off, *inp.add(pp as usize)) { break; }
                                    pp += 1;
                                }
                                if pp - s0 >= d2_mi { pp } else { -1 }
                            };

                            let mut p: i32;
                            if pos >= len { return -1; }
                            { let b = *inp.add(pos as usize);
                              p = if bs_test(buf, dbs_off, b) { exec_quoted_inline(pos) } else { exec_plain_inline(pos) }; }
                            if p < 0 { return -1; }
                            while p < len && *inp.add(p as usize) == sep {
                                let np = p + 1;
                                if np >= len { break; }
                                let b = *inp.add(np as usize);
                                let ep = if bs_test(buf, dbs_off, b) { exec_quoted_inline(np) } else { exec_plain_inline(np) };
                                if ep < 0 { break; }
                                p = ep;
                            }
                            return p;
                        }
                    }

                    let mut p: i32;
                    if pos < len {
                        let b = *inp.add(pos as usize);
                        p = if bs_test(buf, dbs_off, b) { exec(ctx, dch1_off, pos) } else { exec(ctx, dch2_off, pos) };
                    } else { return -1; }
                    if p < 0 { return -1; }
                    while p < len && *inp.add(p as usize) == sep {
                        let np = p + 1;
                        if np >= len { break; }
                        let b = *inp.add(np as usize);
                        let ep = if bs_test(buf, dbs_off, b) { exec(ctx, dch1_off, np) } else { exec(ctx, dch2_off, np) };
                        if ep < 0 { break; }
                        p = ep;
                    }
                    return p;
                }
                if elem_tag == OP_FAST_SEQ3 {
                    let c1_off = r32(buf, elem_off + 4) as usize;
                    let c2_off = r32(buf, elem_off + 8) as usize;
                    let c3_off = r32(buf, elem_off + 12) as usize;
                    let c1_tag = r32(buf, c1_off);
                    let c2_tag = r32(buf, c2_off);
                    let c3_tag = r32(buf, c3_off);
                    if c1_tag == OP_FAST_REPEAT_BITSET && c2_tag == OP_BYTE && c3_tag == OP_FAST_REPEAT_BITSET {
                        let bs1_off = c1_off + 4;
                        let mi1 = r32(buf, c1_off + 36) as i32;
                        let mb = r32(buf, c2_off + 4) as u8;
                        let bs3_off = c3_off + 4;
                        let mi3 = r32(buf, c3_off + 36) as i32;
                        let mut p = pos;
                        let s0 = p;
                        while p < len { if !bs_test(buf, bs1_off, *inp.add(p as usize)) { break; } p += 1; }
                        if p - s0 < mi1 { return -1; }
                        if p >= len || *inp.add(p as usize) != mb { return -1; }
                        p += 1;
                        let s1 = p;
                        while p < len { if !bs_test(buf, bs3_off, *inp.add(p as usize)) { break; } p += 1; }
                        if p - s1 < mi3 { return -1; }
                        while p < len && *inp.add(p as usize) == sep {
                            let mut ep = p + 1;
                            let es0 = ep;
                            while ep < len { if !bs_test(buf, bs1_off, *inp.add(ep as usize)) { break; } ep += 1; }
                            if ep - es0 < mi1 { break; }
                            if ep >= len || *inp.add(ep as usize) != mb { break; }
                            ep += 1;
                            let es3 = ep;
                            while ep < len { if !bs_test(buf, bs3_off, *inp.add(ep as usize)) { break; } ep += 1; }
                            if ep - es3 < mi3 { break; }
                            p = ep;
                        }
                        return p;
                    }
                    let mut p = exec(ctx, c1_off, pos);
                    if p < 0 { return -1; }
                    p = exec(ctx, c2_off, p);
                    if p < 0 { return -1; }
                    p = exec(ctx, c3_off, p);
                    if p < 0 { return -1; }
                    while p < len && *inp.add(p as usize) == sep {
                        let mut ep = exec(ctx, c1_off, p + 1);
                        if ep < 0 { break; }
                        ep = exec(ctx, c2_off, ep);
                        if ep < 0 { break; }
                        ep = exec(ctx, c3_off, ep);
                        if ep < 0 { break; }
                        p = ep;
                    }
                    return p;
                }
                if elem_tag == OP_FAST_SEQ2 {
                    let c1_off = r32(buf, elem_off + 4) as usize;
                    let c2_off = r32(buf, elem_off + 8) as usize;
                    let mut p = exec(ctx, c1_off, pos);
                    if p < 0 { return -1; }
                    p = exec(ctx, c2_off, p);
                    if p < 0 { return -1; }
                    while p < len && *inp.add(p as usize) == sep {
                        let mut ep = exec(ctx, c1_off, p + 1);
                        if ep < 0 { break; }
                        ep = exec(ctx, c2_off, ep);
                        if ep < 0 { break; }
                        p = ep;
                    }
                    return p;
                }
                if elem_tag == OP_FAST_SEQ_FLAT {
                    let fb = elem_off + 4;
                    let fs_nsteps = r32(buf, fb) as usize;
                    let fs_steps_off = r32(buf, fb + 4) as usize;
                    let fs_ntail = r32(buf, fb + 8) as usize;
                    if fs_ntail == 0 {
                        let mut p = exec_flat_steps(ctx, fs_steps_off, 0, fs_nsteps, pos);
                        if p < 0 { return -1; }
                        while p < len && *inp.add(p as usize) == sep {
                            let ep = exec_flat_steps(ctx, fs_steps_off, 0, fs_nsteps, p + 1);
                            if ep < 0 { break; }
                            p = ep;
                        }
                        return p;
                    }
                }

                let mut p = exec(ctx, elem_off, pos);
                if p < 0 { return -1; }
                while p < len && *inp.add(p as usize) == sep {
                    let ep = exec(ctx, elem_off, p + 1);
                    if ep < 0 { break; }
                    p = ep;
                }
                return p;
            }
            OP_REP_ONE_OR_MORE => {
                let child_off = r32(buf, body) as usize;
                let lead_byte_raw = r32(buf, body + 4);
                let has_lead_bs = r32(buf, body + 8);
                let lead_bs_off = body + 12;

                let mut p = exec(ctx, child_off, pos);
                if p < 0 { return -1; }

                if lead_byte_raw != 0xFFFFFFFF {
                    let lb = lead_byte_raw as u8;
                    while p < len && *inp.add(p as usize) == lb {
                        let r = exec(ctx, child_off, p);
                        if r < 0 || r == p { break; }
                        p = r;
                    }
                } else if has_lead_bs != 0 {
                    while p < len {
                        let b = *inp.add(p as usize);
                        if !bs_test(buf, lead_bs_off, b) { break; }
                        let r = exec(ctx, child_off, p);
                        if r < 0 || r == p { break; }
                        p = r;
                    }
                } else {
                    loop {
                        let r = exec(ctx, child_off, p);
                        if r < 0 || r == p { break; }
                        p = r;
                    }
                }
                return p;
            }
            OP_REP_ZERO_OR_MORE => {
                let child_off = r32(buf, body) as usize;
                let lead_byte_raw = r32(buf, body + 4);
                let has_lead_bs = r32(buf, body + 8);
                let lead_bs_off = body + 12;

                let mut p = pos;
                if lead_byte_raw != 0xFFFFFFFF {
                    let lb = lead_byte_raw as u8;
                    while p < len && *inp.add(p as usize) == lb {
                        let r = exec(ctx, child_off, p);
                        if r < 0 || r == p { break; }
                        p = r;
                    }
                } else if has_lead_bs != 0 {
                    while p < len {
                        let b = *inp.add(p as usize);
                        if !bs_test(buf, lead_bs_off, b) { break; }
                        let r = exec(ctx, child_off, p);
                        if r < 0 || r == p { break; }
                        p = r;
                    }
                } else {
                    loop {
                        let r = exec(ctx, child_off, p);
                        if r < 0 || r == p { break; }
                        p = r;
                    }
                }
                return p;
            }
            OP_REP_OPTIONAL => {
                let child_off = r32(buf, body) as usize;
                let lead_byte_raw = r32(buf, body + 4);
                let has_lead_bs = r32(buf, body + 8);
                let lead_bs_off = body + 12;

                if lead_byte_raw != 0xFFFFFFFF {
                    if pos >= len || *inp.add(pos as usize) != lead_byte_raw as u8 { return pos; }
                } else if has_lead_bs != 0 {
                    if pos >= len { return pos; }
                    let b = *inp.add(pos as usize);
                    if !bs_test(buf, lead_bs_off, b) { return pos; }
                }
                let r = exec(ctx, child_off, pos);
                return if r >= 0 { r } else { pos };
            }
            OP_REP_EXACTLY => {
                let child_off = r32(buf, body) as usize;
                let n = r32(buf, body + 4) as i32;
                let mut p = pos;
                for _ in 0..n {
                    p = exec(ctx, child_off, p);
                    if p < 0 { return -1; }
                }
                return p;
            }
            OP_REP_BETWEEN => {
                let child_off = r32(buf, body) as usize;
                let lo = r32(buf, body + 4) as i32;
                let hi = r32(buf, body + 8) as i32;
                let mut p = pos;
                let mut count = 0i32;
                for _ in 0..hi {
                    let r = exec(ctx, child_off, p);
                    if r < 0 || r == p { break; }
                    p = r;
                    count += 1;
                }
                return if count >= lo { p } else { -1 };
            }
            OP_JOINED_BY => {
                let elem_off = r32(buf, body) as usize;
                let sep_off = r32(buf, body + 4) as usize;
                let mut p = exec(ctx, elem_off, pos);
                if p < 0 { return -1; }
                loop {
                    let sp = exec(ctx, sep_off, p);
                    if sp < 0 { break; }
                    let ep = exec(ctx, elem_off, sp);
                    if ep < 0 { break; }
                    p = ep;
                }
                return p;
            }
            OP_JOINED_BY_LENIENT => {
                let elem_off = r32(buf, body) as usize;
                let sep_off = r32(buf, body + 4) as usize;
                let mut p = exec(ctx, elem_off, pos);
                if p < 0 { return -1; }
                loop {
                    let sp = exec(ctx, sep_off, p);
                    if sp < 0 { break; }
                    let ep = exec(ctx, elem_off, sp);
                    if ep < 0 { p = sp; break; }
                    p = ep;
                }
                return p;
            }
            OP_RULE_REF => {
                let ri = r32(buf, body) as usize;
                if ri as u32 >= ctx.num_rules { return -1; }
                let rule_off = r32(buf, ctx.rules_off + ri * 4) as usize;
                if ctx.use_memo {
                    let mk = (ri as i32) * ctx.stride + pos;
                    let cached = *ctx.memo.add(mk as usize);
                    if cached != -2 { return cached; }
                    let r = exec(ctx, rule_off, pos);
                    *ctx.memo.add(mk as usize) = r;
                    return r;
                }
                off = rule_off; continue;
            }
            OP_EXCEPT => {
                if pos >= len { return -1; }
                let child_off = r32(buf, body) as usize;
                let has_bs = r32(buf, body + 4);
                if has_bs != 0 {
                    let bs_off = body + 8;
                    let b = *inp.add(pos as usize);
                    if bs_test(buf, bs_off, b) { return -1; }
                    off = child_off; continue;
                }
                let n_excl = r32(buf, body + 8) as usize;
                for i in 0..n_excl {
                    let exc_off = r32(buf, body + 12 + i * 4) as usize;
                    if exec(ctx, exc_off, pos) >= 0 { return -1; }
                }
                off = child_off; continue;
            }
            OP_NONE_OF => {
                if pos >= len { return -1; }
                let n = r32(buf, body) as usize;
                for i in 0..n {
                    let c = r32(buf, body + 4 + i * 4) as usize;
                    if exec(ctx, c, pos) >= 0 { return -1; }
                }
                let lb = *inp.add(pos as usize);
                let step = if lb < 0x80 { 1 } else if lb < 0xE0 { 2 } else if lb < 0xF0 { 3 } else { 4 };
                return if pos + step <= len { pos + step } else { -1 };
            }
            OP_EXTRACT => {
                let child_off = r32(buf, body) as usize;
                off = child_off; continue;
            }
            OP_UNTIL_INCL => {
                let child_off = r32(buf, body) as usize;
                let term_off = r32(buf, body + 4) as usize;
                let mut p = pos;
                loop {
                    let tr = exec(ctx, term_off, p);
                    if tr >= 0 { return tr; }
                    let cr = exec(ctx, child_off, p);
                    if cr < 0 || cr == p { return -1; }
                    p = cr;
                }
            }
            OP_UNTIL_EXCL => {
                let child_off = r32(buf, body) as usize;
                let term_off = r32(buf, body + 4) as usize;
                let mut p = pos;
                loop {
                    let tr = exec(ctx, term_off, p);
                    if tr >= 0 { return p; }
                    let cr = exec(ctx, child_off, p);
                    if cr < 0 || cr == p { return -1; }
                    p = cr;
                }
            }
            OP_ISNT => {
                let child_off = r32(buf, body) as usize;
                let neg_off = r32(buf, body + 4) as usize;
                if exec(ctx, neg_off, pos) >= 0 { return -1; }
                off = child_off; continue;
            }
            OP_FAST_SEQ_FLAT => {
                let mut p = pos;
                let n_steps = r32(buf, body) as usize;
                let steps_off = r32(buf, body + 4) as usize;
                let n_tail = r32(buf, body + 8) as usize;
                let tail_arr_off = body + 12;
                let has_fpx = r32(buf, tail_arr_off + n_tail * 4);
                let fpx_meta_off = tail_arr_off + n_tail * 4 + 4;

                if has_fpx != 0 {
                    let fpx_len = r32(buf, fpx_meta_off) as i32;
                    let fpx_steps = r32(buf, fpx_meta_off + 4) as usize;
                    let fpx_data_off = fpx_meta_off + 8;

                    if p + fpx_len > len { return -1; }
                    for i in 0..fpx_len {
                        let b = *inp.add((p + i) as usize);
                        if !bs_test(buf, fpx_data_off + (i as usize) * 32, b) { return -1; }
                    }
                    p += fpx_len;
                    if fpx_steps == n_steps {
                        if n_tail == 0 { return p; }
                        if n_tail == 1 {
                            off = r32(buf, tail_arr_off) as usize;
                            pos = p; continue;
                        }
                        for i in 0..n_tail - 1 {
                            let t = r32(buf, tail_arr_off + i * 4) as usize;
                            p = exec(ctx, t, p);
                            if p < 0 { return -1; }
                        }
                        off = r32(buf, tail_arr_off + (n_tail - 1) * 4) as usize;
                        pos = p; continue;
                    }
                    p = exec_flat_steps(ctx, steps_off, fpx_steps, n_steps, p);
                    if p < 0 { return -1; }
                } else {
                    p = exec_flat_steps(ctx, steps_off, 0, n_steps, p);
                    if p < 0 { return -1; }
                }

                if n_tail == 0 { return p; }
                if n_tail == 1 {
                    off = r32(buf, tail_arr_off) as usize;
                    pos = p; continue;
                }
                for i in 0..n_tail - 1 {
                    let t = r32(buf, tail_arr_off + i * 4) as usize;
                    p = exec(ctx, t, p);
                    if p < 0 { return -1; }
                }
                off = r32(buf, tail_arr_off + (n_tail - 1) * 4) as usize;
                pos = p; continue;
            }
            _ => { return -1; }
        }
    }
}

unsafe fn exec_flat_steps(ctx: &Ctx, steps_off: usize, start: usize, end: usize, mut p: i32) -> i32 {
    let buf = ctx.prog;
    let inp = ctx.input;
    let len = ctx.len;
    let mut cursor = steps_off;

    for _ in 0..start {
        cursor = skip_flat_step(buf, cursor);
    }

    for _ in start..end {
        let fop = r32(buf, cursor);
        let fbody = cursor + 4;
        match fop {
            FOP_BYTE => {
                let bv = r32(buf, fbody) as u8;
                if p >= len || *inp.add(p as usize) != bv { return -1; }
                p += 1;
                cursor = fbody + 4;
            }
            FOP_BITSET => {
                if p >= len { return -1; }
                let b = *inp.add(p as usize);
                if !bs_test(buf, fbody, b) { return -1; }
                p += 1;
                cursor = fbody + 32;
            }
            FOP_EXACTLY_BITSET => {
                let n = r32(buf, fbody + 32) as i32;
                if p + n > len { return -1; }
                for i in 0..n {
                    if !bs_test(buf, fbody, *inp.add((p + i) as usize)) { return -1; }
                }
                p += n;
                cursor = fbody + 36;
            }
            FOP_SEQ_BYTES => {
                let tlen = r32(buf, fbody) as i32;
                let text = buf.add(fbody + 4);
                if p + tlen > len { return -1; }
                for i in 0..tlen {
                    if *inp.add((p + i) as usize) != *text.add(i as usize) { return -1; }
                }
                p += tlen;
                cursor = fbody + 4 + ((tlen as usize + 3) & !3);
            }
            FOP_BETWEEN_BITSET => {
                let lo = r32(buf, fbody + 32) as i32;
                let hi = r32(buf, fbody + 36) as i32;
                let mut cnt = 0i32;
                while p < len && cnt < hi {
                    if !bs_test(buf, fbody, *inp.add(p as usize)) { break; }
                    p += 1; cnt += 1;
                }
                if cnt < lo { return -1; }
                cursor = fbody + 40;
            }
            FOP_REPEAT_BITSET => {
                let min = r32(buf, fbody + 32) as i32;
                let start_p = p;
                while p < len {
                    if !bs_test(buf, fbody, *inp.add(p as usize)) { break; }
                    p += 1;
                }
                if p - start_p < min { return -1; }
                cursor = fbody + 36;
            }
            FOP_REP_OPTIONAL => {
                let child_off = r32(buf, fbody) as usize;
                let lead_byte_raw = r32(buf, fbody + 4);
                let has_lead_bs = r32(buf, fbody + 8);
                if lead_byte_raw != 0xFFFFFFFF {
                    if p < len && *inp.add(p as usize) == lead_byte_raw as u8 {
                        let child_tag = r32(buf, child_off);
                        if child_tag == OP_FAST_SEQ2 {
                            let c2_off = r32(buf, child_off + 4 + 4) as usize;
                            let c2_tag = r32(buf, c2_off);
                            if c2_tag == OP_FAST_REPEAT_BITSET || c2_tag == OP_FAST_BETWEEN_BITSET {
                                let rbs_off = c2_off + 4;
                                let rmi = r32(buf, c2_off + 36) as i32;
                                let rma = if c2_tag == OP_FAST_BETWEEN_BITSET { r32(buf, c2_off + 40) as i32 } else { 0x7FFFFFFF };
                                let sp = p + 1;
                                let mut rp = sp;
                                let mut rc = 0i32;
                                while rp < len && rc < rma {
                                    if !bs_test(buf, rbs_off, *inp.add(rp as usize)) { break; }
                                    rp += 1; rc += 1;
                                }
                                if rc >= rmi { p = rp; }
                            } else if c2_tag == OP_FAST_EXACTLY_BITSET {
                                let rbs_off = c2_off + 4;
                                let rn = r32(buf, c2_off + 36) as i32;
                                let sp = p + 1;
                                if sp + rn <= len {
                                    let mut ok = true;
                                    for ri in 0..rn {
                                        if !bs_test(buf, rbs_off, *inp.add((sp + ri) as usize)) { ok = false; break; }
                                    }
                                    if ok { p = sp + rn; }
                                }
                            } else if c2_tag == OP_FAST_JOINED_BYTE {
                                let jelem_off = r32(buf, c2_off + 4) as usize;
                                let jsep = r32(buf, c2_off + 8) as u8;
                                let jelem_tag = r32(buf, jelem_off);
                                if jelem_tag == OP_FAST_REPEAT_BITSET {
                                    let jbs_off = jelem_off + 4;
                                    let jmi = r32(buf, jelem_off + 36) as i32;
                                    let sp = p + 1;
                                    let mut jp = sp;
                                    while jp < len {
                                        if !bs_test(buf, jbs_off, *inp.add(jp as usize)) { break; }
                                        jp += 1;
                                    }
                                    if jp - sp >= jmi {
                                        while jp < len && *inp.add(jp as usize) == jsep {
                                            let s2 = jp + 1;
                                            let mut jp2 = s2;
                                            while jp2 < len {
                                                if !bs_test(buf, jbs_off, *inp.add(jp2 as usize)) { break; }
                                                jp2 += 1;
                                            }
                                            if jp2 - s2 < jmi { break; }
                                            jp = jp2;
                                        }
                                        p = jp;
                                    }
                                } else {
                                    let r = exec(ctx, child_off, p);
                                    if r >= 0 { p = r; }
                                }
                            } else if c2_tag == OP_FAST_JOINED_BITSET_BYTE {
                                let jbs_off = c2_off + 4;
                                let jsep = r32(buf, c2_off + 36) as u8;
                                let sp = p + 1;
                                if sp < len {
                                    let mut jb = *inp.add(sp as usize);
                                    if bs_test(buf, jbs_off, jb) {
                                        let mut jp = sp + 1;
                                        while jp < len {
                                            jb = *inp.add(jp as usize);
                                            if bs_test(buf, jbs_off, jb) { jp += 1; continue; }
                                            if jb != jsep || jp + 1 >= len { break; }
                                            let nb = *inp.add((jp + 1) as usize);
                                            if !bs_test(buf, jbs_off, nb) { break; }
                                            jp += 2;
                                        }
                                        p = jp;
                                    }
                                }
                            } else {
                                let r = exec(ctx, child_off, p);
                                if r >= 0 { p = r; }
                            }
                        } else if child_tag == OP_REP_ONE_OR_MORE {
                            let rep_child_off = r32(buf, child_off + 4) as usize;
                            let rep_child_tag = r32(buf, rep_child_off);
                            if rep_child_tag == OP_FAST_SEQ2 {
                                let rc1_off = r32(buf, rep_child_off + 4) as usize;
                                let rc2_off = r32(buf, rep_child_off + 8) as usize;
                                let rc1_tag = r32(buf, rc1_off);
                                let rc2_tag = r32(buf, rc2_off);
                                if rc1_tag == OP_BYTE && rc2_tag == OP_FAST_REPEAT_BITSET {
                                    let rlb = r32(buf, rc1_off + 4) as u8;
                                    let rbs_off = rc2_off + 4;
                                    let rmi = r32(buf, rc2_off + 36) as i32;
                                    let mut rp = p;
                                    if rp < len && *inp.add(rp as usize) == rlb {
                                        rp += 1;
                                        let s0 = rp;
                                        while rp < len {
                                            if !bs_test(buf, rbs_off, *inp.add(rp as usize)) { break; }
                                            rp += 1;
                                        }
                                        if rp - s0 >= rmi {
                                            while rp < len && *inp.add(rp as usize) == rlb {
                                                rp += 1;
                                                let s1 = rp;
                                                while rp < len {
                                                    if !bs_test(buf, rbs_off, *inp.add(rp as usize)) { break; }
                                                    rp += 1;
                                                }
                                                if rp - s1 < rmi { rp = s1 - 1; break; }
                                            }
                                            p = rp;
                                        }
                                    }
                                } else {
                                    let r = exec(ctx, child_off, p);
                                    if r >= 0 { p = r; }
                                }
                            } else {
                                let r = exec(ctx, child_off, p);
                                if r >= 0 { p = r; }
                            }
                        } else {
                            let r = exec(ctx, child_off, p);
                            if r >= 0 { p = r; }
                        }
                    }
                } else if has_lead_bs != 0 {
                    let lbs_off = fbody + 12;
                    if p < len && bs_test(buf, lbs_off, *inp.add(p as usize)) {
                        let child_tag = r32(buf, child_off);
                        if child_tag == OP_FAST_SEQ3 {
                            let s3c1_off = r32(buf, child_off + 4) as usize;
                            let s3c2_off = r32(buf, child_off + 8) as usize;
                            let s3c3_off = r32(buf, child_off + 12) as usize;
                            let s3c1_tag = r32(buf, s3c1_off);
                            let s3c2_tag = r32(buf, s3c2_off);
                            let s3c3_tag = r32(buf, s3c3_off);
                            if s3c1_tag == OP_FAST_REPEAT_BITSET
                                && s3c2_tag == OP_REP_OPTIONAL
                                && s3c3_tag == OP_BYTE
                            {
                                let o_lb_raw = r32(buf, s3c2_off + 8);
                                if o_lb_raw != 0xFFFFFFFF {
                                    let o_child_off = r32(buf, s3c2_off + 4) as usize;
                                    let o_child_tag = r32(buf, o_child_off);
                                    if o_child_tag == OP_FAST_SEQ2 {
                                        let oc2_off = r32(buf, o_child_off + 8) as usize;
                                        let oc2_tag = r32(buf, oc2_off);
                                        if oc2_tag == OP_FAST_REPEAT_BITSET {
                                            let abs_off = s3c1_off + 4;
                                            let ami = r32(buf, s3c1_off + 36) as i32;
                                            let olb = o_lb_raw as u8;
                                            let obs_off = oc2_off + 4;
                                            let omi = r32(buf, oc2_off + 36) as i32;
                                            let abyte = r32(buf, s3c3_off + 4) as u8;

                                            let mut ap = p;
                                            let as0 = ap;
                                            while ap < len {
                                                if !bs_test(buf, abs_off, *inp.add(ap as usize)) { break; }
                                                ap += 1;
                                            }
                                            if ap - as0 >= ami {
                                                if ap < len && *inp.add(ap as usize) == olb {
                                                    let os = ap + 1;
                                                    let mut op2 = os;
                                                    while op2 < len {
                                                        if !bs_test(buf, obs_off, *inp.add(op2 as usize)) { break; }
                                                        op2 += 1;
                                                    }
                                                    if op2 - os >= omi { ap = op2; }
                                                }
                                                if ap < len && *inp.add(ap as usize) == abyte {
                                                    p = ap + 1;
                                                }
                                            }
                                            cursor = fbody + 44;
                                            continue;
                                        }
                                    }
                                }
                            }
                        }
                        let r = exec(ctx, child_off, p);
                        if r >= 0 { p = r; }
                    }
                    cursor = fbody + 44;
                    continue;
                } else {
                    let r = exec(ctx, child_off, p);
                    if r >= 0 { p = r; }
                }
                cursor = fbody + 12;
            }
            FOP_EXEC => {
                let child_off = r32(buf, fbody) as usize;
                let child_tag = r32(buf, child_off);
                if child_tag == OP_FAST_ALT_BYTE_FIRST {
                    let abs_off = child_off + 4;
                    let fb_off = r32(buf, child_off + 36) as usize;
                    if p < len && bs_test(buf, abs_off, *inp.add(p as usize)) {
                        p += 1;
                    } else {
                        let fb_tag = r32(buf, fb_off);
                        if fb_tag == OP_FAST_SEQ_FLAT {
                            let fb_body = fb_off + 4;
                            let fb_nsteps = r32(buf, fb_body) as usize;
                            let _fb_steps_off = r32(buf, fb_body + 4) as usize;
                            let fb_ntail = r32(buf, fb_body + 8) as usize;
                            let fb_tail_arr = fb_body + 12;
                            let fb_has_fpx = r32(buf, fb_tail_arr + fb_ntail * 4);
                            if fb_has_fpx != 0 {
                                let fpx_meta = fb_tail_arr + fb_ntail * 4 + 4;
                                let fpx_len = r32(buf, fpx_meta) as i32;
                                let fpx_steps_count = r32(buf, fpx_meta + 4) as usize;
                                let fpx_data = fpx_meta + 8;
                                if fpx_steps_count == fb_nsteps && fb_ntail == 0 {
                                    if p + fpx_len > len { return -1; }
                                    let mut ok = true;
                                    for i in 0..fpx_len {
                                        if !bs_test(buf, fpx_data + (i as usize) * 32, *inp.add((p + i) as usize)) { ok = false; break; }
                                    }
                                    if !ok { return -1; }
                                    p += fpx_len;
                                } else {
                                    let r = exec(ctx, fb_off, p);
                                    if r < 0 { return -1; }
                                    p = r;
                                }
                            } else {
                                let r = exec(ctx, fb_off, p);
                                if r < 0 { return -1; }
                                p = r;
                            }
                        } else {
                            let r = exec(ctx, fb_off, p);
                            if r < 0 { return -1; }
                            p = r;
                        }
                    }
                } else if child_tag == OP_FAST_ALT_LEAD_DISPATCH {
                    if p >= len { return -1; }
                    let dbs_off = child_off + 4;
                    let dc1_off = r32(buf, child_off + 36) as usize;
                    let dc2_off = r32(buf, child_off + 40) as usize;
                    let b = *inp.add(p as usize);
                    let target = if bs_test(buf, dbs_off, b) { dc1_off } else { dc2_off };
                    let r = exec(ctx, target, p);
                    if r < 0 { return -1; }
                    p = r;
                } else {
                    let r = exec(ctx, child_off, p);
                    if r < 0 { return -1; }
                    p = r;
                }
                cursor = fbody + 4;
            }
            FOP_JOINED_BITSET_BYTE => {
                let sep = r32(buf, fbody + 32) as u8;
                if p >= len { return -1; }
                let mut b = *inp.add(p as usize);
                if !bs_test(buf, fbody, b) { return -1; }
                p += 1;
                while p < len {
                    b = *inp.add(p as usize);
                    if bs_test(buf, fbody, b) { p += 1; continue; }
                    if b != sep || p + 1 >= len { break; }
                    let nb = *inp.add((p + 1) as usize);
                    if !bs_test(buf, fbody, nb) { break; }
                    p += 2;
                }
                cursor = fbody + 36;
            }
            FOP_JOINED_BYTE => {
                let child_off = r32(buf, fbody) as usize;
                let sep = r32(buf, fbody + 4) as u8;
                let child_tag = r32(buf, child_off);
                if child_tag == OP_FAST_ALT_BYTE_FIRST {
                    let ebs_off = child_off + 4;
                    let efb_off = r32(buf, child_off + 36) as usize;
                    let mut jp: i32;
                    if p < len {
                        let b = *inp.add(p as usize);
                        if bs_test(buf, ebs_off, b) { jp = p + 1; }
                        else { jp = exec(ctx, efb_off, p); }
                    } else { jp = -1; }
                    if jp < 0 { return -1; }
                    while jp < len && *inp.add(jp as usize) == sep {
                        let np = jp + 1;
                        let ep: i32;
                        if np < len {
                            let b = *inp.add(np as usize);
                            if bs_test(buf, ebs_off, b) { ep = np + 1; }
                            else { ep = exec(ctx, efb_off, np); }
                        } else { ep = -1; }
                        if ep < 0 { break; }
                        jp = ep;
                    }
                    p = jp;
                } else {
                    let mut jp = exec(ctx, child_off, p);
                    if jp < 0 { return -1; }
                    while jp < len && *inp.add(jp as usize) == sep {
                        let ep = exec(ctx, child_off, jp + 1);
                        if ep < 0 { break; }
                        jp = ep;
                    }
                    p = jp;
                }
                cursor = fbody + 8;
            }
            FOP_LITERAL_REPEAT_BS => {
                let tlen = r32(buf, fbody) as i32;
                let text = buf.add(fbody + 4);
                let padded = (tlen as usize + 3) & !3;
                let bs_o = fbody + 4 + padded;
                let min = r32(buf, bs_o + 32) as i32;
                if p + tlen > len { return -1; }
                for i in 0..tlen {
                    if *inp.add((p + i) as usize) != *text.add(i as usize) { return -1; }
                }
                p += tlen;
                let start_p = p;
                while p < len {
                    if !bs_test(buf, bs_o, *inp.add(p as usize)) { break; }
                    p += 1;
                }
                if p - start_p < min { return -1; }
                cursor = bs_o + 36;
            }
            FOP_MULTI_LITERAL_REPEAT_BS => {
                let n_segs = r32(buf, fbody) as usize;
                let mut sc = fbody + 4;
                for _ in 0..n_segs {
                    let tlen = r32(buf, sc) as i32;
                    let text = buf.add(sc + 4);
                    let padded = (tlen as usize + 3) & !3;
                    let bs_o = sc + 4 + padded;
                    let min = r32(buf, bs_o + 32) as i32;
                    if p + tlen > len { return -1; }
                    for i in 0..tlen {
                        if *inp.add((p + i) as usize) != *text.add(i as usize) { return -1; }
                    }
                    p += tlen;
                    let start_p = p;
                    while p < len {
                        if !bs_test(buf, bs_o, *inp.add(p as usize)) { break; }
                        p += 1;
                    }
                    if p - start_p < min { return -1; }
                    sc = bs_o + 36;
                }
                cursor = sc;
            }
            _ => { return -1; }
        }
    }
    p
}

unsafe fn skip_flat_step(buf: *const u8, off: usize) -> usize {
    let fop = r32(buf, off);
    let body = off + 4;
    match fop {
        FOP_BYTE => body + 4,
        FOP_BITSET => body + 32,
        FOP_EXACTLY_BITSET => body + 36,
        FOP_SEQ_BYTES => {
            let tlen = r32(buf, body) as usize;
            body + 4 + ((tlen + 3) & !3)
        }
        FOP_BETWEEN_BITSET => body + 40,
        FOP_REPEAT_BITSET => body + 36,
        FOP_REP_OPTIONAL => {
            let has_lead_bs = r32(buf, body + 8);
            if has_lead_bs != 0 { body + 44 } else { body + 12 }
        }
        FOP_EXEC => body + 4,
        FOP_JOINED_BITSET_BYTE => body + 36,
        FOP_JOINED_BYTE => body + 8,
        FOP_LITERAL_REPEAT_BS => {
            let tlen = r32(buf, body) as usize;
            let padded = (tlen + 3) & !3;
            body + 4 + padded + 36
        }
        FOP_MULTI_LITERAL_REPEAT_BS => {
            let n_segs = r32(buf, body) as usize;
            let mut sc = body + 4;
            for _ in 0..n_segs {
                let tlen = r32(buf, sc) as usize;
                let padded = (tlen + 3) & !3;
                sc = sc + 4 + padded + 36;
            }
            sc
        }
        _ => body,
    }
}

#[no_mangle]
pub unsafe extern "C" fn fast_match(prog_ptr: *const u8, prog_len: u32, input_ptr: *const u8, input_len: u32) -> i32 {
    let _ = prog_len;
    let buf = prog_ptr;
    let num_rules = r32(buf, 0);
    let entry_idx = r32(buf, 4) as usize;
    let _flags = *buf.add(8);
    let fully_flat = (_flags & 1) != 0;
    let needs_memo = (_flags & 2) != 0;
    let _has_extract = (_flags & 4) != 0;
    let rules_off = 16usize;
    let len = input_len as i32;

    let saved_heap_ptr = HEAP_PTR;
    let memo_ptr: *mut i32;
    let stride = len + 1;
    if needs_memo {
        let memo_size = (num_rules as usize) * (stride as usize) * 4;
        let raw = heap_alloc(memo_size);
        if raw.is_null() { HEAP_PTR = saved_heap_ptr; return -1; }
        memo_ptr = raw as *mut i32;
        let count = (num_rules as usize) * (stride as usize);
        for i in 0..count {
            *memo_ptr.add(i) = -2;
        }
    } else {
        memo_ptr = core::ptr::null_mut();
    }

    let ctx = Ctx {
        prog: buf,
        input: input_ptr,
        len,
        rules_off,
        num_rules,
        memo: memo_ptr,
        use_memo: needs_memo,
        stride,
    };

    let entry_off = r32(buf, rules_off + entry_idx * 4) as usize;

    let result = if fully_flat {
        exec_fully_flat(&ctx, entry_off)
    } else {
        exec(&ctx, entry_off, 0)
    };
    HEAP_PTR = saved_heap_ptr;
    result
}

unsafe fn exec_fully_flat(ctx: &Ctx, off: usize) -> i32 {
    let buf = ctx.prog;
    let tag = r32(buf, off);
    if tag != OP_FAST_SEQ_FLAT { return exec(ctx, off, 0); }

    let body = off + 4;
    let n_steps = r32(buf, body) as usize;
    let steps_off = r32(buf, body + 4) as usize;
    let n_tail = r32(buf, body + 8) as usize;
    let tail_arr_off = body + 12;
    let has_fpx = r32(buf, tail_arr_off + n_tail * 4);
    let fpx_meta_off = tail_arr_off + n_tail * 4 + 4;

    let inp = ctx.input;
    let len = ctx.len;
    let mut p: i32 = 0;

    if has_fpx != 0 {
        let fpx_len = r32(buf, fpx_meta_off) as i32;
        let fpx_steps_count = r32(buf, fpx_meta_off + 4) as usize;
        let fpx_data_off = fpx_meta_off + 8;

        if fpx_len > len { return -1; }
        for i in 0..fpx_len {
            let b = *inp.add(i as usize);
            if !bs_test(buf, fpx_data_off + (i as usize) * 32, b) { return -1; }
        }
        p = fpx_len;
        if fpx_steps_count == n_steps {
            p = exec_flat_tail(ctx, p, n_tail, tail_arr_off);
            return p;
        }
        p = exec_flat_steps(ctx, steps_off, fpx_steps_count, n_steps, p);
        if p < 0 { return -1; }
    } else {
        p = exec_flat_steps(ctx, steps_off, 0, n_steps, p);
        if p < 0 { return -1; }
    }

    exec_flat_tail(ctx, p, n_tail, tail_arr_off)
}

unsafe fn exec_flat_tail(ctx: &Ctx, mut p: i32, n_tail: usize, tail_arr_off: usize) -> i32 {
    let buf = ctx.prog;
    if n_tail == 0 { return p; }

    if n_tail == 1 {
        let t_off = r32(buf, tail_arr_off) as usize;
        let t_tag = r32(buf, t_off);
        if t_tag == OP_REP_ZERO_OR_MORE || t_tag == OP_REP_ONE_OR_MORE {
            let rep_min = if t_tag == OP_REP_ONE_OR_MORE { 1i32 } else { 0 };
            let child_off = r32(buf, t_off + 4) as usize;
            let lead_byte_raw = r32(buf, t_off + 8);
            let has_lead_bs = r32(buf, t_off + 12);
            let lead_bs_off = t_off + 16;

            let child_tag = r32(buf, child_off);
            if child_tag == OP_FAST_SEQ_FLAT {
                let cb = child_off + 4;
                let rn_steps = r32(buf, cb) as usize;
                let rsteps_off = r32(buf, cb + 4) as usize;
                let rn_tail = r32(buf, cb + 8);

                if rn_tail == 0 {
                    let inp = ctx.input;
                    let len = ctx.len;
                    let mut count = 0i32;
                    while p < len {
                        if has_lead_bs != 0 {
                            let b = *inp.add(p as usize);
                            if !bs_test(buf, lead_bs_off, b) { break; }
                        } else if lead_byte_raw != 0xFFFFFFFF {
                            if *inp.add(p as usize) != lead_byte_raw as u8 { break; }
                        }
                        let sp = p;
                        p = exec_flat_steps(ctx, rsteps_off, 0, rn_steps, p);
                        if p < 0 || p == sp { p = sp; break; }
                        count += 1;
                    }
                    return if count >= rep_min { p } else { -1 };
                }
            }

            let mut count = 0i32;
            if lead_byte_raw != 0xFFFFFFFF {
                let lb = lead_byte_raw as u8;
                let inp = ctx.input;
                let len = ctx.len;
                while p < len && *inp.add(p as usize) == lb {
                    let r = exec(ctx, child_off, p);
                    if r < 0 || r == p { break; }
                    p = r; count += 1;
                }
            } else if has_lead_bs != 0 {
                let inp = ctx.input;
                let len = ctx.len;
                while p < len {
                    let b = *inp.add(p as usize);
                    if !bs_test(buf, lead_bs_off, b) { break; }
                    let r = exec(ctx, child_off, p);
                    if r < 0 || r == p { break; }
                    p = r; count += 1;
                }
            } else {
                loop {
                    let r = exec(ctx, child_off, p);
                    if r < 0 || r == p { break; }
                    p = r; count += 1;
                }
            }
            return if count >= rep_min { p } else { -1 };
        }
        return exec(ctx, t_off, p);
    }

    for i in 0..n_tail - 1 {
        let t = r32(buf, tail_arr_off + i * 4) as usize;
        p = exec(ctx, t, p);
        if p < 0 { return -1; }
    }
    let last = r32(buf, tail_arr_off + (n_tail - 1) * 4) as usize;
    exec(ctx, last, p)
}

extern crate alloc;

use std::slice;
use std::ptr;
use std::ffi::CStr;
use std::fs;
use std::path::Path;
use std::collections::HashSet;

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
                let fb_text_ptr = if fb_is_seq { buf.add(fb_off + 8) } else { ptr::null() };

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
                        let r = exec(ctx, child_off, p);
                        if r >= 0 { p = r; }
                    }
                } else if has_lead_bs != 0 {
                    let lbs_off = fbody + 12;
                    if p < len && bs_test(buf, lbs_off, *inp.add(p as usize)) {
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
                let r = exec(ctx, child_off, p);
                if r < 0 { return -1; }
                p = r;
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
                let mut jp = exec(ctx, child_off, p);
                if jp < 0 { return -1; }
                while jp < len && *inp.add(jp as usize) == sep {
                    let ep = exec(ctx, child_off, jp + 1);
                    if ep < 0 { break; }
                    jp = ep;
                }
                p = jp;
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

fn exec_bytecode(prog: &[u8], input: &[u8]) -> i32 {
    if prog.len() < 16 { return -1; }
    let buf = prog.as_ptr();
    unsafe {
        let num_rules = r32(buf, 0);
        let entry_idx = r32(buf, 4) as usize;
        let flags = *buf.add(8);
        let fully_flat = (flags & 1) != 0;
        let needs_memo = (flags & 2) != 0;
        let rules_off = 16usize;
        let len = input.len() as i32;
        let stride = len + 1;

        let memo_ptr: *mut i32;
        let mut memo_buf: Vec<i32> = Vec::new();
        if needs_memo {
            let count = (num_rules as usize) * (stride as usize);
            memo_buf.resize(count, -2);
            memo_ptr = memo_buf.as_mut_ptr();
        } else {
            memo_ptr = ptr::null_mut();
        }

        let ctx = Ctx {
            prog: buf,
            input: input.as_ptr(),
            len,
            rules_off,
            num_rules,
            memo: memo_ptr,
            use_memo: needs_memo,
            stride,
        };

        let entry_off = r32(buf, rules_off + entry_idx * 4) as usize;

        if fully_flat {
            exec_fully_flat(&ctx, entry_off)
        } else {
            exec(&ctx, entry_off, 0)
        }
    }
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
            return exec_flat_tail(ctx, p, n_tail, tail_arr_off);
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
        return exec(ctx, r32(buf, tail_arr_off) as usize, p);
    }

    for i in 0..n_tail - 1 {
        let t = r32(buf, tail_arr_off + i * 4) as usize;
        p = exec(ctx, t, p);
        if p < 0 { return -1; }
    }
    let last = r32(buf, tail_arr_off + (n_tail - 1) * 4) as usize;
    exec(ctx, last, p)
}

fn scan_bytecode(prog: &[u8], input: &[u8]) -> Vec<(u32, u32)> {
    if prog.len() < 16 { return Vec::new(); }
    let buf_ptr = prog.as_ptr();
    unsafe {
        let num_rules = r32(buf_ptr, 0);
        let entry_idx = r32(buf_ptr, 4) as usize;
        let flags = *buf_ptr.add(8);
        let needs_memo = (flags & 2) != 0;
        let rules_off = 16usize;
        let len = input.len() as i32;
        let stride = len + 1;

        let memo_ptr: *mut i32;
        let mut memo_buf: Vec<i32> = Vec::new();
        if needs_memo {
            let count = (num_rules as usize) * (stride as usize);
            memo_buf.resize(count, -2);
            memo_ptr = memo_buf.as_mut_ptr();
        } else {
            memo_ptr = ptr::null_mut();
        }

        let ctx = Ctx {
            prog: buf_ptr,
            input: input.as_ptr(),
            len,
            rules_off,
            num_rules,
            memo: memo_ptr,
            use_memo: needs_memo,
            stride,
        };

        let entry_off = r32(buf_ptr, rules_off + entry_idx * 4) as usize;

        let lead_bs = compute_lead_bitset(buf_ptr, rules_off, entry_idx, entry_off);
        let mut results = Vec::new();

        if let Some(bs) = lead_bs {
            let inp = input.as_ptr();
            let mut pos = 0i32;
            while pos < len {
                let b = *inp.add(pos as usize);
                if (bs[(b >> 5) as usize] & (1 << (b & 31))) == 0 {
                    pos += 1;
                    continue;
                }
                if needs_memo {
                    let count = (num_rules as usize) * (stride as usize);
                    for i in 0..count { *memo_buf.as_mut_ptr().add(i) = -2; }
                }
                let end = exec(&ctx, entry_off, pos);
                if end > pos {
                    results.push((pos as u32, end as u32));
                    pos = end;
                } else {
                    pos += 1;
                }
            }
        } else {
            let mut pos = 0i32;
            while pos < len {
                if needs_memo {
                    let count = (num_rules as usize) * (stride as usize);
                    for i in 0..count { *memo_buf.as_mut_ptr().add(i) = -2; }
                }
                let end = exec(&ctx, entry_off, pos);
                if end > pos {
                    results.push((pos as u32, end as u32));
                    pos = end;
                } else {
                    pos += 1;
                }
            }
        }

        results
    }
}

unsafe fn compute_lead_bitset(buf: *const u8, rules_off: usize, _entry_idx: usize, off: usize) -> Option<[u32; 8]> {
    compute_lead_bs_inner(buf, rules_off, off, 0)
}

unsafe fn compute_lead_bs_inner(buf: *const u8, rules_off: usize, off: usize, depth: u32) -> Option<[u32; 8]> {
    if depth > 16 { return None; }
    let tag = r32(buf, off);
    let body = off + 4;
    match tag {
        OP_BYTE => {
            let mut bs = [0u32; 8];
            let b = r32(buf, body) as u8;
            bs[(b >> 5) as usize] |= 1 << (b & 31);
            Some(bs)
        }
        OP_BYTE_RANGE => {
            let mut bs = [0u32; 8];
            let lo = r32(buf, body) as u8;
            let hi = r32(buf, body + 4) as u8;
            for i in lo..=hi { bs[(i >> 5) as usize] |= 1 << (i & 31); }
            Some(bs)
        }
        OP_BITSET | OP_FAST_REPEAT_BITSET | OP_FAST_EXACTLY_BITSET | OP_FAST_BETWEEN_BITSET | OP_FAST_JOINED_BITSET_BYTE => {
            let mut bs = [0u32; 8];
            for i in 0..8 { bs[i] = r32(buf, body + i * 4); }
            Some(bs)
        }
        OP_NOT_BITSET => {
            let mut bs = [0u32; 8];
            for i in 0..8 { bs[i] = !r32(buf, body + i * 4); }
            bs[0] &= !1;
            Some(bs)
        }
        OP_TEXT | OP_FAST_SEQ_BYTES => {
            let tlen = r32(buf, body);
            if tlen == 0 { return None; }
            let b = *buf.add(body + 4);
            let mut bs = [0u32; 8];
            bs[(b >> 5) as usize] |= 1 << (b & 31);
            Some(bs)
        }
        OP_CHAR_CLASS_LETTER => { Some(char_class_bitset(OP_CHAR_CLASS_LETTER)) }
        OP_CHAR_CLASS_DIGIT => { Some(char_class_bitset(OP_CHAR_CLASS_DIGIT)) }
        OP_CHAR_CLASS_PRINTABLE => { Some(char_class_bitset(OP_CHAR_CLASS_PRINTABLE)) }
        OP_CHAR_CLASS_VISIBLE => { Some(char_class_bitset(OP_CHAR_CLASS_VISIBLE)) }
        OP_CHAR_CLASS_WHITESPACE => { Some(char_class_bitset(OP_CHAR_CLASS_WHITESPACE)) }
        OP_CHAR_CLASS_ALPHANUM => { Some(char_class_bitset(OP_CHAR_CLASS_ALPHANUM)) }
        OP_CHAR_CLASS_WORD => { Some(char_class_bitset(OP_CHAR_CLASS_WORD)) }
        OP_CHAR_CLASS_ANY => None,
        OP_CHAR_CLASS_UPPER => { Some(char_class_bitset(OP_CHAR_CLASS_UPPER)) }
        OP_CHAR_CLASS_LOWER => { Some(char_class_bitset(OP_CHAR_CLASS_LOWER)) }
        OP_CHAR_CLASS_HEX => { Some(char_class_bitset(OP_CHAR_CLASS_HEX)) }
        OP_FAST_SEQ2 => {
            let c1 = r32(buf, body) as usize;
            compute_lead_bs_inner(buf, rules_off, c1, depth + 1)
        }
        OP_FAST_SEQ3 => {
            let c1 = r32(buf, body) as usize;
            compute_lead_bs_inner(buf, rules_off, c1, depth + 1)
        }
        OP_SEQ => {
            let n = r32(buf, body);
            if n == 0 { return None; }
            let c0 = r32(buf, body + 4) as usize;
            compute_lead_bs_inner(buf, rules_off, c0, depth + 1)
        }
        OP_ALT => {
            let n = r32(buf, body) as usize;
            if n == 0 { return None; }
            let mut merged = [0u32; 8];
            for i in 0..n {
                let c = r32(buf, body + 4 + i * 4) as usize;
                match compute_lead_bs_inner(buf, rules_off, c, depth + 1) {
                    Some(bs) => { for j in 0..8 { merged[j] |= bs[j]; } }
                    None => return None,
                }
            }
            Some(merged)
        }
        OP_FAST_ALT_BYTE_FIRST | OP_FAST_ALT_LEAD_DISPATCH => {
            let mut bs = [0u32; 8];
            for i in 0..8 { bs[i] = r32(buf, body + i * 4); }
            Some(bs)
        }
        OP_REP_ONE_OR_MORE | OP_REP_ZERO_OR_MORE | OP_REP_OPTIONAL => {
            let child = r32(buf, body) as usize;
            compute_lead_bs_inner(buf, rules_off, child, depth + 1)
        }
        OP_REP_EXACTLY | OP_REP_BETWEEN => {
            let child = r32(buf, body) as usize;
            compute_lead_bs_inner(buf, rules_off, child, depth + 1)
        }
        OP_FAST_JOINED_BYTE => {
            let child = r32(buf, body) as usize;
            compute_lead_bs_inner(buf, rules_off, child, depth + 1)
        }
        OP_JOINED_BY | OP_JOINED_BY_LENIENT => {
            let child = r32(buf, body) as usize;
            compute_lead_bs_inner(buf, rules_off, child, depth + 1)
        }
        OP_RULE_REF => {
            let ri = r32(buf, body) as usize;
            let rule_off = r32(buf, rules_off + ri * 4) as usize;
            compute_lead_bs_inner(buf, rules_off, rule_off, depth + 1)
        }
        OP_EXTRACT => {
            let child = r32(buf, body) as usize;
            compute_lead_bs_inner(buf, rules_off, child, depth + 1)
        }
        OP_FAST_REP_BITSET_ALT => {
            let mut bs = [0u32; 8];
            for i in 0..8 { bs[i] = r32(buf, body + i * 4); }
            Some(bs)
        }
        OP_FAST_SEQ_FLAT => {
            let n_steps = r32(buf, body);
            if n_steps == 0 {
                let n_tail = r32(buf, body + 8) as usize;
                if n_tail == 0 { return None; }
                let tail_arr = body + 12;
                let first_tail = r32(buf, tail_arr) as usize;
                return compute_lead_bs_inner(buf, rules_off, first_tail, depth + 1);
            }
            let steps_off = r32(buf, body + 4) as usize;
            let fop = r32(buf, steps_off);
            let fb = steps_off + 4;
            match fop {
                FOP_BYTE => {
                    let mut bs = [0u32; 8];
                    let b = r32(buf, fb) as u8;
                    bs[(b >> 5) as usize] |= 1 << (b & 31);
                    Some(bs)
                }
                FOP_BITSET | FOP_EXACTLY_BITSET | FOP_BETWEEN_BITSET | FOP_REPEAT_BITSET | FOP_JOINED_BITSET_BYTE => {
                    let mut bs = [0u32; 8];
                    for i in 0..8 { bs[i] = r32(buf, fb + i * 4); }
                    Some(bs)
                }
                FOP_SEQ_BYTES => {
                    let tlen = r32(buf, fb);
                    if tlen == 0 { return None; }
                    let b = *buf.add(fb + 4);
                    let mut bs = [0u32; 8];
                    bs[(b >> 5) as usize] |= 1 << (b & 31);
                    Some(bs)
                }
                FOP_LITERAL_REPEAT_BS => {
                    let tlen = r32(buf, fb);
                    if tlen == 0 { return None; }
                    let b = *buf.add(fb + 4);
                    let mut bs = [0u32; 8];
                    bs[(b >> 5) as usize] |= 1 << (b & 31);
                    Some(bs)
                }
                FOP_EXEC | FOP_JOINED_BYTE | FOP_REP_OPTIONAL => {
                    let child = r32(buf, fb) as usize;
                    compute_lead_bs_inner(buf, rules_off, child, depth + 1)
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn char_class_bitset(c: u32) -> [u32; 8] {
    let mut bs = [0u32; 8];
    match c {
        OP_CHAR_CLASS_LETTER => { for i in 0x41u8..=0x5A { bs[(i>>5) as usize] |= 1<<(i&31); } for i in 0x61u8..=0x7A { bs[(i>>5) as usize] |= 1<<(i&31); } }
        OP_CHAR_CLASS_DIGIT => { for i in 0x30u8..=0x39 { bs[(i>>5) as usize] |= 1<<(i&31); } }
        OP_CHAR_CLASS_PRINTABLE => { for i in 0x20u8..=0x7E { bs[(i>>5) as usize] |= 1<<(i&31); } }
        OP_CHAR_CLASS_VISIBLE => { for i in 0x21u8..=0x7E { bs[(i>>5) as usize] |= 1<<(i&31); } }
        OP_CHAR_CLASS_WHITESPACE => { for b in [0x20u8, 0x09, 0x0A, 0x0D] { bs[(b>>5) as usize] |= 1<<(b&31); } }
        OP_CHAR_CLASS_ALPHANUM => { for i in 0x41u8..=0x5A { bs[(i>>5) as usize] |= 1<<(i&31); } for i in 0x61u8..=0x7A { bs[(i>>5) as usize] |= 1<<(i&31); } for i in 0x30u8..=0x39 { bs[(i>>5) as usize] |= 1<<(i&31); } }
        OP_CHAR_CLASS_WORD => { for i in 0x41u8..=0x5A { bs[(i>>5) as usize] |= 1<<(i&31); } for i in 0x61u8..=0x7A { bs[(i>>5) as usize] |= 1<<(i&31); } for i in 0x30u8..=0x39 { bs[(i>>5) as usize] |= 1<<(i&31); } bs[(0x5Fu8>>5) as usize] |= 1<<(0x5F&31); }
        OP_CHAR_CLASS_UPPER => { for i in 0x41u8..=0x5A { bs[(i>>5) as usize] |= 1<<(i&31); } }
        OP_CHAR_CLASS_LOWER => { for i in 0x61u8..=0x7A { bs[(i>>5) as usize] |= 1<<(i&31); } }
        OP_CHAR_CLASS_HEX => { for i in 0x30u8..=0x39 { bs[(i>>5) as usize] |= 1<<(i&31); } for i in 0x41u8..=0x46 { bs[(i>>5) as usize] |= 1<<(i&31); } for i in 0x61u8..=0x66 { bs[(i>>5) as usize] |= 1<<(i&31); } }
        _ => {}
    }
    bs
}

pub struct MatchProgram {
    bytecode: Vec<u8>,
}

#[repr(C)]
pub struct MatchScanResult {
    pub start: u32,
    pub end: u32,
}

#[repr(C)]
pub struct MatchScanResults {
    pub matches: *mut MatchScanResult,
    pub count: u32,
    pub capacity: u32,
}

#[no_mangle]
pub unsafe extern "C" fn match_program_from_bytecode(bytecode: *const u8, len: u32) -> *mut MatchProgram {
    if bytecode.is_null() || len < 16 { return ptr::null_mut(); }
    let data = slice::from_raw_parts(bytecode, len as usize).to_vec();
    let prog = Box::new(MatchProgram { bytecode: data });
    Box::into_raw(prog)
}

#[no_mangle]
pub unsafe extern "C" fn match_program_free(prog: *mut MatchProgram) {
    if !prog.is_null() {
        drop(Box::from_raw(prog));
    }
}

#[no_mangle]
pub unsafe extern "C" fn match_exec(prog: *const MatchProgram, input: *const u8, input_len: u32) -> i32 {
    if prog.is_null() || input.is_null() { return -1; }
    let p = &*prog;
    let inp = slice::from_raw_parts(input, input_len as usize);
    exec_bytecode(&p.bytecode, inp)
}

#[no_mangle]
pub unsafe extern "C" fn match_is_match(prog: *const MatchProgram, input: *const u8, input_len: u32) -> i32 {
    let consumed = match_exec(prog, input, input_len);
    if consumed == input_len as i32 { 1 } else { 0 }
}

#[no_mangle]
pub unsafe extern "C" fn match_scan(prog: *const MatchProgram, input: *const u8, input_len: u32) -> *mut MatchScanResults {
    if prog.is_null() || input.is_null() { return ptr::null_mut(); }
    let p = &*prog;
    let inp = slice::from_raw_parts(input, input_len as usize);
    let hits = scan_bytecode(&p.bytecode, inp);

    let count = hits.len();
    let matches = if count > 0 {
        let layout = std::alloc::Layout::array::<MatchScanResult>(count).unwrap();
        let ptr = std::alloc::alloc(layout) as *mut MatchScanResult;
        for (i, (s, e)) in hits.iter().enumerate() {
            *ptr.add(i) = MatchScanResult { start: *s, end: *e };
        }
        ptr
    } else {
        ptr::null_mut()
    };

    let results = Box::new(MatchScanResults {
        matches,
        count: count as u32,
        capacity: count as u32,
    });
    Box::into_raw(results)
}

#[no_mangle]
pub unsafe extern "C" fn match_scan_results_free(results: *mut MatchScanResults) {
    if results.is_null() { return; }
    let r = Box::from_raw(results);
    if !r.matches.is_null() && r.capacity > 0 {
        let layout = std::alloc::Layout::array::<MatchScanResult>(r.capacity as usize).unwrap();
        std::alloc::dealloc(r.matches as *mut u8, layout);
    }
}

#[no_mangle]
pub extern "C" fn match_version() -> u32 {
    1
}

#[repr(C)]
pub struct MatchLineMatch {
    pub line: u32,
    pub col: u32,
    pub end_col: u32,
}

#[repr(C)]
pub struct MatchFileResult {
    pub file_path: *mut u8,
    pub file_path_len: u32,
    pub matches: *mut MatchLineMatch,
    pub match_count: u32,
    pub match_capacity: u32,
}

#[repr(C)]
pub struct MatchSearchResults {
    pub files: *mut MatchFileResult,
    pub file_count: u32,
    pub file_capacity: u32,
    pub error_count: u32,
}

const BINARY_CHECK_BYTES: usize = 8192;

fn is_binary(buf: &[u8]) -> bool {
    let check_len = buf.len().min(BINARY_CHECK_BYTES);
    buf[..check_len].contains(&0u8)
}

const SKIP_DIRS: &[&str] = &[
    "node_modules", ".git", ".svn", ".hg",
    "dist", "build", "out", "target",
    ".next", ".nuxt", ".cache", "__pycache__",
    "coverage", ".output", ".turbo",
];

fn search_file_inner(prog: &[u8], content: &[u8]) -> Vec<MatchLineMatch> {
    let mut results = Vec::new();
    let mut line_start = 0usize;
    let mut line_num = 1u32;
    let len = content.len();

    loop {
        let line_end = content[line_start..].iter().position(|&b| b == b'\n')
            .map(|p| line_start + p)
            .unwrap_or(len);
        let line = &content[line_start..line_end];

        let hits = scan_bytecode(prog, line);
        for (s, e) in hits {
            results.push(MatchLineMatch { line: line_num, col: s, end_col: e });
        }

        if line_end >= len { break; }
        line_start = line_end + 1;
        line_num += 1;
    }

    results
}

fn alloc_line_matches(matches: Vec<MatchLineMatch>) -> (*mut MatchLineMatch, u32, u32) {
    let count = matches.len();
    if count == 0 { return (ptr::null_mut(), 0, 0); }
    unsafe {
        let layout = std::alloc::Layout::array::<MatchLineMatch>(count).unwrap();
        let p = std::alloc::alloc(layout) as *mut MatchLineMatch;
        for (i, m) in matches.iter().enumerate() {
            *p.add(i) = MatchLineMatch { line: m.line, col: m.col, end_col: m.end_col };
        }
        (p, count as u32, count as u32)
    }
}

fn alloc_c_string(s: &str) -> (*mut u8, u32) {
    let bytes = s.as_bytes();
    let len = bytes.len();
    if len == 0 { return (ptr::null_mut(), 0); }
    unsafe {
        let layout = std::alloc::Layout::array::<u8>(len).unwrap();
        let p = std::alloc::alloc(layout);
        ptr::copy_nonoverlapping(bytes.as_ptr(), p, len);
        (p, len as u32)
    }
}

fn walk_dir(dir: &Path, seen: &mut HashSet<String>, prog: &[u8], glob_ext: Option<&str>, results: &mut Vec<MatchFileResult>, errors: &mut u32) {
    let real = match fs::canonicalize(dir) {
        Ok(p) => p,
        Err(_) => return,
    };
    let key = real.to_string_lossy().to_string();
    if seen.contains(&key) { return; }
    seen.insert(key);

    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let ft = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        let name = entry.file_name();
        let name_str = name.to_string_lossy();

        if ft.is_dir() || ft.is_symlink() {
            if name_str.starts_with('.') || SKIP_DIRS.contains(&name_str.as_ref()) { continue; }
            if ft.is_symlink() {
                match fs::metadata(entry.path()) {
                    Ok(m) if m.is_dir() => {}
                    _ => continue,
                }
            }
            walk_dir(&entry.path(), seen, prog, glob_ext, results, errors);
        } else if ft.is_file() {
            if let Some(ext) = glob_ext {
                if !name_str.ends_with(ext) { continue; }
            }
            match fs::read(entry.path()) {
                Ok(buf) => {
                    if is_binary(&buf) { continue; }
                    let matches = search_file_inner(prog, &buf);
                    if !matches.is_empty() {
                        let path_str = entry.path().to_string_lossy().to_string();
                        let (fp, fp_len) = alloc_c_string(&path_str);
                        let (mp, mc, mcap) = alloc_line_matches(matches);
                        results.push(MatchFileResult {
                            file_path: fp, file_path_len: fp_len,
                            matches: mp, match_count: mc, match_capacity: mcap,
                        });
                    }
                }
                Err(_) => { *errors += 1; }
            }
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn match_search_file(
    prog: *const MatchProgram,
    path: *const i8,
) -> *mut MatchSearchResults {
    if prog.is_null() || path.is_null() { return ptr::null_mut(); }
    let p = &*prog;
    let c_str = CStr::from_ptr(path);
    let path_str = match c_str.to_str() {
        Ok(s) => s,
        Err(_) => return ptr::null_mut(),
    };

    let content = match fs::read(path_str) {
        Ok(b) => b,
        Err(_) => {
            let r = Box::new(MatchSearchResults {
                files: ptr::null_mut(), file_count: 0, file_capacity: 0, error_count: 1,
            });
            return Box::into_raw(r);
        }
    };

    if is_binary(&content) {
        let r = Box::new(MatchSearchResults {
            files: ptr::null_mut(), file_count: 0, file_capacity: 0, error_count: 0,
        });
        return Box::into_raw(r);
    }

    let matches = search_file_inner(&p.bytecode, &content);
    if matches.is_empty() {
        let r = Box::new(MatchSearchResults {
            files: ptr::null_mut(), file_count: 0, file_capacity: 0, error_count: 0,
        });
        return Box::into_raw(r);
    }

    let (fp, fp_len) = alloc_c_string(path_str);
    let (mp, mc, mcap) = alloc_line_matches(matches);

    let layout = std::alloc::Layout::array::<MatchFileResult>(1).unwrap();
    let files_ptr = std::alloc::alloc(layout) as *mut MatchFileResult;
    *files_ptr = MatchFileResult {
        file_path: fp, file_path_len: fp_len,
        matches: mp, match_count: mc, match_capacity: mcap,
    };

    let r = Box::new(MatchSearchResults {
        files: files_ptr, file_count: 1, file_capacity: 1, error_count: 0,
    });
    Box::into_raw(r)
}

#[no_mangle]
pub unsafe extern "C" fn match_search_folder(
    prog: *const MatchProgram,
    path: *const i8,
    glob: *const i8,
) -> *mut MatchSearchResults {
    if prog.is_null() || path.is_null() { return ptr::null_mut(); }
    let p = &*prog;
    let c_str = CStr::from_ptr(path);
    let path_str = match c_str.to_str() {
        Ok(s) => s,
        Err(_) => return ptr::null_mut(),
    };

    let glob_ext = if !glob.is_null() {
        let g = CStr::from_ptr(glob);
        match g.to_str() {
            Ok(s) if s.starts_with("*.") => Some(&s[1..]),
            Ok(s) if s.starts_with('.') => Some(s),
            _ => None,
        }
    } else {
        None
    };

    let mut file_results: Vec<MatchFileResult> = Vec::new();
    let mut errors = 0u32;
    let mut seen = HashSet::new();

    walk_dir(Path::new(path_str), &mut seen, &p.bytecode, glob_ext, &mut file_results, &mut errors);

    let file_count = file_results.len();
    let files_ptr = if file_count > 0 {
        let layout = std::alloc::Layout::array::<MatchFileResult>(file_count).unwrap();
        let fp = std::alloc::alloc(layout) as *mut MatchFileResult;
        for (i, fr) in file_results.iter().enumerate() {
            ptr::write(fp.add(i), MatchFileResult {
                file_path: fr.file_path, file_path_len: fr.file_path_len,
                matches: fr.matches, match_count: fr.match_count, match_capacity: fr.match_capacity,
            });
        }
        // The structs hold raw pointers and have no Drop impl; their copies now
        // live in `fp`. Drop the Vec normally to free its backing buffer —
        // forgetting it would leak that allocation on every folder search.
        drop(file_results);
        fp
    } else {
        ptr::null_mut()
    };

    let r = Box::new(MatchSearchResults {
        files: files_ptr, file_count: file_count as u32, file_capacity: file_count as u32,
        error_count: errors,
    });
    Box::into_raw(r)
}

#[no_mangle]
pub unsafe extern "C" fn match_search_results_free(results: *mut MatchSearchResults) {
    if results.is_null() { return; }
    let r = Box::from_raw(results);
    for i in 0..r.file_count as usize {
        let f = &*r.files.add(i);
        if !f.file_path.is_null() && f.file_path_len > 0 {
            let layout = std::alloc::Layout::array::<u8>(f.file_path_len as usize).unwrap();
            std::alloc::dealloc(f.file_path, layout);
        }
        if !f.matches.is_null() && f.match_capacity > 0 {
            let layout = std::alloc::Layout::array::<MatchLineMatch>(f.match_capacity as usize).unwrap();
            std::alloc::dealloc(f.matches as *mut u8, layout);
        }
    }
    if !r.files.is_null() && r.file_capacity > 0 {
        let layout = std::alloc::Layout::array::<MatchFileResult>(r.file_capacity as usize).unwrap();
        std::alloc::dealloc(r.files as *mut u8, layout);
    }
}

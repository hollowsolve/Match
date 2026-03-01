import sys
import os
import time
import re

sys.path.insert(0, os.path.dirname(__file__))
from match_lang import Program, load_bytecode, version

BYTECODE_DIR = "/tmp/match-bytecodes"

def test_basic():
    print(f"libmatch version: {version()}\n")

    email = load_bytecode(os.path.join(BYTECODE_DIR, "email.bin"))
    ip = load_bytecode(os.path.join(BYTECODE_DIR, "ip.bin"))
    uri = load_bytecode(os.path.join(BYTECODE_DIR, "uri.bin"))

    print("=== Match tests ===")
    assert email.is_match("user@example.com"), "email match failed"
    assert not email.is_match("not-an-email"), "email non-match failed"
    assert ip.is_match("192.168.1.1"), "ip match failed"
    assert not ip.is_match("hello"), "ip non-match failed"
    assert uri.is_match("https://example.com/path"), "uri match failed"
    print("All match tests passed.\n")

    print("=== Scan tests ===")
    text = "Contact user@example.com or admin@test.org for info"
    results = email.scan(text)
    print(f"  Email scan: {results}")
    assert len(results) == 2, f"Expected 2 emails, got {len(results)}"

    text2 = "Servers at 10.0.0.1 and 192.168.1.100 are down"
    results2 = ip.scan(text2)
    print(f"  IP scan: {results2}")
    assert len(results2) == 2, f"Expected 2 IPs, got {len(results2)}"

    text3 = "Visit https://example.com and http://test.org/page"
    results3 = uri.scan(text3)
    print(f"  URI scan: {results3}")
    assert len(results3) == 2, f"Expected 2 URIs, got {len(results3)}"
    print("All scan tests passed.\n")


def bench_mariomka():
    input_file = "/tmp/regex-benchmark/input-text.txt"
    if not os.path.exists(input_file):
        print(f"Skipping benchmark: {input_file} not found")
        return

    with open(input_file, "r") as f:
        data = f.read()

    data_bytes = data.encode("utf-8")
    print(f"Input: {len(data_bytes) / 1024 / 1024:.1f} MB\n")

    email = load_bytecode(os.path.join(BYTECODE_DIR, "email.bin"))
    ip = load_bytecode(os.path.join(BYTECODE_DIR, "ip.bin"))
    uri = load_bytecode(os.path.join(BYTECODE_DIR, "uri.bin"))

    tests = [
        ("Email", email, r"[\w.+-]+@[\w.-]+\.[\w.-]+"),
        ("URI",   uri,   r"[\w]+://[^/\s?#]+[^\s?#]+(?:\?[^\s#]*)?(?:#[^\s]*)?"),
        ("IP",    ip,    r"(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9])"),
    ]

    RUNS = 10

    print(f"{'Test':<10} {'Engine':<8} {'Time (ms)':>12} {'Count':>8}")
    print("─" * 42)

    for label, prog, pattern in tests:
        regex = re.compile(pattern)
        regex.findall(data)
        best_re = float("inf")
        re_count = 0
        for _ in range(RUNS):
            t0 = time.perf_counter()
            matches = regex.findall(data)
            ms = (time.perf_counter() - t0) * 1000
            re_count = len(matches)
            if ms < best_re:
                best_re = ms

        prog.scan_count(data)
        best_m = float("inf")
        m_count = 0
        for _ in range(RUNS):
            t0 = time.perf_counter()
            m_count = prog.scan_count(data)
            ms = (time.perf_counter() - t0) * 1000
            if ms < best_m:
                best_m = ms

        ratio = best_m / best_re if best_re > 0.001 else 0
        count_ok = "✓" if m_count == re_count else f"MISMATCH ({m_count} vs {re_count})"

        print(f"{label:<10} {'Regex':<8} {best_re:>10.2f}ms {re_count:>8}")
        print(f"{label:<10} {'Match':<8} {best_m:>10.2f}ms {m_count:>8}")
        print(f"  → {ratio:.2f}x (Match/Regex)  counts: {count_ok}")
        print()


if __name__ == "__main__":
    test_basic()
    print("=== Mariomka Benchmark (Python) ===\n")
    bench_mariomka()

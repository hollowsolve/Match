import ctypes
import ctypes.util
import os
import platform
import sys
from pathlib import Path
from typing import List, Tuple, Optional

_lib = None

def _find_lib():
    global _lib
    if _lib is not None:
        return _lib

    system = platform.system()
    if system == "Darwin":
        name = "libmatch_ffi.dylib"
    elif system == "Linux":
        name = "libmatch_ffi.so"
    elif system == "Windows":
        name = "match_ffi.dll"
    else:
        raise OSError(f"Unsupported platform: {system}")

    search_paths = []

    env_path = os.environ.get("MATCH_LIB_PATH")
    if env_path:
        search_paths.append(env_path)

    here = Path(__file__).parent
    search_paths.extend([
        str(here / name),
        str(here / "lib" / name),
        str(here.parent.parent / "native" / "libmatch" / "target" / "release" / name),
    ])

    for p in search_paths:
        if os.path.isfile(p):
            _lib = ctypes.cdll.LoadLibrary(p)
            _setup_lib(_lib)
            return _lib

    try:
        _lib = ctypes.cdll.LoadLibrary(name)
        _setup_lib(_lib)
        return _lib
    except OSError:
        pass

    raise OSError(
        f"Could not find {name}. Set MATCH_LIB_PATH or build with: "
        f"cd native/libmatch && cargo build --release"
    )


def _setup_lib(lib):
    lib.match_program_from_bytecode.argtypes = [ctypes.c_char_p, ctypes.c_uint32]
    lib.match_program_from_bytecode.restype = ctypes.c_void_p

    lib.match_program_free.argtypes = [ctypes.c_void_p]
    lib.match_program_free.restype = None

    lib.match_exec.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_uint32]
    lib.match_exec.restype = ctypes.c_int32

    lib.match_is_match.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_uint32]
    lib.match_is_match.restype = ctypes.c_int32

    lib.match_scan.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_uint32]
    lib.match_scan.restype = ctypes.c_void_p

    lib.match_scan_results_free.argtypes = [ctypes.c_void_p]
    lib.match_scan_results_free.restype = None

    lib.match_version.argtypes = []
    lib.match_version.restype = ctypes.c_uint32


class MatchScanResult(ctypes.Structure):
    _fields_ = [("start", ctypes.c_uint32), ("end", ctypes.c_uint32)]


class MatchScanResults(ctypes.Structure):
    _fields_ = [
        ("matches", ctypes.POINTER(MatchScanResult)),
        ("count", ctypes.c_uint32),
        ("capacity", ctypes.c_uint32),
    ]


class Program:
    def __init__(self, bytecode: bytes):
        lib = _find_lib()
        self._lib = lib
        self._ptr = lib.match_program_from_bytecode(bytecode, len(bytecode))
        if not self._ptr:
            raise ValueError("Failed to load bytecode")

    def __del__(self):
        if hasattr(self, '_ptr') and self._ptr:
            self._lib.match_program_free(self._ptr)
            self._ptr = None

    def exec(self, input_str: str) -> int:
        data = input_str.encode("utf-8")
        return self._lib.match_exec(self._ptr, data, len(data))

    def is_match(self, input_str: str) -> bool:
        data = input_str.encode("utf-8")
        return self._lib.match_is_match(self._ptr, data, len(data)) == 1

    def scan(self, input_str: str) -> List[Tuple[int, int, str]]:
        data = input_str.encode("utf-8")
        results_ptr = self._lib.match_scan(self._ptr, data, len(data))
        if not results_ptr:
            return []
        results = ctypes.cast(results_ptr, ctypes.POINTER(MatchScanResults)).contents
        out = []
        for i in range(results.count):
            m = results.matches[i]
            text = data[m.start:m.end].decode("utf-8", errors="replace")
            out.append((m.start, m.end, text))
        self._lib.match_scan_results_free(results_ptr)
        return out

    def scan_bytes(self, input_bytes: bytes) -> List[Tuple[int, int]]:
        results_ptr = self._lib.match_scan(self._ptr, input_bytes, len(input_bytes))
        if not results_ptr:
            return []
        results = ctypes.cast(results_ptr, ctypes.POINTER(MatchScanResults)).contents
        out = []
        for i in range(results.count):
            m = results.matches[i]
            out.append((m.start, m.end))
        self._lib.match_scan_results_free(results_ptr)
        return out

    def scan_count(self, input_str: str) -> int:
        data = input_str.encode("utf-8")
        results_ptr = self._lib.match_scan(self._ptr, data, len(data))
        if not results_ptr:
            return 0
        results = ctypes.cast(results_ptr, ctypes.POINTER(MatchScanResults)).contents
        count = results.count
        self._lib.match_scan_results_free(results_ptr)
        return count


def load_bytecode(path: str) -> Program:
    with open(path, "rb") as f:
        return Program(f.read())


def version() -> int:
    lib = _find_lib()
    return lib.match_version()

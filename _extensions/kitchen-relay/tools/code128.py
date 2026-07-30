"""Minimal Code 128 decode/encode, used to turn the guide's RASTER volume
barcodes into vector without trusting a guess.

Decoding is only accepted when the modulo-103 checksum verifies, so a
misread produces nothing rather than a plausible-but-wrong barcode.
"""

# 107 symbol patterns, index = code value. Each is 6 element widths.
PATTERNS = [
 "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
 "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
 "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
 "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
 "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
 "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
 "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
 "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
 "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
 "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
 "114131","311141","411131","211412","211214","211232","2331112",
]
STOP = 106
START = {"A": 103, "B": 104, "C": 105}

_CODE_B = "".join(chr(c) for c in range(32, 127))  # values 0..94 -> ' '..'~'


def _runs_to_modules(runs):
    """Normalize element run-lengths to integer module counts (1..4)."""
    # Code 128: 11 modules per symbol. Total modules = 11*n + 2 (stop is 13).
    total = sum(runs)
    n_syms = (len(runs) - 1) // 6  # excluding the 7-element stop tail
    est_modules = 11 * n_syms + 13
    unit = total / est_modules
    return [max(1, min(4, round(r / unit))) for r in runs], unit


def decode_runs(runs):
    """runs = alternating bar/space widths starting with a bar."""
    mods, unit = _runs_to_modules(runs)
    # chunk into symbols of 6 elements; the final 7 are the stop pattern
    syms, i = [], 0
    while i + 6 <= len(mods):
        chunk = mods[i:i + 6]
        if len(mods) - i == 7:
            break
        syms.append("".join(str(m) for m in chunk))
        i += 6
    tail = "".join(str(m) for m in mods[i:])

    values = []
    for s in syms:
        if s not in PATTERNS:
            return None, f"unknown symbol {s!r} at {len(values)}"
        values.append(PATTERNS.index(s))
    if not values:
        return None, "no symbols"
    if tail not in ("2331112", "233111"):
        return None, f"bad stop pattern {tail!r}"

    start, *rest = values
    if start not in (103, 104, 105):
        return None, f"bad start {start}"
    if len(rest) < 1:
        return None, "truncated"
    checksum, data = rest[-1], rest[:-1]

    calc = start
    for i, v in enumerate(data, start=1):
        calc += i * v
    calc %= 103
    if calc != checksum:
        return None, f"checksum {checksum} != computed {calc}"

    # Decode data values to text (handles B and C; A only for the digits/upper we need)
    out, mode = [], {103: "A", 104: "B", 105: "C"}[start]
    for v in data:
        if mode == "C":
            if v < 100:
                out.append(f"{v:02d}")
            elif v == 100:
                mode = "B"
            elif v == 101:
                mode = "A"
            else:
                out.append(f"<{v}>")
        else:
            if v < 95:
                out.append(_CODE_B[v] if mode == "B" else _CODE_B[v])
            elif v == 99:
                mode = "C"
            elif v == 100:
                mode = "B"
            elif v == 101:
                mode = "A"
            else:
                out.append(f"<{v}>")
    return "".join(out), None


def encode(data, start="B"):
    """Return the list of element widths for `data` (Code B by default)."""
    vals = [START[start]]
    for ch in data:
        vals.append(_CODE_B.index(ch))
    chk = vals[0]
    for i, v in enumerate(vals[1:], start=1):
        chk += i * v
    vals.append(chk % 103)
    vals.append(STOP)
    widths = []
    for v in vals:
        widths.extend(int(c) for c in PATTERNS[v])
    return widths

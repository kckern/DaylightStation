#!/usr/bin/env python3
"""Generate the DS6878 SPP-Master pairing bar code for a Bluetooth address.

The scanner, once set to Serial Port Profile (Master), learns which device to
connect to by scanning a pairing bar code (DS6878 PRG p.4-25):

    <Fnc 3>Bxxxxxxxxxxxx        Code 128, 'B' prefix + 12-char BT address

The Fnc3 is what marks it as a command rather than data, so it must be encoded
as a real Code 128 FNC3 codeword — hence BWIPP (via treepoem) rather than a
plain Code 128 generator. Requires: pip install treepoem, plus ghostscript.

IMPORTANT: use the ESP's *Classic Bluetooth* MAC, not its WiFi/STA MAC. They
differ (on ESP32 the BT address is the base MAC + 2). Read it from the relay:

    curl -s http://<relay-ip>/status | jq -r .barcode.host_bt_mac

Usage:
    python3 gen-pairing-barcode.py f0:16:1d:02:2a:8a [out.png]
    python3 gen-pairing-barcode.py --from-relay 10.0.0.47 [out.png]
"""
import json
import sys
import urllib.request

try:
    import treepoem
except ImportError:
    sys.exit("need treepoem: pip install treepoem  (and a ghostscript install)")
from PIL import Image

SCALE = 4        # pixel multiplier — big enough to scan off a laptop screen
QUIET = 40       # quiet zone in final pixels; Code 128 needs >=10 modules


def mac_from_relay(host: str) -> str:
    with urllib.request.urlopen(f"http://{host}/status", timeout=5) as r:
        status = json.load(r)
    mac = status.get("barcode", {}).get("host_bt_mac")
    if not mac:
        sys.exit(f"{host} /status has no barcode.host_bt_mac — is it running the SPP firmware?")
    return mac


def main() -> None:
    args = [a for a in sys.argv[1:]]
    if not args:
        sys.exit(__doc__)
    if args[0] == "--from-relay":
        if len(args) < 2:
            sys.exit("--from-relay needs a host, e.g. --from-relay 10.0.0.47")
        mac = mac_from_relay(args[1])
        out = args[2] if len(args) > 2 else "ds6878-pairing.png"
    else:
        mac = args[0]
        out = args[1] if len(args) > 1 else "ds6878-pairing.png"

    hex_addr = mac.replace(":", "").replace("-", "").upper()
    if len(hex_addr) != 12 or any(c not in "0123456789ABCDEF" for c in hex_addr):
        sys.exit(f"not a 12-hex-digit Bluetooth address: {mac!r}")

    payload = "B" + hex_addr
    img = treepoem.generate_barcode(
        barcode_type="code128",
        data="^FNC3" + payload,
        options={"parsefnc": True},   # BWIPP option that makes ^FNC3 a real FNC3
    )
    img = img.convert("1")
    img = img.resize((img.width * SCALE, img.height * SCALE), Image.NEAREST)
    canvas = Image.new("1", (img.width + QUIET * 2, img.height + QUIET * 2), 1)
    canvas.paste(img, (QUIET, QUIET))
    canvas.save(out)

    print(f"Bluetooth address : {mac}")
    print(f"Bar code content  : <Fnc3>{payload}")
    print(f"Written           : {out}  ({canvas.width}x{canvas.height})")
    print()
    print("On the scanner, scan in this order:")
    print("  1. Serial Port Profile (Master)   — PRG p.4-4")
    print("  2. this pairing bar code")


if __name__ == "__main__":
    main()

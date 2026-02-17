# Xerox Scan Date Extraction Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract dates from 300 recovered Xerox scans and rename files with those dates.

**Architecture:** Two-phase approach: (1) Tesseract OCR + regex date parsing for typed/printed documents, (2) LLM vision for handwritten dates that Tesseract can't read. Blank backs (no content) inherit the date from their adjacent front page.

**Tech Stack:** Tesseract 5.5.0 (CLI), Python 3.13, sips (macOS image cropping)

---

## Document Types Observed

| Type | Example | Date Location | Tesseract? |
|------|---------|---------------|------------|
| Typed form | scan_250 | "Date: 6-8-2025" typed at top | Yes |
| Printed bulletin | scan_050 | "December 4, 2022" in header | Yes |
| Handwritten form | scan_100, 150, 200 | "Date: 4/9/23" handwritten at top | No |
| Blank back | scan_001 | No date (back of previous page) | N/A |

## Date Formats to Parse

- `M/D/YY` or `M/D/YYYY` (handwritten: `4/9/23`, `8/6/23`)
- `M-D-YYYY` or `M-D-YY` (typed: `6-8-2025`, `1-28-24`)
- `Month DD, YYYY` (printed: `December 4, 2022`, `February 19, 2023`)
- `Month DD YYYY` (no comma variant)

---

### Task 1: Create the OCR extraction script

**Files:**
- Create: `~/Pictures/xerox_scans/extract_dates.py`

**Step 1: Write the Python script**

```python
#!/usr/bin/env python3
"""
Phase 1: Tesseract OCR date extraction for Xerox scans.
Runs tesseract on top 20% of each image, parses dates via regex.
Outputs results.json with per-file date + confidence.
"""
import subprocess, re, json, os, sys, tempfile
from pathlib import Path
from datetime import datetime

SCAN_DIR = Path.home() / "Pictures" / "xerox_scans"
RESULTS_FILE = SCAN_DIR / "results.json"

MONTHS = r"(?:January|February|March|April|May|June|July|August|September|October|November|December)"
MONTHS_SHORT = r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)"

DATE_PATTERNS = [
    # "Date: 6-8-2025" or "Date: 1-28-24" or "Date: 4/9/23"
    (r'Date[:\s]+(\d{1,2})\s*[-/]\s*(\d{1,2})\s*[-/]\s*(\d{2,4})', 'mdy_numeric'),
    # "December 4, 2022" or "February 19, 2023"
    (rf'({MONTHS})\s+(\d{{1,2}}),?\s+(\d{{4}})', 'month_name_full'),
    # "Dec 4, 2022"
    (rf'({MONTHS_SHORT})\s+(\d{{1,2}}),?\s+(\d{{4}})', 'month_name_short'),
    # Standalone M/D/YY or M-D-YYYY anywhere (fallback)
    (r'(\d{1,2})\s*[-/]\s*(\d{1,2})\s*[-/]\s*(\d{2,4})', 'mdy_standalone'),
]

MONTH_MAP = {
    'January': 1, 'February': 2, 'March': 3, 'April': 4,
    'May': 5, 'June': 6, 'July': 7, 'August': 8,
    'September': 9, 'October': 10, 'November': 11, 'December': 12,
    'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4,
    'Jun': 6, 'Jul': 7, 'Aug': 8, 'Sep': 9,
    'Oct': 10, 'Nov': 11, 'Dec': 12,
}

def crop_top(img_path, fraction=0.20):
    """Crop top portion of image using sips, return temp path."""
    tmp = tempfile.NamedTemporaryFile(suffix='.jpg', delete=False)
    tmp.close()
    # Get dimensions
    result = subprocess.run(
        ['sips', '-g', 'pixelHeight', str(img_path)],
        capture_output=True, text=True
    )
    height = int(re.search(r'pixelHeight:\s+(\d+)', result.stdout).group(1))
    crop_height = int(height * fraction)
    # Copy and crop
    subprocess.run(['cp', str(img_path), tmp.name], check=True)
    # Crop from bottom to keep top portion
    crop_bottom = height - crop_height
    subprocess.run(
        ['sips', '--cropOffset', '0', '0', '--cropToHeightWidth', str(crop_height), '1700', tmp.name],
        capture_output=True, check=True
    )
    return tmp.name

def ocr_image(img_path):
    """Run tesseract on image, return text."""
    result = subprocess.run(
        ['tesseract', str(img_path), 'stdout', '--psm', '6'],
        capture_output=True, text=True
    )
    return result.stdout

def normalize_year(y):
    """Normalize 2-digit year to 4-digit."""
    y = int(y)
    if y < 100:
        y += 2000
    return y

def parse_date(text):
    """Try to extract a date from OCR text. Return (date_str, confidence)."""
    for pattern, ptype in DATE_PATTERNS:
        match = re.search(pattern, text, re.IGNORECASE)
        if not match:
            continue
        try:
            if ptype == 'mdy_numeric':
                m, d, y = int(match.group(1)), int(match.group(2)), normalize_year(match.group(3))
            elif ptype in ('month_name_full', 'month_name_short'):
                m = MONTH_MAP.get(match.group(1), 0)
                d, y = int(match.group(2)), int(match.group(3))
            elif ptype == 'mdy_standalone':
                m, d, y = int(match.group(1)), int(match.group(2)), normalize_year(match.group(3))
            else:
                continue

            if 1 <= m <= 12 and 1 <= d <= 31 and 2015 <= y <= 2026:
                dt = datetime(y, m, d)
                confidence = 'high' if ptype != 'mdy_standalone' else 'medium'
                return dt.strftime('%Y-%m-%d'), confidence
        except (ValueError, AttributeError):
            continue
    return None, None

def is_blank(text):
    """Check if OCR text indicates a mostly blank page."""
    cleaned = re.sub(r'\s+', '', text)
    return len(cleaned) < 20

def main():
    scans = sorted(SCAN_DIR.glob('xerox_scan_*.jpg'))
    print(f"Processing {len(scans)} scans...")
    results = {}

    for i, scan in enumerate(scans):
        name = scan.name
        # OCR full image first
        full_text = ocr_image(scan)

        if is_blank(full_text):
            results[name] = {'date': None, 'confidence': None, 'status': 'blank', 'ocr_snippet': ''}
            print(f"  [{i+1:3d}/300] {name}: BLANK")
            continue

        # Try date from full text
        date, confidence = parse_date(full_text)

        if date:
            results[name] = {'date': date, 'confidence': confidence, 'status': 'dated', 'ocr_snippet': full_text[:200]}
            print(f"  [{i+1:3d}/300] {name}: {date} ({confidence})")
        else:
            # Try cropped top 20% with higher resolution OCR
            try:
                cropped = crop_top(scan)
                top_text = ocr_image(cropped)
                os.unlink(cropped)
                date, confidence = parse_date(top_text)
            except Exception:
                top_text = ''
                date, confidence = None, None

            if date:
                results[name] = {'date': date, 'confidence': confidence, 'status': 'dated', 'ocr_snippet': top_text[:200]}
                print(f"  [{i+1:3d}/300] {name}: {date} ({confidence}) [from crop]")
            else:
                results[name] = {'date': None, 'confidence': None, 'status': 'undated', 'ocr_snippet': full_text[:200]}
                print(f"  [{i+1:3d}/300] {name}: UNDATED")

    # Summary
    dated = sum(1 for r in results.values() if r['status'] == 'dated')
    undated = sum(1 for r in results.values() if r['status'] == 'undated')
    blank = sum(1 for r in results.values() if r['status'] == 'blank')
    print(f"\nResults: {dated} dated, {undated} undated, {blank} blank")

    with open(RESULTS_FILE, 'w') as f:
        json.dump(results, f, indent=2)
    print(f"Saved to {RESULTS_FILE}")

if __name__ == '__main__':
    main()
```

**Step 2: Run the script**

Run: `python3 ~/Pictures/xerox_scans/extract_dates.py`
Expected: JSON file at `~/Pictures/xerox_scans/results.json` with per-file results. Typed/printed scans get dates. Handwritten and blank scans flagged for Phase 2.

**Step 3: Review results and assess Phase 2 needs**

Run: `python3 -c "import json; r=json.load(open('$HOME/Pictures/xerox_scans/results.json')); print(f'Dated: {sum(1 for v in r.values() if v[\"status\"]==\"dated\")}'); print(f'Undated: {sum(1 for v in r.values() if v[\"status\"]==\"undated\")}'); print(f'Blank: {sum(1 for v in r.values() if v[\"status\"]==\"blank\"])}')"`

---

### Task 2: Infer dates for blanks and neighbors

**Files:**
- Create: `~/Pictures/xerox_scans/infer_dates.py`

**Step 1: Write the inference script**

This script takes `results.json` and:
- Assigns blank pages the date of the nearest dated neighbor (front/back pairing)
- For undated pages between two identically-dated pages, assigns that date
- Leaves truly ambiguous pages as `undated` for LLM Phase 2

```python
#!/usr/bin/env python3
"""
Phase 1b: Infer dates for blank/undated scans from neighbors.
Reads results.json, writes inferred_results.json.
"""
import json
from pathlib import Path

SCAN_DIR = Path.home() / "Pictures" / "xerox_scans"
RESULTS_FILE = SCAN_DIR / "results.json"
INFERRED_FILE = SCAN_DIR / "inferred_results.json"

def main():
    with open(RESULTS_FILE) as f:
        results = json.load(f)

    files = sorted(results.keys())

    # Pass 1: Blanks inherit from nearest dated neighbor
    for i, name in enumerate(files):
        if results[name]['status'] != 'blank':
            continue
        # Look at adjacent files
        prev_date = results[files[i-1]]['date'] if i > 0 else None
        next_date = results[files[i+1]]['date'] if i < len(files)-1 else None
        if prev_date:
            results[name]['date'] = prev_date
            results[name]['status'] = 'inferred'
            results[name]['confidence'] = 'inferred_from_neighbor'
        elif next_date:
            results[name]['date'] = next_date
            results[name]['status'] = 'inferred'
            results[name]['confidence'] = 'inferred_from_neighbor'

    # Summary
    dated = sum(1 for r in results.values() if r['status'] == 'dated')
    inferred = sum(1 for r in results.values() if r['status'] == 'inferred')
    undated = sum(1 for r in results.values() if r['status'] == 'undated')
    blank = sum(1 for r in results.values() if r['status'] == 'blank')
    print(f"Results: {dated} dated, {inferred} inferred, {undated} undated (need LLM), {blank} still blank")

    # List undated files for Phase 2
    undated_files = [k for k, v in results.items() if v['status'] == 'undated']
    if undated_files:
        print(f"\nUndated files for LLM Phase 2:")
        for f in undated_files:
            print(f"  {f}")

    with open(INFERRED_FILE, 'w') as f:
        json.dump(results, f, indent=2)
    print(f"\nSaved to {INFERRED_FILE}")

if __name__ == '__main__':
    main()
```

**Step 2: Run the inference**

Run: `python3 ~/Pictures/xerox_scans/infer_dates.py`

---

### Task 3: Rename dated files

**Files:**
- Create: `~/Pictures/xerox_scans/rename_scans.py`

**Step 1: Write the rename script**

Renames files to `YYYY-MM-DD_NNN.jpg` format. Multiple scans on the same date get sequential suffixes (`_001`, `_002`, etc.). Undated files keep a `UNDATED_` prefix for easy identification.

```python
#!/usr/bin/env python3
"""
Rename scans based on extracted/inferred dates.
Uses inferred_results.json. Does a dry run first.
"""
import json, os, sys, shutil
from pathlib import Path
from collections import defaultdict

SCAN_DIR = Path.home() / "Pictures" / "xerox_scans"
INFERRED_FILE = SCAN_DIR / "inferred_results.json"

def main():
    dry_run = '--apply' not in sys.argv

    with open(INFERRED_FILE) as f:
        results = json.load(f)

    files = sorted(results.keys())
    date_counts = defaultdict(int)
    undated_count = 0
    renames = []

    for name in files:
        r = results[name]
        date = r.get('date')
        if date:
            date_counts[date] += 1
            seq = date_counts[date]
            new_name = f"{date}_{seq:03d}.jpg"
        else:
            undated_count += 1
            new_name = f"UNDATED_{undated_count:03d}.jpg"

        if name != new_name:
            renames.append((name, new_name))

    if dry_run:
        print(f"DRY RUN - {len(renames)} files to rename:")
        for old, new in renames[:20]:
            print(f"  {old} -> {new}")
        if len(renames) > 20:
            print(f"  ... and {len(renames) - 20} more")
        print(f"\nRun with --apply to execute.")
    else:
        # Rename to temp names first to avoid collisions
        tmp_renames = []
        for old, new in renames:
            tmp = f"_tmp_{old}"
            os.rename(SCAN_DIR / old, SCAN_DIR / tmp)
            tmp_renames.append((tmp, new))
        for tmp, new in tmp_renames:
            os.rename(SCAN_DIR / tmp, SCAN_DIR / new)
        print(f"Renamed {len(renames)} files.")

if __name__ == '__main__':
    main()
```

**Step 2: Dry run**

Run: `python3 ~/Pictures/xerox_scans/rename_scans.py`
Expected: Preview of renames without executing.

**Step 3: Apply renames**

Run: `python3 ~/Pictures/xerox_scans/rename_scans.py --apply`

---

### Task 4: Phase 2 — LLM OCR for undated scans

**Deferred.** After Task 3 completes, review the `UNDATED_*.jpg` files. These will be sent to Claude vision in a second batch for handwritten date reading. Plan for this will be written after Phase 1 results are known.

---

## Execution Order

1. **Task 1** — OCR extraction (tesseract on all 300 scans)
2. **Task 2** — Neighbor inference (blanks inherit dates)
3. **Task 3** — Rename files (dry run, then apply)
4. **Task 4** — LLM batch for remaining undated (separate plan)

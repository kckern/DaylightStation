# Binary Eye NutriBot UPC Scanning Setup

Scan food barcodes on your phone to instantly log nutrition via NutriBot.

---

## How It Works

```
Phone (WireGuard VPN) → Binary Eye scans barcode → Opens URL with UPC
   → https://{APP_DOMAIN}/api/v1/nutribot/upc?upc=012345678901
   → Cloudflare firewall: PASS (home IP via WireGuard)
   → UPC gateway looks up product → logs food to NutriBot → sends Telegram message
```

## Prerequisites

- [Binary Eye](https://github.com/markusfisch/BinaryEye) app (Android, free/open-source)
- WireGuard VPN active on phone (required — endpoint is IP-restricted)
- NutriBot running in production with UPC gateway configured

## API Endpoint

```
GET https://{APP_DOMAIN}/api/v1/nutribot/upc?upc={BARCODE}
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `upc` | Yes* | 8-14 digit barcode (UPC-A, UPC-E, EAN-13, EAN-8). *If `upc` is missing/empty, the endpoint falls back to any bare 8-14 digit query key (the shape Binary Eye produces when it appends the scan to the URL, e.g. `?member=popeye&0643843714477`). |
| `member` | No | Household member username (e.g., `popeye`). Resolves to Telegram ID via identity mappings. |
| `user_id` | No | Raw Telegram user ID. Fallback if `member` not provided. Defaults to head of household. |

## Setup Steps

### 1. Install Binary Eye

Install from [F-Droid](https://f-droid.org/packages/de.markusfisch.android.binaryeye/) or [Google Play](https://play.google.com/store/apps/details?id=de.markusfisch.android.binaryeye).

### 2. Configure "Send scan to URL"

1. Open Binary Eye → Settings (gear icon)
2. Enable **Send scan to URL** ("forward scans to a given URL")
3. Set **URL to forward to**:

```
https://{APP_DOMAIN}/api/v1/nutribot/upc?member={YOUR_USERNAME}
```

4. Set the send type to **GET, add content to URL**

**Important:** Binary Eye's send-scan feature has NO placeholder substitution — do not put `%s` or `upc=` in the URL. It simply appends the scanned code to the URL (`...?member=popeye&0643843714477`), and the endpoint detects the appended barcode automatically (see `directInput.mjs` bare-key fallback). Replace `{YOUR_USERNAME}` with your household member name (e.g., `popeye`), or omit `?member=...` entirely if you're the head of household.

(Binary Eye's `{RESULT}` placeholder only exists in its separate "Automated actions" and deep-link `ret` features, which open a browser per scan — the background send-scan feature is the better UX.)

## Usage

1. Ensure WireGuard is connected
2. Open Binary Eye
3. Point camera at food barcode
4. Barcode is scanned and URL opens automatically
5. Check Telegram for the logged food with portion selection buttons

## Testing

```bash
# Test with a known UPC (requires VPN or home network)
curl "https://{APP_DOMAIN}/api/v1/nutribot/upc?upc=016000275287"
```

Expected response:
```json
{
  "ok": true,
  "result": {
    "success": true,
    "nutrilogUuid": "...",
    "product": { "name": "Cheerios", "brand": "General Mills" }
  },
  "durationMs": 2000
}
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| 403 Forbidden | Not on VPN | Connect WireGuard before scanning |
| `Missing required parameter: upc` / `Invalid UPC format` with `upc=` or `upc=%s` in proxy logs | URL template contains `upc=` or `%s` — Binary Eye sends these literally and appends the code after `&` | Remove `upc=%s` from the URL; rely on append + server-side bare-key fallback (see step 2) |
| `Invalid UPC format` | Non-numeric barcode scanned | Only EAN/UPC barcodes work (not QR codes) |
| `Product not found` | UPC not in database | Describe the food via text in Telegram instead |
| No Telegram message | Wrong user_id | Add `&user_id={YOUR_TELEGRAM_ID}` to custom URL |

## Supported Barcode Formats

| Format | Digits | Common On |
|--------|--------|-----------|
| UPC-A | 12 | US/Canada products |
| UPC-E | 8 | Small US packages |
| EAN-13 | 13 | International products |
| EAN-8 | 8 | Small international packages |

QR codes, Code 128, and other non-numeric formats are not supported.

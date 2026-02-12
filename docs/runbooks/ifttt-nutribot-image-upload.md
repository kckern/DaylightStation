# IFTTT NutriBot Image Upload Setup

Quick food logging from phone camera via IFTTT button widget.

---

## How It Works

```
Phone → IFTTT Button Widget → Take Photo → Upload to IFTTT → GET request with img_url
   → https://app.example.com/api/v1/nutribot/pinhole?img_url=...
   → Cloudflare firewall: PASS (path ends with /pinhole)
   → AI analyzes image → logs food to NutriBot → sends Telegram message
```

## Prerequisites

- IFTTT account (free tier works)
- IFTTT app on phone
- NutriBot running in production

## User ID

The `/pinhole` endpoint defaults to the primary household user (configured in `data/system/config/chatbots.yml`). For multi-user households, append `&user_id={TELEGRAM_ID}` to the URL.

To find your Telegram user ID, send `/start` to `@userinfobot` on Telegram.

## Setup Steps

### 1. Create IFTTT Applet

1. Open IFTTT app or go to [ifttt.com/create](https://ifttt.com/create)
2. **If This:** Choose "Button widget" → "Button press"
3. **Then That:** Choose "Webhooks" → "Make a web request"

### 2. Configure the Webhook

| Field | Value |
|-------|-------|
| URL | `https://{APP_DOMAIN}/api/v1/nutribot/pinhole?img_url={{ImageURL}}` |
| Method | GET |
| Content Type | `application/json` |
| Body | *(leave empty)* |

**Note:** Replace `{APP_DOMAIN}` with your actual domain from DNS config.

### 3. Alternative: Camera-Triggered Applet

For automatic logging when you take a photo:

1. **If This:** "Android Photos" → "Any new photo" (or iOS equivalent)
2. **Then That:** Same webhook as above

This is noisier (triggers on ALL photos), so the button widget is usually better.

### 4. Add Widget to Home Screen

- **iOS:** Add IFTTT widget to Today View or Home Screen
- **Android:** Add IFTTT Button widget to home screen

## Testing

```bash
# Test with a sample food image URL
curl "https://{APP_DOMAIN}/api/v1/nutribot/pinhole?img_url=https://upload.wikimedia.org/wikipedia/commons/6/6d/Good_Food_Display_-_NCI_Visuals_Online.jpg"
```

Expected response:
```json
{
  "ok": true,
  "result": {
    "success": true,
    "nutrilogUuid": "...",
    "itemCount": 3
  },
  "durationMs": 5000
}
```

You should also see the food log appear in the Telegram NutriBot chat.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| 403 Forbidden | Cloudflare blocking | Verify path ends with `/pinhole` |
| `Missing required parameter: img_url` | IFTTT not passing image URL | Check webhook URL contains `?img_url={{ImageURL}}` |
| No Telegram message | Wrong user_id | Add `&user_id={YOUR_TELEGRAM_ID}` to URL |
| AI returns no food items | Image too dark/blurry | Ensure good lighting when photographing food |

## Security Notes

- The `/pinhole` endpoint is publicly accessible (no IP restriction)
- Input validation: URL format checked, request IP/user-agent logged
- No authentication required — security through obscurity of the URL
- Consider adding rate limiting if abuse is a concern

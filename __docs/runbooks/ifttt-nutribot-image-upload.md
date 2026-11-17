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

## Opening the route for the service

The webhook service sends a plain `GET` and cannot name a household device, so `/pinhole` refuses its request unless the household opens the route, in the nutribot app config:

```yaml
direct_input:
  allow_unbound:
    pinhole: [<username>, ...]
```

Without this block every request answers `403 device_not_allowed`. Config is read at startup.

## User ID

A photo is logged for the first user the route is opened for. For another listed member, append `&member={USERNAME}` to the URL (e.g., `&member=olive`). There is no fallback to the head of household.

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
| No Telegram message | Logged for another user | Add `&member={USERNAME}` to the URL |
| `403 device_not_allowed` | The route is not opened, or `member` names a user it is not opened for | Add the user under `direct_input.allow_unbound.pinhole` and restart |
| `429 daily_limit` | The user's Nutribot day is used up | Wait for local midnight, or raise `quick_input.daily_inputs` |
| AI returns no food items | Image too dark/blurry | Ensure good lighting when photographing food |

## Security Notes

- The `/pinhole` endpoint is publicly accessible (no IP restriction)
- It answers only while `direct_input.allow_unbound.pinhole` lists a user, and only for the users listed
- Once opened, anything on the internet that knows the address can log a photo for those users. No caller identity is checked on this path
- Each request counts against the user's daily Nutribot allowance (60 inputs at the default), which is the bound on what an abuser can spend
- A request from a web page on another site is refused
- Input validation: URL format checked, request IP/user-agent logged

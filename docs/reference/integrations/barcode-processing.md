# Barcode Processing Pipeline

How barcodes flow from physical scan to action. Covers the full path from USB scanner through MQTT to the backend's UPC lookup, nutrition classification, and food logging.

**Depends on:** [Barcode Scanner](barcode-scanner.md) (USB HID capture), Mosquitto MQTT broker, Telegram bot (for interactive portion selection)

---

## How It Fits

```
USB Scanner
       │  evdev grab + keystroke assembly
       ▼
MQTT: daylight/scanner/barcode
       │  { barcode, timestamp, device }
       ▼
┌──────────────────────────────────┐
│  Backend receives barcode        │
│  (MQTTSensorAdapter or API)      │
└──────┬───────────────────────────┘
       │
       ├─► UPC (8-14 digits) ──► LogFoodFromUPC
       │       │
       │       ├─► UPCGateway.lookup()
       │       │     ├─ Open Food Facts (primary)
       │       │     └─ Nutritionix (fallback)
       │       │
       │       ├─► CalorieColorService → green/yellow/orange
       │       │
       │       ├─► NutriLog created (pending)
       │       │
       │       └─► Telegram: product photo + portion buttons
       │             │
       │             └─► User selects portion → SelectUPCPortion
       │                   └─► NutriLog accepted → daily report
       │
       └─► QR / contentId ──► (future: Player via screen-framework)
```

---

## Input Channels

Barcodes reach the backend through three paths:

| Channel | Entry Point | Event Type |
|---------|-------------|------------|
| MQTT (scanner) | `MQTTSensorAdapter` subscribes to `daylight/scanner/barcode` | Sensor message |
| Telegram | User texts a UPC to the nutribot | `InputEventType.UPC` |
| Direct API | `POST /api/v1/nutribot/upc` | HTTP request |

### MQTT Message Format

**Topic:** `daylight/scanner/barcode`

```json
{
  "barcode": "749826002019",
  "timestamp": "2026-03-30T01:21:31.824+00:00",
  "device": "symbol-scanner"
}
```

### Direct API

```bash
# POST with body
curl -X POST http://localhost:3111/api/v1/nutribot/upc \
  -H "Content-Type: application/json" \
  -d '{"user": "kckern", "upc": "749826002019"}'

# Or query params
curl "http://localhost:3111/api/v1/nutribot/upc?user=kckern&upc=749826002019"
```

### Telegram Auto-Detection

`TelegramWebhookParser` classifies text as UPC when it matches 8-14 digits (dashes stripped):

```javascript
// backend/src/1_adapters/telegram/TelegramWebhookParser.mjs
#isUPC(text) {
  const cleaned = text.replace(/-/g, '');
  return /^\d{8,14}$/.test(cleaned);
}
```

---

## Event Type

**File:** `backend/src/2_domains/messaging/value-objects/InputEventType.mjs`

```javascript
export const InputEventType = Object.freeze({
  TEXT: 'text',
  VOICE: 'voice',
  IMAGE: 'image',
  CALLBACK: 'callback',
  COMMAND: 'command',
  UPC: 'upc',
});
```

`UPC` is a distinct event type, routed separately from text. The `NutribotInputRouter` dispatches it to `LogFoodFromUPC`.

---

## UPC Lookup

**File:** `backend/src/1_adapters/nutribot/UPCGateway.mjs`

### Normalization

UPCs are cleaned and zero-padded to 12 digits before lookup:

```javascript
#normalizeUpc(upc) {
  const cleaned = String(upc).replace(/-/g, '');
  // Pad 8-digit UPC-E or short codes to 12
  return cleaned.padStart(12, '0');
}
```

### Lookup Order

1. **Open Food Facts** (primary, no API key required)
   - `https://world.openfoodfacts.org/api/v0/product/{upc}.json`
   - Extracts nutrition per 100g, scales to serving size

2. **Nutritionix** (fallback, requires `appId` + `appKey` in secrets)
   - `https://trackapi.nutritionix.com/v2/search/item?upc={upc}`
   - Headers: `x-app-id`, `x-app-key`

### Returned Product

```javascript
{
  upc: '749826002019',
  name: 'Product Name',
  brand: 'Brand',
  imageUrl: 'https://...',
  icon: '🍎',
  noomColor: 'green',         // from CalorieColorService
  serving: { size: 100, unit: 'g' },
  nutrition: {
    calories: 250,
    protein: 8,
    carbs: 42,
    fat: 3,
    fiber: 2,
    sugar: 10,
    sodium: 500,              // mg
    cholesterol: 0,           // mg
  }
}
```

---

## Calorie Color Classification

**File:** `backend/src/2_domains/nutrition/services/CalorieColorService.mjs`

Classifies foods by calorie density (calories per gram):

| Density | Color | Examples |
|---------|-------|----------|
| < 1.0 cal/g | green | fruits, vegetables, soups |
| 1.0 - 2.4 cal/g | yellow | chicken breast, rice, yogurt |
| > 2.4 cal/g | orange | bread, cheese, nuts, oils |

Category override: foods tagged as vegetables, fruits, salads, or leafy are always green regardless of density.

---

## Food Logging Flow

### LogFoodFromUPC

**File:** `backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.mjs`

1. Generate barcode image as status indicator (via `BarcodeImageAdapter` / `bwip-js`)
2. Look up product via `UPCGateway`
3. Classify with `CalorieColorService`
4. Create `NutriLog` entity (status: `pending`)
5. Save to `YamlFoodLogDatastore` at `data/users/{userId}/nutrition/food-logs/pending/{uuid}.yml`
6. Send Telegram message with product photo, nutrition facts, and portion buttons

### Portion Selection

**File:** `backend/src/3_applications/nutribot/usecases/SelectUPCPortion.mjs`

When the user taps a portion button (1/4, 1/2, 1x, 2x, etc.):

1. Load pending `NutriLog` by UUID from callback data
2. Scale all nutrition values by the portion factor
3. Update status to `accepted`
4. Save to `YamlNutriListDatastore` at `data/users/{userId}/nutrition/nutrilist/{date}.yml`
5. Update Telegram message in-place (remove buttons, show final values)
6. Auto-trigger daily report if no pending logs remain

---

## Persistence

### Food Logs (per-item lifecycle)

```
data/users/{userId}/nutrition/food-logs/
├── pending/     # Awaiting portion selection
│   └── {uuid}.yml
├── accepted/    # Portion confirmed
│   └── {uuid}.yml
└── rejected/    # Cancelled
    └── {uuid}.yml
```

### Nutrilist (daily aggregation)

```
data/users/{userId}/nutrition/nutrilist/
└── {YYYY-MM-DD}.yml   # All accepted items for that day
```

---

## Dependency Wiring

**File:** `backend/src/3_applications/nutribot/NutribotContainer.mjs`

The container lazy-loads use cases with injected dependencies:

```javascript
getLogFoodFromUPC()      // UPC scan → product lookup → pending log
getSelectUPCPortion()    // Portion button → scale → accept log
getGenerateDailyReport() // Compile daily nutrition summary
```

**Bootstrap:** `backend/src/0_system/bootstrap.mjs` (line ~2206) creates `NutribotContainer` with:
- `upcGateway` — Open Food Facts + Nutritionix
- `foodLogStore` — YAML persistence for NutriLog lifecycle
- `nutriListStore` — YAML persistence for daily aggregation
- `barcodeGenerator` — `BarcodeImageAdapter` (bwip-js) for barcode images
- `messagingGateway` — Telegram adapter for interactive messages
- `aiGateway` — AI classification (optional)

---

## Files

| File | Layer | Purpose |
|------|-------|---------|
| `backend/src/2_domains/messaging/value-objects/InputEventType.mjs` | Domain | `UPC` event type definition |
| `backend/src/1_adapters/telegram/TelegramWebhookParser.mjs` | Adapter | Detects UPC format in Telegram text |
| `backend/src/1_adapters/nutribot/NutribotInputRouter.mjs` | Adapter | Routes `UPC` events to `LogFoodFromUPC` |
| `backend/src/1_adapters/nutribot/UPCGateway.mjs` | Adapter | Product lookup (OFF + Nutritionix) |
| `backend/src/1_adapters/nutribot/BarcodeImageAdapter.mjs` | Adapter | Generates barcode PNG via bwip-js |
| `backend/src/2_domains/nutrition/services/CalorieColorService.mjs` | Domain | Green/yellow/orange classification |
| `backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.mjs` | Application | UPC scan → lookup → pending log |
| `backend/src/3_applications/nutribot/usecases/SelectUPCPortion.mjs` | Application | Portion selection → accept log |
| `backend/src/3_applications/nutribot/NutribotContainer.mjs` | Application | DI container for all use cases |
| `backend/src/4_api/v1/handlers/nutribot/directInput.mjs` | API | `POST /api/v1/nutribot/upc` handler |
| `backend/src/4_api/v1/routers/nutribot.mjs` | API | Express router wiring |
| `backend/src/0_system/bootstrap.mjs` | System | Service creation and wiring |
| `backend/src/1_adapters/persistence/yaml/YamlFoodLogDatastore.mjs` | Adapter | NutriLog YAML persistence |
| `backend/src/1_adapters/persistence/yaml/YamlNutriListDatastore.mjs` | Adapter | Daily nutrilist YAML persistence |

---

## Current Gap: MQTT → Nutribot

The barcode scanner publishes to `daylight/scanner/barcode`, but the backend does not yet subscribe to that topic and route scans to `LogFoodFromUPC`. The existing `MQTTSensorAdapter` handles vibration sensor payloads, not barcode payloads.

To close the loop, one of:
- Add a barcode-specific MQTT subscriber in the backend that calls the direct UPC API endpoint
- Extend `MQTTSensorAdapter` to detect barcode payloads and route to the nutribot input router
- Add an EventBus subscriber that listens for `daylight/scanner/barcode` events

For now, scans can be tested via the direct API:
```bash
curl "http://localhost:3111/api/v1/nutribot/upc?user=kckern&upc=749826002019"
```

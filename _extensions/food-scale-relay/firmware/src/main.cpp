// shared food-scale + content-barcode relay — M5Stack ATOM Lite (ESP32-PICO-D4)
//
// BLE-connects to a KitchenIQ 50797 (SENSSUN FOOD) kitchen scale, decodes its
// weight notifications, and streams them (+ button presses) over WebSocket to
// the DaylightStation event bus (/ws). The backend re-broadcasts the
// `food-scale` topic. See ../README.md.
// The same ESP may also maintain a second BLE connection to a Zebra DS2278
// HID scanner and publish normalized barcode events.
//
// Message shapes sent to the bus (dispatched backend-side by `source`):
//   {"source":"food-scale-relay","type":"scale","id":"kitchen","grams":240,"stable":true,"unit":"g","ts":<ms>}
//   {"source":"food-scale-relay","type":"button","id":"kitchen","press":"short"|"long","ts":<ms>}

#include <Arduino.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <WebServer.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <NimBLEDevice.h>
#include <FastLED.h>
#include <Preferences.h>
#include "config.h"

// ---- onboard RGB status LED (SK6812 on GPIO27) --------------------------
#define LED_PIN     27
#define BTN_PIN     39
static CRGB led[1];
// Event-only lighting: the LED remains dark between events.
static void setLed(const CRGB& c) { led[0] = c; FastLED.show(); }
static void flashLed(const CRGB& c, uint16_t ms = 60) {
  setLed(c); delay(ms); setLed(CRGB::Black);
}

// ---- WebSocket ----------------------------------------------------------
static WebSocketsClient webSocket;
static bool wsConnected = false;
static uint32_t g_wsDownSinceMs = 0;   // when the live link actually dropped
static uint32_t g_wsRetries = 0;       // failed reconnects since that drop
static uint32_t g_wsDropCount = 0;     // real drops since boot (not retries)
static WebServer http(80);

// Ring sized 48: at 128 B of text per slot this is ~6 KB on a chip with 520 KB,
// and the extra depth is what lets a barcode/auth event survive a quiet night.
#define RECENT_LOG_MAX 48
struct RecentLog { uint32_t ms; uint16_t repeat; char text[128]; };
static RecentLog g_recentLogs[RECENT_LOG_MAX];
static uint8_t g_recentLogNext = 0;
static uint8_t g_recentLogCount = 0;
static void relayLogLine(const char* text) {
  // Coalesce consecutive duplicates rather than consuming a slot each time.
  // The BLE scan watchdog fires every ~45 s whenever the scale is switched off,
  // which is most of the day. Observed on the live unit: all 24 slots holding
  // that one line, so every Classic-BT auth/ACL event -- the only evidence of a
  // scanner that is trying and failing -- was evicted within ~18 minutes. A
  // repeat counter keeps the flood visible AS a flood without hiding anything.
  if (g_recentLogCount) {
    uint8_t newest = (uint8_t)((g_recentLogNext + RECENT_LOG_MAX - 1) % RECENT_LOG_MAX);
    if (strncmp(g_recentLogs[newest].text, text, sizeof(g_recentLogs[0].text)) == 0) {
      if (g_recentLogs[newest].repeat < 0xFFFF) g_recentLogs[newest].repeat++;
      g_recentLogs[newest].ms = millis();   // age tracks the LATEST occurrence
      Serial.println(text);
      return;
    }
  }
  strncpy(g_recentLogs[g_recentLogNext].text, text, sizeof(g_recentLogs[0].text)-1);
  g_recentLogs[g_recentLogNext].text[sizeof(g_recentLogs[0].text)-1] = 0;
  g_recentLogs[g_recentLogNext].ms = millis();
  g_recentLogs[g_recentLogNext].repeat = 1;
  g_recentLogNext = (g_recentLogNext + 1) % RECENT_LOG_MAX;
  if (g_recentLogCount < RECENT_LOG_MAX) g_recentLogCount++;
  Serial.println(text);
}
static void relayLogf(const char* fmt, ...) {
  char text[128]; va_list ap; va_start(ap, fmt); vsnprintf(text, sizeof(text), fmt, ap); va_end(ap);
  relayLogLine(text);
}


// ---- BLE state ----------------------------------------------------------
static NimBLEAdvertisedDevice* g_advDevice = nullptr;
static volatile bool g_doConnect = false;
static bool g_bleConnected = false;
static NimBLEClient* g_client = nullptr;
#if BARCODE_ENABLED
static NimBLEClient* g_hidClient = nullptr;   // DS2278 BLE-HID central
#endif
static bool g_scanActive = false;
// When the scale was last seen. Nonzero at boot because there is no scale yet;
// drives the scan backoff so an absent scale stops monopolising the antenna.
static uint32_t g_scaleAbsentSinceMs = 1;
#if BARCODE_ENABLED
static NimBLEAdvertisedDevice* g_hidTarget = nullptr;
static volatile bool g_doHidConnect = false;
static int  g_hidStreams = 0;              // subscribed report characteristics

// ---- barcode plumbing (transport-agnostic) ------------------------------
// Survived the Classic-SPP removal unchanged: the queues, the assembly buffer
// and the counters never cared how the bytes arrived. Only the decode differs —
// a BLE HID keyboard sends keycodes, Classic SPP sent the decoded symbol.
struct RawRep { uint16_t handle; uint8_t len; uint8_t d[40]; };
static QueueHandle_t g_bcQueue  = nullptr;   // completed barcode strings
static QueueHandle_t g_rawQueue = nullptr;   // raw reports, BLE task -> loop()
static String   g_code;                      // barcode being assembled
static uint32_t g_lastKeyMs = 0;             // when its last character arrived
static char     g_lastBarcode[128] = "";
static uint32_t g_lastBarcodeMs = 0;
static uint32_t g_scanCount = 0;
#endif


// ---- latest decoded reading (set in notify cb, read in loop) ------------
static volatile int   g_grams = 0;
static volatile bool  g_stable = false;
static volatile uint8_t g_unit = 0x00;
static volatile bool  g_haveReading = false;
static char g_lastButton[12] = "";
static uint32_t g_lastButtonMs = 0;

// ---- emit throttle state ------------------------------------------------
static int  g_lastSentGrams = INT32_MIN;
static bool g_lastSentStable = false;
static uint32_t g_lastSentMs = 0;

// ---- durability / hysteresis -------------------------------------------
// Which settled readings are worth PERSISTING, as opposed to streaming.
//
// The live stream is intentionally chatty (EMIT_MIN_DELTA_G=1 plus a 10 s
// heartbeat) because the nutribot prompt follows the weight up in real time.
// Persistence wants the opposite: one event per real placement. That filter
// used to live only backend-side (persistence.emptyThresholdG / dedupDeltaG in
// scales.yml), which is why a pan resting at 4 g yields dozens of emissions and
// exactly one history row.
//
// Keeping the filter only on the backend is what made the relay fragile: with
// no on-device notion of "durable", a WS outage could only queue raw emissions
// -- six identical heartbeats for one cup -- or nothing at all. Deciding
// durability here means the outage queue holds one event per placement.
//
// Defaults mirror config.example.yml. They are #ifndef so a future
// gen-config.mjs can promote them to the scales.yml SSOT without touching this.
#ifndef EMPTY_THRESHOLD_G
#define EMPTY_THRESHOLD_G 2      // at/below this the pan counts as empty
#endif
#ifndef DEDUP_DELTA_G
#define DEDUP_DELTA_G 2          // min change from the last durable value
#endif
static int  g_lastDurableGrams = INT32_MIN;
static bool g_panEmpty = true;

/**
 * Classify a reading, updating hysteresis state. Called for EVERY settled
 * reading regardless of link state -- if it only ran while the socket was down
 * the baseline would be stale the moment an outage began.
 */
static bool markDurable(int grams, bool stable) {
  if (!stable) return false;                 // mid-placement noise is never durable
  if (grams <= EMPTY_THRESHOLD_G) {
    // Emit the empty TRANSITION once: it ends a placement backend-side. Emitting
    // every resting frame would be the heartbeat problem in a new costume.
    bool transition = !g_panEmpty;
    g_panEmpty = true;
    g_lastDurableGrams = INT32_MIN;
    return transition;
  }
  if (g_panEmpty || g_lastDurableGrams == INT32_MIN ||
      abs(grams - g_lastDurableGrams) >= DEDUP_DELTA_G) {
    g_panEmpty = false;
    g_lastDurableGrams = grams;
    return true;
  }
  return false;
}

static const char* unitStr(uint8_t u) {
  switch (u) { case 0x00: return "g"; case 0x02: return "ml"; default: return "?"; }
}

// ---- durable event queue (scale settled + button) -----------------------
// Barcode scans already survive a WS outage via g_pending/queueScan. Scale
// readings and button presses did NOT: sendReading/sendButton returned early on
// !wsConnected, so the event was dropped with no queue, no counter, and no log
// line -- the relayLogf sat AFTER the early return. Worse, flashLed fired
// BEFORE it, so the LED blinked "sent" for something that never left the chip.
//
// TTL is the one asymmetry with scans. A late scan is harmless -- a UPC means
// the same thing five minutes on. A late WEIGHT is actively wrong: the bridge
// would read it as a fresh placement and prompt for food already eaten. So a
// reading past its TTL is discarded and counted rather than replayed.
#define PENDING_EVENT_MAX  16
#define PENDING_EVENT_TTL_MS 120000UL     // 2 min; past this a weight is a lie
#define PEV_READING 0
#define PEV_BUTTON  1
struct PendingEvent { uint8_t kind; int32_t grams; uint8_t unit; char press[12]; uint32_t ms; };
static PendingEvent g_pev[PENDING_EVENT_MAX];
static uint8_t  g_pevHead = 0;
static uint8_t  g_pevCount = 0;
static uint32_t g_pevDropped = 0;      // lost to queue overflow
static uint32_t g_pevExpired = 0;      // dropped by TTL on flush
static uint32_t g_droppedReadings = 0; // settled-but-not-durable, lost offline
static uint32_t g_droppedButtons = 0;  // should stay 0; buttons always queue

static void queueEvent(const PendingEvent& e) {
  if (g_pevCount == PENDING_EVENT_MAX) {
    g_pevHead = (g_pevHead + 1) % PENDING_EVENT_MAX;   // drop OLDEST: staler is worth less
    g_pevCount--;
    g_pevDropped++;
  }
  g_pev[(g_pevHead + g_pevCount) % PENDING_EVENT_MAX] = e;
  g_pevCount++;
}

// ---- send helpers -------------------------------------------------------
/** Wire-format a reading. `capturedMs` is capture time, not send time. */
static bool txReading(int grams, bool stable, uint8_t unit, uint32_t capturedMs) {
  if (!wsConnected) return false;
  JsonDocument doc;
  doc["source"] = "food-scale-relay";
  doc["type"]   = "scale";
  doc["id"]     = SCALE_ID;
  doc["grams"]  = grams;
  doc["stable"] = stable;
  doc["unit"]   = unitStr(unit);
  doc["ts"]     = capturedMs;
  uint32_t delayed = millis() - capturedMs;
  if (delayed > 1000) doc["delayed_ms"] = delayed;   // present only if it waited
  String out; serializeJson(doc, out);
  return webSocket.sendTXT(out);
}

static void sendReading(int grams, bool stable, uint8_t unit, bool durable) {
  if (!wsConnected) {
    // Offline. Persist only what a placement actually means; the live stream is
    // worthless once stale. LED tells the truth: amber = held, red = dropped.
    if (durable) {
      PendingEvent e{}; e.kind = PEV_READING; e.grams = grams; e.unit = unit; e.ms = millis();
      queueEvent(e);
      relayLogf("[scale] OFFLINE queued %d g (%u held)", grams, (unsigned)g_pevCount);
      flashLed(CRGB::Orange);
    } else {
      g_droppedReadings++;
      flashLed(CRGB::Red, 30);
    }
    return;
  }
  txReading(grams, stable, unit, millis());
  flashLed(CRGB::Green);
  relayLogf("[scale] %d g %s unit=%s", grams, stable ? "stable" : "changing", unitStr(unit));
  g_lastSentGrams = grams; g_lastSentStable = stable; g_lastSentMs = millis();
}

static bool txButton(const char* press, uint32_t capturedMs) {
  if (!wsConnected) return false;
  JsonDocument doc;
  doc["source"] = "food-scale-relay";
  doc["type"]   = "button";
  doc["id"]     = SCALE_ID;
  doc["press"]  = press;
  doc["ts"]     = capturedMs;
  uint32_t delayed = millis() - capturedMs;
  if (delayed > 1000) doc["delayed_ms"] = delayed;
  String out; serializeJson(doc, out);
  return webSocket.sendTXT(out);
}

static void sendButton(const char* press) {
  // Buttons queue UNCONDITIONALLY and are exempt from the reading TTL. The
  // button is the force-capture -- a deliberate "log this now", used precisely
  // when the auto heuristic would miss the measurement. Dropping one silently
  // (which is what the old early return did, behind a purple "sent" flash) is
  // the worst failure this relay had.
  strncpy(g_lastButton, press, sizeof(g_lastButton)-1); g_lastButton[sizeof(g_lastButton)-1]=0;
  g_lastButtonMs = millis();
  if (!wsConnected) {
    PendingEvent e{}; e.kind = PEV_BUTTON; e.ms = millis();
    strncpy(e.press, press, sizeof(e.press)-1);
    queueEvent(e);
    relayLogf("[btn] OFFLINE queued %s (%u held)", press, (unsigned)g_pevCount);
    flashLed(CRGB::Orange);
    return;
  }
  txButton(press, millis());
  flashLed(CRGB::Purple);
  relayLogf("[btn] %s", press);
}

// ---- BLE notify callback ------------------------------------------------
static void onNotify(NimBLERemoteCharacteristic* chr, uint8_t* data, size_t len, bool isNotify) {
  if (len < 10 || data[0] != 0xFF || data[1] != 0xA5) return;
  uint8_t sum = 0;
  for (int i = 2; i < 9; i++) sum += data[i];
  if (sum != data[9]) return; // checksum mismatch — drop
  uint16_t raw = ((uint16_t)data[WEIGHT_OFFSET] << 8) | data[WEIGHT_OFFSET + 1];
  g_grams  = raw / WEIGHT_DIVISOR;
  g_stable = (data[STABLE_BYTE] == STABLE_VALUE);
  g_unit   = data[UNIT_BYTE];
  g_haveReading = true;
}

#if BARCODE_ENABLED
static void flushBarcode() {
  if (!g_code.length()) return;
  char buf[128]; strncpy(buf, g_code.c_str(), sizeof(buf)-1); buf[sizeof(buf)-1]=0;
  xQueueSend(g_bcQueue, buf, 0); g_code="";
}

// SPP carries the decoded symbol as plain bytes, so there are no HID keyboard
// reports to translate. Zebra scanners may or may not append a terminator
// depending on configuration, so treat CR/LF as an immediate flush and keep the
// idle-gap flush in loop() as the fallback (the DS2278 sends no terminator at
// all over BLE HID, and the DS6878's SPP behaviour is unverified until we see a
// real scan).
static void onSppBytes(const uint8_t* data, size_t len) {
  for (size_t i = 0; i < len; i++) {
    uint8_t b = data[i];
    if (b == '\r' || b == '\n') { flushBarcode(); continue; }
    if (b < 0x20 || b > 0x7e) continue;            // drop control / non-printable
    if (g_code.length() < 120) g_code += (char)b;
    g_lastKeyMs = millis();
  }
}

// ---- offline scan queue -------------------------------------------------
// A dropped scan is a missing food-log entry that nobody can notice after the
// fact, so scans are the one event worth buffering across a backend outage.
// Weight readings deliberately are NOT queued: they are continuous, and a lost
// sample is superseded a second later. Bounded so a long outage cannot exhaust
// heap; on overflow the OLDEST is dropped, since a stale scan is worth less
// than a fresh one, and the drop is counted so /status can show it happened.
#define PENDING_SCAN_MAX 24
struct PendingScan { char code[128]; uint32_t ms; };
static PendingScan g_pending[PENDING_SCAN_MAX];
static uint8_t  g_pendingHead = 0;      // index of oldest queued scan
static uint8_t  g_pendingCount = 0;
static uint32_t g_pendingDropped = 0;

static bool sendScan(const char* code, uint32_t capturedMs) {
  if (!wsConnected) return false;
  JsonDocument d;
  d["source"] = "barcode-relay"; d["type"] = "scan";
  d["device"] = BARCODE_ID; d["route"] = BARCODE_ROUTE; d["code"] = code;
  d["ts"] = capturedMs;                    // capture time, not send time
  uint32_t delayed = millis() - capturedMs;
  if (delayed > 1000) d["delayed_ms"] = delayed;   // only present if it waited
  String out; serializeJson(d, out);
  return webSocket.sendTXT(out);
}

static void queueScan(const char* code, uint32_t capturedMs) {
  if (g_pendingCount == PENDING_SCAN_MAX) {
    g_pendingHead = (g_pendingHead + 1) % PENDING_SCAN_MAX;
    g_pendingCount--;
    g_pendingDropped++;
  }
  PendingScan& slot = g_pending[(g_pendingHead + g_pendingCount) % PENDING_SCAN_MAX];
  strncpy(slot.code, code, sizeof(slot.code) - 1);
  slot.code[sizeof(slot.code) - 1] = 0;
  slot.ms = capturedMs;
  g_pendingCount++;
}

static void flushPendingScans() {
  while (g_pendingCount && wsConnected) {
    PendingScan& p = g_pending[g_pendingHead];
    if (!sendScan(p.code, p.ms)) break;    // socket refused — keep it queued
    relayLogf("[barcode] flushed queued %s (%lus late)", p.code,
              (unsigned long)((millis() - p.ms) / 1000));
    g_pendingHead = (g_pendingHead + 1) % PENDING_SCAN_MAX;
    g_pendingCount--;
  }
}

#endif  // BARCODE_ENABLED

// Scale-side outage queue — NOT barcode code. It sat inside the BARCODE_ENABLED
// block by accident, which stayed invisible until the first scale-only board was
// built (2026-07-22) and loop() lost the symbol entirely.
static void flushPendingEvents() {
  while (g_pevCount && wsConnected) {
    PendingEvent& e = g_pev[g_pevHead];
    uint32_t lateMs = millis() - e.ms;

    // Readings expire; buttons never do. Replaying a two-minute-old weight would
    // post a prompt for food already eaten -- a wrong entry is worse than a
    // missing one. A button is a human decision and stays valid.
    if (e.kind == PEV_READING && lateMs > PENDING_EVENT_TTL_MS) {
      relayLogf("[scale] dropped stale queued %ld g (%lus late)",
                (long)e.grams, (unsigned long)(lateMs / 1000));
      g_pevExpired++;
      g_pevHead = (g_pevHead + 1) % PENDING_EVENT_MAX;
      g_pevCount--;
      continue;
    }

    bool sent = (e.kind == PEV_BUTTON) ? txButton(e.press, e.ms)
                                       : txReading(e.grams, true, e.unit, e.ms);
    if (!sent) break;                     // socket refused — keep it queued
    if (e.kind == PEV_BUTTON) {
      relayLogf("[btn] flushed queued %s (%lus late)", e.press, (unsigned long)(lateMs / 1000));
    } else {
      relayLogf("[scale] flushed queued %ld g (%lus late)", (long)e.grams, (unsigned long)(lateMs / 1000));
    }
    g_pevHead = (g_pevHead + 1) % PENDING_EVENT_MAX;
    g_pevCount--;
  }
}



#if BARCODE_ENABLED
// ---- DS2278 BLE HID central ---------------------------------------------
// Ported from _extensions/content-barcode-relay, which ran this end-to-end on
// 2026-07-11. The scanner must be set to "HID Bluetooth Low Energy
// (Discoverable)" (DS2278 PRG p.6-6); it then advertises as a standard BLE HID
// keyboard (service 0x1812) and streams boot/report keyboard input reports.
//
// This replaces the Classic-SPP DS6878 path. Both radios here are LE, which is
// why the scale and the scanner can share one ESP: the contention that made a
// Classic link die (HCI 0x08) does not arise between two LE connections.
static char hidToChar(uint8_t k, bool shift) {
  if (k >= 0x04 && k <= 0x1d) { char c = 'a' + (k - 0x04); return shift ? (char)(c - 32) : c; }
  if (k >= 0x1e && k <= 0x26) { const char* n = "123456789"; const char* sh = "!@#$%^&*("; return shift ? sh[k-0x1e] : n[k-0x1e]; }
  if (k == 0x27) return shift ? ')' : '0';
  switch (k) {
    case 0x2c: return ' ';
    case 0x2d: return shift ? '_' : '-';
    case 0x2e: return shift ? '+' : '=';
    case 0x2f: return shift ? '{' : '[';
    case 0x30: return shift ? '}' : ']';
    case 0x31: return shift ? '|' : '\\';
    case 0x33: return shift ? ':' : ';';
    case 0x34: return shift ? '"' : '\'';
    case 0x35: return shift ? '~' : '`';
    case 0x36: return shift ? '<' : ',';
    case 0x37: return shift ? '>' : '.';
    case 0x38: return shift ? '?' : '/';
    case 0x28: case 0x58: return '\n';       // Enter / keypad Enter
    default: return 0;
  }
}

// HID boot keyboard input report: [modifiers, reserved, k0..k5]. Only NEW
// key-downs count: a held key repeats in every report and would double letters.
static uint8_t g_hidPrev[6] = {0};
static void onHidReport(const uint8_t* data, size_t len) {
  if (len < 3) return;
  bool shift = (data[0] & 0x22) != 0;              // left/right shift
  const uint8_t* keys = data + 2;
  size_t nk = len - 2; if (nk > 6) nk = 6;
  for (size_t i = 0; i < nk; i++) {
    uint8_t k = keys[i];
    if (k == 0 || k == 1) continue;
    bool wasDown = false;
    for (size_t j = 0; j < 6; j++) if (g_hidPrev[j] == k) { wasDown = true; break; }
    if (wasDown) continue;
    char c = hidToChar(k, shift);
    if (c == '\n') flushBarcode();
    else if (c) { if (g_code.length() < 120) g_code += c; g_lastKeyMs = millis(); }
  }
  for (size_t j = 0; j < 6; j++) g_hidPrev[j] = (j < nk) ? keys[j] : 0;
}

static void hidNotifyCB(NimBLERemoteCharacteristic* ch, uint8_t* data, size_t len, bool) {
  RawRep r; r.handle = ch->getHandle();
  r.len = (uint8_t)(len > sizeof(r.d) ? sizeof(r.d) : len);
  memcpy(r.d, data, r.len);
  xQueueSend(g_rawQueue, &r, 0);
}

class HidClientCallbacks : public NimBLEClientCallbacks {
  void onConnect(NimBLEClient*) override { relayLogLine("[hid] connected"); }
  void onDisconnect(NimBLEClient* c) override {
    if (c == g_hidClient) {
      relayLogLine("[hid] disconnected");
      g_hidClient = nullptr; g_hidStreams = 0;
    }
  }
};
static HidClientCallbacks g_hidCb;

static bool connectHidScanner() {
  NimBLEClient* c = NimBLEDevice::createClient();
  c->setClientCallbacks(&g_hidCb, false);
  c->setConnectionParams(12, 12, 0, 150);
  c->setConnectTimeout(10);
  if (!c->connect(g_hidTarget)) { relayLogLine("[hid] connect failed"); NimBLEDevice::deleteClient(c); return false; }
  if (!c->secureConnection()) { relayLogLine("[hid] bond failed"); c->disconnect(); return false; }
  NimBLERemoteService* hid = c->getService(NimBLEUUID((uint16_t)0x1812));
  if (!hid) { relayLogLine("[hid] no HID service"); c->disconnect(); return false; }
  // Some HID devices withhold reports until the host reads the Report Map, and
  // will not use the Report characteristic until Protocol Mode is set to Report.
  NimBLERemoteCharacteristic* rmap = hid->getCharacteristic(NimBLEUUID((uint16_t)0x2A4B));
  if (rmap) rmap->readValue();
  NimBLERemoteCharacteristic* pmode = hid->getCharacteristic(NimBLEUUID((uint16_t)0x2A4E));
  if (pmode) { uint8_t one = 1; pmode->writeValue(&one, 1, false); }
  int subs = 0;
  for (auto ch : *hid->getCharacteristics(true)) {
    bool isReport  = ch->getUUID() == NimBLEUUID((uint16_t)0x2A4D);
    bool isBootKbd = ch->getUUID() == NimBLEUUID((uint16_t)0x2A22);
    if ((isReport || isBootKbd) && ch->canNotify() && ch->subscribe(true, hidNotifyCB)) subs++;
  }
  if (!subs) { relayLogLine("[hid] no notifiable report characteristics"); c->disconnect(); return false; }
  g_hidClient = c; g_hidStreams = subs;
  relayLogf("[hid] READY — %d report stream(s)", subs);
  return true;
}
#endif  // BARCODE_ENABLED

// ---- BLE scan callback --------------------------------------------------
class ScanCallbacks : public NimBLEAdvertisedDeviceCallbacks {
  void onResult(NimBLEAdvertisedDevice* d) override {
    NimBLEAdvertisedDevice& dev = *d;
#if BARCODE_ENABLED
    // The DS2278 advertises the standard HID service (0x1812). Claim it here so
    // one scan feeds both connections; the scale and the scanner are found by
    // the same sweep instead of competing for the radio.
    bool hidMatch = (BARCODE_MAC[0] && dev.getAddress().toString() == BARCODE_MAC)
                 || dev.isAdvertisingService(NimBLEUUID((uint16_t)0x1812))
                 || (dev.haveName() && String(dev.getName().c_str()).indexOf(BARCODE_NAME) >= 0);
    if (!g_hidClient && hidMatch) {
      relayLogf("[hid] found %s", dev.getAddress().toString().c_str());
      NimBLEDevice::getScan()->stop();
      g_scanActive = false;
      g_hidTarget = new NimBLEAdvertisedDevice(dev);
      g_doHidConnect = true;
      return;
    }
#endif
    bool nameMatch = dev.haveName() && dev.getName() == SCALE_MATCH_NAME;
    bool svcMatch  = dev.isAdvertisingService(NimBLEUUID(SCALE_SERVICE_UUID));
    if (!g_bleConnected && !g_doConnect && (nameMatch || svcMatch)) {
      relayLogf("[ble] found %s (%s)", dev.getName().c_str(), dev.getAddress().toString().c_str());
      NimBLEDevice::getScan()->stop();
      g_scanActive = false;
      g_advDevice = new NimBLEAdvertisedDevice(dev);
      g_doConnect = true;
      return;
    }
  }
};

class ClientCallbacks : public NimBLEClientCallbacks {
  void onConnect(NimBLEClient*) override {}
  void onDisconnect(NimBLEClient* c) override {
    if (c == g_client) {
      relayLogLine("[ble] scale disconnected");
      g_bleConnected=false; g_client=nullptr;
      g_scaleAbsentSinceMs = millis() ? millis() : 1;   // starts the backoff clock
    }
  }
};
static ClientCallbacks g_clientCb;

static bool connectToScale() {
  if (g_client) { g_client->disconnect(); g_client = nullptr; }
  g_client = NimBLEDevice::createClient();
  g_client->setClientCallbacks(&g_clientCb, false);
  if (!g_client->connect(g_advDevice)) { relayLogLine("[ble] scale connect failed"); return false; }
  NimBLERemoteService* svc = g_client->getService(SCALE_SERVICE_UUID);
  if (!svc) { relayLogLine("[ble] scale service missing"); g_client->disconnect(); return false; }
  NimBLERemoteCharacteristic* chr = svc->getCharacteristic(SCALE_NOTIFY_UUID);
  if (!chr || !chr->canNotify()) { relayLogLine("[ble] scale notify char missing"); g_client->disconnect(); return false; }
  chr->subscribe(true, onNotify);
  // Relax the BLE connection interval before declaring success. The default
  // fast interval (7.5-30 ms) keeps the BLE radio busy enough to starve the
  // Classic-BT barcode link on this shared antenna — the scanner then drops
  // with ACL reason 0x08 and beeps on every reconnect. A kitchen scale does not
  // need sub-100 ms latency: 100-160 ms still feels instant on the display and
  // frees a large slice of radio time for Classic.
  //   min/max in 1.25 ms units, timeout in 10 ms units.
  // NimBLE's updateConnParams() returns void — the peer's answer arrives later as
  // a connection-update event, so there is nothing to branch on here.
  g_client->updateConnParams(80, 128, 0, 600);
  relayLogLine("[ble] scale conn interval requested 100-160 ms");
  relayLogLine("[ble] subscribed to scale");
  g_bleConnected = true;
  g_scaleAbsentSinceMs = 0;      // present again: leave backoff
  return true;
}

// Kill switch for the BLE scale scan. A continuous BLE scan shares the single
// 2.4 GHz radio with the Classic HID link; when the scale is absent the scan
// gate below opens the instant the HID link connects and never closes. The
// DS6878 works fine against macOS (dedicated radio), so coexistence starvation
// is a live suspect for the ~16 ms HID teardown. Toggle: /ble/scan?on=0|1
// Scanner-only boards never scan for a scale. This is the whole point of the
// split: BLE discovery and a live Classic-BT SPP link cannot share this radio.
#ifndef SCALE_ENABLED
#define SCALE_ENABLED 1
#endif
static bool g_bleScanEnabled = SCALE_ENABLED;

static uint32_t g_scanStartedMs = 0;
static uint32_t g_scanIdleSinceMs = 0;

// Radio arbitration is GONE, deliberately. It existed because a Classic-BT SPP
// link cannot survive a concurrent BLE scan (HCI 0x08, supervision timeout) --
// measured repeatedly on 2026-07-22. Both radios here are now BLE: the scale
// client and the DS2278 HID central share the LE scheduler, which is exactly the
// arrangement content-barcode-relay ran without trouble. If a Classic link ever
// returns to this firmware, the arbitration has to return with it.
//
// An established SPP session no longer counts. It used to: `g_barcodeConnected`
// returned true here for the entire session, which was harmless only because the
// session never survived. Once the scanner actually stayed connected (2026-07-22,
// after a scanner factory reset fixed the bonding failure) it became a hard
// conflict — startScan() and serviceScanWatchdog() both gate on this, so a
// connected scanner suppressed the scale scan permanently. The kitchen scale
// powers itself off between uses and must be re-discovered by scanning, so that
// meant the scale half of the relay could never come back.
//
// Holding the antenna through the ACL/pairing window is kept: that is the window
// a20f1bac0 and 5c753d6c7 recorded BLE scanning wrecking. Holding it for hours
// afterwards was a workaround for a pairing failure that has since been fixed at
// its actual source, and the bond now persists in NVS, so a link that does drop
// re-establishes without operator involvement.
static void startScan() {
  if (g_scanActive || !g_bleScanEnabled) return;
  NimBLEScan* scan = NimBLEDevice::getScan();
  scan->setAdvertisedDeviceCallbacks(new ScanCallbacks(), false);
  scan->setActiveScan(true);
  // Low duty cycle (30/400 = 7.5%) on purpose. The previous 15/45 (33% in very
  // tight slices) starved Classic page scanning on the shared radio: the
  // scanner's connection attempts never reached us at all until the BLE scan
  // was switched off entirely. Finding the scale a second or two later is a
  // fine trade for the barcode link staying reachable.
  scan->setInterval(400);
  scan->setWindow(30);
  scan->start(0, nullptr, false); // continuous until a match stops it
  g_scanActive = true;
  g_scanStartedMs = millis();
}

// A Bluedroid duration-0 scan can stop delivering results without telling us.
// g_scanActive is only ever cleared when a device is FOUND, so once that
// happens the ESP is permanently deaf: startScan() early-returns forever and
// the scale can never be re-acquired. Observed live — the scale dropped and
// stayed gone for 56 minutes with scanning "enabled", and came back instantly
// when the scan was toggled off/on by hand. Restart it periodically while we
// have no scale, which costs nothing when the scan is genuinely healthy.
#define SCAN_RESTART_MS 45000
// After this long with no scale in sight, stop hammering the radio. The scale is
// routinely switched off for hours; the old code restarted a continuous scan
// every 45 s forever, which produced 300+ restarts in one observed 3.8 h stretch
// and is exactly the contention the Classic link cannot survive. Once we are in
// backoff, scan in short bursts instead.
#define SCALE_ABSENT_BACKOFF_MS   180000UL   // 3 min of absence -> back off
#define SCAN_BURST_MS              10000UL   // listen this long...
#define SCAN_BACKOFF_PERIOD_MS     60000UL   // ...once per this long

// While an SPP session is live the scan MUST be duty-cycled, never continuous.
// A continuous 7.5%-duty scan alongside an established Classic link kills it with
// HCI 0x08 (supervision timeout) within a couple of minutes — measured 2026-07-22:
// the scanner dropped and re-paged every few seconds, beeping each time, until
// this gate went in. Short bursts leave long uninterrupted stretches for Classic
// while still finding a scale that was just switched on within ~20 s.
// Measured 2026-07-22: 3 s bursts every 20 s still timed the SPP link out (HCI
// 0x08) after ~50 s. Discovery is the only thing that hurts — once the scale is
// CONNECTED no scanning happens at all and the two links coexist indefinitely —
// so the window is cut to the shortest that can still catch an advertiser, as
// rarely as is tolerable. Worst-case latency to notice a scale that was just
// switched on is SCAN_PERIOD_CLASSIC_MS.
#define SCAN_BURST_CLASSIC_MS       1500UL
#define SCAN_PERIOD_CLASSIC_MS     45000UL
// And the controller-level duty drops too while Classic is up: 20/800 = 2.5%
// instead of the usual 30/400 = 7.5%.
#define SCAN_INTERVAL_CLASSIC        800
#define SCAN_WINDOW_CLASSIC           20

static void serviceScanWatchdog() {
  if (!g_bleScanEnabled || g_bleConnected || g_doConnect) return;
  uint32_t now = millis();

  bool longAbsent = g_scaleAbsentSinceMs && (now - g_scaleAbsentSinceMs > SCALE_ABSENT_BACKOFF_MS);

  const uint32_t burstMs  = SCAN_BURST_MS;
  const uint32_t periodMs = SCAN_BACKOFF_PERIOD_MS;

  if (!longAbsent) {
    // Scale recently present: keep the responsive continuous scan, with the
    // stall watchdog that a duration-0 Bluedroid scan needs.
    if (!g_scanActive) { startScan(); return; }
    if (now - g_scanStartedMs < SCAN_RESTART_MS) return;
    relayLogLine("[ble] scan watchdog — restarting a stalled scan");
    NimBLEDevice::getScan()->stop();
    g_scanActive = false;
    startScan();
    return;
  }

  // Backoff duty cycle. Logged once per transition, not once per restart, so the
  // 48-entry ring keeps holding Classic diagnostics instead of scan chatter.
  if (g_scanActive) {
    if (now - g_scanStartedMs >= burstMs) {
      NimBLEDevice::getScan()->stop();
      g_scanActive = false;
      g_scanIdleSinceMs = now;
    }
  } else if (now - g_scanIdleSinceMs >= periodMs) {
    startScan();
  }
}

// ---- WebSocket events ---------------------------------------------------
static void wsEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    // Log only STATE TRANSITIONS, not every failed reconnect. arduinoWebSockets
    // raises DISCONNECTED on each retry, so a backend restart used to emit one
    // line every 5 s and flush the 24-entry ring buffer — during one outage it
    // evicted every classic-spp diagnostic, which made a scanner fault
    // impossible to diagnose from /status. Diagnostics must survive routine
    // noise, so the noise is what gets suppressed.
    case WStype_CONNECTED:
      if (!wsConnected) {
        if (g_wsDownSinceMs) {
          relayLogf("[ws] connected (down %lus, %lu attempts)",
                    (unsigned long)((millis() - g_wsDownSinceMs) / 1000),
                    (unsigned long)g_wsRetries);
        } else {
          relayLogLine("[ws] connected");
        }
      }
      wsConnected = true;
      g_wsDownSinceMs = 0;
      g_wsRetries = 0;
      break;
    case WStype_DISCONNECTED:
      if (wsConnected) {                       // the real disconnect
        relayLogLine("[ws] disconnected");
        g_wsDownSinceMs = millis();
        g_wsRetries = 0;
        g_wsDropCount++;
      } else {
        g_wsRetries++;                         // a retry that failed — count only
      }
      wsConnected = false;
      break;
    default: break; // inbound bus messages (heartbeat etc.) ignored — we're a producer
  }
}

static void handleStatus() {
  JsonDocument doc;
  doc["device"] = "food-scale-relay";
  doc["firmware"] = "shared-scale-content-barcode";
  doc["uptime_s"] = (uint32_t)(millis() / 1000);
  doc["identity"]["scale_id"] = SCALE_ID;
  doc["identity"]["barcode_id"] = BARCODE_ID;

  JsonObject wifi = doc["wifi"].to<JsonObject>();
  wifi["connected"] = WiFi.status() == WL_CONNECTED;
  wifi["ip"] = WiFi.localIP().toString();
  wifi["rssi"] = WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0;

  JsonObject ws = doc["websocket"].to<JsonObject>();
  ws["connected"] = wsConnected;
  ws["host"] = WS_HOST; ws["port"] = WS_PORT; ws["path"] = WS_PATH;
  ws["drops"] = g_wsDropCount;              // real drops since boot
  if (!wsConnected && g_wsDownSinceMs) {
    ws["down_s"] = (uint32_t)((millis() - g_wsDownSinceMs) / 1000);
    ws["retries"] = g_wsRetries;
  }

  JsonObject scale = doc["scale"].to<JsonObject>();
  scale["connected"] = g_bleConnected;
  scale["target_name"] = SCALE_MATCH_NAME;
  scale["have_reading"] = g_haveReading;
  scale["grams"] = g_grams; scale["stable"] = g_stable; scale["unit"] = unitStr(g_unit);
  // Scan state is not cosmetic: a stalled scan is invisible from the outside
  // and looks identical to "the scale is switched off".
  scale["scan_enabled"] = g_bleScanEnabled;
  scale["scan_active"] = g_scanActive;
  // Backoff state: an absent scale must stop monopolising the shared antenna.
  if (g_scaleAbsentSinceMs) {
    uint32_t absent = (millis() - g_scaleAbsentSinceMs) / 1000;
    scale["absent_s"] = absent;
    scale["scan_backoff"] = (millis() - g_scaleAbsentSinceMs) > SCALE_ABSENT_BACKOFF_MS;
  }
  // Offline durability. Previously a weight or a button press during a WS outage
  // vanished with no counter and no log line, behind a green "sent" LED.
  scale["pending_events"] = g_pevCount;
  scale["queue_dropped"] = g_pevDropped;      // overflowed the 16-slot queue
  scale["queue_expired"] = g_pevExpired;      // past TTL on flush; a late weight lies
  scale["dropped_readings"] = g_droppedReadings;  // non-durable, lost offline (expected)
  scale["dropped_buttons"] = g_droppedButtons;    // should always be 0
  scale["pan_empty"] = g_panEmpty;
  if (g_lastDurableGrams != INT32_MIN) scale["last_durable_g"] = g_lastDurableGrams;
  if (g_scanActive) scale["scan_age_s"] = (uint32_t)((millis() - g_scanStartedMs) / 1000);

  // Everything below touches Classic-BT state that only exists when the barcode
  // role is compiled in. A scale-only board (kitchen-food-scale: no `barcode:`
  // block in the SSOT) reports `enabled: false` and nothing else — consumers key
  // off `enabled` rather than assuming the fields are present.
  JsonObject barcode = doc["barcode"].to<JsonObject>();
  barcode["enabled"] = BARCODE_ENABLED ? true : false;
#if BARCODE_ENABLED
  barcode["transport"]  = "ble-hid";
  barcode["connected"]  = (bool)(g_hidClient != nullptr);
  barcode["streams"]    = g_hidStreams;        // 0 while connected = subscribed to nothing
  barcode["id"]         = BARCODE_ID;
  barcode["route"]      = BARCODE_ROUTE;
  barcode["target_name"]= BARCODE_NAME;
  barcode["mac"]        = BARCODE_MAC;
  barcode["bonded"]     = NimBLEDevice::getNumBonds() > 0;
  barcode["scan_count"]    = g_scanCount;
  barcode["pending_scans"] = g_pendingCount;   // buffered, awaiting the WS
  barcode["dropped_scans"] = g_pendingDropped; // lost to queue overflow
  if (g_lastBarcodeMs) {
    barcode["last_scan"] = g_lastBarcode;
    barcode["last_scan_age_s"] = (uint32_t)((millis() - g_lastBarcodeMs) / 1000);
  }
#endif

  JsonObject button = doc["button"].to<JsonObject>();
  if (g_lastButtonMs) { button["last_press"] = g_lastButton; button["last_press_age_s"] = (uint32_t)((millis()-g_lastButtonMs)/1000); }

  JsonArray logs = doc["recent_logs"].to<JsonArray>();
  uint8_t start = (uint8_t)((g_recentLogNext + RECENT_LOG_MAX - g_recentLogCount) % RECENT_LOG_MAX);
  for (uint8_t i=0; i<g_recentLogCount; i++) {
    const RecentLog& entry = g_recentLogs[(start+i)%RECENT_LOG_MAX];
    JsonObject item = logs.add<JsonObject>();
    item["age_s"] = (uint32_t)((millis()-entry.ms)/1000);   // age of the LATEST occurrence
    item["message"] = entry.text;
    if (entry.repeat > 1) item["repeat"] = entry.repeat;
  }

  String out; serializeJsonPretty(doc, out);
  http.sendHeader("Access-Control-Allow-Origin", "*");
  http.send(200, "application/json", out);
}

// ---- button (GPIO39, active-low) ----------------------------------------
// Physical re-pair gesture: hold ~3 s. This is the only control that works with
// nobody at a keyboard, so it does the whole ceremony — clear our half of the
// bond (an asymmetric link key is indistinguishable from a rejection), drop back
// to the pairing profile that is known to have worked, and hand the radio to
// Classic so the scanner's next attempt lands in a quiet band.
#define BTN_REPAIR_MS 3000UL
// Hold-to-repair: forget the scanner bond so a replacement DS2278 can pair
// without a laptop. Cheap now -- a BLE HID bond re-forms on the next connect
// with no operator ceremony, unlike the Classic link key this used to clear.
static void barcodeRepairGesture() {
#if BARCODE_ENABLED
  relayLogLine("[hid] REPAIR gesture — clearing BLE bonds");
  if (g_hidClient) g_hidClient->disconnect();
  NimBLEDevice::deleteAllBonds();
  for (int i = 0; i < 3; i++) { setLed(CRGB::White); delay(120); setLed(CRGB::Black); delay(120); }
#endif
}

static bool     g_btnDown = false;
static uint32_t g_btnDownMs = 0;
static bool     g_btnRepairArmed = false;
static void serviceButton() {
  bool down = digitalRead(BTN_PIN) == LOW;
  uint32_t now = millis();
  if (down && !g_btnDown) { g_btnDown = true; g_btnDownMs = now; g_btnRepairArmed = false; }
  else if (down && g_btnDown) {
    // Light up white once the hold is long enough to count, so the gesture is
    // confirmable without a screen: let go while it is white and it fires.
    if (!g_btnRepairArmed && now - g_btnDownMs >= BTN_REPAIR_MS) {
      g_btnRepairArmed = true;
      setLed(CRGB::White);
    }
  }
  else if (!down && g_btnDown) {
    g_btnDown = false;
    uint32_t held = now - g_btnDownMs;
    if (held < 40) return; // debounce
    if (held >= BTN_REPAIR_MS) {          // re-pair, NOT a food-log press
      g_btnRepairArmed = false;
      barcodeRepairGesture();
      return;
    }
    sendButton(held >= 800 ? "long" : "short");
    setLed(CRGB::Purple); delay(60);
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);
  relayLogLine("[food-scale-relay] boot");

  FastLED.addLeds<SK6812, LED_PIN, GRB>(led, 1);
  FastLED.setBrightness(60);
  setLed(CRGB::Black);
  pinMode(BTN_PIN, INPUT);
#if BARCODE_ENABLED
  g_bcQueue=xQueueCreate(8,128);
  g_rawQueue=xQueueCreate(32,sizeof(RawRep));
#endif

  // Init the BLE controller BEFORE WiFi so WiFi/BLE coexistence registers
  // cleanly. Enabling the BT controller after WiFi is already up aborts in
  // coex_core_enable. Also: leave WiFi modem-sleep at its default (ON) — coex
  // time-shares the radio, so WiFi.setSleep(false) would break BLE.
  relayLogLine("[ble] init begin");
  NimBLEDevice::init("");
  relayLogLine("[ble] init ready");
  NimBLEDevice::setPower(ESP_PWR_LVL_P9);
#if BARCODE_ENABLED
  // The DS2278 is a HID keyboard: it will not stream reports without an
  // encrypted, bonded link. Just Works is what content-barcode-relay bonded
  // with successfully on 2026-07-11.
  NimBLEDevice::setSecurityAuth(true, false, true);   // bond, no MITM, SC
  NimBLEDevice::setSecurityIOCap(BLE_HS_IO_NO_INPUT_OUTPUT);
#endif

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  relayLogf("[wifi] connecting to %s", WIFI_SSID);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) { delay(300); }
  relayLogf("[wifi] %s", WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString().c_str() : "FAILED (will retry)");

  // mDNS: <scale_id>.local. The IP is a DHCP lease with no reservation, and it
  // previously lived only as prose in a README -- a lease change silently broke
  // every tool pointed at it. Same pattern as the ir-blaster firmware.
  if (WiFi.status() == WL_CONNECTED) {
    if (MDNS.begin(SCALE_ID)) {
      MDNS.addService("http", "tcp", 80);
      relayLogf("[mdns] %s.local", SCALE_ID);
    } else {
      relayLogLine("[mdns] begin FAILED (IP still works)");
    }
  }

  webSocket.begin(WS_HOST, WS_PORT, WS_PATH);
  webSocket.onEvent(wsEvent);
  webSocket.setReconnectInterval(5000);
  // Tolerant heartbeat: ping 20 s, allow 8 s for the pong, 3 strikes before
  // tearing the link down (~60 s to notice a genuinely dead backend). The old
  // 3 s / 2-strike setting was too tight for this board — three radios share
  // one antenna and esp_coex_preference_set(ESP_COEX_PREFER_BT) deliberately
  // gives WiFi the smaller share, so a pong can legitimately arrive late while
  // Classic or BLE holds the radio. Losing the socket over that costs more than
  // noticing a dead backend 30 s later, especially now that scans are queued
  // across an outage rather than dropped.
  webSocket.enableHeartbeat(20000, 8000, 3);

  http.on("/", handleStatus);
  http.on("/status", handleStatus);
#if BARCODE_ENABLED
  // Barcode control plane. The DS2278 is a BLE HID keyboard and the ESP is the
  // central, so there is no pairing profile, no SDP record and no link-key
  // ceremony to expose -- all of that belonged to the Classic-SPP DS6878 and now
  // lives in ../../kitchen-scanner.
  http.on("/barcode/disconnect", [](){
    if (g_hidClient) g_hidClient->disconnect();
    http.send(200, "application/json", "{\"ok\":true,\"action\":\"disconnect\"}");
  });
  http.on("/barcode/unbond", [](){       // forget the BLE bond, force fresh pairing
    NimBLEDevice::deleteAllBonds();
    relayLogLine("[hid] bonds cleared");
    http.send(200, "application/json", "{\"ok\":true,\"action\":\"unbond\"}");
  });
#endif
  // Remote reboot. Its absence used to mean a walk to the kitchen with a USB
  // cable for anything that only resets at boot.
  http.on("/reboot", [](){
    http.send(200, "application/json", "{\"ok\":true,\"action\":\"reboot\"}");
    delay(150);                      // let the response flush before the reset
    ESP.restart();
  });
  http.on("/ble/scan", [](){                 // ?on=0|1
    if (http.hasArg("on")) {
      g_bleScanEnabled = http.arg("on") != "0";
      if (!g_bleScanEnabled && g_scanActive) { NimBLEDevice::getScan()->stop(); g_scanActive = false; }
      relayLogf("[ble] scale scan %s", g_bleScanEnabled ? "enabled" : "DISABLED");
    }
    http.send(200, "application/json",
      g_bleScanEnabled ? "{\"ok\":true,\"ble_scan\":true}" : "{\"ok\":true,\"ble_scan\":false}");
  });
  // ---- simulation endpoints ---------------------------------------------
  // Exercise the backend pipeline without the physical scale or scanner (and
  // without eating a real food-log entry by accident — these emit exactly the
  // same messages, so whatever consumes them cannot tell the difference).
  // Accepts query args or a JSON body:
  //   curl -X POST "http://<ip>/simulate/scale?grams=250&stable=1&unit=g"
  //   curl -X POST "http://<ip>/simulate/barcode?code=041260010682"
  //   curl -X POST http://<ip>/simulate/barcode -d '{"code":"041260010682"}'
  auto simArg = [](const char* key) -> String {
    if (http.hasArg(key)) return http.arg(key);
    if (http.hasArg("plain")) {                     // JSON body fallback
      JsonDocument body;
      if (!deserializeJson(body, http.arg("plain")) && body[key].is<JsonVariant>()) {
        return body[key].as<String>();
      }
    }
    return String();
  };

  http.on("/simulate/scale", HTTP_POST, [simArg](){
    String gramsArg = simArg("grams");
    if (!gramsArg.length()) {
      http.send(400, "application/json", "{\"ok\":false,\"error\":\"grams required\"}");
      return;
    }
    int grams = gramsArg.toInt();
    String stableArg = simArg("stable");
    bool stable = !stableArg.length() || (stableArg != "0" && stableArg != "false");
    String unitArg = simArg("unit");
    uint8_t unit = unitArg == "ml" ? 0x02 : 0x00;
    // Emit directly rather than faking the notify state: this deliberately
    // bypasses the g_bleConnected gate so it works with no scale present.
    sendReading(grams, stable, unit, markDurable(grams, stable));
    char out[96];
    snprintf(out, sizeof(out), "{\"ok\":true,\"simulated\":\"scale\",\"grams\":%d,\"stable\":%s}",
             grams, stable ? "true" : "false");
    http.send(200, "application/json", out);
  });

#if BARCODE_ENABLED
  http.on("/simulate/barcode", HTTP_POST, [simArg](){
    String code = simArg("code");
    if (!code.length()) {
      http.send(400, "application/json", "{\"ok\":false,\"error\":\"code required\"}");
      return;
    }
    // Push onto the same queue a real decode feeds, so the scan goes through
    // the identical loop() path: scan_count, last_scan, LED, and the offline
    // queue if the WebSocket happens to be down.
    char buf[128];
    strncpy(buf, code.c_str(), sizeof(buf) - 1); buf[sizeof(buf) - 1] = 0;
    if (xQueueSend(g_bcQueue, buf, 0) != pdTRUE) {
      http.send(503, "application/json", "{\"ok\":false,\"error\":\"scan queue full\"}");
      return;
    }
    char out[160];
    snprintf(out, sizeof(out), "{\"ok\":true,\"simulated\":\"barcode\",\"code\":\"%s\",\"route\":\"%s\"}",
             buf, BARCODE_ROUTE);
    http.send(200, "application/json", out);
  });
#endif

  http.onNotFound([](){ http.send(404, "text/plain", "food-scale-relay: GET /status\\n"); });
  http.begin();
  relayLogLine("[http] status server listening on :80");

  startScan();
}

void loop() {
  webSocket.loop();
  http.handleClient();
  serviceButton();

  // Wi-Fi self-heal
  static uint32_t lastWifiTry = 0;
  if (WiFi.status() != WL_CONNECTED && millis() - lastWifiTry > 10000) {
    lastWifiTry = millis();
    WiFi.disconnect(); WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  }

  // BLE connect / reconnect
  if (g_doConnect) {
    g_doConnect = false;
    if (!connectToScale()) { delay(500); startScan(); }
  }
#if BARCODE_ENABLED
  if (g_doHidConnect) {
    g_doHidConnect = false;
    // Either way, resume scanning: the same sweep looks for the scale, and the
    // scale is the one that comes and goes as it powers itself off.
    connectHidScanner();
    startScan();
  }

  // Drain HID reports -> assemble -> send. Identical to the pipeline the Classic
  // path used; only the decode changed, because a BLE HID keyboard delivers
  // keycodes rather than the decoded symbol as bytes.
  RawRep r;
  while (xQueueReceive(g_rawQueue, &r, 0) == pdTRUE) {
    char hex[72]; size_t shown = min((size_t)12, (size_t)r.len); size_t at = 0;
    for (size_t i = 0; i < shown && at + 4 < sizeof(hex); i++) at += snprintf(hex+at, sizeof(hex)-at, "%02x ", r.d[i]);
    relayLogf("[hid] h=%u len=%u %s", r.handle, r.len, hex);
    onHidReport(r.d, r.len);
  }
  // The DS2278 sends no terminator over BLE HID, so an idle gap ends the code.
  if (g_code.length() && millis() - g_lastKeyMs > 150) flushBarcode();
  char code[128];
  while (xQueueReceive(g_bcQueue, code, 0) == pdTRUE) {
    g_scanCount++;
    strncpy(g_lastBarcode, code, sizeof(g_lastBarcode)-1); g_lastBarcode[sizeof(g_lastBarcode)-1] = 0;
    g_lastBarcodeMs = millis();
    relayLogf("[barcode] %s", code);
    flashLed(CRGB::Blue);
    uint32_t capturedMs = millis();
    if (!sendScan(code, capturedMs)) {
      queueScan(code, capturedMs);
      relayLogf("[barcode] queued (ws down) — %u pending", (unsigned)g_pendingCount);
    }
  }
  if (g_pendingCount && wsConnected) flushPendingScans();
#endif  // BARCODE_ENABLED

  if (!g_bleConnected && !g_doConnect && !g_scanActive) startScan();
  serviceScanWatchdog();

  if (g_pevCount && wsConnected) flushPendingEvents();

  // Emit decoded readings: on meaningful change / stable-flag flip / heartbeat.
  // Gated on a live BLE link: g_haveReading latches, so without this the
  // heartbeat keeps re-publishing the last known weight after the scale has
  // gone away, which is both wrong (stale data presented as current) and pure
  // WiFi noise competing with the Classic barcode link.
  if (g_haveReading && g_bleConnected) {
    int grams = g_grams; bool stable = g_stable; uint8_t unit = g_unit;
    bool changed   = abs(grams - g_lastSentGrams) >= EMIT_MIN_DELTA_G;
    bool flip      = stable != g_lastSentStable;
    bool heartbeat = millis() - g_lastSentMs >= HEARTBEAT_MS;
    // markDurable runs on EVERY settled reading, not only when we transmit, so
    // the hysteresis baseline cannot go stale while the socket is healthy.
    bool durable   = markDurable(grams, stable);
    if (changed || flip || heartbeat || durable) sendReading(grams, stable, unit, durable);
  }

}

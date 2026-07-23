// kitchen-scanner — Zebra DS6878 over Classic Bluetooth SPP. ATOM Lite.
//
// FORKED from food-scale-relay on 2026-07-23, and deliberately so. It was a
// one-line #include shim while both boards ran one program; they no longer can.
// This firmware needs BLUEDROID, because Classic Bluetooth exists only there.
// food-scale-relay has moved to NimBLE so it can host the DS2278 BLE-HID scanner
// alongside the scale, and NimBLE supports no Classic BT whatsoever. One BLE
// stack per binary, so the two are now genuinely different programs.
//
// This exists to keep the DS6878 board working. If that scanner is retired,
// delete this whole extension rather than trying to re-merge it.
//
// Everything below is the shared source as it stood at the fork; the scale half
// is inert here (SCALE_ENABLED=0 from the SSOT — no `ble:` block on this device).
//
// ---- original header ----
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
#include <BLEDevice.h>
#include <FastLED.h>
#include <Preferences.h>
#include "config.h"
#include "esp_log.h"
#if BARCODE_ENABLED
extern "C" {
#include "esp_spp_api.h"
#include "esp_gap_bt_api.h"
#include "esp_bt_device.h"
#include "esp_coexist.h"
#include "esp_sdp_api.h"
}
#endif

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

// ---- Bluedroid stack trace capture --------------------------------------
// Everything between "ACL up" and the scanner hanging up ~1 s later happens
// inside Bluedroid -- SDP query, RFCOMM connect, security negotiation -- and
// none of it reaches the GAP callbacks. It goes to the stack's own ESP_LOG tags,
// i.e. the serial console, which is precisely what is NOT attached once the unit
// is in the kitchen. 22 consecutive failures were diagnosed blind for exactly
// this reason. Mirror those lines into a ring that /barcode/trace serves.
//
// Two properties make it usable:
//  - Capture is ARMED only between ACL up and ACL down. Bluedroid at DEBUG is a
//    firehose; outside that ~1 s window it is noise that would evict the window.
//  - The ring FREEZES on the first attempt that fails, so the scanner's own
//    ~3 s retry loop cannot overwrite the evidence before anyone reads it.
// While armed the hook does NOT forward to the original vprintf: UART at
// 115200 baud cannot absorb SDP-level debug without stalling the BT task, and a
// probe that changes the timing of the thing it measures is worth nothing.
// Sized against DRAM, which this build already runs at ~85%: 160 x 132 B is
// ~21 KB and leaves headroom. SDP at VERBOSE is chattier than at DEBUG, so if a
// window still overflows the ring, narrow it with /barcode/tracefilter rather
// than growing this -- there is no DRAM left to grow into.
#define TRACE_LOG_MAX 160
struct TraceLine { uint32_t ms; char text[132]; };
static TraceLine g_traceLogs[TRACE_LOG_MAX];
static uint16_t g_traceNext = 0;
static uint16_t g_traceCount = 0;
static volatile bool g_traceArmed = false;
static volatile bool g_traceFrozen = false;
static portMUX_TYPE g_traceMux = portMUX_INITIALIZER_UNLOCKED;
static vprintf_like_t g_prevVprintf = nullptr;
// Substring the line must contain to be kept; empty = keep everything. Runtime
// so a firehose can be narrowed to e.g. "BT_SDP" over HTTP, not over USB.
static char g_traceFilter[24] = "";

static int traceVprintf(const char* fmt, va_list ap) {
  if (!g_traceArmed || g_traceFrozen)
    return g_prevVprintf ? g_prevVprintf(fmt, ap) : 0;
  char line[sizeof(g_traceLogs[0].text)];
  va_list copy; va_copy(copy, ap);
  int n = vsnprintf(line, sizeof(line), fmt, copy);
  va_end(copy);
  if (n <= 0) return n;
  if (g_traceFilter[0] && !strstr(line, g_traceFilter)) return n;
  size_t len = strnlen(line, sizeof(line));
  while (len && (line[len-1] == '\n' || line[len-1] == '\r')) line[--len] = 0;
  if (!len) return n;
  portENTER_CRITICAL(&g_traceMux);
  g_traceLogs[g_traceNext].ms = millis();
  memcpy(g_traceLogs[g_traceNext].text, line, len + 1);
  g_traceNext = (uint16_t)((g_traceNext + 1) % TRACE_LOG_MAX);
  if (g_traceCount < TRACE_LOG_MAX) g_traceCount++;
  portEXIT_CRITICAL(&g_traceMux);
  return n;   // swallowed deliberately: see the note above about UART timing
}

// Bluedroid DEBUG output is off unless someone is actively capturing. See the
// hazard note in initClassicSpp() -- unarmed lines go to the UART and can block
// the BT task. Not persisted: a reboot always returns to the safe state.
static bool g_btDebugLog = false;
static void applyBtLogLevel() {
  esp_log_level_t lvl = g_btDebugLog ? ESP_LOG_DEBUG : ESP_LOG_WARN;
  for (const char* tag : { "BT_SDP", "BT_RFCOMM", "BT_L2CAP", "BT_BTM", "BT_APPL" })
    esp_log_level_set(tag, lvl);
}

static void traceClear() {
  portENTER_CRITICAL(&g_traceMux);
  g_traceNext = 0; g_traceCount = 0;
  portEXIT_CRITICAL(&g_traceMux);
  g_traceFrozen = false;
}

// ---- BLE state ----------------------------------------------------------
static BLEAdvertisedDevice* g_advDevice = nullptr;
static volatile bool g_doConnect = false;
static bool g_bleConnected = false;
static BLEClient* g_client = nullptr;
static bool g_scanActive = false;
// When the scale was last seen. Nonzero at boot because there is no scale yet;
// drives the scan backoff so an absent scale stops monopolising the antenna.
static uint32_t g_scaleAbsentSinceMs = 1;

#if BARCODE_ENABLED
// ---- Classic Bluetooth SPP acceptor -------------------------------------
// The DS6878 has no BLE mode at all — PRG p.4-5 lists its complete host-type
// set as Cradle Host, SPP Master, SPP Slave and Bluetooth Keyboard Emulation
// (HID Slave) — so this link is Classic BT, unlike the DS2278 content scanner
// which is BLE HID/HOGP.
//
// We run as an SPP *acceptor* and let the scanner initiate. The scanner is put
// in SPP Master mode and given this ESP's Classic BT MAC via a pairing bar code
// (PRG p.4-25: Code 128 containing <Fnc 3>B + the 12-char address; generate one
// with tools/gen-pairing-barcode.mjs). That inverts the previous HID topology,
// where we had to page the scanner — which sleeps between scans, so it answered
// inquiry but refused paging and every attempt died on ESP_BT_STATUS_TIMEOUT.
// Letting it come to us also means a power blip needs no paging race: whoever
// pulls the trigger next re-establishes the link.
//
// Security: the server is started with ESP_SPP_SEC_NONE, so we demand no
// authenticated link on the incoming channel. That sidesteps the wall the HID
// path hit — a keyboard-class HID device requires an MITM-authenticated link
// key, so SSP negotiated Passkey Entry and demanded a 6-digit code the operator
// had to key in by scanning digit bar codes inside a ~30 s LMP window. Four
// attempts all expired with auth status=9 (AUTH_FAILURE) / ACL reason 0x22
// (LMP response timeout), having received nothing.
//
// SSP is still compiled in: on ESP-IDF 5.3+ it is a runtime flag on
// esp_bluedroid_init_with_cfg() rather than a Kconfig symbol, and Arduino's
// BLEDevice::init() owns Bluedroid startup here (it calls esp_bt_controller_init
// unconditionally, so pre-initialising it ourselves would make that call fail).
// If the scanner turns out to demand authentication anyway, the fallback is to
// take over Bluedroid startup with .ssp_en = false so legacy pairing runs and
// the fixed PIN below matches the DS6878 factory default (12345, PRG p.4-30).
static esp_bd_addr_t g_barcodeAddr = {0};
static bool g_sppInitialized = false;
static bool g_barcodeConnected = false;
static uint32_t g_sppHandle = 0;
static uint32_t g_classicOpenCount = 0;
static uint32_t g_classicCloseCount = 0;
static char g_classicLastEvent[64] = "";
static uint32_t g_classicLastEventMs = 0;
// Durable GAP evidence. open/close above only count SUCCESSFUL SPP sessions, so
// a scanner that pages us and then fails to establish leaves them at zero --
// byte-identical to a scanner switched off in a drawer. These counters are the
// discriminator, and unlike the log ring they cannot be evicted:
//   acl_conn_count > 0 && open_count == 0  -> in range, reaching us, failing
//   acl_conn_count == 0                    -> not reaching us at all
static uint32_t g_aclConnCount = 0;
static uint32_t g_aclDisconnCount = 0;
static int32_t  g_lastAclReason = -1;
static uint32_t g_lastAclMs = 0;
static uint32_t g_authAttemptCount = 0;
static uint32_t g_authFailCount = 0;
static int32_t  g_lastAuthStatus = -1;
static uint32_t g_lastAuthMs = 0;

// ---- runtime-tunable Classic pairing profile ----------------------------
// This board lives in a kitchen. Every reflash costs a walk, a USB cable and a
// disassembly, so a wrong guess about pairing must be correctable over HTTP
// rather than over USB. Everything that governs how the SPP link authenticates
// is therefore a runtime knob persisted in NVS, not a compile-time constant.
//
// Defaults reproduce the configuration that DEMONSTRABLY WORKED on 2026-07-21
// (commit 5c753d6c7: "paired and opened cleanly", opens 2->9 across a soak):
// ESP_SPP_SEC_NONE with no IO capability declared at all, i.e. Just Works.
// IOCAP_UNSET means "never call esp_bt_gap_set_security_param" — declaring an
// IO capability, even NoInputNoOutput, is a behaviour change from that proven
// state, so it must be opt-in.
#define IOCAP_UNSET 0xFF
static uint16_t g_sppSecMask   = ESP_SPP_SEC_NONE;
static uint8_t  g_ioCap        = IOCAP_UNSET;
static bool     g_autoEscalate = true;
static uint8_t  g_profile      = 0;      // index into the escalation ladder
static uint32_t g_failStreak   = 0;      // ACL up -> down without an SPP open
static uint32_t g_aclUpNoOpenMs = 0;     // set on ACL up, cleared on SPP open
static Preferences g_prefs;

// The rest of what an SPP master can see and judge us on, all runtime-settable
// for the same reason. The scanner tears the ACL down before authentication is
// ever attempted (auth_attempt_count stayed 0 across 22 failures and all three
// rungs of the ladder), so whatever it dislikes is decided from SDP and the
// inquiry-level identity, not from security. These are the remaining inputs:
//   - Class of Device: what kind of thing we claim to be. Bluedroid's default is
//     uncategorized; a master looking for a serial peer may want a Computer CoD.
//   - Device name / SDP service name: some masters match on the string.
//   - RFCOMM channel: 0 lets the stack assign (lands on 1). A master that has a
//     channel hard-coded would need it pinned.
#define BT_NAME_MAX 32
static char     g_btName[BT_NAME_MAX]  = BARCODE_HOST_NAME;
static char     g_srvName[BT_NAME_MAX] = "DaylightScan";
static uint8_t  g_sppScn       = 0;      // 0 = let the stack choose
static uint32_t g_classicCod   = 0;      // 0 = leave Bluedroid's default alone
static bool     g_dipEnabled   = false;  // publish a Device Identification record
static uint16_t g_dipVendor    = 0x0501; // Zebra Technologies, BT-assigned
static uint16_t g_dipProduct   = 0x0001;

// Suppress the BLE scale scan while Classic is doing anything. A continuous BLE
// scan starving Classic on this shared antenna is not a theory: a20f1bac0 records
// the scanner's connection attempts not landing at all until the scan was
// switched off, and 5c753d6c7 records the established link dying at ~3 s with
// ACL reason 0x08 (supervision timeout) under BLE+WiFi traffic. Pairing is the
// most timing-sensitive moment there is, so the radio is handed to Classic for a
// window after every ACL event.
#define CLASSIC_RADIO_HOLD_MS 30000UL
static uint32_t g_classicHoldUntilMs = 0;
// SPP delivers raw decoded barcode bytes (not HID keyboard reports), copied out
// of the Bluedroid task via a queue and reassembled in loop().
struct RawRep { uint16_t handle; uint8_t len; uint8_t d[64]; };
static QueueHandle_t g_rawQueue;
static QueueHandle_t g_bcQueue;
static volatile uint32_t g_scanCount = 0;
static char g_lastBarcode[128] = "";
static uint32_t g_lastBarcodeMs = 0;
static String g_code;
static uint32_t g_lastKeyMs = 0;
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
static void onNotify(BLERemoteCharacteristic* chr, uint8_t* data, size_t len, bool isNotify) {
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
static void classicUnbond();   // defined below; the escalation ladder needs it

static void saveClassicPrefs() {
  g_prefs.begin("relay", false);
  g_prefs.putUShort("sec", g_sppSecMask);
  g_prefs.putUChar("iocap", g_ioCap);
  g_prefs.putBool("auto", g_autoEscalate);
  g_prefs.putUChar("profile", g_profile);
  g_prefs.putUChar("scn", g_sppScn);
  g_prefs.putUInt("cod", g_classicCod);
  g_prefs.putString("btname", g_btName);
  g_prefs.putString("srvname", g_srvName);
  g_prefs.putBool("dip", g_dipEnabled);
  g_prefs.putUShort("dipvid", g_dipVendor);
  g_prefs.putUShort("dippid", g_dipProduct);
  g_prefs.end();
}

static void loadClassicPrefs() {
  g_prefs.begin("relay", true);
  g_sppSecMask   = g_prefs.getUShort("sec", ESP_SPP_SEC_NONE);
  g_ioCap        = g_prefs.getUChar("iocap", IOCAP_UNSET);
  g_autoEscalate = g_prefs.getBool("auto", true);
  g_profile      = g_prefs.getUChar("profile", 0);
  g_sppScn       = g_prefs.getUChar("scn", 0);
  g_classicCod   = g_prefs.getUInt("cod", 0);
  g_dipEnabled   = g_prefs.getBool("dip", false);
  g_dipVendor    = g_prefs.getUShort("dipvid", 0x0501);
  g_dipProduct   = g_prefs.getUShort("dippid", 0x0001);
  String n = g_prefs.getString("btname", BARCODE_HOST_NAME);
  String s = g_prefs.getString("srvname", "DaylightScan");
  strncpy(g_btName,  n.c_str(), sizeof(g_btName)  - 1); g_btName[sizeof(g_btName)  - 1] = 0;
  strncpy(g_srvName, s.c_str(), sizeof(g_srvName) - 1); g_srvName[sizeof(g_srvName) - 1] = 0;
  g_prefs.end();
}

// Class of Device is advertised in the inquiry/extended-inquiry response and is
// the one piece of identity a master sees before it ever opens L2CAP. Applied
// only when explicitly set, so the default path stays byte-identical to the
// configuration that opened cleanly on 2026-07-21.
// Device Identification Profile record. A master that asks "what are you?" and
// gets an empty answer is one of the few remaining explanations for a 30-byte
// SDP reply followed by an immediate hang-up, and publishing a DI record is the
// only fix for it. Off by default -- it changes what we advertise, so it stays
// opt-in until the VERBOSE trace says the scanner actually asks for it.
static bool     g_sdpCommonUp = false;

static void sdpCommonCB(esp_sdp_cb_event_t event, esp_sdp_cb_param_t* p) {
  relayLogf("[classic-sdp] event %d", (int)event);
}

// Created once per boot on purpose. esp_sdp_create_record() returns its handle
// asynchronously and nothing here stores it, so a second call would ADD a second
// DI record rather than replace the first -- two contradictory records in the SDP
// database, contaminating the very experiment this knob exists for. Changing
// vid/pid therefore takes a reboot, which /reboot now makes a one-liner.
static bool g_dipCreated = false;

static void applyDipRecord() {
  if (!g_dipEnabled) return;
  if (g_dipCreated) { relayLogLine("[classic-sdp] DI record already published — reboot to change"); return; }
  if (!g_sdpCommonUp) {
    esp_sdp_register_callback(sdpCommonCB);
    if (esp_sdp_init() != ESP_OK) { relayLogLine("[classic-sdp] init failed"); return; }
    g_sdpCommonUp = true;
  }
  esp_bluetooth_sdp_dip_record_t dip = {};
  dip.hdr.type         = ESP_SDP_TYPE_DIP_SERVER;
  dip.vendor           = g_dipVendor;
  dip.vendor_id_source = ESP_SDP_VENDOR_ID_SRC_BT;
  dip.product          = g_dipProduct;
  dip.version          = 0x0100;
  dip.primary_record   = true;
  esp_err_t rc = esp_sdp_create_record((esp_bluetooth_sdp_record_t*)&dip);
  if (rc == ESP_OK) g_dipCreated = true;
  relayLogf("[classic-sdp] DI record vid=0x%04x pid=0x%04x rc=%d",
            (unsigned)g_dipVendor, (unsigned)g_dipProduct, (int)rc);
}

static void applyClassicCod() {
  // v=0 means "stack default", which we cannot restore at runtime: ESP_BT_SET_COD_ALL
  // ORs the service bits rather than replacing them, so a previously-set class
  // cannot be cleared. Setting 0 persists the intent; the reboot that follows
  // (/reboot) is what actually restores it.
  if (!g_classicCod) { relayLogLine("[classic-spp] cod=default (takes effect after reboot)"); return; }
  esp_bt_cod_t cod = {};
  cod.major   = (g_classicCod >> 8) & 0x1F;
  cod.minor   = (g_classicCod >> 2) & 0x3F;
  cod.service = (g_classicCod >> 13) & 0x7FF;
  esp_err_t rc = esp_bt_gap_set_cod(cod, ESP_BT_SET_COD_ALL);
  relayLogf("[classic-spp] cod=0x%06lx rc=%d", (unsigned long)g_classicCod, (int)rc);
}

// Declaring an IO capability is what decides the SSP association model. Left
// unset we inherit Bluedroid's default, which is the state that paired fine.
static void applyIoCap() {
  if (g_ioCap == IOCAP_UNSET) { relayLogLine("[classic-spp] iocap: unset (stack default)"); return; }
  esp_bt_io_cap_t cap = (esp_bt_io_cap_t)g_ioCap;
  esp_err_t rc = esp_bt_gap_set_security_param(ESP_BT_SP_IOCAP_MODE, &cap, sizeof(cap));
  relayLogf("[classic-spp] iocap=%d rc=%d", (int)g_ioCap, (int)rc);
}

// The security mask is fixed at esp_spp_start_srv() time, so changing it means
// bouncing the server. That is the whole reason /barcode/sec can exist.
static void restartSppServer(const char* why) {
  esp_spp_stop_srv();
  applyIoCap();
  applyClassicCod();
  esp_bt_gap_set_device_name(g_btName);
  esp_err_t rc = esp_spp_start_srv(g_sppSecMask, ESP_SPP_ROLE_SLAVE, g_sppScn, g_srvName);
  relayLogf("[classic-spp] server restart (%s) sec=0x%04x iocap=%d scn=%d name=\"%s\" rc=%d",
            why, (unsigned)g_sppSecMask, (int)g_ioCap, (int)g_sppScn, g_srvName, (int)rc);
}

// Escalation ladder, walked automatically when the scanner keeps reaching us and
// keeps hanging up. Each rung is a real hypothesis about why:
//   0 - Just Works, no IO cap declared      (proven working 2026-07-21)
//   1 - Just Works, IO cap explicitly None  (in case the stack default drifted)
//   2 - Authenticated + encrypted, DisplayOnly -> SSP Passkey Entry. Needs an
//       operator to key 6 digits within ~30 s, so it is the LAST rung, not the
//       first: main.cpp:108-115 records that ceremony expiring 4 times out of 4.
static void applyProfile(uint8_t profile, const char* why) {
  g_profile = profile;
  switch (profile) {
    case 0: g_sppSecMask = ESP_SPP_SEC_NONE; g_ioCap = IOCAP_UNSET; break;
    case 1: g_sppSecMask = ESP_SPP_SEC_NONE; g_ioCap = ESP_BT_IO_CAP_NONE; break;
    default:
      g_profile = 2;
      g_sppSecMask = ESP_SPP_SEC_AUTHENTICATE | ESP_SPP_SEC_ENCRYPT;
      g_ioCap = ESP_BT_IO_CAP_OUT;
      break;
  }
  saveClassicPrefs();
  restartSppServer(why);
}

// One failed cycle = the scanner paged us, the ACL came up, and it hung up
// without SPP ever opening. Three of those is not noise.
static void noteClassicFailure() {
  g_failStreak++;
  relayLogf("[classic-spp] fail streak %lu (profile %d)",
            (unsigned long)g_failStreak, (int)g_profile);
  if (!g_autoEscalate) return;
  // The rung that used to sit here -- classicUnbond() at a streak of 3 -- is GONE
  // and must not come back. It was written when a working pairing was assumed to
  // be cheap and the pairing CONFIG was the suspect. Neither turned out to be
  // true: the 2026-07-22 failure was scanner-side state that only a factory reset
  // cleared, and re-pairing costs a physical trip with three bar codes. Deleting
  // a good bond after three transient RF failures is pure damage, and the ESP
  // cannot re-create the bond on its own afterwards.
  //
  // The security-profile rungs are kept: they are reversible and cost nothing.
  if (g_failStreak == 6 && g_profile < 1) { applyProfile(1, "auto-escalate"); return; }
  if (g_failStreak == 9 && g_profile < 2) { applyProfile(2, "auto-escalate"); return; }
}

static void sppCB(esp_spp_cb_event_t event, esp_spp_cb_param_t* p) {
  switch (event) {
    case ESP_SPP_INIT_EVT:
      relayLogf("[classic-spp] init status=%d", (int)p->init.status);
      if (p->init.status != ESP_SPP_SUCCESS) break;
      // Be discoverable *and* connectable: the scanner needs to reach us on its
      // own schedule. The pairing bar code already tells it our address, so
      // discovery is only a convenience for bring-up.
      esp_bt_gap_set_device_name(g_btName);
      esp_bt_gap_set_scan_mode(ESP_BT_CONNECTABLE, ESP_BT_GENERAL_DISCOVERABLE);
      applyClassicCod();
      // Security comes from the persisted profile, not a literal. SEC_AUTHENTICATE
      // on its own was tried once and was strictly worse — the stack refused the
      // incoming connection before GAP even reported the ACL (scanner beeps
      // "connection rejected by remote device", PRG Table 2-1). That experiment
      // ran with NO IO capability declared, so it could only ever resolve to Just
      // Works; it says nothing about authenticated pairing done properly, which
      // is what profile 2 is for.
      applyIoCap();
      applyDipRecord();
      esp_spp_start_srv(g_sppSecMask, ESP_SPP_ROLE_SLAVE, g_sppScn, g_srvName);
      break;
    case ESP_SPP_START_EVT:
      relayLogf("[classic-spp] server listening scn=%d status=%d",
                (int)p->start.scn, (int)p->start.status);
      g_sppInitialized = p->start.status == ESP_SPP_SUCCESS;
      snprintf(g_classicLastEvent, sizeof(g_classicLastEvent), "listening scn=%d", (int)p->start.scn);
      g_classicLastEventMs = millis();
      break;
    case ESP_SPP_SRV_OPEN_EVT:
      g_barcodeConnected = p->srv_open.status == ESP_SPP_SUCCESS;
      g_sppHandle = p->srv_open.handle;
      memcpy(g_barcodeAddr, p->srv_open.rem_bda, sizeof(esp_bd_addr_t));
      relayLogf("[classic-spp] scanner connected status=%d handle=%lu",
                (int)p->srv_open.status, (unsigned long)p->srv_open.handle);
      if (g_barcodeConnected) {
        g_classicOpenCount++;
        // The link opened: whatever profile we are on is right. Stop climbing the
        // ladder and hold the radio for Classic while the session is live.
        g_failStreak = 0;
        g_aclUpNoOpenMs = 0;
        g_classicHoldUntilMs = millis() + CLASSIC_RADIO_HOLD_MS;
        // Disarm on success. Arming lasts from ACL up to ACL down, which on a
        // healthy link is the whole session -- hours of every component's
        // esp_log output swallowed by the hook instead of reaching serial. The
        // window worth capturing ends the moment SPP opens.
        g_traceArmed = false;
        snprintf(g_classicLastEvent, sizeof(g_classicLastEvent), "open handle=%lu",
                 (unsigned long)p->srv_open.handle);
      g_classicLastEventMs = millis();
        flashLed(CRGB::Green, 200);
      }
      break;
    case ESP_SPP_DATA_IND_EVT: {
      RawRep r;
      r.handle = (uint16_t)p->data_ind.handle;
      r.len = (uint8_t)min((size_t)sizeof(r.d), (size_t)p->data_ind.len);
      if (p->data_ind.data && r.len) { memcpy(r.d, p->data_ind.data, r.len); xQueueSend(g_rawQueue, &r, 0); }
      break;
    }
    case ESP_SPP_CLOSE_EVT:
      relayLogf("[classic-spp] closed status=%d port_status=%lu async=%d",
                (int)p->close.status, (unsigned long)p->close.port_status, (int)p->close.async);
      g_barcodeConnected = false;
      g_sppHandle = 0;
      g_classicCloseCount++;
      snprintf(g_classicLastEvent, sizeof(g_classicLastEvent), "closed status=%d", (int)p->close.status);
      g_classicLastEventMs = millis();
      break;
    default:
      relayLogf("[classic-spp] event %d", (int)event);
      break;
  }
}

static void classicGapCB(esp_bt_gap_cb_event_t event, esp_bt_gap_cb_param_t* p) {
  if (event == ESP_BT_GAP_AUTH_CMPL_EVT) {
    g_authAttemptCount++;
    g_lastAuthStatus = (int32_t)p->auth_cmpl.stat;
    g_lastAuthMs = millis();
    if (p->auth_cmpl.stat != ESP_BT_STATUS_SUCCESS) g_authFailCount++;
    relayLogf("[classic-spp] auth status=%d", (int)p->auth_cmpl.stat);
  } else if (event == ESP_BT_GAP_ACL_CONN_CMPL_STAT_EVT) {
    // The scanner reached us. This fires even when SPP never establishes, which
    // is precisely the "beeping and squawking" case.
    g_aclConnCount++;
    g_lastAclMs = millis();
    // Hand the radio to Classic: from here to SPP open is the window that a
    // continuous BLE scan is documented to wreck.
    g_classicHoldUntilMs = millis() + CLASSIC_RADIO_HOLD_MS;
    g_aclUpNoOpenMs = millis();
    // Arm the stack trace: from here until the ACL drops is the entire window
    // that has never been observed. Nothing else in this firmware can see it.
    if (!g_traceFrozen) g_traceArmed = true;
    const uint8_t* b = p->acl_conn_cmpl_stat.bda;
    relayLogf("[classic-spp] ACL up stat=%d peer=%02X:%02X:%02X:%02X:%02X:%02X",
              (int)p->acl_conn_cmpl_stat.stat, b[0], b[1], b[2], b[3], b[4], b[5]);
  } else if (event == ESP_BT_GAP_ACL_DISCONN_CMPL_STAT_EVT) {
    g_aclDisconnCount++;
    g_lastAclReason = (int32_t)p->acl_disconn_cmpl_stat.reason;
    g_lastAclMs = millis();
    // reason 275 = ESP_BT_STATUS_BASE_FOR_HCI_ERR(0x100) + 0x13, i.e. HCI
    // "remote user terminated" — the scanner hung up on us.
    const uint8_t* b = p->acl_disconn_cmpl_stat.bda;
    relayLogf("[classic-spp] ACL down reason=%d%s peer=%02X:%02X:%02X:%02X:%02X:%02X",
              (int)p->acl_disconn_cmpl_stat.reason,
              p->acl_disconn_cmpl_stat.reason == 275 ? " (remote hung up)" : "",
              b[0], b[1], b[2], b[3], b[4], b[5]);
    // Only count it as a failure if the ACL never became an SPP session. A drop
    // AFTER a good open is a different disease (supervision timeout / range) and
    // must not push us up the security ladder.
    if (g_aclUpNoOpenMs && !g_barcodeConnected) {
      g_aclUpNoOpenMs = 0;
      // Freeze the ring on the FIRST failure. The scanner retries every ~3 s, so
      // without this the window that matters is overwritten long before anyone
      // gets to /barcode/trace.
      if (g_traceArmed && g_traceCount) g_traceFrozen = true;
      noteClassicFailure();
    }
    g_traceArmed = false;
  } else if (event == ESP_BT_GAP_MODE_CHG_EVT) {
    // sniff/active transitions — debug-level noise, skip
  } else if (event == ESP_BT_GAP_KEY_NOTIF_EVT) {
    relayLogf("[classic-spp] SSP passkey shown %06lu", (unsigned long)p->key_notif.passkey);
  } else if (event == ESP_BT_GAP_CFM_REQ_EVT) {
    // Just Works / numeric comparison — accept without operator involvement.
    relayLogf("[classic-spp] SSP confirm %06lu -> accept", (unsigned long)p->cfm_req.num_val);
    esp_bt_gap_ssp_confirm_reply(p->cfm_req.bda, true);
  } else if (event == ESP_BT_GAP_PIN_REQ_EVT) {
    // Legacy-pairing path. Only reachable if the scanner declines SSP; kept
    // because the DS6878's factory default static PIN is 12345 (PRG p.4-30).
    if (p->pin_req.min_16_digit) {
      relayLogLine("[classic-spp] scanner requested 16-digit PIN");
      esp_bt_gap_pin_reply(p->pin_req.bda, false, 0, nullptr);
    } else {
      esp_bt_pin_code_t pin = {'1', '2', '3', '4', '5'};
      relayLogLine("[classic-spp] replying with DS6878 default PIN 12345");
      esp_bt_gap_pin_reply(p->pin_req.bda, true, 5, pin);
    }
  } else {
    // Catch-all: we have been diagnosing blind between ACL-up and the scanner
    // hanging up, so log every other GAP event rather than swallowing it.
    relayLogf("[classic-spp] GAP event %d", (int)event);
  }
}

static void logClassicBonds() {
  int count = esp_bt_gap_get_bond_device_num();
  relayLogf("[classic-spp] bonded devices: %d", count);
  if (count <= 0) return;
  esp_bd_addr_t list[4];
  int n = min(count, 4);
  if (esp_bt_gap_get_bond_device_list(&n, list) == ESP_OK) {
    for (int i = 0; i < n; i++)
      relayLogf("[classic-spp] bond[%d] %02x:%02x:%02x:%02x:%02x:%02x", i,
        list[i][0], list[i][1], list[i][2], list[i][3], list[i][4], list[i][5]);
  }
}

// Log this ESP's Classic BT MAC — it is what the scanner's pairing bar code
// must encode, and it differs from the WiFi/STA MAC by one in the last octet.
static void logClassicIdentity() {
  const uint8_t* mac = esp_bt_dev_get_address();
  if (!mac) { relayLogLine("[classic-spp] BT address unavailable"); return; }
  relayLogf("[classic-spp] our BT MAC %02X:%02X:%02X:%02X:%02X:%02X "
            "(pairing bar code: B%02X%02X%02X%02X%02X%02X)",
            mac[0],mac[1],mac[2],mac[3],mac[4],mac[5],
            mac[0],mac[1],mac[2],mac[3],mac[4],mac[5]);
}

static void initClassicSpp() {
  relayLogLine("[classic-spp] init begin");
  loadClassicPrefs();
  g_prevVprintf = esp_log_set_vprintf(traceVprintf);
  // esp_log_write() checks esp_log_is_tag_loggable() BEFORE it calls the vprintf
  // hook (components/log/src/log.c:41-43), so the hook only ever sees lines that
  // already passed the RUNTIME tag level. That level defaults to
  // CONFIG_LOG_DEFAULT_LEVEL, which is 3 (INFO) in this build -- which is why the
  // 2026-07-22 captures contained no DEBUG lines despite the Kconfig trace levels
  // being raised. Raising the compile-time ceiling alone is not sufficient.
  //
  // Raising those tags is therefore OPT-IN, via /barcode/tracelevel?on=1. It was
  // briefly unconditional (2026-07-22) and that was a genuine hazard, not just
  // noise: while the ring is not armed the hook forwards to the original vprintf,
  // i.e. straight to the UART at 115200 from the Bluedroid task. Serial.write
  // BLOCKS once the TX FIFO fills, so a board with no serial cable attached would
  // stall the Bluetooth stack under exactly the load we were trying to measure.
  // Default off; turn it on only while capturing.
  //
  // What it unlocks is L2CAP/BTM/RFCOMM DEBUG -- notably which PSM the incoming
  // channel is on. It does NOT unlock the SDP request UUID or the record we
  // return: sdp_server.c has exactly one SDP_TRACE_DEBUG and it is commented out
  // in the vendor source, so there is no server-side SDP payload logging to
  // enable. Do not expect it here.
  applyBtLogLevel();
  relayLogf("[classic-spp] profile=%d sec=0x%04x iocap=%d auto=%d",
            (int)g_profile, (unsigned)g_sppSecMask, (int)g_ioCap, (int)g_autoEscalate);
  // A fixed PIN matching the DS6878 factory default, kept as the legacy-pairing
  // fallback for the case where the scanner declines SSP entirely.
  //
  // NOTE: an earlier version of this comment claimed "CONFIG_BT_SSP_ENABLED off"
  // and concluded legacy pairing was the only path. That was wrong twice over:
  // the symbol does not exist in ESP-IDF 5.x at all (SSP is a runtime flag on
  // esp_bluedroid_init_with_cfg(), default true — see the note at the top of the
  // Classic section), and the sdkconfig it was read from is not the one this
  // environment builds. SSP is live; if it ever needs disabling, that is done by
  // taking over Bluedroid startup with .ssp_en = false, not by editing a Kconfig.
  esp_bt_pin_type_t pinType = ESP_BT_PIN_TYPE_FIXED;
  esp_bt_pin_code_t pin = {'1', '2', '3', '4', '5'};
  esp_bt_gap_set_pin(pinType, 5, pin);
  esp_err_t err = esp_bt_gap_register_callback(classicGapCB);
  if (err != ESP_OK) { relayLogf("[classic-spp] GAP callback failed: %d", (int)err); return; }
  err = esp_spp_register_callback(sppCB);
  if (err != ESP_OK) { relayLogf("[classic-spp] callback registration failed: %d", (int)err); return; }
  esp_spp_cfg_t cfg = {};
  cfg.mode = ESP_SPP_MODE_CB;
  cfg.enable_l2cap_ertm = false;
  cfg.tx_buffer_size = 0;                 // only used in VFS mode
  err = esp_spp_enhanced_init(&cfg);
  if (err != ESP_OK) { relayLogf("[classic-spp] SPP init failed: %d", (int)err); return; }
  // The server is started from ESP_SPP_INIT_EVT once the stack is up.
  relayLogf("[classic-spp] host \"%s\" waiting for scanner to connect", BARCODE_HOST_NAME);
  logClassicIdentity();
  logClassicBonds();
}

static void classicUnbond() {
  bool any = false;
  int count = esp_bt_gap_get_bond_device_num();
  if (count > 0) {
    esp_bd_addr_t list[4];
    int n = min(count, 4);
    if (esp_bt_gap_get_bond_device_list(&n, list) == ESP_OK) {
      for (int i = 0; i < n; i++) { esp_bt_gap_remove_bond_device(list[i]); any = true; }
    }
  }
  relayLogf("[classic-spp] unbond: removed %d bond(s)", any ? count : 0);
  g_barcodeConnected = false;
}
#endif

// ---- BLE scan callback --------------------------------------------------
class ScanCallbacks : public BLEAdvertisedDeviceCallbacks {
  void onResult(BLEAdvertisedDevice dev) override {
    bool nameMatch = dev.haveName() && dev.getName() == SCALE_MATCH_NAME;
    bool svcMatch  = dev.isAdvertisingService(BLEUUID(SCALE_SERVICE_UUID));
    if (!g_bleConnected && !g_doConnect && (nameMatch || svcMatch)) {
      relayLogf("[ble] found %s (%s)", dev.getName().c_str(), dev.getAddress().toString().c_str());
      BLEDevice::getScan()->stop();
      g_scanActive = false;
      g_advDevice = new BLEAdvertisedDevice(dev);
      g_doConnect = true;
      return;
    }
  }
};

class ClientCallbacks : public BLEClientCallbacks {
  void onConnect(BLEClient*) override {}
  void onDisconnect(BLEClient* c) override {
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
  g_client = BLEDevice::createClient();
  g_client->setClientCallbacks(&g_clientCb);
  if (!g_client->connect(g_advDevice)) { relayLogLine("[ble] scale connect failed"); return false; }
  BLERemoteService* svc = g_client->getService(SCALE_SERVICE_UUID);
  if (!svc) { relayLogLine("[ble] scale service missing"); g_client->disconnect(); return false; }
  BLERemoteCharacteristic* chr = svc->getCharacteristic(SCALE_NOTIFY_UUID);
  if (!chr || !chr->canNotify()) { relayLogLine("[ble] scale notify char missing"); g_client->disconnect(); return false; }
  chr->registerForNotify(onNotify);
  // Relax the BLE connection interval before declaring success. The default
  // fast interval (7.5-30 ms) keeps the BLE radio busy enough to starve the
  // Classic-BT barcode link on this shared antenna — the scanner then drops
  // with ACL reason 0x08 and beeps on every reconnect. A kitchen scale does not
  // need sub-100 ms latency: 100-160 ms still feels instant on the display and
  // frees a large slice of radio time for Classic.
  //   min/max in 1.25 ms units, timeout in 10 ms units.
  if (g_client->updateConnParams(80, 128, 0, 600)) {
    relayLogLine("[ble] scale conn interval relaxed to 100-160 ms");
  } else {
    relayLogLine("[ble] scale conn param update REJECTED (peer kept its own)");
  }
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

// True while Classic owns the radio — an ACL event happened recently enough that
// pairing may still be in flight.
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
static bool classicHoldsRadio() {
#if BARCODE_ENABLED
  if (g_classicHoldUntilMs && (int32_t)(g_classicHoldUntilMs - millis()) > 0) return true;
#endif
  return false;
}

static void startScan() {
  if (g_scanActive || !g_bleScanEnabled || classicHoldsRadio()) return;
  BLEScan* scan = BLEDevice::getScan();
  scan->setAdvertisedDeviceCallbacks(new ScanCallbacks());
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

  // Classic first, always. Yield the antenna rather than compete for it.
  if (classicHoldsRadio()) {
    if (g_scanActive) {
      BLEDevice::getScan()->stop();
      g_scanActive = false;
      g_scanIdleSinceMs = now;
      relayLogLine("[ble] scan paused — Classic has the radio");
    }
    return;
  }

  bool longAbsent = g_scaleAbsentSinceMs && (now - g_scaleAbsentSinceMs > SCALE_ABSENT_BACKOFF_MS);

  // A live SPP session forces the duty cycle even when the scale was just here.
  bool classicLive = false;
#if BARCODE_ENABLED
  classicLive = g_barcodeConnected;
#endif
  const uint32_t burstMs  = classicLive ? SCAN_BURST_CLASSIC_MS  : SCAN_BURST_MS;
  const uint32_t periodMs = classicLive ? SCAN_PERIOD_CLASSIC_MS : SCAN_BACKOFF_PERIOD_MS;

  if (!longAbsent && !classicLive) {
    // Scale recently present: keep the responsive continuous scan, with the
    // stall watchdog that a duration-0 Bluedroid scan needs.
    if (!g_scanActive) { startScan(); return; }
    if (now - g_scanStartedMs < SCAN_RESTART_MS) return;
    relayLogLine("[ble] scan watchdog — restarting a stalled scan");
    BLEDevice::getScan()->stop();
    g_scanActive = false;
    startScan();
    return;
  }

  // Backoff duty cycle. Logged once per transition, not once per restart, so the
  // 48-entry ring keeps holding Classic diagnostics instead of scan chatter.
  if (g_scanActive) {
    if (now - g_scanStartedMs >= burstMs) {
      BLEDevice::getScan()->stop();
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
  barcode["connected"] = g_barcodeConnected;
  barcode["transport"] = "classic-spp";
  barcode["id"] = BARCODE_ID; barcode["route"] = BARCODE_ROUTE;
  barcode["target_name"] = BARCODE_NAME; barcode["mac"] = BARCODE_MAC;
  barcode["host_name"] = BARCODE_HOST_NAME;
  barcode["mode"] = "spp-acceptor";           // the scanner initiates; we listen
  barcode["listening"] = g_sppInitialized;
  barcode["open_count"] = g_classicOpenCount;
  barcode["close_count"] = g_classicCloseCount;
  if (g_classicLastEvent[0]) barcode["last_event"] = g_classicLastEvent;
  if (g_classicLastEventMs) barcode["last_event_age_s"] = (uint32_t)((millis()-g_classicLastEventMs)/1000);
  // Attempt evidence — see the declarations above for why open_count alone
  // cannot tell "switched off" from "trying and failing".
  barcode["acl_conn_count"] = g_aclConnCount;
  barcode["acl_disconn_count"] = g_aclDisconnCount;
  if (g_lastAclReason >= 0) barcode["last_acl_reason"] = g_lastAclReason;
  if (g_lastAclMs) barcode["last_acl_age_s"] = (uint32_t)((millis()-g_lastAclMs)/1000);
  barcode["auth_attempt_count"] = g_authAttemptCount;
  barcode["auth_fail_count"] = g_authFailCount;
  if (g_lastAuthStatus >= 0) barcode["last_auth_status"] = g_lastAuthStatus;
  if (g_lastAuthMs) barcode["last_auth_age_s"] = (uint32_t)((millis()-g_lastAuthMs)/1000);
  barcode["bonds"] = esp_bt_gap_get_bond_device_num();
  // Pairing profile — what we are currently asking of the scanner, and how many
  // times in a row it has reached us and hung up without opening SPP.
  barcode["profile"] = g_profile;
  char secHex[10]; snprintf(secHex, sizeof(secHex), "0x%04x", (unsigned)g_sppSecMask);
  barcode["sec_mask"] = secHex;
  // Whether the failure window was actually captured — the first thing to check
  // before reading /barcode/trace.
  barcode["trace_frozen"] = g_traceFrozen;
  barcode["trace_lines"] = g_traceCount;
  barcode["bt_name"] = g_btName;
  barcode["srv_name"] = g_srvName;
  barcode["scn"] = g_sppScn;
  char codHex[12]; snprintf(codHex, sizeof(codHex), "0x%06lx", (unsigned long)g_classicCod);
  barcode["cod"] = codHex;
  barcode["iocap"] = g_ioCap;                 // 255 = stack default, never set
  barcode["auto_escalate"] = g_autoEscalate;
  barcode["fail_streak"] = g_failStreak;
  barcode["radio_held"] = classicHoldsRadio();
  // What the scanner's pairing bar code must encode (PRG p.4-25: <Fnc3>B+addr).
  const uint8_t* btMac = esp_bt_dev_get_address();
  if (btMac) {
    char hostMac[18], pairing[16];
    snprintf(hostMac, sizeof(hostMac), "%02x:%02x:%02x:%02x:%02x:%02x",
             btMac[0],btMac[1],btMac[2],btMac[3],btMac[4],btMac[5]);
    snprintf(pairing, sizeof(pairing), "B%02X%02X%02X%02X%02X%02X",
             btMac[0],btMac[1],btMac[2],btMac[3],btMac[4],btMac[5]);
    barcode["host_bt_mac"] = hostMac;
    barcode["pairing_payload"] = pairing;
  }
  char boundMac[18] = "";
  bool haveBoundMac = false;
  for (uint8_t b : g_barcodeAddr) if (b) { haveBoundMac = true; break; }
  if (haveBoundMac) {
    snprintf(boundMac, sizeof(boundMac), "%02x:%02x:%02x:%02x:%02x:%02x",
      g_barcodeAddr[0], g_barcodeAddr[1], g_barcodeAddr[2],
      g_barcodeAddr[3], g_barcodeAddr[4], g_barcodeAddr[5]);
  }
  barcode["bound_mac"] = boundMac;
  barcode["scan_count"] = g_scanCount;
  barcode["pending_scans"] = g_pendingCount;      // buffered, awaiting the WS
  barcode["dropped_scans"] = g_pendingDropped;    // lost to queue overflow
  if (g_lastBarcodeMs) { barcode["last_scan"] = g_lastBarcode; barcode["last_scan_age_s"] = (uint32_t)((millis()-g_lastBarcodeMs)/1000); }
#endif  // BARCODE_ENABLED

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
static void classicRepairGesture() {
#if BARCODE_ENABLED
  relayLogLine("[classic-spp] REPAIR gesture — unbond, reset profile, quiet radio");
  classicUnbond();
  g_failStreak = 0;
  applyProfile(0, "button repair");
  g_classicHoldUntilMs = millis() + 120000UL;   // 2 min with the antenna to itself
  if (g_scanActive) { BLEDevice::getScan()->stop(); g_scanActive = false; }
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
      classicRepairGesture();
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
  BLEDevice::init("");
  relayLogLine("[ble] init ready");
  BLEDevice::setPower(ESP_PWR_LVL_P9);
#if BARCODE_ENABLED
  // Give Bluetooth priority over WiFi on the shared radio. Without this the SPP
  // link opens and pairs cleanly, then dies ~3 s later with ACL reason 0x08
  // (connection timeout) — a supervision timeout, i.e. the Classic link is
  // being starved by WiFi (WebSocket heartbeat, HTTP server, status polling)
  // rather than rejected by the scanner. The barcode link is latency-tolerant
  // in one direction only: we can afford slower WiFi, we cannot afford a
  // dropped scan.
  esp_err_t coexRc = esp_coex_preference_set(ESP_COEX_PREFER_BT);
  relayLogf("[coex] prefer BT over WiFi: rc=%d", (int)coexRc);
  initClassicSpp();
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
  // Barcode control plane — bring-up/ops without a serial cable. There is no
  // /barcode/connect any more: in SPP-acceptor mode the scanner initiates, so
  // the only way to (re)establish a link is to pull its trigger.
  http.on("/barcode/disconnect", [](){
    if (g_sppHandle) esp_spp_disconnect(g_sppHandle);
    http.send(200, "application/json", "{\"ok\":true,\"action\":\"disconnect\"}");
  });
  http.on("/barcode/unbond", [](){           // forget link keys, force fresh pairing
    classicUnbond();
    http.send(200, "application/json", "{\"ok\":true,\"action\":\"unbond\"}");
  });
  // Pairing profile control. These exist so that being wrong about SSP costs an
  // HTTP call instead of a trip to the kitchen with a USB cable.
  //   /barcode/profile?n=0|1|2   0 = Just Works (proven), 1 = explicit NoIO,
  //                              2 = authenticated + encrypted (Passkey Entry)
  //   /barcode/sec?mask=0x0036   raw override of the SPP security mask
  //   /barcode/iocap?cap=0|1|2|3|255   255 = leave the stack default alone
  //   /barcode/auto?on=0|1       stop/start automatic escalation
  //   /barcode/repair            the button gesture, over HTTP
  http.on("/barcode/profile", [](){
    if (http.hasArg("n")) applyProfile((uint8_t)http.arg("n").toInt(), "http");
    char out[160];
    snprintf(out, sizeof(out), "{\"ok\":true,\"profile\":%d,\"sec\":\"0x%04x\",\"iocap\":%d}",
             (int)g_profile, (unsigned)g_sppSecMask, (int)g_ioCap);
    http.send(200, "application/json", out);
  });
  http.on("/barcode/sec", [](){
    if (http.hasArg("mask")) {
      g_sppSecMask = (uint16_t)strtoul(http.arg("mask").c_str(), nullptr, 0);
      saveClassicPrefs();
      restartSppServer("http sec");
    }
    char out[96];
    snprintf(out, sizeof(out), "{\"ok\":true,\"sec\":\"0x%04x\"}", (unsigned)g_sppSecMask);
    http.send(200, "application/json", out);
  });
  http.on("/barcode/iocap", [](){
    if (http.hasArg("cap")) {
      g_ioCap = (uint8_t)http.arg("cap").toInt();
      saveClassicPrefs();
      restartSppServer("http iocap");
    }
    char out[96];
    snprintf(out, sizeof(out), "{\"ok\":true,\"iocap\":%d}", (int)g_ioCap);
    http.send(200, "application/json", out);
  });
  http.on("/barcode/auto", [](){
    if (http.hasArg("on")) { g_autoEscalate = http.arg("on") != "0"; saveClassicPrefs(); }
    http.send(200, "application/json",
      g_autoEscalate ? "{\"ok\":true,\"auto\":true}" : "{\"ok\":true,\"auto\":false}");
  });
  // The Bluedroid trace of the last failed attempt: SDP, RFCOMM, L2CAP and BTM
  // for the ~1 s between ACL up and the scanner hanging up. ?clear=1 releases
  // the freeze so the next attempt is captured.
  http.on("/barcode/trace", [](){
    // `?clear` must be an explicit truthy value: `?clear=0` used to clear too,
    // because only hasArg() was checked.
    if (http.hasArg("clear") && http.arg("clear") != "0") {
      traceClear();
      http.send(200, "application/json", "{\"ok\":true,\"cleared\":true}");
      return;
    }
    // STREAMED, not built into one String. A full 160-line ring is ~24 KB and
    // this board runs at ~85% DRAM: on 2026-07-22 the response truncated
    // mid-JSON in the field and cost us the one capture that mattered. Worse,
    // the ring serialises oldest-first, so truncation eats the NEWEST lines --
    // exactly the ones describing the failure. Chunked transfer keeps the buffer
    // to one line at a time.
    portENTER_CRITICAL(&g_traceMux);
    uint16_t count = g_traceCount, next = g_traceNext;
    bool frozen = g_traceFrozen;
    portEXIT_CRITICAL(&g_traceMux);

    http.setContentLength(CONTENT_LENGTH_UNKNOWN);
    http.sendHeader("Access-Control-Allow-Origin", "*");
    http.send(200, "application/json", "");
    String head = "{\"frozen\":";
    head += frozen ? "true" : "false";
    head += ",\"count\":"; head += count;
    head += ",\"lines\":[";
    http.sendContent(head);
    uint16_t start = (uint16_t)((next + TRACE_LOG_MAX - count) % TRACE_LOG_MAX);
    String line;
    for (uint16_t i = 0; i < count; i++) {
      TraceLine& t = g_traceLogs[(start + i) % TRACE_LOG_MAX];
      line = i ? "," : "";
      line += "{\"ms\":"; line += t.ms; line += ",\"t\":\"";
      for (const char* c = t.text; *c; c++) {          // minimal JSON escaping
        if (*c == '"' || *c == '\\') { line += '\\'; line += *c; }
        else if ((uint8_t)*c >= 0x20) line += *c;
      }
      line += "\"}";
      http.sendContent(line);
    }
    http.sendContent("]}");
    http.sendContent("");                              // terminate the chunked body
  });
  // Bluedroid DEBUG verbosity — off by default, see applyBtLogLevel().
  http.on("/barcode/tracelevel", [](){
    if (http.hasArg("on")) { g_btDebugLog = http.arg("on") != "0"; applyBtLogLevel(); }
    http.send(200, "application/json",
      g_btDebugLog ? "{\"ok\":true,\"bt_debug\":true}" : "{\"ok\":true,\"bt_debug\":false}");
  });
  // Identity knobs — what an SPP master can inspect before security is ever
  // negotiated, which is the only phase this scanner actually reaches.
  //   /barcode/cod?v=0x000104    Class of Device, Computer/Desktop (0 = stack default)
  //                              NB 0x0020C decodes to Phone/Smartphone, not Computer.
  //   /barcode/name?v=Foo        Bluetooth device name
  //   /barcode/srvname?v=Bar     SDP service name of the SPP record
  //   /barcode/scn?v=1           RFCOMM channel (0 = stack assigns)
  http.on("/barcode/cod", [](){
    if (http.hasArg("v")) {
      g_classicCod = (uint32_t)strtoul(http.arg("v").c_str(), nullptr, 0);
      saveClassicPrefs();
      applyClassicCod();
    }
    char out[80];
    snprintf(out, sizeof(out), "{\"ok\":true,\"cod\":\"0x%06lx\"}", (unsigned long)g_classicCod);
    http.send(200, "application/json", out);
  });
  http.on("/barcode/name", [](){
    if (http.hasArg("v")) {
      strncpy(g_btName, http.arg("v").c_str(), sizeof(g_btName) - 1);
      g_btName[sizeof(g_btName) - 1] = 0;
      saveClassicPrefs();
      esp_bt_gap_set_device_name(g_btName);
    }
    char out[96];
    snprintf(out, sizeof(out), "{\"ok\":true,\"name\":\"%s\"}", g_btName);
    http.send(200, "application/json", out);
  });
  http.on("/barcode/srvname", [](){
    if (http.hasArg("v")) {
      strncpy(g_srvName, http.arg("v").c_str(), sizeof(g_srvName) - 1);
      g_srvName[sizeof(g_srvName) - 1] = 0;
      saveClassicPrefs();
      restartSppServer("http srvname");
    }
    char out[96];
    snprintf(out, sizeof(out), "{\"ok\":true,\"srvname\":\"%s\"}", g_srvName);
    http.send(200, "application/json", out);
  });
  // Narrow the trace when VERBOSE floods the ring, e.g. ?v=BT_SDP. Empty clears.
  http.on("/barcode/tracefilter", [](){
    if (http.hasArg("v")) {
      strncpy(g_traceFilter, http.arg("v").c_str(), sizeof(g_traceFilter) - 1);
      g_traceFilter[sizeof(g_traceFilter) - 1] = 0;
    }
    char out[80];
    snprintf(out, sizeof(out), "{\"ok\":true,\"filter\":\"%s\"}", g_traceFilter);
    http.send(200, "application/json", out);
  });
  // Publish a Device Identification record: /barcode/dip?on=1[&vid=0x0501&pid=0x1]
  http.on("/barcode/dip", [](){
    // vid/pid persist on their own too — they used to mutate RAM only unless `on`
    // was also passed, so a reboot silently reverted them.
    bool changed = false;
    if (http.hasArg("vid")) { g_dipVendor  = (uint16_t)strtoul(http.arg("vid").c_str(), nullptr, 0); changed = true; }
    if (http.hasArg("pid")) { g_dipProduct = (uint16_t)strtoul(http.arg("pid").c_str(), nullptr, 0); changed = true; }
    if (http.hasArg("on")) { g_dipEnabled = http.arg("on") != "0"; changed = true; }
    if (changed) {
      saveClassicPrefs();
      applyDipRecord();
    }
    char out[112];
    snprintf(out, sizeof(out), "{\"ok\":true,\"dip\":%s,\"vid\":\"0x%04x\",\"pid\":\"0x%04x\"}",
             g_dipEnabled ? "true" : "false", (unsigned)g_dipVendor, (unsigned)g_dipProduct);
    http.send(200, "application/json", out);
  });
  http.on("/barcode/scn", [](){
    if (http.hasArg("v")) {
      // Validate BEFORE persisting. An out-of-range SCN makes esp_spp_start_srv
      // fail asynchronously, so without this the HTTP reply says ok:true while
      // the scanner-facing server is down -- and the bad value survives reboot.
      long v = http.arg("v").toInt();
      if (v < 0 || v > 30) {
        http.send(400, "application/json", "{\"ok\":false,\"error\":\"scn must be 0 (auto) or 1-30\"}");
        return;
      }
      g_sppScn = (uint8_t)v;
      saveClassicPrefs();
      restartSppServer("http scn");
    }
    char out[64];
    snprintf(out, sizeof(out), "{\"ok\":true,\"scn\":%d}", (int)g_sppScn);
    http.send(200, "application/json", out);
  });
  // Remote reboot. Its absence is why a duplicated SDP record or a wedged stack
  // meant a walk to the kitchen with a USB cable; several knobs (DI record,
  // Class of Device) only fully reset at boot.
  http.on("/reboot", [](){
    http.send(200, "application/json", "{\"ok\":true,\"action\":\"reboot\"}");
    delay(150);                      // let the response flush before the reset
    ESP.restart();
  });
  http.on("/barcode/repair", [](){
    classicRepairGesture();
    http.send(200, "application/json", "{\"ok\":true,\"action\":\"repair\"}");
  });
  http.on("/ble/scan", [](){                 // ?on=0|1 — silence the radio to test coexistence
    if (http.hasArg("on")) {
      g_bleScanEnabled = http.arg("on") != "0";
      if (!g_bleScanEnabled && g_scanActive) { BLEDevice::getScan()->stop(); g_scanActive = false; }
      relayLogf("[ble] scale scan %s", g_bleScanEnabled ? "enabled" : "DISABLED");
    }
    http.send(200, "application/json",
      g_bleScanEnabled ? "{\"ok\":true,\"ble_scan\":true}" : "{\"ok\":true,\"ble_scan\":false}");
  });
#endif
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
  // Nothing to page over Classic any more: the scanner is the SPP initiator, so
  // there is no connect state machine, no retry backoff, and no need to pause
  // the BLE scan to keep a continuous scan from starving classic paging.
  if (!g_bleConnected && !g_doConnect && !g_scanActive) startScan();
  serviceScanWatchdog();

#if BARCODE_ENABLED
  RawRep r;
  while (xQueueReceive(g_rawQueue,&r,0)==pdTRUE) {
    char hex[72]; size_t shown = min((size_t)12, (size_t)r.len); size_t at = 0;
    for (size_t i=0; i<shown && at+4<sizeof(hex); i++) at += snprintf(hex+at, sizeof(hex)-at, "%02x ", r.d[i]);
    relayLogf("[spp] h=%u len=%u %s", r.handle, r.len, hex);
    onSppBytes(r.d,r.len);
  }
  if (g_code.length() && millis()-g_lastKeyMs>150) flushBarcode();
  char code[128];
  while (xQueueReceive(g_bcQueue,code,0)==pdTRUE) {
    g_scanCount++;
    strncpy(g_lastBarcode, code, sizeof(g_lastBarcode)-1); g_lastBarcode[sizeof(g_lastBarcode)-1]=0;
    g_lastBarcodeMs = millis();
    relayLogf("[barcode] %s",code);
    flashLed(CRGB::Blue);
    uint32_t capturedMs = millis();
    if (!sendScan(code, capturedMs)) {
      queueScan(code, capturedMs);
      relayLogf("[barcode] queued (ws down) — %u pending", (unsigned)g_pendingCount);
    }
  }
  // Drain anything buffered during an outage, oldest first.
  if (g_pendingCount && wsConnected) flushPendingScans();
#endif
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

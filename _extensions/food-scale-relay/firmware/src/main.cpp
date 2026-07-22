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
#include "config.h"
#if BARCODE_ENABLED
extern "C" {
#include "esp_spp_api.h"
#include "esp_gap_bt_api.h"
#include "esp_bt_device.h"
#include "esp_coexist.h"
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

// ---- BLE state ----------------------------------------------------------
static BLEAdvertisedDevice* g_advDevice = nullptr;
static volatile bool g_doConnect = false;
static bool g_bleConnected = false;
static BLEClient* g_client = nullptr;
static bool g_scanActive = false;

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

static const char* unitStr(uint8_t u) {
  switch (u) { case 0x00: return "g"; case 0x02: return "ml"; default: return "?"; }
}

// ---- send helpers -------------------------------------------------------
static void sendReading(int grams, bool stable, uint8_t unit) {
  flashLed(CRGB::Green);
  if (!wsConnected) return;
  JsonDocument doc;
  doc["source"] = "food-scale-relay";
  doc["type"]   = "scale";
  doc["id"]     = SCALE_ID;
  doc["grams"]  = grams;
  doc["stable"] = stable;
  doc["unit"]   = unitStr(unit);
  doc["ts"]     = (uint32_t)millis();
  String out; serializeJson(doc, out);
  webSocket.sendTXT(out);
  relayLogf("[scale] %d g %s unit=%s", grams, stable ? "stable" : "changing", unitStr(unit));
  g_lastSentGrams = grams; g_lastSentStable = stable; g_lastSentMs = millis();
}

static void sendButton(const char* press) {
  flashLed(CRGB::Purple);
  if (!wsConnected) return;
  JsonDocument doc;
  doc["source"] = "food-scale-relay";
  doc["type"]   = "button";
  doc["id"]     = SCALE_ID;
  doc["press"]  = press;
  doc["ts"]     = (uint32_t)millis();
  String out; serializeJson(doc, out);
  webSocket.sendTXT(out);
  strncpy(g_lastButton, press, sizeof(g_lastButton)-1); g_lastButton[sizeof(g_lastButton)-1]=0;
  g_lastButtonMs = millis();
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

static void sppCB(esp_spp_cb_event_t event, esp_spp_cb_param_t* p) {
  switch (event) {
    case ESP_SPP_INIT_EVT:
      relayLogf("[classic-spp] init status=%d", (int)p->init.status);
      if (p->init.status != ESP_SPP_SUCCESS) break;
      // Be discoverable *and* connectable: the scanner needs to reach us on its
      // own schedule. The pairing bar code already tells it our address, so
      // discovery is only a convenience for bring-up.
      esp_bt_gap_set_device_name(BARCODE_HOST_NAME);
      esp_bt_gap_set_scan_mode(ESP_BT_CONNECTABLE, ESP_BT_GENERAL_DISCOVERABLE);
      // SEC_NONE. SEC_AUTHENTICATE was tried and is strictly worse: with it the
      // stack refuses the incoming connection before GAP even reports the ACL
      // (scanner beeps "connection rejected by remote device", PRG Table 2-1),
      // whereas SEC_NONE at least gets ACL up stat=0 before the scanner hangs
      // up with reason 0x13.
      esp_spp_start_srv(ESP_SPP_SEC_NONE, ESP_SPP_ROLE_SLAVE, 0, "DaylightScan");
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
    relayLogf("[classic-spp] ACL up stat=%d", (int)p->acl_conn_cmpl_stat.stat);
  } else if (event == ESP_BT_GAP_ACL_DISCONN_CMPL_STAT_EVT) {
    g_aclDisconnCount++;
    g_lastAclReason = (int32_t)p->acl_disconn_cmpl_stat.reason;
    g_lastAclMs = millis();
    relayLogf("[classic-spp] ACL down reason=%d", (int)p->acl_disconn_cmpl_stat.reason);
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
  // Legacy pairing only (CONFIG_BT_SSP_ENABLED off): a fixed PIN matching the
  // DS6878 factory default means an unattended bond with no operator step.
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
    if (c == g_client) { relayLogLine("[ble] scale disconnected"); g_bleConnected=false; g_client=nullptr; }
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
  return true;
}

// Kill switch for the BLE scale scan. A continuous BLE scan shares the single
// 2.4 GHz radio with the Classic HID link; when the scale is absent the scan
// gate below opens the instant the HID link connects and never closes. The
// DS6878 works fine against macOS (dedicated radio), so coexistence starvation
// is a live suspect for the ~16 ms HID teardown. Toggle: /ble/scan?on=0|1
static bool g_bleScanEnabled = true;

static uint32_t g_scanStartedMs = 0;

static void startScan() {
  if (g_scanActive || !g_bleScanEnabled) return;
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
static void serviceScanWatchdog() {
  if (!g_bleScanEnabled || g_bleConnected || g_doConnect) return;
  if (!g_scanActive || millis() - g_scanStartedMs < SCAN_RESTART_MS) return;
  relayLogLine("[ble] scan watchdog — restarting a stalled scan");
  BLEDevice::getScan()->stop();
  g_scanActive = false;
  startScan();
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
  if (g_scanActive) scale["scan_age_s"] = (uint32_t)((millis() - g_scanStartedMs) / 1000);

  JsonObject barcode = doc["barcode"].to<JsonObject>();
  barcode["enabled"] = BARCODE_ENABLED;
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
static bool     g_btnDown = false;
static uint32_t g_btnDownMs = 0;
static void serviceButton() {
  bool down = digitalRead(BTN_PIN) == LOW;
  uint32_t now = millis();
  if (down && !g_btnDown) { g_btnDown = true; g_btnDownMs = now; }
  else if (!down && g_btnDown) {
    g_btnDown = false;
    uint32_t held = now - g_btnDownMs;
    if (held < 40) return; // debounce
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
    sendReading(grams, stable, unit);
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
    if (changed || flip || heartbeat) sendReading(grams, stable, unit);
  }

}

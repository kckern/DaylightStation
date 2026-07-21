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
#include <WebServer.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <BLEDevice.h>
#include <FastLED.h>
#include "config.h"
#if BARCODE_ENABLED
extern "C" {
#include "esp_hidh_api.h"
#include "esp_gap_bt_api.h"
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
static WebServer http(80);

struct RecentLog { uint32_t ms; char text[128]; };
static RecentLog g_recentLogs[24];
static uint8_t g_recentLogNext = 0;
static uint8_t g_recentLogCount = 0;
static void relayLogLine(const char* text) {
  strncpy(g_recentLogs[g_recentLogNext].text, text, sizeof(g_recentLogs[0].text)-1);
  g_recentLogs[g_recentLogNext].text[sizeof(g_recentLogs[0].text)-1] = 0;
  g_recentLogs[g_recentLogNext].ms = millis();
  g_recentLogNext = (g_recentLogNext + 1) % 24;
  if (g_recentLogCount < 24) g_recentLogCount++;
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
static esp_bd_addr_t g_barcodeAddr = {0};
static volatile bool g_barcodeOpenPending = false;
static bool g_classicDiscoveryActive = false;
static bool g_hidHostInitialized = false;
static bool g_barcodeConnected = false;
static volatile bool g_classicConnecting = false;   // connect issued, awaiting final OPEN/CLOSE
static uint32_t g_classicConnectStartMs = 0;
static uint32_t g_classicLastCloseMs = 0;           // backoff anchor after CLOSE/fail
// In "Bluetooth Keyboard Emulation (HID Slave)" the DS6878 is the slave and
// waits for the host to connect (DS6878 PRG p.4-5), so we page it. Listening
// mode is kept behind /barcode/mode?passive=1 for other scanners that initiate.
static bool g_classicPassive = BARCODE_PASSIVE;
static uint32_t g_classicOpenCount = 0;             // successful HID opens (incl. short-lived)
static uint32_t g_classicCloseCount = 0;
static char g_classicLastEvent[64] = "";
// SSP passkey the operator must key into the scanner (via Variable PIN Code +
// alphanumeric bar codes). Surfaced on /status — serial isn't always attached.
static uint32_t g_classicPasskey = 0;
static uint32_t g_classicPasskeyMs = 0;
// IO capability drives which SSP association model is negotiated:
//   DisplayOnly (false) — stack picks the passkey, operator keys it into the
//     scanner. Proven to work, but you race the ~30 s LMP timeout every pair.
//   KeyboardOnly (true) — both ends input, so we can supply a FIXED passkey the
//     operator can pre-stage as digit bar codes. Repeatable.
// NoInputNoOutput is never correct here: it degrades SSP to Just Works, and the
// scanner drops an unauthenticated HID channel ~16 ms after it opens.
static bool g_classicIoKeyboard = false;
static uint32_t g_classicFixedPasskey = BARCODE_FIXED_PASSKEY;

static void applyClassicIoCap() {
  esp_bt_sp_param_t ioParam = ESP_BT_SP_IOCAP_MODE;
  esp_bt_io_cap_t ioCap = g_classicIoKeyboard ? ESP_BT_IO_CAP_IN : ESP_BT_IO_CAP_OUT;
  esp_bt_gap_set_security_param(ioParam, &ioCap, sizeof(ioCap));
  relayLogf("[classic-hid] io-cap = %s", g_classicIoKeyboard ? "KeyboardOnly" : "DisplayOnly");
}
struct RawRep { uint16_t handle; uint8_t len; uint8_t d[40]; };
static QueueHandle_t g_rawQueue;
static QueueHandle_t g_bcQueue;
static volatile uint32_t g_scanCount = 0;
static char g_lastBarcode[128] = "";
static uint32_t g_lastBarcodeMs = 0;
static String g_code;
static uint8_t g_prevKeys[6] = {0};
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
static char hidToChar(uint8_t k, bool shift) {
  if (k >= 0x04 && k <= 0x1d) { char c='a'+k-0x04; return shift ? c-32 : c; }
  if (k >= 0x1e && k <= 0x26) { const char* n="123456789"; const char* s="!@#$%^&*("; return shift ? s[k-0x1e] : n[k-0x1e]; }
  if (k == 0x27) return shift ? ')' : '0';
  switch (k) {
    case 0x28: case 0x58: return '\n'; case 0x2c: return ' ';
    case 0x2d: return shift ? '_' : '-'; case 0x2e: return shift ? '+' : '=';
    case 0x2f: return shift ? '{' : '['; case 0x30: return shift ? '}' : ']';
    case 0x31: return shift ? '|' : '\\'; case 0x33: return shift ? ':' : ';';
    case 0x34: return shift ? '"' : '\''; case 0x35: return shift ? '~' : '`';
    case 0x36: return shift ? '<' : ','; case 0x37: return shift ? '>' : '.';
    case 0x38: return shift ? '?' : '/'; default: return 0;
  }
}

static void flushBarcode() {
  if (!g_code.length()) return;
  char buf[128]; strncpy(buf, g_code.c_str(), sizeof(buf)-1); buf[sizeof(buf)-1]=0;
  xQueueSend(g_bcQueue, buf, 0); g_code="";
}

static void onHidReport(const uint8_t* data, size_t len) {
  if (len < 3) return;
  // Report-protocol input reports may prepend a report ID; boot keyboard
  // reports do not. Accept both layouts because Zebra firmware can expose
  // either depending on the negotiated HID protocol.
  if (len >= 9 && (data[0] == 1 || data[0] == 2 || data[0] == 3)) { data++; len--; }
  bool shift = (data[0] & 0x22) != 0;
  const uint8_t* keys=data+2; size_t nk=min((size_t)6,len-2);
  for (size_t i=0;i<nk;i++) {
    uint8_t k=keys[i]; if (!k || k==1) continue;
    bool was=false; for (uint8_t old:g_prevKeys) if (old==k) was=true;
    if (was) continue;
    char c=hidToChar(k,shift); if (c=='\n') flushBarcode();
    else if (c) { g_code+=c; g_lastKeyMs=millis(); }
  }
  for (size_t i=0;i<6;i++) g_prevKeys[i]=i<nk?keys[i]:0;
}

static void classicHidHostCB(esp_hidh_cb_event_t event, esp_hidh_cb_param_t* p) {
  switch (event) {
    case ESP_HIDH_INIT_EVT:
      relayLogf("[classic-hid] host init: %d", (int)p->init.status);
      break;
    case ESP_HIDH_OPEN_EVT:
      relayLogf("[classic-hid] OPEN status=%d conn=%d handle=%u",
                (int)p->open.status, (int)p->open.conn_status, p->open.handle);
      if (p->open.conn_status == ESP_HIDH_CONN_STATE_CONNECTING) break; // interim event
      g_barcodeConnected = p->open.status == ESP_HIDH_OK &&
                           p->open.conn_status == ESP_HIDH_CONN_STATE_CONNECTED;
      g_classicConnecting = false;
      if (g_barcodeConnected) {
        g_classicOpenCount++;
        memcpy(g_barcodeAddr, p->open.bd_addr, sizeof(esp_bd_addr_t)); // may be an inbound peer
        snprintf(g_classicLastEvent, sizeof(g_classicLastEvent), "open handle=%u", p->open.handle);
      } else {
        g_classicLastCloseMs = millis();
        snprintf(g_classicLastEvent, sizeof(g_classicLastEvent), "open failed status=%d", (int)p->open.status);
      }
      break;
    case ESP_HIDH_DATA_IND_EVT: {
      RawRep r; r.handle = p->data_ind.handle; r.len = min((size_t)40, (size_t)p->data_ind.len);
      if (p->data_ind.data && r.len) { memcpy(r.d, p->data_ind.data, r.len); xQueueSend(g_rawQueue, &r, 0); }
      break;
    }
    case ESP_HIDH_CLOSE_EVT:
      relayLogf("[classic-hid] CLOSED: %d reason=%u conn=%d",
                (int)p->close.status, p->close.reason, (int)p->close.conn_status);
      g_barcodeConnected = false;
      g_classicConnecting = false;
      g_classicLastCloseMs = millis();
      g_classicCloseCount++;
      snprintf(g_classicLastEvent, sizeof(g_classicLastEvent), "closed reason=%u", p->close.reason);
      break;
    case ESP_HIDH_VC_UNPLUG_EVT:
      relayLogf("[classic-hid] VC_UNPLUG status=%d", (int)p->unplug.status);
      g_barcodeConnected = false;
      g_classicConnecting = false;
      g_classicLastCloseMs = millis();
      break;
    case ESP_HIDH_ADD_DEV_EVT:
      relayLogf("[classic-hid] ADD_DEV status=%d handle=%u", (int)p->add_dev.status, p->add_dev.handle);
      break;
    case ESP_HIDH_GET_DSCP_EVT:
      relayLogf("[classic-hid] GET_DSCP found=%d dl_len=%d", (int)p->dscp.added, (int)p->dscp.dl_len);
      break;
    case ESP_HIDH_SET_PROTO_EVT:
      relayLogf("[classic-hid] SET_PROTO status=%d", (int)p->set_proto.status);
      break;
    default:
      relayLogf("[classic-hid] event %d", (int)event);
      break;
  }
}

static bool classicNameMatches(const char* name) {
  return name && *name && String(name).indexOf(BARCODE_NAME) >= 0;
}

static bool classicAddressMatches(const esp_bd_addr_t addr) {
  if (!BARCODE_MAC[0]) return false;
  char text[18]; snprintf(text, sizeof(text), "%02x:%02x:%02x:%02x:%02x:%02x",
    addr[0], addr[1], addr[2], addr[3], addr[4], addr[5]);
  return String(text).equalsIgnoreCase(BARCODE_MAC);
}

static void classicGapCB(esp_bt_gap_cb_event_t event, esp_bt_gap_cb_param_t* p) {
  if (event == ESP_BT_GAP_AUTH_CMPL_EVT) {
    relayLogf("[classic-hid] auth status=%d", (int)p->auth_cmpl.stat);
  } else if (event == ESP_BT_GAP_ACL_CONN_CMPL_STAT_EVT) {
    relayLogf("[classic-hid] ACL up stat=%d", (int)p->acl_conn_cmpl_stat.stat);
  } else if (event == ESP_BT_GAP_ACL_DISCONN_CMPL_STAT_EVT) {
    relayLogf("[classic-hid] ACL down reason=%d", (int)p->acl_disconn_cmpl_stat.reason);
  } else if (event == ESP_BT_GAP_MODE_CHG_EVT) {
    // sniff/active transitions — debug-level noise, skip
  } else if (event == ESP_BT_GAP_KEY_NOTIF_EVT) {
    g_classicPasskey = p->key_notif.passkey;
    g_classicPasskeyMs = millis();
    relayLogf("[classic-hid] ENTER PASSKEY ON SCANNER: %06lu", (unsigned long)p->key_notif.passkey);
    flashLed(CRGB::Yellow, 400);
  } else if (event == ESP_BT_GAP_CFM_REQ_EVT) {
    relayLogf("[classic-hid] SSP confirm %06lx", (unsigned long)p->cfm_req.num_val);
    esp_bt_gap_ssp_confirm_reply(p->cfm_req.bda, true);
  } else if (event == ESP_BT_GAP_KEY_REQ_EVT) {
    // KeyboardOnly path: the stack wants the passkey from us. Supply the fixed
    // one so the operator can pre-stage the matching digit bar codes.
    g_classicPasskey = g_classicFixedPasskey;
    g_classicPasskeyMs = millis();
    relayLogf("[classic-hid] SSP key requested -> replying %06lu (scan this on the scanner)",
              (unsigned long)g_classicFixedPasskey);
    esp_bt_gap_ssp_passkey_reply(p->key_req.bda, true, g_classicFixedPasskey);
    flashLed(CRGB::Yellow, 400);
  } else if (event == ESP_BT_GAP_PIN_REQ_EVT) {
    if (p->pin_req.min_16_digit) {
      relayLogLine("[classic-hid] scanner requested 16-digit PIN");
      esp_bt_gap_pin_reply(p->pin_req.bda, false, 0, nullptr);
    } else {
      esp_bt_pin_code_t pin = {'1', '2', '3', '4', '5'};
      relayLogLine("[classic-hid] replying with DS6878 default PIN");
      esp_bt_gap_pin_reply(p->pin_req.bda, true, 5, pin);
    }
  } else if (event == ESP_BT_GAP_DISC_RES_EVT) {
    const char* name = nullptr;
    for (int i=0; i<p->disc_res.num_prop; i++) {
      auto* prop = &p->disc_res.prop[i];
      if (prop->type == ESP_BT_GAP_DEV_PROP_BDNAME) name = (const char*)prop->val;
    }
    if (classicAddressMatches(p->disc_res.bda) || classicNameMatches(name)) {
      memcpy(g_barcodeAddr, p->disc_res.bda, sizeof(esp_bd_addr_t));
      relayLogf("[classic-hid] found %s", name ? name : BARCODE_NAME);
      esp_bt_gap_cancel_discovery();
      g_barcodeOpenPending = true;
    }
  } else if (event == ESP_BT_GAP_DISC_STATE_CHANGED_EVT &&
             p->disc_st_chg.state == ESP_BT_GAP_DISCOVERY_STOPPED) {
    g_classicDiscoveryActive = false;
  }
}

static void startClassicDiscovery() {
  if (!g_hidHostInitialized || g_classicDiscoveryActive || g_barcodeConnected ||
      g_barcodeOpenPending || g_classicConnecting) return;
  esp_err_t err = esp_bt_gap_start_discovery(ESP_BT_INQ_MODE_GENERAL_INQUIRY, 8, 0);
  if (err == ESP_OK) { g_classicDiscoveryActive = true; relayLogLine("[classic-hid] discovery started"); }
  else relayLogf("[classic-hid] discovery start failed: %d", (int)err);
}

static void logClassicBonds() {
  int count = esp_bt_gap_get_bond_device_num();
  relayLogf("[classic-hid] bonded devices: %d", count);
  if (count <= 0) return;
  esp_bd_addr_t list[4];
  int n = min(count, 4);
  if (esp_bt_gap_get_bond_device_list(&n, list) == ESP_OK) {
    for (int i = 0; i < n; i++)
      relayLogf("[classic-hid] bond[%d] %02x:%02x:%02x:%02x:%02x:%02x", i,
        list[i][0], list[i][1], list[i][2], list[i][3], list[i][4], list[i][5]);
  }
}

static void initClassicHidHost() {
  relayLogLine("[classic-hid] init begin");
  applyClassicIoCap();
  esp_bt_pin_type_t pinType = ESP_BT_PIN_TYPE_FIXED;
  esp_bt_pin_code_t pin = {'1', '2', '3', '4', '5'};
  esp_bt_gap_set_pin(pinType, 5, pin);
  esp_err_t err = esp_bt_hid_host_register_callback(classicHidHostCB);
  if (err != ESP_OK) { relayLogf("[classic-hid] callback registration failed: %d", (int)err); return; }
  err = esp_bt_hid_host_init();
  if (err != ESP_OK) { relayLogf("[classic-hid] HID init failed: %d", (int)err); return; }
  relayLogLine("[classic-hid] HID stack ready");
  err = esp_bt_gap_register_callback(classicGapCB);
  if (err != ESP_OK) { relayLogf("[classic-hid] GAP callback failed: %d", (int)err); return; }
  // Named + discoverable so the scanner can find and page us on its own.
  esp_bt_gap_set_device_name(BARCODE_HOST_NAME);
  esp_bt_gap_set_scan_mode(ESP_BT_CONNECTABLE, ESP_BT_GENERAL_DISCOVERABLE);
  g_hidHostInitialized = true;
  relayLogf("[classic-hid] host ready as \"%s\" (%s)", BARCODE_HOST_NAME,
            g_classicPassive ? "listening" : "paging");
  logClassicBonds();
}

// Register the scanner in the HID device DB without paging it, so an inbound
// connection from the scanner is accepted while we stay passive.
static void classicPrimeTarget() {
  if (!g_hidHostInitialized || !BARCODE_MAC[0]) return;
  unsigned v[6];
  if (sscanf(BARCODE_MAC, "%x:%x:%x:%x:%x:%x", &v[0],&v[1],&v[2],&v[3],&v[4],&v[5]) != 6) return;
  for (int i=0;i<6;i++) g_barcodeAddr[i] = (uint8_t)v[i];
  relayLogf("[classic-hid] target %s (%s)", BARCODE_MAC,
            g_classicPassive ? "waiting for scanner to connect" : "will page it");
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
  relayLogf("[classic-hid] unbond: removed %d bond(s)", any ? count : 0);
  g_barcodeConnected = false;
  g_classicConnecting = false;
  g_classicLastCloseMs = millis();
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

static void startScan() {
  if (g_scanActive || !g_bleScanEnabled) return;
  BLEScan* scan = BLEDevice::getScan();
  scan->setAdvertisedDeviceCallbacks(new ScanCallbacks());
  scan->setActiveScan(true);
  scan->setInterval(45);
  scan->setWindow(15);
  scan->start(0, nullptr, false); // continuous until a match stops it
  g_scanActive = true;
}

// ---- WebSocket events ---------------------------------------------------
static void wsEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      wsConnected = true;
      relayLogLine("[ws] connected");
      break;
    case WStype_DISCONNECTED:
      wsConnected = false;
      relayLogLine("[ws] disconnected");
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

  JsonObject scale = doc["scale"].to<JsonObject>();
  scale["connected"] = g_bleConnected;
  scale["target_name"] = SCALE_MATCH_NAME;
  scale["have_reading"] = g_haveReading;
  scale["grams"] = g_grams; scale["stable"] = g_stable; scale["unit"] = unitStr(g_unit);

  JsonObject barcode = doc["barcode"].to<JsonObject>();
  barcode["enabled"] = BARCODE_ENABLED;
  barcode["connected"] = g_barcodeConnected;
  barcode["transport"] = "classic-hid";
  barcode["id"] = BARCODE_ID; barcode["route"] = BARCODE_ROUTE;
  barcode["target_name"] = BARCODE_NAME; barcode["mac"] = BARCODE_MAC;
  barcode["host_name"] = BARCODE_HOST_NAME;
  barcode["mode"] = g_classicPassive ? "listening" : "paging";
  barcode["iocap"] = g_classicIoKeyboard ? "keyboard" : "display";
  barcode["connecting"] = g_classicConnecting;
  barcode["open_count"] = g_classicOpenCount;
  barcode["close_count"] = g_classicCloseCount;
  if (g_classicLastEvent[0]) barcode["last_event"] = g_classicLastEvent;
  barcode["bonds"] = esp_bt_gap_get_bond_device_num();
  if (g_classicPasskeyMs) {
    char pk[8]; snprintf(pk, sizeof(pk), "%06lu", (unsigned long)g_classicPasskey);
    barcode["passkey"] = pk;   // key this into the scanner to finish pairing
    barcode["passkey_age_s"] = (uint32_t)((millis() - g_classicPasskeyMs) / 1000);
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
  barcode["discovery_active"] = g_classicDiscoveryActive;
  barcode["scan_count"] = g_scanCount;
  if (g_lastBarcodeMs) { barcode["last_scan"] = g_lastBarcode; barcode["last_scan_age_s"] = (uint32_t)((millis()-g_lastBarcodeMs)/1000); }

  JsonObject button = doc["button"].to<JsonObject>();
  if (g_lastButtonMs) { button["last_press"] = g_lastButton; button["last_press_age_s"] = (uint32_t)((millis()-g_lastButtonMs)/1000); }

  JsonArray logs = doc["recent_logs"].to<JsonArray>();
  uint8_t start = (g_recentLogNext + 24 - g_recentLogCount) % 24;
  for (uint8_t i=0; i<g_recentLogCount; i++) {
    const RecentLog& entry = g_recentLogs[(start+i)%24];
    JsonObject item = logs.add<JsonObject>();
    item["age_s"] = (uint32_t)((millis()-entry.ms)/1000);
    item["message"] = entry.text;
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
  initClassicHidHost();
#endif

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  relayLogf("[wifi] connecting to %s", WIFI_SSID);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) { delay(300); }
  relayLogf("[wifi] %s", WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString().c_str() : "FAILED (will retry)");

  webSocket.begin(WS_HOST, WS_PORT, WS_PATH);
  webSocket.onEvent(wsEvent);
  webSocket.setReconnectInterval(5000);
  webSocket.enableHeartbeat(15000, 3000, 2);

  http.on("/", handleStatus);
  http.on("/status", handleStatus);
#if BARCODE_ENABLED
  // Barcode control plane — bring-up/ops without a serial cable.
  http.on("/barcode/connect", [](){          // one-shot host-initiated page
    g_barcodeOpenPending = true;
    http.send(200, "application/json", "{\"ok\":true,\"action\":\"connect\"}");
  });
  http.on("/barcode/disconnect", [](){
    esp_bt_hid_host_disconnect(g_barcodeAddr);
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
  http.on("/barcode/iocap", [](){            // ?mode=display|keyboard
    if (http.hasArg("mode")) {
      g_classicIoKeyboard = http.arg("mode") == "keyboard";
      applyClassicIoCap();
    }
    if (http.hasArg("passkey")) g_classicFixedPasskey = http.arg("passkey").toInt();
    char out[96];
    snprintf(out, sizeof(out), "{\"ok\":true,\"iocap\":\"%s\",\"fixed_passkey\":\"%06lu\"}",
             g_classicIoKeyboard ? "keyboard" : "display", (unsigned long)g_classicFixedPasskey);
    http.send(200, "application/json", out);
  });
  http.on("/barcode/mode", [](){             // ?passive=0|1
    if (http.hasArg("passive")) {
      g_classicPassive = http.arg("passive") != "0";
      relayLogf("[classic-hid] mode -> %s", g_classicPassive ? "listening" : "paging");
    }
    http.send(200, "application/json",
      g_classicPassive ? "{\"ok\":true,\"mode\":\"listening\"}" : "{\"ok\":true,\"mode\":\"paging\"}");
  });
#endif
  http.onNotFound([](){ http.send(404, "text/plain", "food-scale-relay: GET /status\\n"); });
  http.begin();
  relayLogLine("[http] status server listening on :80");

  startScan();
#if BARCODE_ENABLED
  classicPrimeTarget();
  if (!g_classicPassive) startClassicDiscovery();
#endif
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
  if (g_barcodeOpenPending) {
    g_barcodeOpenPending=false;
    // Pause the BLE scale scan while paging the scanner — the shared radio
    // starves classic paging under a continuous BLE scan (page timeout 0x4).
    if (g_scanActive) { BLEDevice::getScan()->stop(); g_scanActive = false; }
    relayLogLine("[classic-hid] opening scanner");
    if (esp_bt_hid_host_connect(g_barcodeAddr) == ESP_OK) {
      g_classicConnecting = true;
      g_classicConnectStartMs = millis();
    } else {
      relayLogLine("[classic-hid] open request failed");
      g_classicLastCloseMs = millis();
    }
  }
  // An SSP passkey is outstanding: hold off both the connect watchdog and the
  // retry loop. A retry fired mid-pairing collides with the in-flight connect
  // (OPEN status=15 BUSY) and eats the operator's ~30 s window to key it in.
  bool pairingPending = g_classicPasskeyMs && (millis() - g_classicPasskeyMs < 45000);

  // Watchdog: if the stack never delivers a final OPEN/CLOSE, unwedge ourselves.
  // Must exceed bluedroid's own page/SDP timeout (~24 s observed) or it preempts
  // the real result and we lose the status code.
  if (g_classicConnecting && !pairingPending && millis() - g_classicConnectStartMs > 35000) {
    relayLogLine("[classic-hid] connect timed out; resetting state");
    g_classicConnecting = false;
    g_classicLastCloseMs = millis();
  }
#endif
  if ((!g_bleConnected
#if BARCODE_ENABLED
       || !g_barcodeConnected
#endif
      ) && !g_doConnect
#if BARCODE_ENABLED
      && !g_barcodeOpenPending && !g_classicConnecting
#endif
      && !g_scanActive) {
    startScan();
  }

#if BARCODE_ENABLED
  // In passive mode we never page the scanner — we stay discoverable and let it
  // connect to us. Discovery/paging only runs when explicitly enabled.
  static uint32_t lastClassicTry = 0;
  if (!g_classicPassive && !pairingPending &&
      !g_barcodeConnected && !g_classicDiscoveryActive && !g_barcodeOpenPending &&
      !g_classicConnecting && millis() - lastClassicTry > 12000 &&
      (g_classicLastCloseMs == 0 || millis() - g_classicLastCloseMs > 20000)) {
    lastClassicTry = millis();
    startClassicDiscovery();
  }
#endif

#if BARCODE_ENABLED
  RawRep r;
  while (xQueueReceive(g_rawQueue,&r,0)==pdTRUE) {
    char hex[72]; size_t shown = min((size_t)12, (size_t)r.len); size_t at = 0;
    for (size_t i=0; i<shown && at+4<sizeof(hex); i++) at += snprintf(hex+at, sizeof(hex)-at, "%02x ", r.d[i]);
    relayLogf("[hid] h=%u len=%u %s", r.handle, r.len, hex);
    onHidReport(r.d,r.len);
  }
  if (g_code.length() && millis()-g_lastKeyMs>150) flushBarcode();
  char code[128];
  while (xQueueReceive(g_bcQueue,code,0)==pdTRUE) {
    g_scanCount++;
    strncpy(g_lastBarcode, code, sizeof(g_lastBarcode)-1); g_lastBarcode[sizeof(g_lastBarcode)-1]=0;
    g_lastBarcodeMs = millis();
    relayLogf("[barcode] %s",code);
    flashLed(CRGB::Blue);
    if (wsConnected) {
      JsonDocument d; d["source"]="barcode-relay"; d["type"]="scan";
      d["device"]=BARCODE_ID; d["route"]=BARCODE_ROUTE; d["code"]=code; d["ts"]=(uint32_t)millis();
      String out; serializeJson(d,out); webSocket.sendTXT(out);
    }
  }
#endif

  // Emit decoded readings: on meaningful change / stable-flag flip / heartbeat.
  if (g_haveReading) {
    int grams = g_grams; bool stable = g_stable; uint8_t unit = g_unit;
    bool changed   = abs(grams - g_lastSentGrams) >= EMIT_MIN_DELTA_G;
    bool flip      = stable != g_lastSentStable;
    bool heartbeat = millis() - g_lastSentMs >= HEARTBEAT_MS;
    if (changed || flip || heartbeat) sendReading(grams, stable, unit);
  }

}

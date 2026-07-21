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
      g_barcodeConnected = p->open.status == ESP_HIDH_OK &&
                           p->open.conn_status == ESP_HIDH_CONN_STATE_CONNECTED;
      relayLogf("[classic-hid] OPEN status=%d handle=%u", (int)p->open.status, p->open.handle);
      break;
    case ESP_HIDH_DATA_IND_EVT: {
      RawRep r; r.handle = p->data_ind.handle; r.len = min((size_t)40, (size_t)p->data_ind.len);
      if (p->data_ind.data && r.len) { memcpy(r.d, p->data_ind.data, r.len); xQueueSend(g_rawQueue, &r, 0); }
      break;
    }
    case ESP_HIDH_CLOSE_EVT:
      relayLogf("[classic-hid] CLOSED: %d", (int)p->close.status);
      g_barcodeConnected = false;
      break;
    default: break;
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
  } else if (event == ESP_BT_GAP_KEY_NOTIF_EVT) {
    relayLogf("[classic-hid] passkey=%lu", (unsigned long)p->key_notif.passkey);
  } else if (event == ESP_BT_GAP_CFM_REQ_EVT) {
    relayLogf("[classic-hid] SSP confirm %06lx", (unsigned long)p->cfm_req.num_val);
    esp_bt_gap_ssp_confirm_reply(p->cfm_req.bda, true);
  } else if (event == ESP_BT_GAP_KEY_REQ_EVT) {
    relayLogLine("[classic-hid] SSP key requested");
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
  if (!g_hidHostInitialized || g_classicDiscoveryActive || g_barcodeConnected || g_barcodeOpenPending) return;
  esp_err_t err = esp_bt_gap_start_discovery(ESP_BT_INQ_MODE_GENERAL_INQUIRY, 8, 0);
  if (err == ESP_OK) { g_classicDiscoveryActive = true; relayLogLine("[classic-hid] discovery started"); }
  else relayLogf("[classic-hid] discovery start failed: %d", (int)err);
}

static void initClassicHidHost() {
  relayLogLine("[classic-hid] init begin");
  esp_bt_sp_param_t ioParam = ESP_BT_SP_IOCAP_MODE;
  esp_bt_io_cap_t ioCap = ESP_BT_IO_CAP_NONE;
  esp_bt_gap_set_security_param(ioParam, &ioCap, sizeof(ioCap));
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
  esp_bt_gap_set_scan_mode(ESP_BT_CONNECTABLE, ESP_BT_NON_DISCOVERABLE);
  g_hidHostInitialized = true;
  relayLogLine("[classic-hid] host ready");
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

static void startScan() {
  if (g_scanActive) return;
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
  http.onNotFound([](){ http.send(404, "text/plain", "food-scale-relay: GET /status\\n"); });
  http.begin();
  relayLogLine("[http] status server listening on :80");

  startScan();
#if BARCODE_ENABLED
  startClassicDiscovery();
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
    relayLogLine("[classic-hid] opening scanner");
    if (esp_bt_hid_host_connect(g_barcodeAddr) != ESP_OK) {
      relayLogLine("[classic-hid] open request failed");
    }
  }
#endif
  if ((!g_bleConnected
#if BARCODE_ENABLED
       || !g_barcodeConnected
#endif
      ) && !g_doConnect
#if BARCODE_ENABLED
      && !g_barcodeOpenPending
#endif
      && !g_scanActive) {
    startScan();
  }

#if BARCODE_ENABLED
  static uint32_t lastClassicTry = 0;
  if (!g_barcodeConnected && !g_classicDiscoveryActive && !g_barcodeOpenPending &&
      millis() - lastClassicTry > 12000) {
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

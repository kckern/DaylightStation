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
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <NimBLEDevice.h>
#include <FastLED.h>
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

// ---- BLE state ----------------------------------------------------------
static NimBLEAdvertisedDevice* g_advDevice = nullptr;
static volatile bool g_doConnect = false;
static bool g_bleConnected = false;
static NimBLEClient* g_client = nullptr;

#if BARCODE_ENABLED
static NimBLEAdvertisedDevice* g_barcodeAdvDevice = nullptr;
static NimBLEClient* g_barcodeClient = nullptr;
static volatile bool g_doBarcodeConnect = false;
static bool g_barcodeConnected = false;
struct RawRep { uint16_t handle; uint8_t len; uint8_t d[40]; };
static QueueHandle_t g_rawQueue;
static QueueHandle_t g_bcQueue;
static volatile uint32_t g_scanCount = 0;
static String g_code;
static uint8_t g_prevKeys[6] = {0};
static uint32_t g_lastKeyMs = 0;
#endif

// ---- latest decoded reading (set in notify cb, read in loop) ------------
static volatile int   g_grams = 0;
static volatile bool  g_stable = false;
static volatile uint8_t g_unit = 0x00;
static volatile bool  g_haveReading = false;

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
  Serial.printf("[scale] %d g %-8s unit=%s\n", grams, stable ? "stable" : "changing", unitStr(unit));
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
  Serial.printf("[btn] %s\n", press);
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

static void barcodeNotifyCB(NimBLERemoteCharacteristic* ch,uint8_t* data,size_t len,bool) {
  RawRep r; r.handle=ch->getHandle(); r.len=min((size_t)40,len); memcpy(r.d,data,r.len);
  xQueueSend(g_rawQueue,&r,0);
}
#endif

// ---- BLE scan callback --------------------------------------------------
class ScanCallbacks : public NimBLEAdvertisedDeviceCallbacks {
  void onResult(NimBLEAdvertisedDevice* dev) override {
    bool nameMatch = dev->haveName() && dev->getName() == SCALE_MATCH_NAME;
    bool svcMatch  = dev->isAdvertisingService(NimBLEUUID(SCALE_SERVICE_UUID));
    if (!g_bleConnected && !g_doConnect && (nameMatch || svcMatch)) {
      Serial.printf("[ble] found %s (%s)\n", dev->getName().c_str(), dev->getAddress().toString().c_str());
      NimBLEDevice::getScan()->stop();
      g_advDevice = new NimBLEAdvertisedDevice(*dev);
      g_doConnect = true;
      return;
    }
#if BARCODE_ENABLED
    if (!g_barcodeConnected && !g_doBarcodeConnect) {
      bool match = dev->getAddress().toString() == BARCODE_MAC;
      if (!match && dev->haveName() && String(dev->getName().c_str()).indexOf(BARCODE_NAME) >= 0) match=true;
      if (!match && dev->haveServiceUUID() && dev->isAdvertisingService(NimBLEUUID((uint16_t)0x1812))) match=true;
      if (match) {
        Serial.printf("[ble] found barcode %s (%s)\n", dev->getName().c_str(), dev->getAddress().toString().c_str());
        NimBLEDevice::getScan()->stop();
        g_barcodeAdvDevice = new NimBLEAdvertisedDevice(*dev);
        g_doBarcodeConnect = true;
      }
    }
#endif
  }
};

class ClientCallbacks : public NimBLEClientCallbacks {
  void onDisconnect(NimBLEClient* c) override {
    if (c == g_client) { Serial.println("[ble] scale disconnected"); g_bleConnected=false; g_client=nullptr; }
#if BARCODE_ENABLED
    if (c == g_barcodeClient) { Serial.println("[ble] barcode disconnected"); g_barcodeConnected=false; g_barcodeClient=nullptr; }
#endif
  }
};
static ClientCallbacks g_clientCb;

static bool connectToScale() {
  if (g_client) { NimBLEDevice::deleteClient(g_client); g_client = nullptr; }
  g_client = NimBLEDevice::createClient();
  g_client->setClientCallbacks(&g_clientCb, false);
  if (!g_client->connect(g_advDevice)) { Serial.println("[ble] connect failed"); return false; }
  NimBLERemoteService* svc = g_client->getService(SCALE_SERVICE_UUID);
  if (!svc) { Serial.println("[ble] service missing"); g_client->disconnect(); return false; }
  NimBLERemoteCharacteristic* chr = svc->getCharacteristic(SCALE_NOTIFY_UUID);
  if (!chr || !chr->canNotify()) { Serial.println("[ble] notify char missing"); g_client->disconnect(); return false; }
  if (!chr->subscribe(true, onNotify)) { Serial.println("[ble] subscribe failed"); g_client->disconnect(); return false; }
  Serial.println("[ble] subscribed to scale");
  g_bleConnected = true;
  return true;
}

#if BARCODE_ENABLED
static bool connectToBarcode() {
  NimBLEClient* c = NimBLEDevice::createClient();
  c->setClientCallbacks(&g_clientCb, false);
  c->setConnectionParams(12,12,0,150); c->setConnectTimeout(10);
  if (!c->connect(g_barcodeAdvDevice)) { Serial.println("[ble] barcode connect failed"); NimBLEDevice::deleteClient(c); return false; }
  if (!c->secureConnection()) { Serial.println("[ble] barcode bond failed"); c->disconnect(); NimBLEDevice::deleteClient(c); return false; }
  NimBLERemoteService* hid=c->getService(NimBLEUUID((uint16_t)0x1812));
  if (!hid) { Serial.println("[ble] barcode HID service missing"); c->disconnect(); NimBLEDevice::deleteClient(c); return false; }
  NimBLERemoteCharacteristic* map=hid->getCharacteristic(NimBLEUUID((uint16_t)0x2A4B));
  if (map) { std::string v=map->readValue(); Serial.printf("[ble] barcode report map len=%u\n",(unsigned)v.size()); }
  NimBLERemoteCharacteristic* mode=hid->getCharacteristic(NimBLEUUID((uint16_t)0x2A4E));
  if (mode) { uint8_t one=1; mode->writeValue(&one,1,false); }
  int subs=0;
  for (auto ch : *hid->getCharacteristics(true)) {
    bool report=ch->getUUID()==NimBLEUUID((uint16_t)0x2A4D);
    bool boot=ch->getUUID()==NimBLEUUID((uint16_t)0x2A22);
    if ((report||boot) && ch->canNotify() && ch->subscribe(true,barcodeNotifyCB)) subs++;
  }
  if (!subs) { Serial.println("[ble] barcode report notifiable chars missing"); c->disconnect(); NimBLEDevice::deleteClient(c); return false; }
  g_barcodeClient=c; g_barcodeConnected=true;
  Serial.printf("[ble] barcode READY — %d report streams\n",subs);
  return true;
}
#endif

static void startScan() {
  NimBLEScan* scan = NimBLEDevice::getScan();
  scan->setAdvertisedDeviceCallbacks(new ScanCallbacks(), false);
  scan->setActiveScan(true);
  scan->setInterval(45);
  scan->setWindow(15);
  scan->start(0, nullptr, false); // continuous until a match stops it
}

// ---- WebSocket events ---------------------------------------------------
static void wsEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      wsConnected = true;
      Serial.println("[ws] connected");
      break;
    case WStype_DISCONNECTED:
      wsConnected = false;
      Serial.println("[ws] disconnected");
      break;
    default: break; // inbound bus messages (heartbeat etc.) ignored — we're a producer
  }
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
  Serial.println("\n[food-scale-relay] boot");

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
  NimBLEDevice::init("");
  NimBLEDevice::setPower(ESP_PWR_LVL_P9);
#if BARCODE_ENABLED
  NimBLEDevice::setSecurityAuth(true, false, true);
  NimBLEDevice::setSecurityIOCap(BLE_HS_IO_NO_INPUT_OUTPUT);
#endif

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("[wifi] connecting to %s", WIFI_SSID);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) { delay(300); Serial.print("."); }
  Serial.printf("\n[wifi] %s\n", WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString().c_str() : "FAILED (will retry)");

  webSocket.begin(WS_HOST, WS_PORT, WS_PATH);
  webSocket.onEvent(wsEvent);
  webSocket.setReconnectInterval(5000);
  webSocket.enableHeartbeat(15000, 3000, 2);

  startScan();
}

void loop() {
  webSocket.loop();
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
  if (g_doBarcodeConnect) {
    g_doBarcodeConnect=false;
    if (!connectToBarcode()) { delay(500); startScan(); }
  }
#endif
  if ((!g_bleConnected
#if BARCODE_ENABLED
       || !g_barcodeConnected
#endif
      ) && !g_doConnect
#if BARCODE_ENABLED
      && !g_doBarcodeConnect
#endif
      && !NimBLEDevice::getScan()->isScanning()) {
    startScan();
  }

#if BARCODE_ENABLED
  RawRep r;
  while (xQueueReceive(g_rawQueue,&r,0)==pdTRUE) onHidReport(r.d,r.len);
  if (g_code.length() && millis()-g_lastKeyMs>150) flushBarcode();
  char code[128];
  while (xQueueReceive(g_bcQueue,code,0)==pdTRUE) {
    g_scanCount++;
    Serial.printf("[barcode] %s\n",code);
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

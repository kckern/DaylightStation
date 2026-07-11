// food-scale-relay — M5Stack ATOM Lite (ESP32-PICO-D4)
//
// BLE-connects to a KitchenIQ 50797 (SENSSUN FOOD) kitchen scale, decodes its
// weight notifications, and streams them (+ button presses) over WebSocket to
// the DaylightStation event bus (/ws). The backend re-broadcasts the
// `food-scale` topic. See ../README.md.
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
static void setLed(const CRGB& c) { led[0] = c; FastLED.show(); }

// ---- WebSocket ----------------------------------------------------------
static WebSocketsClient webSocket;
static bool wsConnected = false;

// ---- BLE state ----------------------------------------------------------
static NimBLEAdvertisedDevice* g_advDevice = nullptr;
static volatile bool g_doConnect = false;
static bool g_bleConnected = false;
static NimBLEClient* g_client = nullptr;

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

// ---- BLE scan callback --------------------------------------------------
class ScanCallbacks : public NimBLEAdvertisedDeviceCallbacks {
  void onResult(NimBLEAdvertisedDevice* dev) override {
    bool nameMatch = dev->haveName() && dev->getName() == SCALE_MATCH_NAME;
    bool svcMatch  = dev->isAdvertisingService(NimBLEUUID(SCALE_SERVICE_UUID));
    if (nameMatch || svcMatch) {
      Serial.printf("[ble] found %s (%s)\n", dev->getName().c_str(), dev->getAddress().toString().c_str());
      NimBLEDevice::getScan()->stop();
      g_advDevice = new NimBLEAdvertisedDevice(*dev);
      g_doConnect = true;
    }
  }
};

class ClientCallbacks : public NimBLEClientCallbacks {
  void onDisconnect(NimBLEClient* c) override {
    Serial.println("[ble] disconnected");
    g_bleConnected = false;
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

// ---- status LED ---------------------------------------------------------
static void updateLed() {
  if (WiFi.status() != WL_CONNECTED)      setLed(CRGB(40, 0, 0));      // red: no wifi
  else if (!g_bleConnected)               setLed(CRGB(0, 0, 40));      // blue: no scale
  else if (!wsConnected)                  setLed(CRGB(40, 20, 0));     // amber: no bus
  else                                    setLed(CRGB(0, 40, 0));      // green: streaming
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n[food-scale-relay] boot");

  FastLED.addLeds<SK6812, LED_PIN, GRB>(led, 1);
  FastLED.setBrightness(60);
  setLed(CRGB(40, 0, 0));
  pinMode(BTN_PIN, INPUT);

  // Init the BLE controller BEFORE WiFi so WiFi/BLE coexistence registers
  // cleanly. Enabling the BT controller after WiFi is already up aborts in
  // coex_core_enable. Also: leave WiFi modem-sleep at its default (ON) — coex
  // time-shares the radio, so WiFi.setSleep(false) would break BLE.
  NimBLEDevice::init("");
  NimBLEDevice::setPower(ESP_PWR_LVL_P9);

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
  if (!g_bleConnected && !g_doConnect && !NimBLEDevice::getScan()->isScanning()) {
    startScan();
  }

  // Emit decoded readings: on meaningful change / stable-flag flip / heartbeat.
  if (g_haveReading) {
    int grams = g_grams; bool stable = g_stable; uint8_t unit = g_unit;
    bool changed   = abs(grams - g_lastSentGrams) >= EMIT_MIN_DELTA_G;
    bool flip      = stable != g_lastSentStable;
    bool heartbeat = millis() - g_lastSentMs >= HEARTBEAT_MS;
    if (changed || flip || heartbeat) sendReading(grams, stable, unit);
  }

  static uint32_t lastLed = 0;
  if (millis() - lastLed > 250) { lastLed = millis(); updateLed(); }
}

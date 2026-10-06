#include <Arduino.h>
#include <ArduinoJson.h>
#include <ArduinoOTA.h>
#include <ESPmDNS.h>
#include <WebServer.h>
#include <WiFi.h>
#include <Wire.h>
#include <esp_system.h>
#include "config.h"

// M5 ATOM Lite HY2.0: yellow = GPIO26 (SDA), white = GPIO32 (SCL).
// RFID2 U031-B (WS1850S) responds at 7-bit I2C address 0x28.
static constexpr int RFID_SDA = 26;
static constexpr int RFID_SCL = 32;
static constexpr uint8_t RFID_ADDR = 0x28;
static constexpr uint32_t PROBE_INTERVAL_MS = 2000;
static constexpr uint32_t WIFI_RETRY_MS = 5000;

static WebServer http(80);
static bool otaReady = false;
static bool otaActive = false;
static bool mdnsReady = false;
static bool httpReady = false;
static bool readerPresent = false;
static uint8_t readerI2cError = 255;
static uint32_t lastProbeMs = 0;
static uint32_t probeCount = 0;
static uint32_t lastWifiTryMs = 0;

static void probeReader() {
  Wire.beginTransmission(RFID_ADDR);
  const uint8_t error = Wire.endTransmission();
  const bool present = error == 0;
  if (probeCount == 0 || present != readerPresent || error != readerI2cError) {
    Serial.printf("[rfid2] i2c=0x%02x present=%d error=%u\n", RFID_ADDR, present, error);
  }
  readerPresent = present;
  readerI2cError = error;
  lastProbeMs = millis();
  ++probeCount;
}

static void sendStatus() {
  JsonDocument doc;
  doc["id"] = DEVICE_ID;
  doc["firmware"] = "rfid2-relay-shell";
  doc["build"] = __DATE__ " " __TIME__;
  doc["uptime_ms"] = millis();
  doc["reset_reason"] = static_cast<int>(esp_reset_reason());
  doc["chip"] = ESP.getChipModel();
  doc["flash_bytes"] = ESP.getFlashChipSize();
  doc["wifi"]["connected"] = WiFi.status() == WL_CONNECTED;
  doc["wifi"]["ip"] = WiFi.localIP().toString();
  doc["wifi"]["rssi_dbm"] = WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0;
  doc["wifi"]["mac"] = WiFi.macAddress();
  doc["ota"]["ready"] = otaReady && WiFi.status() == WL_CONNECTED;
  doc["ota"]["active"] = otaActive;
  doc["ota"]["udp_port"] = 3232;
  doc["rfid2"]["address"] = "0x28";
  doc["rfid2"]["present"] = readerPresent;
  doc["rfid2"]["i2c_error"] = readerI2cError;
  doc["rfid2"]["probe_count"] = probeCount;
  doc["rfid2"]["last_probe_ms"] = lastProbeMs;
  String body;
  serializeJson(doc, body);
  http.send(200, "application/json", body);
}

static void startNetworkServices() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (!httpReady) {
    http.begin();
    httpReady = true;
    Serial.printf("[http] ready http://%s/status\n", WiFi.localIP().toString().c_str());
  }
  if (!mdnsReady) {
    mdnsReady = MDNS.begin(DEVICE_ID);
    if (mdnsReady) MDNS.addService("http", "tcp", 80);
    Serial.printf("[mdns] %s.local %s\n", DEVICE_ID, mdnsReady ? "ready" : "failed");
  }
  if (!otaReady) {
    ArduinoOTA.setHostname(DEVICE_ID);
    ArduinoOTA.setPassword(OTA_PASSWORD);
    ArduinoOTA.setMdnsEnabled(false);
    ArduinoOTA.onStart([]() {
      otaActive = true;
      http.stop();
      Serial.println("[ota] receiving image");
    });
    ArduinoOTA.onEnd([]() { Serial.println("[ota] complete; restarting"); });
    ArduinoOTA.onError([](ota_error_t error) {
      Serial.printf("[ota] error=%u; restarting old image\n", static_cast<unsigned>(error));
      delay(100);
      ESP.restart();
    });
    ArduinoOTA.begin();
    otaReady = true;
    Serial.println("[ota] ready udp=3232 auth=enabled");
  }
}

void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.printf("[boot] %s build=%s %s\n", DEVICE_ID, __DATE__, __TIME__);
  Wire.begin(RFID_SDA, RFID_SCL, 100000);
  Wire.setTimeOut(50);
  probeReader();

  http.on("/status", HTTP_GET, sendStatus);
  http.onNotFound([]() { http.send(404, "text/plain", "GET /status\n"); });

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.setHostname(DEVICE_ID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWifiTryMs = millis();
  Serial.printf("[wifi] connecting ssid=%s\n", WIFI_SSID);
}

void loop() {
  const uint32_t now = millis();
  if (WiFi.status() == WL_CONNECTED) {
    startNetworkServices();
  } else if (now - lastWifiTryMs >= WIFI_RETRY_MS) {
    lastWifiTryMs = now;
    WiFi.reconnect();
  }

  if (otaReady) ArduinoOTA.handle();
  if (otaActive) return;
  http.handleClient();
  if (probeCount == 0 || now - lastProbeMs >= PROBE_INTERVAL_MS) probeReader();
  delay(2);
}

// ir-blaster — M5Stack ATOM Lite (ESP32-PICO-D4)
//
// A config-driven IR transmitter. Named IR codes (power, hdmi1, hdmi2, hdmi3, …)
// are decoded host-side from Tuya-format base64 into raw microsecond timing
// arrays (tools/gen-config.mjs) and blasted on the onboard IR LED (GPIO12) via
// IRremoteESP8266's sendRaw at a 38 kHz carrier.
//
// Trigger over HTTP (so Home Assistant `rest_command` and `curl` both work):
//   GET /            → JSON: id, ip, uptime, list of code names
//   GET /health      → JSON: same, for liveness checks
//   GET /send?code=NAME  → transmit the named code; JSON {ok, code}
//
// The high-level "turn the TV on and verify with the power sensor, retry, plug-
// cycle as fallback" orchestration stays in HA (office_tv_on/off scripts). This
// device only needs to reliably emit the raw codes on demand.

#include <Arduino.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include <IRsend.h>
#include <FastLED.h>
#include "config.h"

// ---- onboard RGB status LED (SK6812 on GPIO27) --------------------------
#define LED_PIN 27
static CRGB led[1];
// STATUS_LED == 0 forces the onboard RGB dark in every state (dark-room blasters).
static void setLed(const CRGB& c) { led[0] = STATUS_LED ? c : CRGB::Black; FastLED.show(); }

// ---- IR + HTTP ----------------------------------------------------------
static IRsend irsend(IR_PIN);         // onboard IR LED, non-inverted, modulation on
static WebServer server(80);
static volatile uint32_t g_sendCount = 0;
static char g_lastCode[24] = "";

static const IrCode* findCode(const String& name) {
  for (int i = 0; i < IR_CODE_COUNT; i++) {
    if (name.equals(IR_CODES[i].name)) return &IR_CODES[i];
  }
  return nullptr;
}

// sendRaw wants a non-const uint16_t*; our tables are const, so copy to a small
// stack buffer. Codes are ~75 durations max — 256 is comfortable headroom.
static bool blast(const IrCode* code) {
  if (!code || code->len == 0 || code->len > 256) return false;
  uint16_t buf[256];
  for (uint16_t i = 0; i < code->len; i++) buf[i] = code->data[i];
  setLed(CRGB::Blue);
  irsend.sendRaw(buf, code->len, IR_CARRIER_KHZ);
  strncpy(g_lastCode, code->name, sizeof(g_lastCode) - 1);
  g_sendCount++;
  Serial.printf("[ir] sent '%s' (%u durations)\n", code->name, code->len);
  return true;
}

static void writeStatusJson(JsonDocument& doc) {
  doc["id"] = BLASTER_ID;
  doc["ip"] = WiFi.localIP().toString();
  doc["uptime_ms"] = (uint32_t)millis();
  doc["sends"] = g_sendCount;
  doc["last_code"] = g_lastCode;
  JsonArray codes = doc["codes"].to<JsonArray>();
  for (int i = 0; i < IR_CODE_COUNT; i++) codes.add(IR_CODES[i].name);
}

static void handleStatus() {
  JsonDocument doc;
  writeStatusJson(doc);
  String out; serializeJson(doc, out);
  server.send(200, "application/json", out);
}

static void handleSend() {
  const String name = server.arg("code");
  JsonDocument doc;
  if (name.isEmpty()) {
    doc["ok"] = false; doc["error"] = "missing ?code=NAME";
    String out; serializeJson(doc, out);
    server.send(400, "application/json", out);
    return;
  }
  const IrCode* code = findCode(name);
  if (!code) {
    doc["ok"] = false; doc["error"] = "unknown code"; doc["code"] = name;
    JsonArray codes = doc["available"].to<JsonArray>();
    for (int i = 0; i < IR_CODE_COUNT; i++) codes.add(IR_CODES[i].name);
    String out; serializeJson(doc, out);
    server.send(404, "application/json", out);
    return;
  }
  const bool ok = blast(code);
  doc["ok"] = ok; doc["code"] = name; doc["id"] = BLASTER_ID;
  String out; serializeJson(doc, out);
  server.send(ok ? 200 : 500, "application/json", out);
}

// ---- status LED ---------------------------------------------------------
// green: wifi up, idle · red: no wifi · (blue flash handled in blast()).
static void updateLed() {
  if (WiFi.status() != WL_CONNECTED) setLed(CRGB(40, 0, 0));  // red
  else                              setLed(CRGB(0, 30, 0));   // green
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.printf("\n[ir-blaster] boot id=%s codes=%d\n", BLASTER_ID, IR_CODE_COUNT);

  FastLED.addLeds<SK6812, LED_PIN, GRB>(led, 1);
  FastLED.setBrightness(60);
  setLed(CRGB(40, 0, 0));

  irsend.begin();

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);              // no BLE coex here; keep the radio hot for HTTP latency
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("[wifi] connecting to %s", WIFI_SSID);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) { delay(300); Serial.print("."); }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[wifi] %s\n", WiFi.localIP().toString().c_str());
    // mDNS: reachable as ir-<id>.local (e.g. ir-office-tv.local) without a static lease.
    String host = String("ir-") + BLASTER_ID;
    if (MDNS.begin(host.c_str())) { MDNS.addService("http", "tcp", 80); Serial.printf("[mdns] http://%s.local\n", host.c_str()); }
  } else {
    Serial.println("\n[wifi] FAILED (will retry in loop)");
  }

  server.on("/", handleStatus);
  server.on("/health", handleStatus);
  server.on("/send", handleSend);
  server.onNotFound([]() { server.send(404, "application/json", "{\"ok\":false,\"error\":\"not found\"}"); });
  server.begin();
  Serial.println("[http] listening on :80  (GET /send?code=NAME)");

  updateLed();
}

void loop() {
  server.handleClient();

  // Wi-Fi self-heal
  static uint32_t lastWifiTry = 0;
  if (WiFi.status() != WL_CONNECTED && millis() - lastWifiTry > 10000) {
    lastWifiTry = millis();
    WiFi.disconnect(); WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  }

  // After a blue send-flash, settle the LED back to its idle state.
  static uint32_t lastLed = 0;
  if (millis() - lastLed > 150) { lastLed = millis(); updateLed(); }
}

// DaylightStation pressure-mat-relay — TrampleTek Blue on WEMOS LOLIN C3 Mini.
//
// The textile is a resistive analog pressure sensor, not a calibrated scale.
// Pressure lowers the GPIO0 voltage. We publish the honest measurements
// (voltage, voltage delta, gradient) plus derived occupied/step events.

#include <Arduino.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <WebServer.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <ArduinoOTA.h>
#include <esp_task_wdt.h>
#include <esp_system.h>
#include <esp32-hal-rgb-led.h>
#include "config.h"
#include "PressureMatDetector.h"

#ifndef FIRMWARE_BUILD_ID
#define FIRMWARE_BUILD_ID "unversioned"
#endif

#define RELAY_SOURCE "pressure-mat-relay"
#define WDT_TIMEOUT_S 20

// OTA defaults OFF so an older generated config.h cannot accidentally expose
// an unauthenticated firmware receiver. gen-config.mjs enables it only when the
// private mat config also supplies a password.
#ifndef OTA_ENABLED
#define OTA_ENABLED 0
#endif
#ifndef OTA_PASSWORD
#define OTA_PASSWORD ""
#endif

static WebSocketsClient ws;
static WebServer http(80);
static Preferences prefs;
static bool wsConnected = false;
static PressureMatDetector detector;
static const auto& reading = detector.state();
static float configuredPressDelta = PRESS_DELTA_V;
static float configuredPressGradient = PRESS_GRADIENT_VPS;
static float configuredStompDelta = STOMP_DELTA_V;
static float configuredStompGradient = STOMP_GRADIENT_VPS;
static uint32_t sampleAt = 0;
static uint32_t readingAt = 0;
static uint32_t helloAt = 0;
static uint32_t bootCount = 0;
static esp_reset_reason_t resetReason = ESP_RST_UNKNOWN;
static float samples[SMOOTHING_FRAMES] = {};
static uint8_t sampleIndex = 0;
static uint8_t sampleCount = 0;
static uint8_t lastWifiDisconnectReason = 0;
static uint16_t wifiDisconnectRepeats = 0;
#if OTA_ENABLED
static volatile bool otaActive = false;
#endif

static const char* resetReasonName(esp_reset_reason_t reason) {
  switch (reason) {
    case ESP_RST_POWERON: return "POWERON";
    case ESP_RST_SW: return "SW";
    case ESP_RST_PANIC: return "PANIC";
    case ESP_RST_INT_WDT: return "INT_WDT";
    case ESP_RST_TASK_WDT: return "TASK_WDT";
    case ESP_RST_WDT: return "WDT";
    case ESP_RST_BROWNOUT: return "BROWNOUT";
    default: return "OTHER";
  }
}

static void setLed(uint8_t red, uint8_t green, uint8_t blue) {
#if STATUS_LED_ENABLED
  neopixelWrite(STATUS_LED_PIN, red, green, blue);
#else
  (void)red;
  (void)green;
  (void)blue;
#endif
}

static void flashLed(uint8_t red, uint8_t green, uint8_t blue, uint16_t duration = 50) {
#if STATUS_LED_ENABLED
  setLed(red, green, blue);
  delay(duration);
  setLed(0, 0, 0);
#else
  (void)red;
  (void)green;
  (void)blue;
  (void)duration;
#endif
}

static bool sendDocument(JsonDocument& doc) {
  if (!wsConnected) return false;
  String output;
  serializeJson(doc, output);
  return ws.sendTXT(output);
}

static void addReading(JsonDocument& doc) {
  doc["protocol_version"] = 2;
  doc["firmware_build"] = FIRMWARE_BUILD_ID;
  doc["boot_count"] = bootCount;
  doc["id"] = MAT_ID;
  doc["voltage"] = serialized(String(reading.voltage, 3));
  doc["rest_voltage"] = serialized(String(reading.restVoltage, 3));
  doc["delta_v"] = serialized(String(reading.delta, 3));
  doc["gradient_vps"] = serialized(String(reading.gradient, 3));
  doc["occupied"] = reading.occupied;
  doc["occupancy_known"] = reading.occupancyKnown;
  doc["detection_state"] = detector.phase();
  doc["rearm_count"] = reading.rearms;
  doc["steps"] = reading.steps;
  doc["stomps"] = reading.stomps;
  doc["ts"] = millis();
}

static void sendReading() {
  JsonDocument doc;
  doc["source"] = RELAY_SOURCE;
  doc["type"] = "reading";
  addReading(doc);
  sendDocument(doc);
}

static void sendPresence(const char* event, bool includePressSummary = false) {
  JsonDocument doc;
  doc["source"] = RELAY_SOURCE;
  doc["type"] = "presence";
  doc["event"] = event;
  addReading(doc);
  if (includePressSummary) {
    doc["peak_delta_v"] = serialized(String(reading.peakDelta, 3));
    doc["peak_gradient_vps"] = serialized(String(reading.peakGradient, 3));
    doc["press_duration_ms"] = reading.pressDurationMs;
    doc["classified_stomp"] = reading.classifiedStomp;
  }
  sendDocument(doc);
  Serial.printf("[mat] %s voltage=%.3f delta=%.3f gradient=%.3f steps=%lu\n",
                event, reading.voltage, reading.delta, reading.gradient, (unsigned long)reading.steps);
}

static void sendHello() {
  JsonDocument doc;
  doc["source"] = RELAY_SOURCE;
  doc["type"] = "hello";
  addReading(doc);
  doc["uptime_s"] = millis() / 1000;
  doc["boot_count"] = bootCount;
  doc["last_reset"] = resetReasonName(resetReason);
  doc["rssi"] = WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0;
  doc["ip"] = WiFi.localIP().toString();
  doc["free_heap"] = ESP.getFreeHeap();
  sendDocument(doc);
}

static float readFrameVoltage() {
  uint32_t raw = 0;
  for (int i = 0; i < RAW_SAMPLES_PER_FRAME; ++i) {
    raw += analogRead(SENSOR_PIN);
  }
  // Keep ASC's published conversion rather than analogReadMilliVolts(). Their
  // sensitivity presets and the factory serial firmware are expressed on this
  // raw 12-bit/3.3 V scale (the attached unloaded mat reads ~2.73 V here).
  return (raw / (float)RAW_SAMPLES_PER_FRAME) * (3.3f / 4095.0f);
}

static float smooth(float frame) {
  samples[sampleIndex] = frame;
  sampleIndex = (sampleIndex + 1) % SMOOTHING_FRAMES;
  if (sampleCount < SMOOTHING_FRAMES) sampleCount++;
  float total = 0.0f;
  for (uint8_t i = 0; i < sampleCount; ++i) total += samples[i];
  return total / sampleCount;
}

static void configureDetector() {
  PressureMatDetector::Config config;
  config.pressDelta = configuredPressDelta;
  config.pressGradient = configuredPressGradient;
  config.stompDelta = configuredStompDelta;
  config.stompGradient = configuredStompGradient;
  config.releaseRatio = RELEASE_DELTA_RATIO;
  config.maxSampleGapMs = std::max<uint32_t>(500, SAMPLE_INTERVAL_MS * 3);
  detector.configure(config);
}

static void recalibrateDetector() {
  detector.recalibrate();
  sampleCount = sampleIndex = 0;
}

static void sampleSensor() {
  const float next = smooth(readFrameVoltage());
  if (sampleCount < SMOOTHING_FRAMES) return;
  const auto events = detector.sample(next, millis());
  if (events.pressed) { flashLed(0, 32, 0); sendPresence("pressed"); }
  if (events.stomped) { flashLed(32, 0, 24, 90); sendPresence("stomped"); }
  if (events.released) { flashLed(0, 0, 32); sendPresence("released", true); }
  if (events.rearmed) {
    // A settled state is not proof of a physical release. Publish diagnostics,
    // not a fabricated presence edge, and preserve both physical counters.
    sendReading();
    Serial.printf("[mat] rearmed count=%lu steps=%lu occupancy=unknown\n",
                  (unsigned long)reading.rearms, (unsigned long)reading.steps);
  }
}

static void statusResponse() {
  JsonDocument doc;
  doc["protocol_version"] = 2;
  doc["id"] = MAT_ID;
  doc["source"] = RELAY_SOURCE;
  doc["firmware_build"] = FIRMWARE_BUILD_ID;
  doc["detection_state"] = detector.phase();
  doc["occupancy_known"] = reading.occupancyKnown;
  doc["rearm_count"] = reading.rearms;
  doc["uptime_s"] = millis() / 1000;
  doc["boot_count"] = bootCount;
  doc["last_reset"] = resetReasonName(resetReason);
  doc["wifi"]["connected"] = WiFi.status() == WL_CONNECTED;
  doc["wifi"]["ip"] = WiFi.localIP().toString();
  doc["wifi"]["rssi"] = WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0;
  doc["ws"]["connected"] = wsConnected;
  doc["ota"]["enabled"] = OTA_ENABLED == 1;
  doc["ota"]["port"] = OTA_ENABLED == 1 ? 3232 : 0;
  doc["sensor"]["pin"] = SENSOR_PIN;
  doc["sensor"]["voltage"] = reading.voltage;
  doc["sensor"]["rest_voltage"] = reading.restVoltage;
  doc["sensor"]["delta_v"] = reading.delta;
  doc["sensor"]["gradient_vps"] = reading.gradient;
  doc["sensor"]["occupied"] = reading.occupied;
  doc["sensor"]["steps"] = reading.steps;
  doc["sensor"]["stomps"] = reading.stomps;
  doc["sensor"]["transitions"] = reading.transitions;
  doc["sensor"]["current_press_peak_delta_v"] = reading.peakDelta;
  doc["sensor"]["current_press_peak_gradient_vps"] = reading.peakGradient;
  doc["sensor"]["current_press_duration_ms"] = reading.occupied ? reading.pressDurationMs : 0;
  doc["detection"]["press_delta_v"] = configuredPressDelta;
  doc["detection"]["press_gradient_vps"] = configuredPressGradient;
  doc["detection"]["stomp_delta_v"] = configuredStompDelta;
  doc["detection"]["stomp_gradient_vps"] = configuredStompGradient;
  String output;
  serializeJson(doc, output);
  http.send(200, "application/json", output);
}

static void wsEvent(WStype_t type, uint8_t* payload, size_t length) {
  if (type == WStype_CONNECTED) {
    wsConnected = true;
    Serial.println("[ws] connected");
    String subscribe = String("{\"type\":\"bus_command\",\"action\":\"subscribe\",\"topic\":\"pressure-mat-control:")
                     + MAT_ID + "\"}";
    ws.sendTXT(subscribe);
    sendHello();
  } else if (type == WStype_DISCONNECTED) {
    wsConnected = false;
    Serial.println("[ws] disconnected");
  } else if (type == WStype_TEXT && payload && length) {
    JsonDocument command;
    if (deserializeJson(command, payload, length)) return;
    const char* action = command["action"] | "";
    if (strcmp(action, "recalibrate") == 0) {
      recalibrateDetector();
      Serial.println("[command] recalibrate");
    } else if (strcmp(action, "threshold") == 0) {
      const float delta = command["delta"] | configuredPressDelta;
      const float grad = command["gradient"] | configuredPressGradient;
      const float stompDelta = command["stompDelta"] | configuredStompDelta;
      const float stompGrad = command["stompGradient"] | configuredStompGradient;
      if (delta >= 0.01f && delta <= 2.0f) configuredPressDelta = delta;
      if (grad >= 0.01f && grad <= 5.0f) configuredPressGradient = grad;
      if (stompDelta >= 0.02f && stompDelta <= 2.5f) configuredStompDelta = stompDelta;
      if (stompGrad >= 0.02f && stompGrad <= 8.0f) configuredStompGradient = stompGrad;
      prefs.putFloat("press-delta", configuredPressDelta);
      prefs.putFloat("press-grad", configuredPressGradient);
      prefs.putFloat("stomp-delta", configuredStompDelta);
      prefs.putFloat("stomp-grad", configuredStompGradient);
      configureDetector();
      Serial.println("[command] threshold updated");
    } else if (strcmp(action, "reboot") == 0) {
      Serial.println("[command] reboot");
      delay(100);
      ESP.restart();
    }
  }
}

static void ensureWifi() {
  static uint32_t lastAttempt = 0;
  if (WiFi.status() == WL_CONNECTED || millis() - lastAttempt < 10000) return;
  lastAttempt = millis();
  Serial.printf("[wifi] retry ssid=%s\n", WIFI_SSID);
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

static void logTargetNetwork() {
  const int count = WiFi.scanNetworks(false, true);
  bool found = false;
  for (int i = 0; i < count; ++i) {
    if (WiFi.SSID(i) == WIFI_SSID) {
      found = true;
      Serial.printf("[wifi] target visible RSSI=%d channel=%d encryption=%d\n",
                    WiFi.RSSI(i), WiFi.channel(i), WiFi.encryptionType(i));
      break;
    }
  }
  if (!found) Serial.printf("[wifi] target NOT visible among %d network(s)\n", count);
  WiFi.scanDelete();
}

void setup() {
  Serial.begin(115200);
  delay(300);
  resetReason = esp_reset_reason();
  prefs.begin("pressure-mat", false);
  bootCount = prefs.getUInt("boots", 0) + 1;
  prefs.putUInt("boots", bootCount);
  configuredPressDelta = prefs.isKey("press-delta") ? prefs.getFloat("press-delta", PRESS_DELTA_V) : PRESS_DELTA_V;
  configuredPressGradient = prefs.isKey("press-grad") ? prefs.getFloat("press-grad", PRESS_GRADIENT_VPS) : PRESS_GRADIENT_VPS;
  configuredStompDelta = prefs.isKey("stomp-delta") ? prefs.getFloat("stomp-delta", STOMP_DELTA_V) : STOMP_DELTA_V;
  configuredStompGradient = prefs.isKey("stomp-grad") ? prefs.getFloat("stomp-grad", STOMP_GRADIENT_VPS) : STOMP_GRADIENT_VPS;

  configureDetector();
  analogReadResolution(12);
  analogSetPinAttenuation(SENSOR_PIN, ADC_11db);
#if STATUS_LED_ENABLED
  setLed(0, 0, 0);
#endif

  WiFi.mode(WIFI_STA);
  WiFi.setTxPower(WIFI_POWER_8_5dBm); // ASC-required C3 Mini stability setting.
  WiFi.onEvent([](WiFiEvent_t event, WiFiEventInfo_t info) {
    if (event == ARDUINO_EVENT_WIFI_STA_DISCONNECTED) {
      const uint8_t reason = info.wifi_sta_disconnected.reason;
      if (reason != lastWifiDisconnectReason) {
        lastWifiDisconnectReason = reason;
        wifiDisconnectRepeats = 1;
        Serial.printf("[wifi] disconnected reason=%u\n", reason);
      } else {
        wifiDisconnectRepeats++;
        if (wifiDisconnectRepeats % 25 == 0) {
          Serial.printf("[wifi] disconnected reason=%u repeats=%u\n", reason, wifiDisconnectRepeats);
        }
      }
    }
  });
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("[boot] %s boot=%lu reset=%s ADC=GPIO%d\n", MAT_ID,
                (unsigned long)bootCount, resetReasonName(resetReason), SENSOR_PIN);

  const uint32_t connectStarted = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - connectStarted < 20000) delay(100);
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[wifi] %s RSSI=%d\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
    if (MDNS.begin(MAT_ID)) MDNS.addService("http", "tcp", 80);
  } else {
    Serial.println("[wifi] initial connection failed; retrying in loop");
    logTargetNetwork();
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  }

  ws.begin(WS_HOST, WS_PORT, WS_PATH);
  ws.onEvent(wsEvent);
  ws.setReconnectInterval(5000);
  ws.enableHeartbeat(20000, 8000, 3);

  http.on("/", statusResponse);
  http.on("/status", statusResponse);
  http.on("/recalibrate", HTTP_POST, []() {
    recalibrateDetector();
    http.send(200, "application/json", "{\"ok\":true,\"action\":\"recalibrate\"}");
  });
  http.on("/threshold", HTTP_POST, []() {
    if (http.hasArg("delta")) {
      const float value = http.arg("delta").toFloat();
      if (value >= 0.01f && value <= 2.0f) configuredPressDelta = value;
    }
    if (http.hasArg("gradient")) {
      const float value = http.arg("gradient").toFloat();
      if (value >= 0.01f && value <= 5.0f) configuredPressGradient = value;
    }
    if (http.hasArg("stomp_delta")) {
      const float value = http.arg("stomp_delta").toFloat();
      if (value >= 0.02f && value <= 2.5f) configuredStompDelta = value;
    }
    if (http.hasArg("stomp_gradient")) {
      const float value = http.arg("stomp_gradient").toFloat();
      if (value >= 0.02f && value <= 8.0f) configuredStompGradient = value;
    }
    prefs.putFloat("press-delta", configuredPressDelta);
    prefs.putFloat("press-grad", configuredPressGradient);
    prefs.putFloat("stomp-delta", configuredStompDelta);
    prefs.putFloat("stomp-grad", configuredStompGradient);
    configureDetector();
    statusResponse();
  });
  http.on("/reboot", []() {
    http.send(200, "application/json", "{\"ok\":true,\"action\":\"reboot\"}");
    delay(150);
    ESP.restart();
  });
  http.begin();

  esp_task_wdt_init(WDT_TIMEOUT_S, true);
  esp_task_wdt_add(NULL);

#if OTA_ENABLED
  ArduinoOTA.setHostname(MAT_ID);
  ArduinoOTA.setPassword(OTA_PASSWORD);
  ArduinoOTA.onStart([]() {
    // Writing flash must own the loop. Network maintenance during the transfer
    // can stall espota long enough to abort it, so resume everything by reboot.
    otaActive = true;
    ws.disconnect();
    http.stop();
    Serial.println("[ota] update starting; websocket + http quiesced");
  });
  // ArduinoOTA receives the whole image inside one handle() call. Feed per
  // chunk so a healthy slow transfer survives while a stalled one still trips.
  ArduinoOTA.onProgress([](unsigned int, unsigned int) { esp_task_wdt_reset(); });
  ArduinoOTA.onEnd([]() { Serial.println("[ota] update complete; rebooting"); });
  ArduinoOTA.onError([](ota_error_t error) {
    Serial.printf("[ota] failed error=%u; rebooting into previous image\n", (unsigned)error);
    delay(200);
    ESP.restart();
  });
  ArduinoOTA.begin();
  Serial.println("[ota] ready udp=3232 auth=enabled");
#endif
}

void loop() {
  esp_task_wdt_reset();
#if OTA_ENABLED
  ArduinoOTA.handle();
  if (otaActive) return;
#endif
  ensureWifi();
  ws.loop();
  http.handleClient();
  const uint32_t now = millis();
  if (now - sampleAt >= SAMPLE_INTERVAL_MS) {
    sampleAt = now;
    sampleSensor();
  }
  if (reading.initialized && now - readingAt >= READING_INTERVAL_MS) {
    readingAt = now;
    sendReading();
    Serial.printf("[sample] voltage=%.3f delta=%.3f gradient=%.3f occupied=%d steps=%lu stomps=%lu\n",
                  reading.voltage, reading.delta, reading.gradient, reading.occupied,
                  (unsigned long)reading.steps, (unsigned long)reading.stomps);
  }
  if (now - helloAt >= HELLO_INTERVAL_MS) {
    helloAt = now;
    sendHello();
  }
  delay(1);
}

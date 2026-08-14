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
#include <esp_task_wdt.h>
#include <esp_system.h>
#include <esp32-hal-rgb-led.h>
#include "config.h"

#define RELAY_SOURCE "pressure-mat-relay"
#define ARM_WINDOW_MS 5000UL
#define WDT_TIMEOUT_S 20

static WebSocketsClient ws;
static WebServer http(80);
static Preferences prefs;
static bool wsConnected = false;
static bool occupied = false;
static bool initialized = false;
static bool pressArmed = false;
static bool releaseArmed = false;
static float voltage = 0.0f;
static float previousVoltage = 0.0f;
static float restVoltage = 0.0f;
static float deltaVoltage = 0.0f;
static float gradient = 0.0f;
static float pressThreshold = 0.0f;
static float releaseThreshold = 0.0f;
static float configuredPressDelta = PRESS_DELTA_V;
static float configuredPressGradient = PRESS_GRADIENT_VPS;
static float configuredStompDelta = STOMP_DELTA_V;
static float configuredStompGradient = STOMP_GRADIENT_VPS;
static uint32_t pressArmedAt = 0;
static uint32_t releaseArmedAt = 0;
static uint32_t sampleAt = 0;
static uint32_t readingAt = 0;
static uint32_t helloAt = 0;
static uint32_t stepCount = 0;
static uint32_t stompCount = 0;
static uint32_t transitionCount = 0;
static bool stompReported = false;
static float peakImpactGradient = 0.0f;
static uint32_t bootCount = 0;
static esp_reset_reason_t resetReason = ESP_RST_UNKNOWN;
static float samples[SMOOTHING_FRAMES] = {};
static uint8_t sampleIndex = 0;
static uint8_t sampleCount = 0;
static uint8_t lastWifiDisconnectReason = 0;
static uint16_t wifiDisconnectRepeats = 0;

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
  doc["id"] = MAT_ID;
  doc["voltage"] = serialized(String(voltage, 3));
  doc["delta_v"] = serialized(String(deltaVoltage, 3));
  doc["gradient_vps"] = serialized(String(gradient, 3));
  doc["occupied"] = occupied;
  doc["steps"] = stepCount;
  doc["stomps"] = stompCount;
  doc["ts"] = millis();
}

static void sendReading() {
  JsonDocument doc;
  doc["source"] = RELAY_SOURCE;
  doc["type"] = "reading";
  addReading(doc);
  sendDocument(doc);
}

static void sendPresence(const char* event) {
  JsonDocument doc;
  doc["source"] = RELAY_SOURCE;
  doc["type"] = "presence";
  doc["event"] = event;
  addReading(doc);
  sendDocument(doc);
  Serial.printf("[mat] %s voltage=%.3f delta=%.3f gradient=%.3f steps=%lu\n",
                event, voltage, deltaVoltage, gradient, (unsigned long)stepCount);
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

static void maybeReportStomp() {
  if (!occupied || stompReported || deltaVoltage < configuredStompDelta ||
      peakImpactGradient < configuredStompGradient) return;
  stompReported = true;
  stompCount++;
  flashLed(32, 0, 24, 90);
  sendPresence("stomped");
}

static void transitionTo(bool nextOccupied) {
  if (occupied == nextOccupied) return;
  occupied = nextOccupied;
  transitionCount++;
  pressArmed = false;
  releaseArmed = false;
  if (occupied) {
    stepCount++;
    stompReported = false;
    peakImpactGradient = max(0.0f, -gradient);
    deltaVoltage = max(0.0f, restVoltage - voltage);
    flashLed(0, 32, 0);
    sendPresence("pressed");
    maybeReportStomp();
  } else {
    deltaVoltage = 0.0f;
    flashLed(0, 0, 32);
    sendPresence("released");
  }
}

static void sampleSensor() {
  const float next = smooth(readFrameVoltage());
  if (!initialized || sampleCount < SMOOTHING_FRAMES) {
    voltage = previousVoltage = restVoltage = next;
    initialized = sampleCount >= SMOOTHING_FRAMES;
    return;
  }

  previousVoltage = voltage;
  voltage = next;
  gradient = (voltage - previousVoltage) / (SAMPLE_INTERVAL_MS / 1000.0f);
  const uint32_t now = millis();

  if (!occupied) {
    deltaVoltage = 0.0f;
    // Capture the edge once. Recomputing the absolute threshold on every
    // falling frame makes it chase a smooth footfall downward forever.
    if (!pressArmed && gradient <= -configuredPressGradient) {
      restVoltage = previousVoltage;
      pressThreshold = previousVoltage - configuredPressDelta;
      pressArmed = true;
      pressArmedAt = now;
    }
    if (pressArmed && now - pressArmedAt > ARM_WINDOW_MS) pressArmed = false;
    if (pressArmed && voltage <= pressThreshold) transitionTo(true);
  } else {
    deltaVoltage = max(0.0f, restVoltage - voltage);
    peakImpactGradient = max(peakImpactGradient, -gradient);
    maybeReportStomp();
    if (!releaseArmed && gradient >= configuredPressGradient * RELEASE_GRADIENT_RATIO) {
      releaseThreshold = previousVoltage + configuredPressDelta * RELEASE_DELTA_RATIO;
      releaseArmed = true;
      releaseArmedAt = now;
    }
    if (releaseArmed && now - releaseArmedAt > ARM_WINDOW_MS) releaseArmed = false;
    if (releaseArmed && voltage >= releaseThreshold) transitionTo(false);
  }
}

static void statusResponse() {
  JsonDocument doc;
  doc["id"] = MAT_ID;
  doc["source"] = RELAY_SOURCE;
  doc["uptime_s"] = millis() / 1000;
  doc["boot_count"] = bootCount;
  doc["last_reset"] = resetReasonName(resetReason);
  doc["wifi"]["connected"] = WiFi.status() == WL_CONNECTED;
  doc["wifi"]["ip"] = WiFi.localIP().toString();
  doc["wifi"]["rssi"] = WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0;
  doc["ws"]["connected"] = wsConnected;
  doc["sensor"]["pin"] = SENSOR_PIN;
  doc["sensor"]["voltage"] = voltage;
  doc["sensor"]["rest_voltage"] = restVoltage;
  doc["sensor"]["delta_v"] = deltaVoltage;
  doc["sensor"]["gradient_vps"] = gradient;
  doc["sensor"]["occupied"] = occupied;
  doc["sensor"]["steps"] = stepCount;
  doc["sensor"]["stomps"] = stompCount;
  doc["sensor"]["transitions"] = transitionCount;
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
      occupied = false;
      initialized = false;
      sampleCount = 0;
      pressArmed = releaseArmed = false;
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
    occupied = false;
    initialized = false;
    sampleCount = 0;
    pressArmed = releaseArmed = false;
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
}

void loop() {
  esp_task_wdt_reset();
  ensureWifi();
  ws.loop();
  http.handleClient();
  const uint32_t now = millis();
  if (now - sampleAt >= SAMPLE_INTERVAL_MS) {
    sampleAt = now;
    sampleSensor();
  }
  if (initialized && now - readingAt >= READING_INTERVAL_MS) {
    readingAt = now;
    sendReading();
    Serial.printf("[sample] voltage=%.3f delta=%.3f gradient=%.3f occupied=%d steps=%lu stomps=%lu\n",
                  voltage, deltaVoltage, gradient, occupied,
                  (unsigned long)stepCount, (unsigned long)stompCount);
  }
  if (now - helloAt >= HELLO_INTERVAL_MS) {
    helloAt = now;
    sendHello();
  }
  delay(1);
}

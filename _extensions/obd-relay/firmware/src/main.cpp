// obd-relay — Freematics ONE+ Model B (ESP32, in-car OBD-II telemetry)
//
// Logs trips (GNSS + OBD PIDs, ~1Hz) to onboard LittleFS while driving; uploads
// buffered trips + streams live snapshots over WebSocket to the DaylightStation
// event bus (/ws) whenever the car is on home WiFi. Ignition off = power cut
// mid-write, by design: trip files are append+flush, finalized on next boot.
// See ../../README.md and docs/_wip/plans/2026-07-14-obd-relay-design.md.
//
// Build layers (platformio.ini):
//   USE_FREEMATICS — real OBD co-processor + GNSS via FreematicsPlus
//                    (vendored by tools/fetch-libs.mjs). Sampling is
//                    TODO(bring-up step 1) until the hardware arrives.
//   BENCH_SIM      — fabricated samples so the transport layer (buffer, WS,
//                    upload/ack) runs on any dev ESP32 today.
//
// Message shapes sent to the bus (dispatched backend-side by `source`):
//   {"source":"obd-relay","type":"hello","id":...,"fw":...,"ts":...}
//   {"source":"obd-relay","type":"snapshot","id":...,"battery_v":...,"gps":{...},"ts":...}
//   {"source":"obd-relay","type":"trip","id":...,"trip_id":...,"seq":0,"final":true,"meta":{...},"samples":[[...]]}
//   {"source":"obd-relay","type":"event","id":...,"event":"wifi-joined"|"trip-start","ts":...}
// Inbound: {"type":"trip-ack","trip_id":...} → delete the buffered trip file.

#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <time.h>
#include "config.h"

#ifdef USE_FREEMATICS
// TODO(bring-up step 0): vendored by tools/fetch-libs.mjs — verify header names
// against the real library before first hardware build.
#include <FreematicsPlus.h>
static FreematicsESP32 sys;
static COBD obd;   // co-processor UART OBD link
static GPS_DATA* gpsData = nullptr;
#endif

static const char* FW_VERSION = "0.1.0";
static const char* TRIP_DIR = "/trips";

// ---- one telemetry sample (positional order == wire order) ---------------
struct Sample {
  uint32_t t;        // ms since boot (rebased to epoch at upload when known)
  float lat, lon;
  int16_t speedKph, rpm, coolantC;
  int8_t fuelPct;
  float battV;
};

// ---- state ----------------------------------------------------------------
static WebSocketsClient webSocket;
static bool wsConnected = false;
static bool timeSynced = false;      // NTP succeeded this power session
static File tripFile;
static String tripId;
static uint32_t tripStartMs = 0;
static uint32_t sampleCount = 0;
static uint32_t lastSampleMs = 0;
static uint32_t lastSnapshotMs = 0;
static Sample lastSample = {};
static bool haveSample = false;

// upload state: one trip in flight at a time, deleted only on backend ack
static String uploadingPath;
static String uploadingTripId;

static uint64_t epochMs() {
  if (!timeSynced) return 0;
  struct timeval tv; gettimeofday(&tv, nullptr);
  return (uint64_t)tv.tv_sec * 1000ULL + tv.tv_usec / 1000ULL;
}

// ---- sampling -------------------------------------------------------------
// Returns true when a fresh sample was read into `s`.
static bool readSample(Sample& s) {
  s.t = millis();
#if defined(BENCH_SIM)
  // Fabricated drive so the buffer/upload path is exercisable on the bench.
  float ph = (millis() % 600000) / 600000.0f;
  s.lat = 47.60f + 0.01f * ph;  s.lon = -122.33f - 0.01f * ph;
  s.speedKph = 30 + (int)(25 * sinf(ph * 6.283f));
  s.rpm = 900 + s.speedKph * 40;
  s.coolantC = 88; s.fuelPct = 63; s.battV = 14.2f;
  return true;
#elif defined(USE_FREEMATICS)
  // TODO(bring-up step 1): read real PIDs via the OBD co-processor —
  //   obd.readPID(PID_SPEED, ...), PID_RPM, PID_COOLANT_TEMP, PID_FUEL_LEVEL,
  //   obd.getVoltage(); GNSS via sys.gpsGetData(&gpsData).
  // Record which PIDs THIS car answers in ../README.md (measured, not inferred).
  (void)s;
  return false;
#else
  (void)s;
  return false;
#endif
}

// TODO(bring-up step 1): DTC read once per trip (USE_FREEMATICS):
// obd.readDTC(...) → include in trip meta + next snapshot.

// ---- trip buffer (LittleFS) ------------------------------------------------
// File format: line 1 = header JSON; then one CSV line per sample;
// footer "E,<ms>" on graceful close. Unfooted files are finalized on boot.
static void tripOpen() {
  tripId = String((uint32_t)esp_random(), HEX) + "-" + String(millis(), HEX);
  tripStartMs = millis();
  sampleCount = 0;
  LittleFS.mkdir(TRIP_DIR);
  tripFile = LittleFS.open(String(TRIP_DIR) + "/" + tripId + ".log", "w");
  if (!tripFile) { Serial.println("[trip] open FAILED"); return; }
  JsonDocument h;
  h["trip_id"] = tripId;
  h["started_epoch_ms"] = epochMs();          // 0 = clock unknown at start
  h["started_boot_ms"] = tripStartMs;
  h["schema"] = "t,lat,lon,speed_kph,rpm,coolant_c,fuel_pct,batt_v";
  String line; serializeJson(h, line);
  tripFile.println(line);
  tripFile.flush();
  Serial.printf("[trip] started %s\n", tripId.c_str());
}

static void tripAppend(const Sample& s) {
  if (!tripFile) return;
  tripFile.printf("%lu,%.5f,%.5f,%d,%d,%d,%d,%.1f\n",
    (unsigned long)s.t, s.lat, s.lon, s.speedKph, s.rpm, s.coolantC, s.fuelPct, s.battV);
  sampleCount++;
  if (sampleCount % 30 == 0) tripFile.flush();  // survive power cuts within ~30s
}

// Finalize any trip file missing a footer (previous session lost power mid-trip).
static void finalizeUnfootedTrips() {
  File dir = LittleFS.open(TRIP_DIR);
  if (!dir) return;
  for (File f = dir.openNextFile(); f; f = dir.openNextFile()) {
    String path = String(TRIP_DIR) + "/" + f.name();
    size_t sz = f.size();
    bool footed = false;
    if (sz > 16) { f.seek(sz - 16); String tail = f.readString(); footed = tail.indexOf("\nE,") >= 0; }
    f.close();
    if (!footed) {
      File w = LittleFS.open(path, "a");
      if (w) { w.printf("E,0\n"); w.close(); Serial.printf("[trip] finalized %s\n", path.c_str()); }
    }
  }
}

// ---- WS send helpers --------------------------------------------------------
static void sendJson(JsonDocument& doc) {
  if (!wsConnected) return;
  doc["source"] = "obd-relay";
  doc["id"] = VEHICLE_ID;
  String out; serializeJson(doc, out);
  webSocket.sendTXT(out);
}

static void sendEvent(const char* event) {
  JsonDocument doc;
  doc["type"] = "event"; doc["event"] = event; doc["ts"] = epochMs();
  sendJson(doc);
  Serial.printf("[event] %s\n", event);
}

static void sendSnapshot() {
  if (!haveSample) return;
  JsonDocument doc;
  doc["type"] = "snapshot";
  doc["battery_v"] = lastSample.battV;
  doc["fuel_pct"] = lastSample.fuelPct;
  doc["coolant_c"] = lastSample.coolantC;
  doc["rpm"] = lastSample.rpm;
  doc["speed_kph"] = lastSample.speedKph;
  JsonObject gps = doc["gps"].to<JsonObject>();
  gps["lat"] = lastSample.lat; gps["lon"] = lastSample.lon;
  doc["ts"] = epochMs();
  sendJson(doc);
}

// ---- buffered-trip upload ---------------------------------------------------
// One trip at a time; chunked by TRIP_CHUNK_SAMPLES; file deleted on trip-ack.
// The CURRENT (still-open) trip is never uploaded — only completed buffers.
static void uploadNextTrip() {
  if (!wsConnected || uploadingPath.length()) return;
  File dir = LittleFS.open(TRIP_DIR);
  if (!dir) return;
  String path;
  for (File f = dir.openNextFile(); f; f = dir.openNextFile()) {
    String p = String(TRIP_DIR) + "/" + f.name();
    f.close();
    if (tripFile && p.endsWith(tripId + ".log")) continue;  // skip live trip
    path = p; break;
  }
  if (!path.length()) return;

  File f = LittleFS.open(path, "r");
  if (!f) return;
  JsonDocument header;
  if (deserializeJson(header, f.readStringUntil('\n'))) { f.close(); LittleFS.remove(path); return; }
  String tid = header["trip_id"] | "unknown";
  uint64_t startedEpoch = header["started_epoch_ms"] | (uint64_t)0;

  int seq = 0;
  uint32_t total = 0, endedT = 0;
  JsonDocument doc;
  JsonArray samples;
  auto beginChunk = [&]() {
    doc.clear();
    doc["type"] = "trip"; doc["trip_id"] = tid; doc["seq"] = seq; doc["final"] = false;
    samples = doc["samples"].to<JsonArray>();
  };
  beginChunk();
  while (f.available()) {
    String line = f.readStringUntil('\n');
    if (line.startsWith("E,")) break;
    Sample s; // parse CSV line
    if (sscanf(line.c_str(), "%lu,%f,%f,%hd,%hd,%hd,%hhd,%f",
               (unsigned long*)&s.t, &s.lat, &s.lon, &s.speedKph, &s.rpm,
               &s.coolantC, &s.fuelPct, &s.battV) != 8) continue;
    JsonArray row = samples.add<JsonArray>();
    row.add(s.t); row.add(s.lat); row.add(s.lon); row.add(s.speedKph);
    row.add(s.rpm); row.add(s.coolantC); row.add(s.fuelPct); row.add(s.battV);
    total++; endedT = s.t;
    if ((int)samples.size() >= TRIP_CHUNK_SAMPLES) { sendJson(doc); seq++; beginChunk(); }
  }
  f.close();

  doc["final"] = true;
  JsonObject meta = doc["meta"].to<JsonObject>();
  meta["started_epoch_ms"] = startedEpoch;
  meta["time_approx"] = (startedEpoch == 0);
  meta["samples"] = total;
  meta["ended_boot_ms"] = endedT;
  meta["schema"] = header["schema"] | "";
  meta["upload_epoch_ms"] = epochMs();
  meta["upload_boot_ms"] = (uint32_t)millis();   // lets backend rebase boot-ms → wall time
  sendJson(doc);
  uploadingPath = path; uploadingTripId = tid;   // await trip-ack before delete
  Serial.printf("[upload] %s (%lu samples, %d chunks) — awaiting ack\n", tid.c_str(), (unsigned long)total, seq + 1);
}

// ---- WS events ---------------------------------------------------------------
static void wsEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED: {
      wsConnected = true;
      Serial.println("[ws] connected");
      JsonDocument doc;
      doc["type"] = "hello"; doc["fw"] = FW_VERSION;
      doc["rssi"] = WiFi.RSSI(); doc["ts"] = epochMs();
      sendJson(doc);
      sendEvent("wifi-joined");
      break;
    }
    case WStype_DISCONNECTED:
      wsConnected = false;
      uploadingPath = ""; uploadingTripId = "";  // retry the trip next connect
      Serial.println("[ws] disconnected");
      break;
    case WStype_TEXT: {
      JsonDocument doc;
      if (deserializeJson(doc, payload, length)) return;
      if (strcmp(doc["type"] | "", "trip-ack") == 0 &&
          uploadingTripId == (doc["trip_id"] | "")) {
        LittleFS.remove(uploadingPath);
        Serial.printf("[upload] acked %s — deleted\n", uploadingTripId.c_str());
        uploadingPath = ""; uploadingTripId = "";
      }
      break;
    }
    default: break;
  }
}

// ---- setup / loop --------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.printf("\n[obd-relay] boot fw=%s vehicle=%s\n", FW_VERSION, VEHICLE_ID);

  if (!LittleFS.begin(true)) Serial.println("[fs] mount FAILED");
  finalizeUnfootedTrips();

#ifdef USE_FREEMATICS
  // TODO(bring-up step 0/1): sys.begin(), obd.begin(), obd.init() — link to the
  // ECU, then sys.gpsBegin() for GNSS. Retry loop: the ECU may need ignition
  // fully on (not just accessory) before it answers.
#endif

  // Opportunistic WiFi — away from home this simply never connects; sampling
  // and trip buffering don't depend on it.
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  webSocket.begin(WS_HOST, WS_PORT, WS_PATH);
  webSocket.onEvent(wsEvent);
  webSocket.setReconnectInterval(5000);
  webSocket.enableHeartbeat(15000, 3000, 2);

  tripOpen();
}

void loop() {
  webSocket.loop();

  // WiFi self-heal + NTP once associated
  static uint32_t lastWifiTry = 0;
  if (WiFi.status() != WL_CONNECTED && millis() - lastWifiTry > 10000) {
    lastWifiTry = millis();
    WiFi.disconnect(); WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  }
  if (WiFi.status() == WL_CONNECTED && !timeSynced) {
    configTime(0, 0, "pool.ntp.org");
    struct tm tinfo;
    if (getLocalTime(&tinfo, 50)) { timeSynced = true; Serial.println("[time] NTP synced"); }
  }

  // sample at SAMPLE_HZ into the live trip
  if (millis() - lastSampleMs >= (uint32_t)(1000 / SAMPLE_HZ)) {
    lastSampleMs = millis();
    Sample s;
    if (readSample(s)) { lastSample = s; haveSample = true; tripAppend(s); }
  }

  // live snapshot while on the bus
  if (wsConnected && millis() - lastSnapshotMs >= (uint32_t)SNAPSHOT_S * 1000) {
    lastSnapshotMs = millis();
    sendSnapshot();
  }

  // drain buffered trips (one at a time, ack-gated)
  uploadNextTrip();
}

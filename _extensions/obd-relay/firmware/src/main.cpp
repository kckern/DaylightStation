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
#include <WebServer.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <time.h>
#include <esp_sleep.h>
#include "config.h"

// ---- standby / battery protection ------------------------------------------
// The OBD-II port is typically always-hot, so the device keeps drawing with the
// engine off. Running flat out (WiFi associated, HTTP + WS up) is a multi-day
// parasitic load on the car battery on top of the vehicle's own, which is a
// dead car after a long park. Standby is therefore not optional.
//
// Engine state comes from OBD-port voltage via the co-processor (ATRV), which
// works with NO ECU link and with the ignition off — an alternator holds the
// bus high while running and it falls back to battery rest voltage when off.
//
// THRESHOLDS NEED CALIBRATION on the actual car: resting and charging voltage
// vary by battery, alternator and temperature. These defaults are deliberately
// conservative (a false "engine on" only costs power; a false "engine off"
// would cut a live trip short). Override in config.h via gen-config.
#ifndef STANDBY_ENGINE_OFF_V
#define STANDBY_ENGINE_OFF_V     13.0f  // below this = not charging = engine off
#endif
#ifndef STANDBY_CONFIRM_S
#define STANDBY_CONFIRM_S        120    // sustained low volts before believing it
#endif
#ifndef STANDBY_UPLOAD_WINDOW_S
#define STANDBY_UPLOAD_WINDOW_S  60     // bounded window to drain trips first
#endif
#ifndef STANDBY_CHECK_S
#define STANDBY_CHECK_S          60     // deep-sleep interval between volt checks
#endif

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
static WebServer http(80);
static bool wsConnected = false;
static uint32_t g_wsDownSinceMs = 0;   // when the live link actually dropped
static uint32_t g_wsRetries = 0;       // failed reconnects since that drop
static uint32_t g_wsDropCount = 0;     // real drops since boot (not retries)
static bool g_wsEverConnected = false; // distinguishes "never reached the bus"
                                       // from "connected fine, nothing to report":
                                       // both otherwise read as drops=0 on /status
static uint32_t g_bootMs = 0;
static uint32_t g_wifiAssociateMs = 0;  // how long WiFi.begin() took this boot

// Health of the parts that can fail silently. A car that never uploads looks
// identical from the outside to a car that was never driven, so each of these
// gets surfaced on /status rather than living only in a serial log nobody reads.
static bool g_fsMounted = false;
static uint32_t g_tripsUploaded = 0;
static uint32_t g_tripsAcked = 0;
#ifdef USE_FREEMATICS
static bool g_sysReady = false;        // co-processor link up (sys.begin)
// Written by obdLinkTask on core 0, read by loop()/handleStatus on core 1.
static volatile bool g_obdReady = false;  // ECU link up (obd.init) — needs ignition
static int  g_devType = 0;             // reported by the co-processor
// Written by obdLinkTask (core 0), read by loop()/handleStatus (core 1).
static volatile float g_batteryV = 0;  // OBD-port volts; 0 = not read yet
static volatile uint32_t g_batteryAgeMs = 0;
#endif
static uint32_t g_engineOffSinceMs = 0;  // first sustained low-voltage reading
static bool g_wokeFromStandby = false;

// ---- recent-log ring (pattern shared with kitchen-relay/omr-relay) --------
// Consecutive duplicates coalesce into a repeat counter instead of consuming a
// slot each time — otherwise one chatty retry loop evicts every other line.
#define RECENT_LOG_MAX 48
struct RecentLog { uint32_t ms; uint16_t repeat; char text[128]; };
static RecentLog g_recentLogs[RECENT_LOG_MAX];
static uint8_t g_recentLogNext = 0;
static uint8_t g_recentLogCount = 0;
static void relayLogLine(const char* text) {
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
  if (!g_fsMounted) { relayLogLine("[trip] no filesystem — not buffering"); return; }
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

// Close the live trip so it becomes uploadable. uploadNextTrip() deliberately
// skips the still-open trip, so without this the drive you just finished never
// uploads while you are parked — it would sit on flash until the NEXT boot
// finalized it, i.e. upload as you are leaving home again. Rotating on arrival
// is what makes "pull into the garage, kill the engine" actually work.
static void tripClose() {
  if (!tripFile) return;
  tripFile.printf("E,%lu\n", (unsigned long)millis());
  tripFile.flush();
  tripFile.close();
  relayLogf("[trip] closed %s (%lu samples)", tripId.c_str(), (unsigned long)sampleCount);
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
  // Without the FS guard this runs every loop iteration on an unmounted volume
  // and buries the serial log under "File system is not mounted" (~16/second),
  // hiding every other line — observed on this unit before the guard existed.
  if (!g_fsMounted || !wsConnected || uploadingPath.length()) return;
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
  g_tripsUploaded++;
  relayLogf("[upload] %s (%lu samples, %d chunks) — awaiting ack", tid.c_str(), (unsigned long)total, seq + 1);
}

// ---- WS events ---------------------------------------------------------------
static void wsEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED: {
      wsConnected = true;
      g_wsDownSinceMs = 0;
      g_wsRetries = 0;
      g_wsEverConnected = true;
      relayLogLine("[ws] connected");
      // Arriving home: rotate the live trip so the drive that just finished is
      // a closed file and uploads NOW, rather than waiting for the next boot.
      // The window between pulling into the garage and killing the engine is
      // short, and the device is already associated by then — so the moment the
      // bus comes up is the moment to bank the drive.
      if (tripFile && sampleCount > 0) { tripClose(); tripOpen(); }
      JsonDocument doc;
      doc["type"] = "hello"; doc["fw"] = FW_VERSION;
      doc["rssi"] = WiFi.RSSI(); doc["ts"] = epochMs();
      sendJson(doc);
      sendEvent("wifi-joined");
      break;
    }
    case WStype_DISCONNECTED:
      // A failed reconnect attempt also raises DISCONNECTED. Counting those as
      // drops would make a car parked away from home look like a flapping link.
      if (wsConnected) {
        relayLogLine("[ws] disconnected");
        g_wsDownSinceMs = millis();
        g_wsRetries = 0;
        g_wsDropCount++;
      } else {
        g_wsRetries++;
      }
      wsConnected = false;
      uploadingPath = ""; uploadingTripId = "";  // retry the trip next connect
      break;
    case WStype_TEXT: {
      JsonDocument doc;
      if (deserializeJson(doc, payload, length)) return;
      if (strcmp(doc["type"] | "", "trip-ack") == 0 &&
          uploadingTripId == (doc["trip_id"] | "")) {
        LittleFS.remove(uploadingPath);
        g_tripsAcked++;
        relayLogf("[upload] acked %s — deleted", uploadingTripId.c_str());
        uploadingPath = ""; uploadingTripId = "";
      }
      break;
    }
    default: break;
  }
}

#ifdef USE_FREEMATICS
// Owns every blocking call to the OBD co-processor, on core 0, so that the
// network loop on core 1 is never starved. Deliberately does NOT log directly:
// relayLogLine() is not thread-safe, so this only flips a flag and lets loop()
// report the transition.
static void obdLinkTask(void*) {
  for (;;) {
    if (g_sysReady) {
      // Voltage first, and unconditionally: it drives standby, so it must keep
      // updating even when the ECU link never comes up. ATRV goes to the
      // co-processor, not the ECU, so it answers with the ignition off.
      float v = obd.getVoltage();
      if (v > 0) { g_batteryV = v; g_batteryAgeMs = millis(); }
      if (!g_obdReady && obd.init()) g_obdReady = true;
    }
    vTaskDelay(pdMS_TO_TICKS(g_obdReady ? 15000 : 5000));
  }
}
#endif

#ifdef USE_FREEMATICS
// Engine off → bank the drive, then sleep. Never returns; the ESP32 reboots
// into setup() on the next timer wake.
//
// The upload window is BOUNDED and happens before sleeping rather than after,
// because this is the one moment we know the car is stationary and (if home)
// on WiFi. Sleeping first and uploading later would mean a trip sits on flash
// until the next drive.
static void enterStandby(const char* why) {
  relayLogf("[standby] %s (%.2fV) — closing trip", why, g_batteryV);
  tripClose();

  // Drain buffered trips for at most STANDBY_UPLOAD_WINDOW_S. Bounded on
  // purpose: an unreachable backend must not hold the device awake on the
  // car's battery indefinitely.
  uint32_t t0 = millis();
  while (millis() - t0 < (uint32_t)STANDBY_UPLOAD_WINDOW_S * 1000) {
    webSocket.loop();
    http.handleClient();
    uploadNextTrip();
    if (wsConnected && uploadingPath.isEmpty()) {
      // Nothing left in flight — check whether anything is still queued.
      File dir = LittleFS.open(TRIP_DIR);
      bool any = false;
      if (dir && dir.isDirectory()) for (File f = dir.openNextFile(); f; f = dir.openNextFile()) { any = true; break; }
      if (!any) break;
    }
    delay(20);
  }
  relayLogf("[standby] sleeping %ds (uploaded=%lu acked=%lu)",
            STANDBY_CHECK_S, (unsigned long)g_tripsUploaded, (unsigned long)g_tripsAcked);

  if (tripFile) tripFile.close();
  LittleFS.end();
  webSocket.disconnect();
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  obd.enterLowPowerMode();          // ATLP — sleeps the co-processor too
  delay(50);
  esp_sleep_enable_timer_wakeup((uint64_t)STANDBY_CHECK_S * 1000000ULL);
  esp_deep_sleep_start();           // does not return
}
#endif

// ---- HTTP pull plane -----------------------------------------------------
// The push path (uploadNextTrip) only fires when the car is home AND the bus is
// up AND the backend acks. That leaves every other moment with no way to see
// what the device is holding. These two endpoints are the pull counterpart:
//   GET /trips        → manifest of buffered payloads
//   GET /trip?id=<id> → one payload, in the SAME shape uploadNextTrip sends,
//                       so a pulled trip and a pushed trip are comparable.
// Pulling never deletes: only a backend trip-ack frees a buffer, so a curl can
// never cost you a trip.

// Trip ids are hex+dash by construction (esp_random + millis). Anything else is
// refused rather than sanitised — this string becomes a filesystem path.
static bool safeTripId(const String& id) {
  if (!id.length() || id.length() > 40) return false;
  for (size_t i = 0; i < id.length(); i++) {
    char c = id[i];
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || c == '-')) return false;
  }
  return true;
}

// Samples per line; counts newlines without holding the file in RAM.
static uint32_t countSamples(File& f) {
  uint32_t lines = 0; uint8_t buf[256]; int n;
  while ((n = f.read(buf, sizeof(buf))) > 0)
    for (int i = 0; i < n; i++) if (buf[i] == '\n') lines++;
  return lines > 1 ? lines - 1 : 0;      // minus the header line
}

static void handleTrips() {
  JsonDocument doc;
  doc["device"] = "obd-relay";
  doc["vehicle"] = VEHICLE_ID;
  doc["fs_mounted"] = g_fsMounted;
  JsonArray arr = doc["trips"].to<JsonArray>();

  if (g_fsMounted) {
    File dir = LittleFS.open(TRIP_DIR);
    if (dir && dir.isDirectory()) {
      for (File f = dir.openNextFile(); f; f = dir.openNextFile()) {
        String name = f.name();
        if (!name.endsWith(".log")) { f.close(); continue; }
        JsonObject t = arr.add<JsonObject>();
        t["trip_id"] = name.substring(0, name.length() - 4);
        t["bytes"] = (uint32_t)f.size();

        JsonDocument header;
        String first = f.readStringUntil('\n');
        if (!deserializeJson(header, first)) {
          t["started_epoch_ms"] = header["started_epoch_ms"] | (uint64_t)0;
          t["started_boot_ms"] = header["started_boot_ms"] | (uint32_t)0;
          t["time_approx"] = (uint64_t)(header["started_epoch_ms"] | (uint64_t)0) == 0;
          t["schema"] = header["schema"] | "";
        }
        t["samples"] = countSamples(f);
        // A trip still being written is the live one — it is never uploaded and
        // its tail may be mid-line, so say so instead of implying it's complete.
        bool live = tripFile && name == (tripId + ".log");
        t["live"] = live;
        t["uploading"] = (uploadingTripId.length() && name == (uploadingTripId + ".log"));
        t["url"] = String("/trip?id=") + name.substring(0, name.length() - 4);
        f.close();
      }
    }
  }
  String out; serializeJsonPretty(doc, out);
  http.send(200, "application/json", out);
}

// Streamed so a long trip can't exhaust the heap the way a buffered
// JsonDocument would (1 Hz for an hour is thousands of rows).
static void handleTrip() {
  String id = http.arg("id");
  if (!safeTripId(id)) { http.send(400, "application/json", "{\"error\":\"bad or missing id\"}"); return; }
  String path = String(TRIP_DIR) + "/" + id + ".log";
  if (!g_fsMounted || !LittleFS.exists(path)) {
    http.send(404, "application/json", "{\"error\":\"no such trip\"}"); return;
  }
  File f = LittleFS.open(path, "r");
  if (!f) { http.send(500, "application/json", "{\"error\":\"open failed\"}"); return; }

  JsonDocument header;
  bool haveHeader = !deserializeJson(header, f.readStringUntil('\n'));

  http.setContentLength(CONTENT_LENGTH_UNKNOWN);
  http.send(200, "application/json", "");

  String head = String("{\"source\":\"obd-relay\",\"type\":\"trip\",\"id\":\"") + VEHICLE_ID +
                "\",\"trip_id\":\"" + id + "\",\"seq\":0,\"final\":true,\"samples\":[";
  http.sendContent(head);

  uint32_t total = 0, endedT = 0;
  String chunk; chunk.reserve(1024);
  while (f.available()) {
    String line = f.readStringUntil('\n');
    line.trim();
    if (!line.length()) continue;
    if (line.startsWith("E,")) break;
    Sample s;
    if (sscanf(line.c_str(), "%lu,%f,%f,%hd,%hd,%hd,%hhd,%f",
               (unsigned long*)&s.t, &s.lat, &s.lon, &s.speedKph, &s.rpm,
               &s.coolantC, &s.fuelPct, &s.battV) != 8) continue;
    if (total) chunk += ',';
    // Every integer is cast explicitly: fuelPct is int8_t, and String += on a
    // signed char appends that BYTE as a character rather than its digits.
    chunk += '['; chunk += (unsigned long)s.t; chunk += ','; chunk += String(s.lat, 6); chunk += ',';
    chunk += String(s.lon, 6); chunk += ','; chunk += (int)s.speedKph; chunk += ',';
    chunk += (int)s.rpm; chunk += ','; chunk += (int)s.coolantC; chunk += ',';
    chunk += (int)s.fuelPct; chunk += ','; chunk += String(s.battV, 2); chunk += ']';
    total++; endedT = s.t;
    if (chunk.length() > 900) { http.sendContent(chunk); chunk = ""; }
  }
  if (chunk.length()) http.sendContent(chunk);
  f.close();

  JsonDocument meta;
  uint64_t startedEpoch = haveHeader ? (header["started_epoch_ms"] | (uint64_t)0) : 0;
  meta["started_epoch_ms"] = startedEpoch;
  meta["time_approx"] = (startedEpoch == 0);
  meta["samples"] = total;
  meta["ended_boot_ms"] = endedT;
  meta["schema"] = haveHeader ? (header["schema"] | "") : "";
  meta["pulled_epoch_ms"] = epochMs();
  meta["pulled_boot_ms"] = (uint32_t)millis();
  String tail; serializeJson(meta, tail);
  http.sendContent(String("],\"meta\":") + tail + "}");
  http.sendContent("");            // terminate the chunked response
}

// ---- HTTP status plane ---------------------------------------------------
// Same shape as the sibling relays: GET / (or /status) returns the whole health
// picture as JSON so the device can be interrogated from any machine on the LAN
// without a serial cable — which, in a car parked in the garage, is the only
// practical way to ask it anything.
static void handleStatus() {
  JsonDocument doc;
  doc["device"] = "obd-relay";
  doc["vehicle"] = VEHICLE_ID;
  doc["firmware"] = FW_VERSION;
  doc["uptime_s"] = (uint32_t)(millis() / 1000);
  doc["time_synced"] = timeSynced;
  doc["epoch_ms"] = epochMs();

  JsonObject wifi = doc["wifi"].to<JsonObject>();
  wifi["connected"] = WiFi.status() == WL_CONNECTED;
  wifi["ip"] = WiFi.localIP().toString();
  wifi["rssi"] = WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0;
  wifi["ssid"] = WIFI_SSID;
  // Association time varies from 200ms to the full 15s timeout between boots.
  // Reporting the BSSID and channel is the prerequisite for pinning them in
  // WiFi.begin(), which skips the scan and makes the connect deterministic —
  // the difference between making and missing a 20-second window.
  wifi["associate_ms"] = g_wifiAssociateMs;
  if (WiFi.status() == WL_CONNECTED) {
    wifi["bssid"] = WiFi.BSSIDstr();
    wifi["channel"] = WiFi.channel();
  }

  JsonObject ws = doc["websocket"].to<JsonObject>();
  ws["connected"] = wsConnected;
  ws["host"] = WS_HOST; ws["port"] = WS_PORT; ws["path"] = WS_PATH;
  ws["drops"] = g_wsDropCount;
  // Reported unconditionally: a device that has NEVER reached the bus otherwise
  // looks identical to a healthy one (drops:0, no down_s) on this endpoint.
  ws["ever_connected"] = g_wsEverConnected;
  ws["failed_attempts"] = g_wsRetries;
  if (!wsConnected && g_wsDownSinceMs) {
    ws["down_s"] = (uint32_t)((millis() - g_wsDownSinceMs) / 1000);
  }

  JsonObject vehicle = doc["vehicle_link"].to<JsonObject>();
#ifdef USE_FREEMATICS
  vehicle["build"] = "freematics";
  vehicle["coproc_ready"] = g_sysReady;   // sys.begin() — the boot-critical one
  vehicle["dev_type"] = g_devType;
  vehicle["obd_ready"] = g_obdReady;      // false until ignition is fully on
  // Battery/standby: this is the drain story, made observable instead of
  // estimated. battery_v comes from ATRV (co-processor, no ECU needed).
  vehicle["battery_v"] = g_batteryV;
  if (g_batteryAgeMs) vehicle["battery_age_s"] = (uint32_t)((millis() - g_batteryAgeMs) / 1000);
  vehicle["woke_from_standby"] = g_wokeFromStandby;
  JsonObject sb = vehicle["standby"].to<JsonObject>();
  sb["engine_off_below_v"] = STANDBY_ENGINE_OFF_V;
  sb["confirm_s"] = STANDBY_CONFIRM_S;
  sb["upload_window_s"] = STANDBY_UPLOAD_WINDOW_S;
  sb["check_s"] = STANDBY_CHECK_S;
  sb["engine_off_for_s"] = g_engineOffSinceMs
    ? (uint32_t)((millis() - g_engineOffSinceMs) / 1000) : 0;
#else
  vehicle["build"] = "bench-sim";
#endif

  // Trip buffer. `pending` is what would be lost if the flash died right now.
  JsonObject trip = doc["trip"].to<JsonObject>();
  trip["fs_mounted"] = g_fsMounted;
  trip["current_id"] = tripId;
  trip["samples"] = sampleCount;
  trip["uploaded"] = g_tripsUploaded;
  trip["acked"] = g_tripsAcked;
  trip["uploading"] = uploadingTripId;
  uint32_t pending = 0;
  if (g_fsMounted) {
    File dir = LittleFS.open(TRIP_DIR);
    if (dir && dir.isDirectory()) { for (File f = dir.openNextFile(); f; f = dir.openNextFile()) pending++; }
  }
  trip["pending_files"] = pending;

  if (haveSample) {
    JsonObject s = doc["last_sample"].to<JsonObject>();
    s["age_s"] = (uint32_t)((millis() - lastSample.t) / 1000);
    s["speed_kph"] = lastSample.speedKph; s["rpm"] = lastSample.rpm;
    s["coolant_c"] = lastSample.coolantC; s["fuel_pct"] = lastSample.fuelPct;
    s["batt_v"] = lastSample.battV;
    s["lat"] = lastSample.lat; s["lon"] = lastSample.lon;
  }

  JsonArray logs = doc["recent_logs"].to<JsonArray>();
  for (uint8_t i = 0; i < g_recentLogCount; i++) {
    uint8_t idx = (uint8_t)((g_recentLogNext + RECENT_LOG_MAX - g_recentLogCount + i) % RECENT_LOG_MAX);
    JsonObject e = logs.add<JsonObject>();
    e["age_s"] = (uint32_t)((millis() - g_recentLogs[idx].ms) / 1000);
    e["text"] = g_recentLogs[idx].text;
    if (g_recentLogs[idx].repeat > 1) e["repeat"] = g_recentLogs[idx].repeat;
  }

  String out; serializeJsonPretty(doc, out);
  http.send(200, "application/json", out);
}

// ---- setup / loop --------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(200);
  g_bootMs = millis();
  g_wokeFromStandby = (esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_TIMER);
  relayLogf("[obd-relay] boot fw=%s vehicle=%s%s", FW_VERSION, VEHICLE_ID,
            g_wokeFromStandby ? " (standby wake)" : "");

  g_fsMounted = LittleFS.begin(true);          // true = format on first/corrupt mount
  if (!g_fsMounted) {
    // A virgin or corrupted partition fails the first mount; format explicitly
    // and retry once rather than running trip-blind for the whole power session.
    relayLogLine("[fs] mount failed — formatting");
    if (LittleFS.format()) g_fsMounted = LittleFS.begin(false);
  }
  relayLogf("[fs] %s", g_fsMounted ? "mounted" : "UNAVAILABLE (trips cannot buffer)");
  if (g_fsMounted) finalizeUnfootedTrips();

#ifdef USE_FREEMATICS
  // sys.begin() brings up the co-processor link. This is NOT optional: without
  // it the co-processor's watchdog resets the ESP32 in a tight loop, which is
  // exactly what the board did before this call existed (measured 2026-07-30 —
  // rst:0x3 SW_RESET repeating, no application output). Vendor order, from
  // firmware_v5/telelogger.ino: sys.begin() then obd.begin(sys.link).
  // (co-processor, NO cellular). The default is begin(true, true), which brings
  // up the SIM7670 LTE modem — hardware we deliberately do not use in v1 (no
  // SIM, no plan). Suspected culprit for the WS client failing every attempt on
  // the hardware build while the identical transport code connected fine on the
  // bench builds; cellular init shares timing/power with the radio path.
  g_sysReady = sys.begin(true, false);
  if (g_sysReady) {
    g_devType = sys.devType;
    relayLogf("[sys] co-processor ready devType=%d", g_devType);
    obd.begin(sys.link);
    // Fast path on a standby wake: if the engine is STILL off, go straight back
    // to sleep without ever powering the radio. This is what keeps the duty
    // cycle — and therefore the average draw on the car battery — low. A full
    // wake costs seconds of WiFi; this costs a single ATRV round trip.
    if (g_wokeFromStandby) {
      float v = obd.getVoltage();
      if (v > 0) { g_batteryV = v; g_batteryAgeMs = millis(); }
      if (v > 0 && v < STANDBY_ENGINE_OFF_V) {
        Serial.printf("[standby] still off (%.2fV) — back to sleep\n", v);
        obd.enterLowPowerMode();
        delay(50);
        esp_sleep_enable_timer_wakeup((uint64_t)STANDBY_CHECK_S * 1000000ULL);
        esp_deep_sleep_start();       // does not return
      }
      relayLogf("[standby] woke — %.2fV, engine on", v);
    }
    // obd.init() BLOCKS for ~5s and fails until the ignition is fully on, so it
    // must never run on the Arduino loop task. Measured 2026-07-30: retrying it
    // inline every 5s starved webSocket.loop(), which needs frequent servicing
    // to finish a handshake — the WS client failed every single attempt
    // (ever_connected:false, 35+ failures) and HTTP answered in 2.5-3s instead
    // of milliseconds, while the identical transport code on the bench build
    // connected immediately. It runs on core 0; Arduino's loop() owns core 1.
    xTaskCreatePinnedToCore(obdLinkTask, "obd-link", 4096, nullptr, 1, nullptr, 0);
  } else {
    relayLogLine("[sys] co-processor begin FAILED");
  }
#endif

  // Opportunistic WiFi — away from home this simply never connects; sampling
  // and trip buffering don't depend on it.
  WiFi.mode(WIFI_STA);
  WiFi.persistent(false);        // don't wear flash rewriting creds every boot
  WiFi.setAutoReconnect(true);   // supplicant keeps trying on its own
  // Modem sleep left ON (the default). It was disabled earlier in development to
  // shave association latency, but that raised idle draw on a device sitting on
  // the car's battery — the wrong trade once standby exists to bound the awake
  // time. Measured association is 200-700ms with it enabled, which is fine.
  WiFi.setSleep(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) delay(100);
  g_wifiAssociateMs = millis() - t0;
  relayLogf("[wifi] associate took %lums", (unsigned long)g_wifiAssociateMs);
  relayLogf("[wifi] %s", WiFi.status() == WL_CONNECTED
            ? WiFi.localIP().toString().c_str() : "not associated (will retry)");

  webSocket.begin(WS_HOST, WS_PORT, WS_PATH);
  webSocket.onEvent(wsEvent);
  webSocket.setReconnectInterval(5000);
  webSocket.enableHeartbeat(15000, 3000, 2);

  http.on("/", handleStatus);
  http.on("/status", handleStatus);
  http.on("/trips", handleTrips);      // manifest of buffered payloads
  http.on("/trip", handleTrip);        // one payload, push-identical shape
  http.begin();
  relayLogLine("[http] status server on :80");

  tripOpen();
}

void loop() {
  webSocket.loop();
  http.handleClient();

#ifdef USE_FREEMATICS
  // obdLinkTask (core 0) owns the blocking retries; loop() only reports the
  // transition, keeping every blocking co-processor call off this task.
  static bool lastObdReported = false;
  if (g_obdReady != lastObdReported) {
    lastObdReported = g_obdReady;
    relayLogf("[obd] ECU link %s", g_obdReady ? "up" : "lost");
  }

  // Engine-off → standby. Requires a sustained low reading (STANDBY_CONFIRM_S)
  // so that cranking — which briefly pulls the bus down hard — can't be
  // mistaken for the engine being switched off.
  // A reading of exactly 0 means "no answer from the co-processor", NOT zero
  // volts; treating that as engine-off would sleep the device on a comms fault.
  if (g_batteryV > 0) {
    if (g_batteryV < STANDBY_ENGINE_OFF_V) {
      if (!g_engineOffSinceMs) g_engineOffSinceMs = millis();
      else if (millis() - g_engineOffSinceMs > (uint32_t)STANDBY_CONFIRM_S * 1000) {
        enterStandby("engine off");
      }
    } else {
      g_engineOffSinceMs = 0;
    }
  }
#endif

  // WiFi self-heal + NTP once associated
  // setAutoReconnect() already retries continuously. The old code called
  // WiFi.disconnect() + begin() every 10s, which TORE DOWN whatever association
  // attempt was in flight and restarted it from scratch — actively slower than
  // leaving the supplicant alone. Only force a fresh begin() after a long stall.
  static uint32_t lastWifiTry = 0;
  if (WiFi.status() != WL_CONNECTED && millis() - lastWifiTry > 30000) {
    lastWifiTry = millis();
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  }
  if (WiFi.status() == WL_CONNECTED) lastWifiTry = millis();
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

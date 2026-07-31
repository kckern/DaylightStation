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
#include <Update.h>
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
// Battery failsafe. A voltage of 0 means "the co-processor did not answer", not
// "zero volts", and is NOT treated as engine-off — otherwise a comms fault would
// sleep the device mid-drive and lose the trip. But that safe-for-data choice is
// unsafe for the battery: without this, a co-processor that stops answering
// leaves the device awake forever, draining exactly as it did before standby
// existed. If voltage stays unreadable this long, sleep anyway and let the next
// wake re-evaluate. Losing a trip beats a car that will not start.
#ifndef STANDBY_VOLT_FAULT_S
#define STANDBY_VOLT_FAULT_S     600
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

#ifdef USE_FREEMATICS
// ---- PID table -------------------------------------------------------------
// Every OBD read is a blocking UART round trip to the co-processor, so all of
// this runs on obdLinkTask (core 0) and loop() only ever copies the result.
// Putting reads on the Arduino loop task is what starved webSocket.loop()
// earlier in bring-up and left the WS client unable to complete a handshake.
//
// `ok` is per-PID and sticky-per-attempt: which PIDs a given car answers is
// vehicle-specific and MUST be measured, not assumed (see /pids). Standard
// OBD-II covers the HOT and most DIAG entries; ODOMETER (0xA6) is in later
// J1979 revisions but rarely implemented. Oil life and tyre pressure are NOT
// standard OBD-II at all and are deliberately absent — they are manufacturer
// -specific and not reachable this way.
struct PidProbe {
  byte pid;
  const char* name;
  const char* unit;
  bool ok;        // did this car answer, last attempt
  int  value;
  bool tried;
};

// Sampled at SAMPLE_HZ — the ones that actually change while driving.
static PidProbe g_hotPids[] = {
  { PID_SPEED,        "speed",       "kph", false, 0, false },
  { PID_RPM,          "rpm",         "rpm", false, 0, false },
  { PID_COOLANT_TEMP, "coolant",     "C",   false, 0, false },
  { PID_FUEL_LEVEL,   "fuel_level",  "%",   false, 0, false },
};
// Slow-moving / diagnostic. Read once per trip and then periodically; these are
// the "what is the state of the car" set rather than the "what is it doing now"
// set, and they are what a diagnostics view is built from.
static PidProbe g_diagPids[] = {
  { PID_CONTROL_MODULE_VOLTAGE, "control_module_voltage", "V",  false, 0, false },
  { PID_ENGINE_LOAD,            "engine_load",            "%",  false, 0, false },
  { PID_THROTTLE,               "throttle",               "%",  false, 0, false },
  { PID_INTAKE_TEMP,            "intake_temp",            "C",  false, 0, false },
  { PID_AMBIENT_TEMP,           "ambient_temp",           "C",  false, 0, false },
  { PID_ENGINE_OIL_TEMP,        "engine_oil_temp",        "C",  false, 0, false },
  { PID_BAROMETRIC,             "barometric",             "kPa",false, 0, false },
  { PID_RUNTIME,                "runtime_since_start",    "s",  false, 0, false },
  { PID_DISTANCE_WITH_MIL,      "distance_with_mil",      "km", false, 0, false },
  { PID_DISTANCE,               "distance_since_cleared", "km", false, 0, false },
  { PID_WARMS_UPS,              "warmups_since_cleared",  "",   false, 0, false },
  { PID_TIME_WITH_MIL,          "time_with_mil",          "min",false, 0, false },
  { PID_TIME_SINCE_CODES_CLEARED,"time_since_cleared",    "min",false, 0, false },
  { PID_ODOMETER,               "odometer",               "km", false, 0, false },
};
#define HOT_PID_COUNT  (sizeof(g_hotPids)  / sizeof(g_hotPids[0]))
#define DIAG_PID_COUNT (sizeof(g_diagPids) / sizeof(g_diagPids[0]))

// DTCs (check-engine). Standard Mode 03, the one diagnostic that is reliably
// available on any OBD-II car.
#define MAX_DTC 6
static uint16_t g_dtc[MAX_DTC];
static int g_dtcCount = -1;            // -1 = not read yet this trip
static char g_vin[24] = {0};

// ---- protocol probe --------------------------------------------------------
// obd.init(PROTO_AUTO) never linked on the target car (2021 Chrysler Pacifica,
// FCA) even though the co-processor answers ATRV — so the OBD hardware path is
// alive and it is protocol negotiation that fails. Rather than guess-and-
// reflash, walk every protocol once and report which links. 2018+ FCA vehicles
// also ship a Security Gateway (SGW) between the OBD port and the vehicle
// buses; if NO protocol links but ATRV works, that is the next suspect.
//
// Runs on core 0 (each init() blocks for seconds) and is request/poll rather
// than synchronous: a full sweep takes far longer than an HTTP timeout.
struct ProtoProbe {
  byte proto;
  const char* name;
  bool tried;
  bool linked;      // init() succeeded
  bool pidOk;       // and a real Mode 01 read came back — the honest test
  int  rpm;
};
static ProtoProbe g_protos[] = {
  { PROTO_ISO15765_11B_500K, "ISO15765 11bit 500k (expected for 2021 FCA)", false, false, false, 0 },
  { PROTO_ISO15765_29B_500K, "ISO15765 29bit 500k",                          false, false, false, 0 },
  { PROTO_ISO15765_11B_250K, "ISO15765 11bit 250k",                          false, false, false, 0 },
  { PROTO_ISO15765_29B_250K, "ISO15765 29bit 250k",                          false, false, false, 0 },
  { PROTO_AUTO,              "AUTO",                                          false, false, false, 0 },
  { PROTO_ISO11898_11B_500K, "raw CAN 11bit 500k",                            false, false, false, 0 },
  { PROTO_ISO11898_29B_500K, "raw CAN 29bit 500k",                            false, false, false, 0 },
  { PROTO_KWP2000_FAST,      "KWP2000 fast",                                  false, false, false, 0 },
  { PROTO_ISO_9141_2,        "ISO 9141-2",                                    false, false, false, 0 },
};
#define PROTO_COUNT (sizeof(g_protos) / sizeof(g_protos[0]))
static volatile bool g_probeRequested = false;
static volatile bool g_probeRunning = false;
static volatile int  g_probeIndex = -1;
static volatile bool g_probeDone = false;
static int g_probeWinner = -1;
// Auto-sweep: the device is in a car and the useful moment is whenever the
// engine happens to be running, which is exactly when nobody is holding a
// laptop. Run the sweep unprompted after init() has failed a few times with the
// engine clearly on, so the answer is already waiting to be read.
static uint8_t g_obdInitFails = 0;
static bool g_autoProbeDone = false;   // once per power session, not per minute
#define AUTO_PROBE_AFTER_FAILS 3

// Live sample handoff: written on core 0, copied on core 1 under a spinlock.
static portMUX_TYPE g_sampleMux = portMUX_INITIALIZER_UNLOCKED;
static Sample g_liveSample = {};
static bool g_haveLiveSample = false;
static bool g_gpsReady = false;
#endif

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
static bool g_otaActive = false;         // suppress standby mid-flash
// Temporary standby inhibit, for flashing or debugging a device that is parked.
// ALWAYS time-bounded and never persisted: an inhibit that outlived the session
// would silently reintroduce exactly the battery drain standby exists to stop.
static uint32_t g_standbyInhibitUntilMs = 0;
#define STANDBY_INHIBIT_MAX_MIN 30

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
  // The read itself happens on obdLinkTask (core 0) because every PID is a
  // blocking UART round trip; this only copies the latest result. Returning
  // false when there is nothing new keeps empty rows out of the trip file —
  // a trip of zeroes is worse than a short trip, because it looks like data.
  bool have = false;
  portENTER_CRITICAL(&g_sampleMux);
  if (g_haveLiveSample) { s = g_liveSample; g_haveLiveSample = false; have = true; }
  portEXIT_CRITICAL(&g_sampleMux);
  if (have) s.t = millis();
  return have;
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
// Read one table of PIDs, recording per-entry whether THIS car answered.
// Individually rather than via the batch readPID(): the batch form reports only
// how many succeeded, not which, and "which PIDs does this car support" is the
// entire question bring-up step 1 exists to answer.
static void probePids(PidProbe* table, size_t count) {
  for (size_t i = 0; i < count; i++) {
    int v = 0;
    table[i].tried = true;
    table[i].ok = obd.readPID(table[i].pid, v);
    if (table[i].ok) table[i].value = v;
  }
}

static int pidValue(const PidProbe* table, size_t count, byte pid, int fallback) {
  for (size_t i = 0; i < count; i++)
    if (table[i].pid == pid) return table[i].ok ? table[i].value : fallback;
  return fallback;
}

// Build one telemetry sample from the vehicle. Runs on core 0 only.
static void sampleVehicle() {
  probePids(g_hotPids, HOT_PID_COUNT);

  Sample s{};
  s.t = millis();
  s.speedKph = (int16_t)pidValue(g_hotPids, HOT_PID_COUNT, PID_SPEED, 0);
  s.rpm      = (int16_t)pidValue(g_hotPids, HOT_PID_COUNT, PID_RPM, 0);
  s.coolantC = (int16_t)pidValue(g_hotPids, HOT_PID_COUNT, PID_COOLANT_TEMP, 0);
  s.fuelPct  = (int8_t) pidValue(g_hotPids, HOT_PID_COUNT, PID_FUEL_LEVEL, -1);
  s.battV    = g_batteryV;

  if (g_gpsReady && sys.gpsGetData(&gpsData) && gpsData) {
    s.lat = gpsData->lat;
    s.lon = gpsData->lng;                 // NOTE: the struct field is `lng`
    // GPS_DATA.speed is KNOTS. Recording it as km/h would inflate every
    // GPS-derived speed by ~1.85x and silently corrupt trip distance.
    if (s.speedKph == 0 && gpsData->sat > 3)
      s.speedKph = (int16_t)(gpsData->speed * 1.852f);
  }

  portENTER_CRITICAL(&g_sampleMux);
  g_liveSample = s;
  g_haveLiveSample = true;
  portEXIT_CRITICAL(&g_sampleMux);
}

// Walk every protocol. "Linked" is not enough — init() can succeed while the
// ECU never answers a real request, so each candidate must also return a Mode 01
// PID before it counts. That distinction is the whole point of the sweep.
static void runProtocolProbe() {
  g_probeRunning = true;
  g_probeDone = false;
  g_probeWinner = -1;
  // Hold standby off for the duration from HERE, so both the manual and the
  // automatic entry points are covered. Bounded (10 min), so if the engine is
  // switched off mid-sweep the device still sleeps shortly after.
  g_standbyInhibitUntilMs = millis() + 10UL * 60000UL;
  relayLogLine("[probe] starting protocol sweep");

  for (size_t i = 0; i < PROTO_COUNT; i++) {
    g_probeIndex = (int)i;
    g_protos[i].tried = true;
    g_protos[i].linked = false;
    g_protos[i].pidOk = false;

    obd.uninit();
    delay(200);
    g_protos[i].linked = obd.init((OBD_PROTOCOLS)g_protos[i].proto);
    if (g_protos[i].linked) {
      int rpm = 0;
      g_protos[i].pidOk = obd.readPID(PID_RPM, rpm);
      g_protos[i].rpm = rpm;
      relayLogf("[probe] %s: linked, PID %s", g_protos[i].name,
                g_protos[i].pidOk ? "OK" : "no answer");
      if (g_protos[i].pidOk && g_probeWinner < 0) {
        g_probeWinner = (int)i;
        break;                      // first protocol that truly works wins
      }
    } else {
      relayLogf("[probe] %s: no link", g_protos[i].name);
    }
  }

  if (g_probeWinner >= 0) {
    // Leave the link established on the winner so normal sampling resumes.
    obd.uninit();
    delay(200);
    g_obdReady = obd.init((OBD_PROTOCOLS)g_protos[g_probeWinner].proto);
    g_dtcCount = -1;                // re-read diagnostics on the new link
    relayLogf("[probe] WINNER: %s", g_protos[g_probeWinner].name);
  } else {
    relayLogLine("[probe] no protocol linked — suspect FCA Security Gateway (SGW)");
  }
  g_probeIndex = -1;
  g_probeRunning = false;
  g_probeDone = true;
}

static void obdLinkTask(void*) {
  for (;;) {
    if (g_sysReady && g_probeRequested) {
      g_probeRequested = false;
      runProtocolProbe();
      continue;
    }
    if (g_sysReady) {
      // Voltage first, and unconditionally: it drives standby, so it must keep
      // updating even when the ECU link never comes up. ATRV goes to the
      // co-processor, not the ECU, so it answers with the ignition off.
#ifdef TEST_VOLT_FAULT
      float v = 0;   // simulate a co-processor that never answers (failsafe test)
#else
      float v = obd.getVoltage();
#endif
      if (v > 0) { g_batteryV = v; g_batteryAgeMs = millis(); }
      if (!g_obdReady) {
        if (obd.init()) {
          g_obdReady = true;
          g_obdInitFails = 0;
        } else if (++g_obdInitFails >= AUTO_PROBE_AFTER_FAILS
                   && !g_autoProbeDone
                   && g_batteryV >= STANDBY_ENGINE_OFF_V) {
          // Engine is clearly running (charging voltage) and plain init() keeps
          // failing — sweep now rather than waiting for someone to curl at the
          // right moment. Once per power session.
          g_autoProbeDone = true;
          relayLogLine("[probe] auto-starting after repeated init failures");
          runProtocolProbe();
        }
      }
    }

    if (g_obdReady) {
      // First read after the ECU link comes up: identity + diagnostics + DTCs.
      // Once per link rather than per sample — these barely move, and each one
      // is a UART round trip we do not want in the 1Hz path.
      if (g_dtcCount < 0) {
        if (!g_vin[0]) obd.getVIN(g_vin, sizeof(g_vin));
        probePids(g_diagPids, DIAG_PID_COUNT);
        int n = obd.readDTC(g_dtc, MAX_DTC);
        g_dtcCount = n < 0 ? 0 : n;
        relayLogf("[obd] linked — %d DTC(s), vin=%s", g_dtcCount, g_vin[0] ? g_vin : "n/a");
      }
      sampleVehicle();
      vTaskDelay(pdMS_TO_TICKS(1000 / SAMPLE_HZ));
    } else {
      // No ECU: keep the voltage poll alive (standby depends on it) but do not
      // hammer init(); each attempt blocks for seconds.
      g_dtcCount = -1;              // re-read diagnostics when the link returns
      vTaskDelay(pdMS_TO_TICKS(5000));
    }
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

#ifdef USE_FREEMATICS
// GET /pids — which PIDs THIS car actually answers, measured.
// This is the instrument for bring-up step 1. Everything downstream (what a
// diagnostics view can show, whether odometer is even reachable) follows from
// what this returns, and nothing should be assumed before it has been run with
// the ignition on.
static void addPidTable(JsonArray arr, const PidProbe* table, size_t count, const char* group) {
  for (size_t i = 0; i < count; i++) {
    JsonObject o = arr.add<JsonObject>();
    char hex[8]; snprintf(hex, sizeof(hex), "0x%02X", table[i].pid);
    o["pid"] = hex;
    o["name"] = table[i].name;
    o["group"] = group;
    if (table[i].unit[0]) o["unit"] = table[i].unit;
    o["tried"] = table[i].tried;
    o["supported"] = table[i].ok;
    if (table[i].ok) o["value"] = table[i].value;
  }
}

static void handlePids() {
  JsonDocument doc;
  doc["device"] = "obd-relay";
  doc["vehicle"] = VEHICLE_ID;
  doc["ecu_linked"] = g_obdReady;
  if (!g_obdReady) {
    // Say so loudly: an all-false table with no ECU link would read as "this car
    // supports nothing", which is a very different conclusion.
    doc["note"] = "No ECU link — results are meaningless until obd_ready is true "
                  "(ignition fully on).";
  }
  if (g_vin[0]) doc["vin"] = g_vin;
  JsonArray arr = doc["pids"].to<JsonArray>();
  addPidTable(arr, g_hotPids, HOT_PID_COUNT, "hot");
  addPidTable(arr, g_diagPids, DIAG_PID_COUNT, "diagnostic");
  String out; serializeJsonPretty(doc, out);
  http.send(200, "application/json", out);
}

// GET /obd/probe        → current sweep state / results
// GET /obd/probe?start=1 → kick off a sweep (runs on core 0, poll for results)
static void handleObdProbe() {
  if (http.hasArg("start")) {
    if (!g_probeRunning) {
      // A sweep is many blocking init() calls; hold standby off so it can't be
      // cut in half, and clear any stale engine-off timer.
      g_standbyInhibitUntilMs = millis() + 10UL * 60000UL;
      g_engineOffSinceMs = 0;
      g_probeRequested = true;
    }
  }
  JsonDocument doc;
  doc["device"] = "obd-relay";
  doc["running"] = g_probeRunning;
  doc["done"] = g_probeDone;
  doc["ecu_linked"] = g_obdReady;
  doc["battery_v"] = g_batteryV;
  if (g_probeIndex >= 0 && g_probeIndex < (int)PROTO_COUNT)
    doc["testing"] = g_protos[g_probeIndex].name;
  if (g_probeWinner >= 0) doc["winner"] = g_protos[g_probeWinner].name;
  else if (g_probeDone)
    doc["conclusion"] = "No protocol linked while ATRV works — the OBD hardware "
                        "path is alive, so suspect the FCA Security Gateway "
                        "(SGW) fitted to 2018+ vehicles, or ignition not in RUN.";
  JsonArray arr = doc["protocols"].to<JsonArray>();
  for (size_t i = 0; i < PROTO_COUNT; i++) {
    JsonObject o = arr.add<JsonObject>();
    char hex[8]; snprintf(hex, sizeof(hex), "0x%X", g_protos[i].proto);
    o["proto"] = hex;
    o["name"] = g_protos[i].name;
    o["tried"] = g_protos[i].tried;
    o["linked"] = g_protos[i].linked;
    // linked-but-no-PID is the interesting failure: negotiation succeeded and
    // the ECU still said nothing.
    o["pid_answered"] = g_protos[i].pidOk;
    if (g_protos[i].pidOk) o["rpm"] = g_protos[i].rpm;
  }
  String out; serializeJsonPretty(doc, out);
  http.send(200, "application/json", out);
}

// GET /diagnostics — current vehicle state rather than a time series:
// check-engine codes plus the slow-moving PIDs.
static void handleDiagnostics() {
  JsonDocument doc;
  doc["device"] = "obd-relay";
  doc["vehicle"] = VEHICLE_ID;
  doc["ecu_linked"] = g_obdReady;
  doc["ts"] = epochMs();
  if (g_vin[0]) doc["vin"] = g_vin;
  doc["battery_v"] = g_batteryV;

  JsonObject mil = doc["check_engine"].to<JsonObject>();
  mil["read"] = (g_dtcCount >= 0);
  mil["count"] = g_dtcCount < 0 ? 0 : g_dtcCount;
  JsonArray codes = mil["codes"].to<JsonArray>();
  for (int i = 0; i < g_dtcCount && i < MAX_DTC; i++) {
    // DTCs come back packed; render as the familiar P/C/B/U + 4 hex digits.
    const char sys[] = {'P','C','B','U'};
    char buf[8];
    snprintf(buf, sizeof(buf), "%c%04X", sys[(g_dtc[i] >> 14) & 0x3], g_dtc[i] & 0x3FFF);
    codes.add(buf);
  }

  JsonObject vals = doc["readings"].to<JsonObject>();
  for (size_t i = 0; i < DIAG_PID_COUNT; i++) {
    if (!g_diagPids[i].ok) continue;     // omit rather than report a fake 0
    JsonObject o = vals[g_diagPids[i].name].to<JsonObject>();
    o["value"] = g_diagPids[i].value;
    if (g_diagPids[i].unit[0]) o["unit"] = g_diagPids[i].unit;
  }
  JsonArray unsup = doc["unsupported"].to<JsonArray>();
  for (size_t i = 0; i < DIAG_PID_COUNT; i++)
    if (g_diagPids[i].tried && !g_diagPids[i].ok) unsup.add(g_diagPids[i].name);

  // Named explicitly so their absence is not mistaken for "not fitted".
  doc["not_available_via_obd2"] = "oil life and tyre pressure (TPMS) are not "
                                  "standard OBD-II; they are manufacturer-specific";

  String out; serializeJsonPretty(doc, out);
  http.send(200, "application/json", out);
}
#endif

// ---- OTA -------------------------------------------------------------------
// This device lives inside a car. Every firmware change so far has meant pulling
// it out of the OBD port and carrying it to a USB cable, which is why standby
// nearly shipped without a failsafe. Flash over WiFi instead:
//
//   curl -F "firmware=@.pio/build/freematics-oneplus-b/firmware.bin" \
//        http://<device-ip>/update
//
// Requires the two 2MB OTA slots in partitions_16mb_trips.csv (app0/app1).
// LIMITATION: the device is deep-asleep most of the time when parked, so OTA
// only lands while it is awake — engine running, or the ~3min window after
// switch-off. It is not a way to reach a car parked for a week.
static void handleUpdateResult() {
  bool ok = !Update.hasError();
  http.sendHeader("Connection", "close");
  http.send(ok ? 200 : 500, "application/json",
            ok ? "{\"ok\":true,\"rebooting\":true}" : "{\"ok\":false}");
  if (ok) { delay(250); ESP.restart(); }
  g_otaActive = false;
}

static void handleUpdateUpload() {
  HTTPUpload& up = http.upload();
  if (up.status == UPLOAD_FILE_START) {
    g_otaActive = true;                 // do not let standby fire mid-flash
    relayLogf("[ota] start %s", up.filename.c_str());
    if (!Update.begin(UPDATE_SIZE_UNKNOWN)) relayLogf("[ota] begin failed: %s", Update.errorString());
  } else if (up.status == UPLOAD_FILE_WRITE) {
    if (Update.write(up.buf, up.currentSize) != up.currentSize)
      relayLogf("[ota] write failed: %s", Update.errorString());
  } else if (up.status == UPLOAD_FILE_END) {
    if (Update.end(true)) relayLogf("[ota] ok, %u bytes — rebooting", (unsigned)up.totalSize);
    else relayLogf("[ota] end failed: %s", Update.errorString());
  } else if (up.status == UPLOAD_FILE_ABORTED) {
    Update.abort();
    g_otaActive = false;
    relayLogLine("[ota] aborted");
  }
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
  doc["ota"] = g_otaActive ? "in-progress" : "ready";   // POST firmware to /update
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
  sb["volt_fault_s"] = STANDBY_VOLT_FAULT_S;
  sb["engine_off_for_s"] = g_engineOffSinceMs
    ? (uint32_t)((millis() - g_engineOffSinceMs) / 1000) : 0;
  bool inh = g_standbyInhibitUntilMs && (int32_t)(g_standbyInhibitUntilMs - millis()) > 0;
  sb["inhibited"] = inh;
  if (inh) sb["inhibit_remaining_s"] = (uint32_t)((g_standbyInhibitUntilMs - millis()) / 1000);
  sb["gps_ready"] = g_gpsReady;
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
    // GNSS. gpsBeginExt() is the external-antenna path the vendor tries first,
    // falling back to the internal receiver. Failure is not fatal — trips still
    // log PIDs without a fix, and time-to-first-fix under a dash is its own
    // bring-up question (step 2).
    g_gpsReady = sys.gpsBeginExt() || sys.gpsBegin();
    relayLogf("[gps] %s", g_gpsReady ? "started" : "unavailable");

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
  http.on("/update", HTTP_POST, handleUpdateResult, handleUpdateUpload);  // OTA
#ifdef USE_FREEMATICS
  http.on("/obd/probe", handleObdProbe);    // walk protocols, find what links
  http.on("/pids", handlePids);              // which PIDs this car answers
  http.on("/diagnostics", handleDiagnostics); // check-engine + slow-moving state
  // Hold standby off long enough to flash or inspect a parked device. Bounded
  // hard at STANDBY_INHIBIT_MAX_MIN so a forgotten inhibit cannot drain the car.
  http.on("/standby/inhibit", [](){
    long mins = http.hasArg("minutes") ? http.arg("minutes").toInt() : 10;
    if (mins < 1) mins = 1;
    if (mins > STANDBY_INHIBIT_MAX_MIN) mins = STANDBY_INHIBIT_MAX_MIN;
    g_standbyInhibitUntilMs = millis() + (uint32_t)mins * 60000UL;
    g_engineOffSinceMs = 0;
    relayLogf("[standby] inhibited for %ld min", mins);
    JsonDocument d; d["ok"] = true; d["minutes"] = mins; d["max_minutes"] = STANDBY_INHIBIT_MAX_MIN;
    String out; serializeJson(d, out);
    http.send(200, "application/json", out);
  });
  http.on("/standby/release", [](){
    g_standbyInhibitUntilMs = 0;
    relayLogLine("[standby] inhibit released");
    http.send(200, "application/json", "{\"ok\":true}");
  });
#endif
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
  bool inhibited = g_standbyInhibitUntilMs && (int32_t)(g_standbyInhibitUntilMs - millis()) > 0;
  if (inhibited && g_engineOffSinceMs) g_engineOffSinceMs = millis();  // don't bank time while held
  if (!g_otaActive && !inhibited) {
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
    // Failsafe: no readable voltage for STANDBY_VOLT_FAULT_S. Without this the
    // device would stay awake indefinitely on a co-processor fault, which is the
    // exact battery drain standby exists to prevent.
    uint32_t lastOk = g_batteryAgeMs ? g_batteryAgeMs : g_bootMs;
    if (millis() - lastOk > (uint32_t)STANDBY_VOLT_FAULT_S * 1000) {
      enterStandby("voltage unreadable");
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

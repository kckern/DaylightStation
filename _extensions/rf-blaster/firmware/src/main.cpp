// rf-blaster — M5Stack ATOM Lite (ESP32-PICO-D4)
//
// A config-driven 433 MHz OOK transmitter that can also LEARN a remote.
//
// Named codes (disco_on, disco_off, …) live in the household SSOT as raw
// microsecond mark/space timings and are replayed on a cheap 433 MHz TX module.
// This is the sibling of ../../ir-blaster and deliberately mirrors its shape:
// same SSOT-driven config, same HTTP surface, same status-LED vocabulary.
//
//   GET /                  → JSON: id, ip, uptime, pins, code names
//   GET /health            → same, for liveness checks
//   GET /send?code=NAME    → transmit the named code; JSON {ok, code}
//   GET /learn?ms=8000     → listen, isolate a repeating frame, return timings
//
// WHY RMT AND NOT BIT-BANGING
// The obvious implementation is digitalWrite + delayMicroseconds. It mostly
// works and it is what rc-switch does. But this board also runs Wi-Fi and an
// HTTP server, and their interrupts land in the middle of a frame, stretching
// individual pulses by tens of microseconds. A receiver decoding 350 µs bit
// cells tolerates some of that and then abruptly does not. The ESP32's RMT
// peripheral clocks the whole frame out in hardware, so Wi-Fi jitter cannot
// reach it. Carrier generation is DISABLED — that is the difference between
// this and ir-blaster, which uses the same peripheral with a 38 kHz carrier
// switched on. Baseband on/off keying is what EV1527/PT2262-class remotes speak.
//
// WHY NOT rc-switch
// rc-switch decodes to a protocol number plus an integer, and silently declines
// anything outside its table. Raw timings replay whatever the remote actually
// sent, including protocols nobody has named. The cost is that the config is a
// list of numbers rather than a tidy code — see ../LEARNING.md.
//
// !! UNTESTED ON HARDWARE. Written before the 433 MHz modules arrived; every
// !! timing constant below is reasoned from datasheets, not measured. Do not
// !! trust it until it has driven a real remote. See ../README.md "Status".

#include <Arduino.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include <FastLED.h>
#include "driver/rmt.h"
#include "config.h"

// ---- onboard RGB status LED (SK6812 on GPIO27) --------------------------
#define LED_PIN 27
static CRGB led[1];
// STATUS_LED == 0 forces the onboard RGB dark in every state.
static void setLed(const CRGB& c) { led[0] = STATUS_LED ? c : CRGB::Black; FastLED.show(); }

// ---- limits -------------------------------------------------------------
// A 24-bit EV1527 frame is ~50 timings; generous headroom for chattier remotes.
#define MAX_FLAT    768   // (level,duration) pairs after long-gap splitting
#define MAX_ITEMS   384   // RMT items = ceil(MAX_FLAT / 2)
#define RMT_CH      RMT_CHANNEL_0
// RMT duration fields are 15 bits (max 32767 µs). Split anything longer.
#define RMT_MAX_US  30000

static WebServer server(80);
static volatile uint32_t g_sendCount = 0;
static char g_lastCode[24] = "";

// =============================================================================
// Transmit
// =============================================================================
static rmt_item32_t g_items[MAX_ITEMS];

// Expand alternating mark/space timings into RMT items, splitting any duration
// that overflows the peripheral's 15-bit field. Returns item count.
static size_t packItems(const uint16_t* timings, uint16_t n) {
  static uint8_t  lvl[MAX_FLAT];
  static uint16_t dur[MAX_FLAT];
  size_t f = 0;
  for (uint16_t i = 0; i < n && f < MAX_FLAT; i++) {
    if (timings[i] == 0) continue;
    const uint8_t level = (i % 2 == 0) ? 1 : 0;   // even index = mark (carrier on)
    uint32_t remaining = timings[i];
    while (remaining > 0 && f < MAX_FLAT) {
      const uint16_t chunk = remaining > RMT_MAX_US ? RMT_MAX_US : (uint16_t)remaining;
      lvl[f] = level; dur[f] = chunk; f++;
      remaining -= chunk;
    }
  }
  size_t items = 0;
  for (size_t i = 0; i < f && items < MAX_ITEMS; i += 2) {
    g_items[items].level0    = lvl[i];
    g_items[items].duration0 = dur[i];
    if (i + 1 < f) { g_items[items].level1 = lvl[i + 1]; g_items[items].duration1 = dur[i + 1]; }
    else           { g_items[items].level1 = 0;          g_items[items].duration1 = 0; }
    items++;
  }
  return items;
}

// delayMicroseconds is only reliable for short waits; inter-frame gaps are often
// 10 ms+. Split across delay()/delayMicroseconds() so both stay in their range.
static void waitUs(uint32_t us) {
  if (us >= 16000) { delay(us / 1000); us %= 1000; }
  if (us) delayMicroseconds(us);
}

static const RfCode* findCode(const String& name) {
  for (int i = 0; i < RF_CODE_COUNT; i++) {
    if (name.equals(RF_CODES[i].name)) return &RF_CODES[i];
  }
  return nullptr;
}

// Real remotes send a frame several times per button press; a receiver often
// requires two identical frames before it acts. `repeats` comes from the SSOT.
static bool blast(const RfCode* code, uint16_t repeatsOverride) {
  if (!code || code->len < 2) return false;
  const size_t items = packItems(code->data, code->len);
  if (!items) return false;

  const uint16_t repeats = repeatsOverride ? repeatsOverride : code->repeats;
  setLed(CRGB::Blue);
  for (uint16_t r = 0; r < repeats; r++) {
    rmt_write_items(RMT_CH, g_items, items, true /* wait for done */);
    if (r + 1 < repeats && code->gap_us) waitUs(code->gap_us);
  }
  strncpy(g_lastCode, code->name, sizeof(g_lastCode) - 1);
  g_sendCount++;
  Serial.printf("[rf] sent '%s' (%u timings, %u items, x%u)\n",
                code->name, code->len, (unsigned)items, repeats);
  return true;
}

// =============================================================================
// Learn — capture from the 433 MHz receiver and isolate one repeating frame
// =============================================================================
// A superheterodyne receiver with no transmitter in range outputs a continuous
// stream of noise, so the buffer is CIRCULAR: it keeps overwriting until the
// window closes, which means a button pressed at any point during the window
// survives. Pulses shorter than NOISE_FLOOR_US are dropped in the ISR — real
// OOK bit cells are hundreds of microseconds, and letting noise through fills
// the buffer before the button is ever pressed.
#define CAP_MAX          2048
#define NOISE_FLOOR_US   80
#define MIN_FRAME_PULSES 16

static volatile uint32_t g_capDur[CAP_MAX];
static volatile uint8_t  g_capLvlAfter[CAP_MAX];   // pin level AFTER this edge
static volatile uint32_t g_capTotal = 0;           // total edges (may exceed CAP_MAX)
static volatile uint32_t g_capLast  = 0;
static volatile bool     g_capOn    = false;

static void IRAM_ATTR rxIsr() {
  if (!g_capOn) return;
  const uint32_t now = micros();
  const uint32_t d   = now - g_capLast;
  if (d < NOISE_FLOOR_US) return;                  // ignore, do NOT advance g_capLast
  g_capLast = now;
  const uint32_t idx = g_capTotal % CAP_MAX;
  g_capDur[idx]      = d;
  g_capLvlAfter[idx] = (uint8_t)digitalRead(RF_RX_PIN);
  g_capTotal++;
}

// Chronological read of the circular buffer.
static uint32_t capCount() { return g_capTotal < CAP_MAX ? g_capTotal : CAP_MAX; }
static uint32_t capAt(uint32_t i, uint8_t* levelAfter) {
  const uint32_t base = g_capTotal < CAP_MAX ? 0 : (g_capTotal % CAP_MAX);
  const uint32_t idx  = (base + i) % CAP_MAX;
  if (levelAfter) *levelAfter = g_capLvlAfter[idx];
  return g_capDur[idx];
}

struct Segment { uint32_t start; uint16_t len; };

// Split the capture on long LOW gaps (the silence between frame repeats), then
// return the frame length that occurred most often. Requiring a repeat is the
// whole noise filter: random RF hash does not produce the same pulse count twice.
static bool analyseCapture(Segment* best, uint16_t* segCount, bool* repeated) {
  const uint32_t n = capCount();
  *segCount = 0; *repeated = false;
  if (n < MIN_FRAME_PULSES) return false;

  static Segment segs[64];
  uint16_t ns = 0;
  uint32_t start = 1;                              // entry 0 is a partial pulse
  for (uint32_t i = 1; i < n && ns < 64; i++) {
    uint8_t lvlAfter = 0;
    const uint32_t d = capAt(i, &lvlAfter);
    // A long pulse that ends with the line going HIGH was a LOW gap: frame boundary.
    if (d >= RF_SYNC_GAP_US && lvlAfter == 1) {
      if (i > start && (i - start) >= MIN_FRAME_PULSES) {
        segs[ns].start = start;
        segs[ns].len   = (uint16_t)min<uint32_t>(i - start, RF_MAX_TIMINGS);
        ns++;
      }
      start = i + 1;
    }
  }
  *segCount = ns;
  if (!ns) return false;

  // Most frequent length wins; ties break toward the longer frame.
  uint16_t bestLen = 0, bestCount = 0;
  for (uint16_t a = 0; a < ns; a++) {
    uint16_t c = 0;
    for (uint16_t b = 0; b < ns; b++) if (segs[b].len == segs[a].len) c++;
    if (c > bestCount || (c == bestCount && segs[a].len > bestLen)) { bestCount = c; bestLen = segs[a].len; }
  }
  for (uint16_t a = 0; a < ns; a++) {
    if (segs[a].len == bestLen) { *best = segs[a]; break; }
  }
  *repeated = bestCount >= 2;
  return true;
}

static void handleLearn() {
  uint32_t windowMs = server.hasArg("ms") ? server.arg("ms").toInt() : 8000;
  windowMs = constrain(windowMs, 1000UL, 30000UL);

  g_capTotal = 0;
  g_capLast  = micros();
  g_capOn    = true;
  attachInterrupt(digitalPinToInterrupt(RF_RX_PIN), rxIsr, CHANGE);
  setLed(CRGB::Yellow);

  const uint32_t t0 = millis();
  while (millis() - t0 < windowMs) { delay(10); }

  detachInterrupt(digitalPinToInterrupt(RF_RX_PIN));
  g_capOn = false;

  Segment best = {0, 0};
  uint16_t segCount = 0;
  bool repeated = false;
  const bool found = analyseCapture(&best, &segCount, &repeated);

  JsonDocument doc;
  doc["ok"]             = found;
  doc["window_ms"]      = windowMs;
  doc["edges_captured"] = (uint32_t)g_capTotal;
  doc["edges_kept"]     = capCount();
  doc["overflowed"]     = g_capTotal > CAP_MAX;
  doc["frames_seen"]    = segCount;
  doc["repeated"]       = repeated;

  if (!found) {
    doc["error"] = segCount ? "no frame long enough" : "no frame boundary found";
    doc["hint"]  = "hold the remote closer, press repeatedly, or lower sync_gap_us";
  } else {
    // Emit starting on a MARK so timings[0] is always carrier-on, matching what
    // packItems() replays. If the first entry is a space, drop it.
    uint32_t s = best.start; uint16_t len = best.len;
    uint8_t lvlAfter = 0;
    capAt(s, &lvlAfter);
    if (lvlAfter == 1) { s++; if (len) len--; }   // ended going HIGH ⇒ it was a space
    doc["pulse_count"] = len;
    JsonArray t = doc["timings"].to<JsonArray>();
    for (uint16_t i = 0; i < len; i++) t.add((uint32_t)capAt(s + i, nullptr));
    if (!repeated) doc["warning"] = "frame seen only once — may be noise; press again to confirm";
  }

  String out; serializeJson(doc, out);
  server.send(found ? 200 : 404, "application/json", out);
  Serial.printf("[learn] %ums edges=%u frames=%u repeated=%d\n",
                windowMs, (unsigned)g_capTotal, segCount, (int)repeated);
}

// =============================================================================
// HTTP
// =============================================================================
static void writeStatusJson(JsonDocument& doc) {
  doc["id"]        = BLASTER_ID;
  doc["ip"]        = WiFi.localIP().toString();
  doc["uptime_ms"] = (uint32_t)millis();
  doc["sends"]     = g_sendCount;
  doc["last_code"] = g_lastCode;
  doc["free_heap"] = ESP.getFreeHeap();
  JsonObject pins  = doc["pins"].to<JsonObject>();
  pins["tx"]       = RF_TX_PIN;
  pins["rx"]       = RF_RX_PIN;
  JsonArray codes  = doc["codes"].to<JsonArray>();
  for (int i = 0; i < RF_CODE_COUNT; i++) codes.add(RF_CODES[i].name);
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
  const RfCode* code = findCode(name);
  if (!code) {
    doc["ok"] = false; doc["error"] = "unknown code"; doc["code"] = name;
    JsonArray codes = doc["available"].to<JsonArray>();
    for (int i = 0; i < RF_CODE_COUNT; i++) codes.add(RF_CODES[i].name);
    String out; serializeJson(doc, out);
    server.send(404, "application/json", out);
    return;
  }
  const uint16_t rep = server.hasArg("repeats") ? (uint16_t)server.arg("repeats").toInt() : 0;
  const bool ok = blast(code, rep);
  doc["ok"] = ok; doc["code"] = name; doc["id"] = BLASTER_ID;
  String out; serializeJson(doc, out);
  server.send(ok ? 200 : 500, "application/json", out);
}

// ---- status LED ---------------------------------------------------------
// green: wifi up, idle · red: no wifi · blue: sending · yellow: learning.
static void updateLed() {
  if (WiFi.status() != WL_CONNECTED) setLed(CRGB(40, 0, 0));  // red
  else                               setLed(CRGB(0, 30, 0));  // green
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.printf("\n[rf-blaster] boot id=%s codes=%d tx=%d rx=%d\n",
                BLASTER_ID, RF_CODE_COUNT, RF_TX_PIN, RF_RX_PIN);

  FastLED.addLeds<SK6812, LED_PIN, GRB>(led, 1);
  FastLED.setBrightness(60);
  setLed(CRGB(40, 0, 0));

  pinMode(RF_RX_PIN, INPUT);

  // RMT: 80 MHz APB / 80 = 1 MHz, so one tick is exactly one microsecond and the
  // SSOT's timings need no scaling. Carrier off = baseband OOK.
  rmt_config_t rc = {};
  rc.rmt_mode                  = RMT_MODE_TX;
  rc.channel                   = RMT_CH;
  rc.gpio_num                  = (gpio_num_t)RF_TX_PIN;
  rc.mem_block_num             = 1;
  rc.clk_div                   = 80;
  rc.tx_config.loop_en         = false;
  rc.tx_config.carrier_en      = false;
  rc.tx_config.idle_output_en  = true;
  rc.tx_config.idle_level      = RMT_IDLE_LEVEL_LOW;
  ESP_ERROR_CHECK(rmt_config(&rc));
  ESP_ERROR_CHECK(rmt_driver_install(rc.channel, 0, 0));

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("[wifi] connecting to %s", WIFI_SSID);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) { delay(300); Serial.print("."); }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[wifi] %s\n", WiFi.localIP().toString().c_str());
    String host = String("rf-") + BLASTER_ID;
    if (MDNS.begin(host.c_str())) { MDNS.addService("http", "tcp", 80); Serial.printf("[mdns] http://%s.local\n", host.c_str()); }
  } else {
    Serial.println("\n[wifi] FAILED (will retry in loop)");
  }

  server.on("/", handleStatus);
  server.on("/health", handleStatus);
  server.on("/send", handleSend);
  server.on("/learn", handleLearn);
  server.onNotFound([]() { server.send(404, "application/json", "{\"ok\":false,\"error\":\"not found\"}"); });
  server.begin();
  Serial.println("[http] listening on :80  (GET /send?code=NAME · GET /learn?ms=8000)");

  updateLed();
}

void loop() {
  server.handleClient();

  static uint32_t lastWifiTry = 0;
  if (WiFi.status() != WL_CONNECTED && millis() - lastWifiTry > 10000) {
    lastWifiTry = millis();
    WiFi.disconnect(); WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  }

  static uint32_t lastLed = 0;
  if (millis() - lastLed > 150) { lastLed = millis(); updateLed(); }
}

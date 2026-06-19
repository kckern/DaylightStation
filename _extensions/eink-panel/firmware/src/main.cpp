// =============================================================================
// DaylightStation e-paper panel firmware — Seeed reTerminal E1003 (IT8951 Gray16)
// =============================================================================
// Fully local. The panel is a "remote control for your own server":
//   wake (button or timer) -> WiFi -> [optional action GET] -> GET /config ->
//   compare image_hash to the cached one; ONLY if it changed: GET PNG ->
//   decode to luma -> Floyd-Steinberg dither to Gray16 -> push to panel -> sleep.
//
// Change detection lives on /config, not /panel. /config is a CHEAP key=value
// snapshot of the server's now-state: rotation, button map, next_wake cadence,
// and an `image_hash` fingerprint of every pixel-affecting input. Most wakes the
// hash is unchanged, so the panel skips the expensive PNG download AND the ~3s
// e-ink refresh and goes straight back to sleep — that's what makes a short poll
// interval viable on battery.
//
// PNG decode uses pngle (vendored into lib/seeed/ by tools/fetch-deps.mjs). The
// dither + 4bpp packing are done here, 1 byte/pixel, because the full RGB888
// buffer Seeed's dither_image needs (~7.9MB) doesn't fit beside the 1.32MB
// Gray16 sprite in 8MB PSRAM. The endpoint just serves a normal PNG.
//
// Config (Wi-Fi, host, panel id, buttons) is generated into include/config.h
// from the household SSOT (screens/kitchen-eink.yml) — never hardcoded here.
// =============================================================================
#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <esp_sleep.h>
#include <driver/rtc_io.h>

#include "TFT_eSPI.h"      // Seeed_GFX; EPaper class appears when EPAPER_ENABLE is set
#include "pngle.h"         // lib/seeed — streaming PNG decoder
#include "config.h"        // generated, gitignored

#ifndef EPAPER_ENABLE
#error "Panel setup not loaded — check platformio.ini build_flags -DBOARD_SCREEN_COMBO=522"
#endif

static EPaper epaper;
// The reTerminal's USB-serial (CH340) is wired to UART on GPIO44(RX)/43(TX).
// `Serial` (USB CDC) is dark unless CDC-on-boot; Seeed logs via Serial1 here.
#define LOG Serial1
static constexpr int PIN_DBG_RX = 44;
static constexpr int PIN_DBG_TX = 43;

// ---- decode target (filled by the pngle callback) --------------------------
// We store ONE luma byte per pixel (W*H), not RGB888 (W*H*3): the full-res RGB
// buffer (~7.9MB) does not fit alongside the 1.32MB Gray16 sprite in 8MB PSRAM.
static uint8_t* g_gray = nullptr;
static int      g_w = 0, g_h = 0;

// Content fingerprint of the image currently drawn on the panel. /config returns
// `image_hash` (server's SHA-1 of every pixel-affecting input); we render only
// when it differs from this, then store the new one. Held in RTC slow memory so
// it survives deep sleep; a cold power-cut zeroes it, so the first wake after
// that always renders and self-heals. SHA-1 hex is 40 chars; 48 leaves room for
// the NUL. The server's value for THIS wake is captured (RAM) in g_serverHash.
RTC_DATA_ATTR static char g_imgHash[48] = { 0 };   // last-rendered (survives sleep)
static char g_serverHash[48] = { 0 };              // advertised by /config this wake
static char g_imagePath[96]  = { 0 };              // server-supplied PNG path (relative)

// ---- runtime config (fetched from the server, cached in RTC) ----------------
// Only the bootstrap (Wi-Fi/host/port/id) is compiled in (config.h). Everything
// that might change — panel rotation, the button->action map, sleep cadence — is
// fetched each wake from GET /config (rotation, btn_*, next_wake, image_hash), so
// changing it is a SSOT edit + redeploy, never a reflash. Values live in RTC so a
// timer wake reuses the last config without re-fetching if the server is briefly
// down; a cold power-cut zeroes them and we fall back to the safety defaults.
//
// Button GPIOs are hardware-class (fixed on the E1003), so they stay compiled in.
static constexpr int BTN_GREEN_GPIO = 3;
static constexpr int BTN_RIGHT_GPIO = 4;
static constexpr int BTN_LEFT_GPIO  = 5;
// Inert safety fallbacks — used ONLY on a cold boot when /config is unreachable.
static constexpr int      DEF_ROTATION   = 0;        // landscape
static constexpr uint32_t FALLBACK_SLEEP = 30 * 60;  // 30 min, matches server default

RTC_DATA_ATTR static bool     g_haveConfig = false;
RTC_DATA_ATTR static int      g_rotation   = DEF_ROTATION;
RTC_DATA_ATTR static char     g_actGreen[16] = "select";
RTC_DATA_ATTR static char     g_actRight[16] = "next";
RTC_DATA_ATTR static char     g_actLeft[16]  = "prev";
// Server-driven sleep cadence (seconds). 0 until the first /panel header arrives.
RTC_DATA_ATTR static uint32_t g_nextWakeSec = 0;

static void on_draw(pngle_t* p, uint32_t x, uint32_t y, uint32_t w, uint32_t h, const uint8_t rgba[4]) {
  if (!g_gray) {
    g_w = (int)pngle_get_width(p);
    g_h = (int)pngle_get_height(p);
    g_gray = (uint8_t*)ps_malloc((size_t)g_w * g_h);   // ~2.6MB for 1872x1404
    if (!g_gray) { LOG.println("[eink] OOM gray"); return; }
  }
  // Rec.601 luma; alpha ignored (server renders opaque).
  const uint8_t luma = (uint8_t)((rgba[0] * 77 + rgba[1] * 150 + rgba[2] * 29) >> 8);
  for (uint32_t dy = 0; dy < h; ++dy) {
    for (uint32_t dx = 0; dx < w; ++dx) {
      const int px = (int)(x + dx), py = (int)(y + dy);
      if (px < 0 || py < 0 || px >= g_w || py >= g_h) continue;
      g_gray[(size_t)py * g_w + px] = luma;
    }
  }
}

// Floyd-Steinberg dither luma (0..255) -> 16 gray levels (index 0=black..15=white),
// in place: g[i] becomes the 4-bit index. Error diffuses only to not-yet-quantized
// neighbors (j > i), so the buffer safely holds a mix of luma and indices.
static void ditherGray16InPlace(uint8_t* g, int W, int H) {
  for (int y = 0; y < H; ++y) {
    for (int x = 0; x < W; ++x) {
      const size_t i = (size_t)y * W + x;
      const int oldv = g[i];
      const int idx  = (oldv * 15 + 127) / 255;       // nearest of 16 levels
      const int err  = oldv - (idx * 255 / 15);
      g[i] = (uint8_t)idx;
      auto diffuse = [&](int xx, int yy, int num) {
        if (xx < 0 || xx >= W || yy < 0 || yy >= H) return;
        const size_t j = (size_t)yy * W + xx;
        if (j <= i) return;                            // already quantized
        int v = g[j] + (err * num) / 16;
        g[j] = (uint8_t)(v < 0 ? 0 : v > 255 ? 255 : v);
      };
      diffuse(x + 1, y,     7);
      diffuse(x - 1, y + 1, 3);
      diffuse(x,     y + 1, 5);
      diffuse(x + 1, y + 1, 1);
    }
  }
}

// Seeed's 4bpp packer (verbatim from reTerminal_E1003_SDcard_Gray16.ino).
static void pack_4bpp_in_place(uint8_t* idx, int W, int H) {
  for (int y = 0; y < H; ++y) {
    const uint8_t* src = idx + (size_t)y * W;
    uint8_t* dst       = idx + (size_t)y * (W / 2);
    for (int x = 0; x < W; x += 2) {
      const uint8_t a = src[x]     & 0xF;
      const uint8_t b = src[x + 1] & 0xF;
      dst[x >> 1] = (uint8_t)((a << 4) | b);
    }
  }
}

static String urlHost()   { return String("http://") + DS_HOST + ":" + DS_PORT; }
// Panel id is a path segment (matches the v1 API convention, not a ?id= query).
static String urlBase()   { return urlHost() + "/api/v1/eink/" + PANEL_ID; }
static String urlConfig() { return urlBase() + "/config"; }
static String urlPanel()  { return urlBase() + "/panel"; }
static String urlAction(const char* a) { return urlBase() + "/action/" + a; }
// Prefer the PNG path /config advertised (an absolute /api/... path the server
// controls), prefixed with host:port; fall back to the compiled default.
static String urlPanelResolved() { return g_imagePath[0] ? (urlHost() + g_imagePath) : urlPanel(); }

static bool wifiUp() {
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) delay(100);
  return WiFi.status() == WL_CONNECTED;
}

// Copy a value into a fixed char buffer (trim + bound; ignore empties so a blank
// server value never blanks the cached field). cap = sizeof(dst).
static void setField(char* dst, size_t cap, const String& v) {
  String s = v; s.trim();
  if (!s.length() || s.length() >= cap) return;
  strncpy(dst, s.c_str(), cap - 1); dst[cap - 1] = '\0';
}

// Fetch the state snapshot from /config and apply it. The body is lib-free
// `key=value` lines (text/plain) so we need no JSON parser:
//   rotation, btn_green/right/left   -> runtime config (cached in RTC)
//   next_wake                        -> server-driven sleep cadence (seconds)
//   image                            -> PNG path to pull when the hash changed
//   image_hash                       -> content fingerprint we diff against cache
// Returns true if a snapshot was applied; on any failure the caller keeps the
// RTC-cached config (or compiled safety defaults on a cold boot) and, crucially,
// will NOT render (g_serverHash stays empty -> no false "changed").
static bool fetchConfig() {
  HTTPClient http; WiFiClient c;
  if (!http.begin(c, urlConfig())) { LOG.println("[eink] config begin fail"); return false; }
  int code = http.GET();
  if (code != HTTP_CODE_OK) { LOG.printf("[eink] config GET %d\n", code); http.end(); return false; }
  String body = http.getString();
  http.end();

  int start = 0;
  while (start < (int)body.length()) {
    int nl = body.indexOf('\n', start);
    String line = (nl < 0) ? body.substring(start) : body.substring(start, nl);
    start = (nl < 0) ? body.length() : nl + 1;
    line.trim();
    int eq = line.indexOf('=');
    if (eq <= 0) continue;
    String key = line.substring(0, eq); key.trim();
    String val = line.substring(eq + 1); val.trim();
    if      (key == "rotation")   g_rotation = val.toInt();
    else if (key == "btn_green")  setField(g_actGreen, sizeof(g_actGreen), val);
    else if (key == "btn_right")  setField(g_actRight, sizeof(g_actRight), val);
    else if (key == "btn_left")   setField(g_actLeft,  sizeof(g_actLeft),  val);
    else if (key == "next_wake")  { long nw = val.toInt(); if (nw > 0) g_nextWakeSec = (uint32_t)nw; }
    else if (key == "image")      setField(g_imagePath, sizeof(g_imagePath), val);
    else if (key == "image_hash") setField(g_serverHash, sizeof(g_serverHash), val);
  }
  g_haveConfig = true;
  LOG.printf("[eink] config rot=%d g=%s r=%s l=%s wake=%us hash=%s\n",
             g_rotation, g_actGreen, g_actRight, g_actLeft, g_nextWakeSec, g_serverHash);
  return true;
}

// Fire-and-forget action notify; server updates its per-panel view state.
static void sendAction(const char* action) {
  HTTPClient http; WiFiClient c;
  if (http.begin(c, urlAction(action))) { http.GET(); http.end(); }
}

// Stream the PNG straight into pngle (no full-file buffering). This is the
// expensive path — the caller only reaches it after /config's image_hash said
// the content changed, so it's an unconditional GET (no If-None-Match / 304).
// Returns true on a clean decode into g_gray.
static bool fetchAndDecode() {
  HTTPClient http; WiFiClient c;
  if (!http.begin(c, urlPanelResolved())) { LOG.println("[eink] http begin fail"); return false; }

  int code = http.GET();
  if (code != HTTP_CODE_OK) { LOG.printf("[eink] GET %d\n", code); http.end(); return false; }

  int len = http.getSize();
  WiFiClient* s = http.getStreamPtr();
  pngle_t* p = pngle_new();
  pngle_set_draw_callback(p, on_draw);

  uint8_t buf[2048];
  bool ok = true;
  while (http.connected() && (len < 0 || len > 0)) {
    size_t avail = s->available();
    if (!avail) { delay(1); continue; }
    int n = s->readBytes(buf, avail > sizeof(buf) ? sizeof(buf) : avail);
    if (n <= 0) break;
    if (pngle_feed(p, buf, n) < 0) { LOG.printf("[eink] png: %s\n", pngle_error(p)); ok = false; break; }
    if (len > 0) len -= n;
  }
  pngle_destroy(p);
  http.end();

  return ok && g_gray && g_w > 0 && g_h > 0;
}

static void renderToPanel() {
  ditherGray16InPlace(g_gray, g_w, g_h);   // luma -> 4-bit indices, in place
  pack_4bpp_in_place(g_gray, g_w, g_h);    // 2 px/byte
  epaper.pushImage(0, 0, g_w, g_h, (uint16_t*)g_gray);
  epaper.update();                          // ~1-3s panel refresh
  free(g_gray); g_gray = nullptr;
  LOG.printf("[eink] rendered %dx%d\n", g_w, g_h);
}

static void sleepNow() {
  const uint64_t mask =
      (1ULL << BTN_GREEN_GPIO) | (1ULL << BTN_RIGHT_GPIO) | (1ULL << BTN_LEFT_GPIO);
  // Buttons are active-low; wake when any goes LOW. ext1 (not ext0) supports a mask.
  rtc_gpio_pullup_en((gpio_num_t)BTN_GREEN_GPIO);
  rtc_gpio_pullup_en((gpio_num_t)BTN_RIGHT_GPIO);
  rtc_gpio_pullup_en((gpio_num_t)BTN_LEFT_GPIO);
  esp_sleep_enable_ext1_wakeup(mask, ESP_EXT1_WAKEUP_ANY_LOW);
  // Cadence is server-driven (/config next_wake); fall back to the compiled safety
  // value only before the first successful snapshot (e.g. server-down boot).
  const uint64_t sec = g_nextWakeSec > 0 ? (uint64_t)g_nextWakeSec : (uint64_t)FALLBACK_SLEEP;
  esp_sleep_enable_timer_wakeup(sec * 1000000ULL);
  LOG.printf("[eink] deep sleep %llus\n", (unsigned long long)sec);
  LOG.flush();
  esp_deep_sleep_start();
}

void setup() {
  LOG.begin(115200, SERIAL_8N1, PIN_DBG_RX, PIN_DBG_TX);
  delay(50);
  LOG.println("\n[eink] boot");

  // Which button (if any) woke us? Capture the GPIO now; map it to an action
  // string AFTER /config (the map is server-driven, cached in RTC).
  int wokeBtn = -1;   // 0=green, 1=right, 2=left
  if (esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_EXT1) {
    const uint64_t st = esp_sleep_get_ext1_wakeup_status();
    if      (st & (1ULL << BTN_GREEN_GPIO)) wokeBtn = 0;
    else if (st & (1ULL << BTN_RIGHT_GPIO)) wokeBtn = 1;
    else if (st & (1ULL << BTN_LEFT_GPIO))  wokeBtn = 2;
  }

  if (!wifiUp()) { LOG.println("[eink] wifi FAIL"); sleepNow(); }
  LOG.printf("[eink] wifi ok ssid=%s ip=%s\n", WIFI_SSID, WiFi.localIP().toString().c_str());

  // Pull the state snapshot first: rotation + button map (for this render),
  // next_wake (cadence), and image_hash (change gate). On failure we keep the
  // RTC-cached config but g_serverHash stays empty, so we won't render blind.
  bool haveSnap = fetchConfig();

  // A button press mutates the server-side view, so notify it and re-snapshot to
  // pick up the NEW view's image_hash before deciding whether to redraw.
  const char* action = wokeBtn == 0 ? g_actGreen
                     : wokeBtn == 1 ? g_actRight
                     : wokeBtn == 2 ? g_actLeft
                     : nullptr;
  LOG.printf("[eink] wake action=%s\n", action ? action : "(timer/boot)");
  if (action) {
    sendAction(action);
    haveSnap = fetchConfig();
  }

  // Render only when the server's content fingerprint differs from what we last
  // drew (or we've never drawn — cold boot). A no-op 'select' leaves the hash
  // unchanged, so it correctly skips the ~3s refresh.
  const bool changed = haveSnap &&
      (g_imgHash[0] == '\0' || strcmp(g_imgHash, g_serverHash) != 0);

  if (!changed) {
    LOG.printf("[eink] unchanged (hash=%s); skipping render\n", g_serverHash);
  } else {
    epaper.begin();
    epaper.initGrayMode(GRAY_LEVEL16);
    epaper.setRotation((g_rotation / 90) & 3);
    epaper.fillSprite(TFT_GRAY_15);                  // start from white
    LOG.printf("[eink] fetching %s\n", urlPanelResolved().c_str());
    if (fetchAndDecode()) {
      renderToPanel();
      // Commit the fingerprint only after a clean decode+refresh, so a torn fetch
      // retries next wake instead of marking a half-drawn frame as current.
      strncpy(g_imgHash, g_serverHash, sizeof(g_imgHash) - 1);
      g_imgHash[sizeof(g_imgHash) - 1] = '\0';
    } else {
      LOG.println("[eink] fetch/decode failed; leaving prior image");
    }
  }

  sleepNow();
}

void loop() { /* never runs — all work happens in setup(), then deep sleep */ }

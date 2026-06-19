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
#error "Panel setup not loaded — check platformio.ini build_flags -DBOARD_SCREEN_COMBO=..."
#endif

// ---- render profile (multi-device) ------------------------------------------
// Exactly one EINK_* profile is set per panel by platformio.ini build_flags. It
// selects the decode buffer + dither + display path below; everything else (wifi,
// /config, change-detection, sleep) is shared. Add a profile only for a genuinely
// new colour technology — most new panels just reuse GRAY16 or COLOR_E6.
//   EINK_GRAY16   — mono 16-level grey (IT8951; e.g. E1003). Memory-light: 1 byte/
//                   px luma + custom dither (Seeed's RGB888 path won't fit at 1872x1404).
//   EINK_COLOR_E6 — Spectra-6 colour (e.g. E1004). RGB888 + Seeed's PAL_E6 dither
//                   (fits at 1200x1600); freed before the framebuffer is allocated.
#if defined(EINK_COLOR_E6)
  // Uses the in-file memory-light 6-colour dither (Seeed's dither_image needs a
  // ~11.5MB full-image error buffer at 1200x1600 — won't fit).
#elif defined(EINK_GRAY16)
  // (uses the in-file grayscale dither)
#else
  #error "No render profile — set -DEINK_GRAY16 or -DEINK_COLOR_E6 in platformio.ini"
#endif

static EPaper epaper;
// The reTerminal's USB-serial (CH340) is wired to UART on GPIO44(RX)/43(TX).
// `Serial` (USB CDC) is dark unless CDC-on-boot; Seeed logs via Serial1 here.
#define LOG Serial1
static constexpr int PIN_DBG_RX = 44;
static constexpr int PIN_DBG_TX = 43;

// ---- decode target (filled by the pngle callback) --------------------------
// GRAY16: 1 byte/px luma — the 1872x1404 RGB888 buffer (~7.9MB) won't fit beside
//         the 1.32MB Gray16 sprite in 8MB PSRAM.
// COLOR_E6: 3 byte/px RGB888 — 1200x1600 fits, and is freed before the color
//         framebuffer is allocated (see renderToPanel).
#if defined(EINK_COLOR_E6)
  static constexpr int SRC_BPP = 3;
#else
  static constexpr int SRC_BPP = 1;
#endif
static uint8_t* g_buf = nullptr;   // SRC_BPP bytes per pixel, in PSRAM
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
  if (!g_buf) {
    g_w = (int)pngle_get_width(p);
    g_h = (int)pngle_get_height(p);
    g_buf = (uint8_t*)ps_malloc((size_t)g_w * g_h * SRC_BPP);
    if (!g_buf) { LOG.println("[eink] OOM decode buf"); return; }
  }
  for (uint32_t dy = 0; dy < h; ++dy) {
    for (uint32_t dx = 0; dx < w; ++dx) {
      const int px = (int)(x + dx), py = (int)(y + dy);
      if (px < 0 || py < 0 || px >= g_w || py >= g_h) continue;
      const size_t i = (size_t)py * g_w + px;
#if defined(EINK_COLOR_E6)
      uint8_t* d = g_buf + i * 3; d[0] = rgba[0]; d[1] = rgba[1]; d[2] = rgba[2];  // alpha ignored
#else
      g_buf[i] = (uint8_t)((rgba[0] * 77 + rgba[1] * 150 + rgba[2] * 29) >> 8);     // Rec.601 luma
#endif
    }
  }
}

#if defined(EINK_GRAY16)
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
#endif // EINK_GRAY16

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

  int len = http.getSize();                 // Content-Length, or -1 if chunked
  WiFiClient* s = http.getStreamPtr();
  pngle_t* p = pngle_new();
  pngle_set_draw_callback(p, on_draw);

  uint8_t buf[2048];
  bool ok = true;
  uint32_t lastData = millis();
  // Drain buffered bytes BEFORE honoring a disconnect: the server closes the TCP
  // connection as soon as it finishes sending, so http.connected() can go false
  // while the tail is still in the RX buffer. Reading until connected() (the old
  // bug) dropped that tail — invisible on the 41KB grey image, but lopped the
  // bottom ~15% off the 1.44MB colour image. Loop on remaining length instead.
  while (len != 0) {
    const size_t avail = s->available();
    if (avail) {
      const int n = s->readBytes(buf, avail > sizeof(buf) ? sizeof(buf) : avail);
      if (n > 0) {
        if (pngle_feed(p, buf, n) < 0) { LOG.printf("[eink] png: %s\n", pngle_error(p)); ok = false; break; }
        if (len > 0) len -= n;
        lastData = millis();
      }
    } else if (!s->connected()) {
      break;                                // nothing buffered AND closed -> done
    } else if (millis() - lastData > 20000) {
      LOG.println("[eink] stream stall"); ok = false; break;   // safety net
    } else {
      delay(2);                             // connected, waiting for more bytes
    }
  }
  const bool complete = (len == 0 || len < 0);   // all Content-Length bytes consumed
  pngle_destroy(p);
  http.end();
  if (!complete) LOG.printf("[eink] truncated: %d bytes short\n", len);

  return ok && complete && g_buf && g_w > 0 && g_h > 0;
}

#if defined(EINK_COLOR_E6)
// Spectra-6 palette (RGB) and the 4-bit codes the IT-class panel expects, copied
// from Seeed's dither.cpp so on-panel colours match.
static const uint8_t E6_RGB[6][3] = {
  {255,255,255}, {29,185,84}, {229,57,53}, {255,216,0}, {0,76,255}, {0,0,0},
};
static const uint8_t E6_CODE[6] = { 0x0, 0x2, 0x6, 0xB, 0xD, 0xF };

static inline int nearestE6(int r, int g, int b) {
  int best = 0, bd = 1 << 30;
  for (int i = 0; i < 6; ++i) {
    const int dr = r - E6_RGB[i][0], dg = g - E6_RGB[i][1], db = b - E6_RGB[i][2];
    const int d = dr * dr + dg * dg + db * db;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// Floyd-Steinberg to the 6 Spectra colours. Memory-light: only TWO int16x3 error
// rows (~14KB at W=1200), vs Seeed's full-image 6-bytes/px buffer (~11.5MB). The
// 4-bit E6 code is written into g[i] IN PLACE — safe because the index cursor (byte
// i) always trails the RGB read cursor (byte i*3 >= i), so RGB is read before it's
// overwritten. Errors live in the side rows, never in g.
static bool ditherE6InPlace(uint8_t* g, int W, int H) {
  const size_t rowN = (size_t)W * 3;
  int16_t* cur = (int16_t*)calloc(rowN, sizeof(int16_t));
  int16_t* nxt = (int16_t*)calloc(rowN, sizeof(int16_t));
  if (!cur || !nxt) { free(cur); free(nxt); return false; }
  auto clamp8 = [](int v) { return v < 0 ? 0 : v > 255 ? 255 : v; };
  for (int y = 0; y < H; ++y) {
    for (int x = 0; x < W; ++x) {
      const size_t pi = (size_t)y * W + x;
      const int r = clamp8(g[pi * 3]     + cur[x * 3]     / 16);
      const int gg= clamp8(g[pi * 3 + 1] + cur[x * 3 + 1] / 16);
      const int b = clamp8(g[pi * 3 + 2] + cur[x * 3 + 2] / 16);
      const int q = nearestE6(r, gg, b);
      g[pi] = E6_CODE[q];                                  // in-place index write
      const int er = r - E6_RGB[q][0], eg = gg - E6_RGB[q][1], eb = b - E6_RGB[q][2];
      auto add = [&](int16_t* row, int xx, int w) {
        if (xx < 0 || xx >= W) return;
        row[xx*3] += (int16_t)(er*w); row[xx*3+1] += (int16_t)(eg*w); row[xx*3+2] += (int16_t)(eb*w);
      };
      add(cur, x + 1, 7); add(nxt, x - 1, 3); add(nxt, x, 5); add(nxt, x + 1, 1);
    }
    int16_t* t = cur; cur = nxt; nxt = t;                  // advance rows
    memset(nxt, 0, rowN * sizeof(int16_t));
  }
  free(cur); free(nxt);
  return true;
}
#endif

// Dither the decoded buffer to the panel's native depth, push it, and refresh.
// Profile-specific: GRAY16 uses the sprite + in-file grey dither; COLOR_E6 dithers
// RGB888 -> 6 colours in place (no extra full-size buffer).
static void renderToPanel() {
#if defined(EINK_COLOR_E6)
  if (!ditherE6InPlace(g_buf, g_w, g_h)) { LOG.println("[eink] OOM dither rows"); free(g_buf); g_buf = nullptr; return; }
  pack_4bpp_in_place(g_buf, g_w, g_h);      // 2 px/byte (E6 codes), in place
  epaper.begin();
  epaper.setRotation((g_rotation / 90) & 3);
  epaper.pushImage(0, 0, g_w, g_h, (uint16_t*)g_buf);
  epaper.update();                          // full-colour refresh (~20s on Spectra-6)
  free(g_buf); g_buf = nullptr;
#else
  // GRAY16: sprite was allocated by initGrayMode() before decode; dither in place.
  ditherGray16InPlace(g_buf, g_w, g_h);     // luma -> 4-bit indices, in place
  pack_4bpp_in_place(g_buf, g_w, g_h);      // 2 px/byte
  epaper.pushImage(0, 0, g_w, g_h, (uint16_t*)g_buf);
  epaper.update();                          // ~1-3s panel refresh
  free(g_buf); g_buf = nullptr;
#endif
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
#if defined(EINK_GRAY16)
    // Gray16 needs its sprite allocated BEFORE decode (renderToPanel pushes into
    // it). Color allocates its framebuffer inside renderToPanel, after freeing RGB.
    epaper.begin();
    epaper.initGrayMode(GRAY_LEVEL16);
    epaper.setRotation((g_rotation / 90) & 3);
    epaper.fillSprite(TFT_GRAY_15);                  // start from white
#endif
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

// =============================================================================
// DaylightStation e-paper panel firmware — Seeed reTerminal E1003 (IT8951 Gray16)
// =============================================================================
// Fully local. The panel is a "remote control for your own server":
//   wake (button or timer) -> WiFi -> [optional action GET] -> GET PNG ->
//   decode to luma -> Floyd-Steinberg dither to Gray16 -> push to panel -> sleep.
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

static String urlPanel()  { return String("http://") + DS_HOST + ":" + DS_PORT + "/api/v1/eink/panel?id=" + PANEL_ID; }
static String urlAction(const char* a) { return String("http://") + DS_HOST + ":" + DS_PORT + "/api/v1/eink/action?id=" + PANEL_ID + "&action=" + a; }

static bool wifiUp() {
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) delay(100);
  return WiFi.status() == WL_CONNECTED;
}

// Fire-and-forget action notify; server updates its per-panel view state.
static void sendAction(const char* action) {
  HTTPClient http; WiFiClient c;
  if (http.begin(c, urlAction(action))) { http.GET(); http.end(); }
}

// Stream the PNG straight into pngle (no full-file buffering).
static bool fetchAndDecode() {
  HTTPClient http; WiFiClient c;
  if (!http.begin(c, urlPanel())) { LOG.println("[eink] http begin fail"); return false; }
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
  esp_sleep_enable_timer_wakeup((uint64_t)SLEEP_MINUTES * 60ULL * 1000000ULL);
  LOG.println("[eink] deep sleep");
  LOG.flush();
  esp_deep_sleep_start();
}

void setup() {
  LOG.begin(115200, SERIAL_8N1, PIN_DBG_RX, PIN_DBG_TX);
  delay(50);
  LOG.println("\n[eink] boot");

  // Which button (if any) woke us?
  const char* action = nullptr;
  if (esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_EXT1) {
    const uint64_t st = esp_sleep_get_ext1_wakeup_status();
    if      (st & (1ULL << BTN_GREEN_GPIO)) action = BTN_GREEN_ACTION;
    else if (st & (1ULL << BTN_RIGHT_GPIO)) action = BTN_RIGHT_ACTION;
    else if (st & (1ULL << BTN_LEFT_GPIO))  action = BTN_LEFT_ACTION;
  }
  LOG.printf("[eink] wake action=%s\n", action ? action : "(timer/boot)");

  epaper.begin();
  epaper.initGrayMode(GRAY_LEVEL16);
  epaper.setRotation((DISPLAY_ROTATION / 90) & 3);
  epaper.fillSprite(TFT_GRAY_15);                    // start from white

  if (!wifiUp()) { LOG.println("[eink] wifi FAIL"); sleepNow(); }
  LOG.printf("[eink] wifi ok ssid=%s ip=%s\n", WIFI_SSID, WiFi.localIP().toString().c_str());
  LOG.printf("[eink] fetching %s\n", urlPanel().c_str());

  if (action) sendAction(action);                    // tell server what happened
  if (fetchAndDecode()) renderToPanel();
  else LOG.println("[eink] fetch/decode failed; leaving prior image");

  sleepNow();
}

void loop() { /* never runs — all work happens in setup(), then deep sleep */ }

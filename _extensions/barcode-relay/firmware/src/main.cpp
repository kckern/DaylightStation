// barcode-relay — M5Stack ATOM Lite as a BLE HID *central* for a Zebra DS2278.
//
// The DS2278 is set to "HID Bluetooth Low Energy (Discoverable)" (PRG p.6-6), so
// it advertises as a standard BLE HID keyboard (service 0x1812, appearance 0x03C1).
// This firmware connects to it directly by MAC, bonds (LE Secure Connections /
// Just Works), subscribes to its HID input-report notifications, decodes the
// keystrokes into a barcode string (Enter-terminated), and relays each barcode
// over WiFi to the DaylightStation event bus as
//   {source:'barcode-relay', type:'scan', device:'ds2278', code, ts}
//
// Fill WiFi creds locally before flashing (committed with placeholders).

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <FastLED.h>
#include <NimBLEDevice.h>

// ---------- config ----------
static const char* WIFI_SSID = "YOUR_SSID";
static const char* WIFI_PASS = "YOUR_WIFI_PASS";
static const char* WS_HOST   = "10.0.0.68";
static const uint16_t WS_PORT = 8791;
static const char* WS_PATH   = "/ws";

// The DS2278 scanner's BLE identity (from `bluetoothctl` discovery).
static const char* TARGET_MAC  = "c8:1c:fe:fd:ce:90";
static const char* TARGET_NAME = "DS2278";

#define LED_PIN 27
static CRGB led[1];
static void setLed(const CRGB& c){ led[0]=c; FastLED.show(); }

// ---------- net ----------
static WiFiUDP udp; static IPAddress g_bcast; static const uint16_t LOG_PORT=9999;
static WebSocketsClient ws; static volatile bool wsConnected=false;

static void logf(const char* fmt, ...){
  char b[240]; va_list ap; va_start(ap,fmt); vsnprintf(b,sizeof(b),fmt,ap); va_end(ap);
  Serial.println(b);
  if(WiFi.status()==WL_CONNECTED){ udp.beginPacket(g_bcast,LOG_PORT); udp.write((const uint8_t*)b,strlen(b)); udp.write((const uint8_t*)"\n",1); udp.endPacket(); }
}

// completed barcodes handed from the BLE task to loop() for WS send
static QueueHandle_t g_bcQueue;
// raw HID reports handed from the BLE task to loop() for logging/decoding
struct RawRep { uint16_t handle; uint8_t len; uint8_t d[40]; };
static QueueHandle_t g_rawQueue;

static void wsEvent(WStype_t t, uint8_t*, size_t){
  if(t==WStype_CONNECTED){ wsConnected=true; logf("[ws] connected"); }
  else if(t==WStype_DISCONNECTED){ wsConnected=false; logf("[ws] disconnected"); }
}

// ---------- HID keycode -> ASCII (US layout) ----------
static char hidToChar(uint8_t k, bool shift){
  if(k>=0x04 && k<=0x1d){ char c='a'+(k-0x04); return shift ? (char)(c-32) : c; } // a-z
  if(k>=0x1e && k<=0x26){ const char* n="123456789"; const char* s="!@#$%^&*("; return shift ? s[k-0x1e] : n[k-0x1e]; }
  if(k==0x27) return shift ? ')' : '0';
  switch(k){
    case 0x2c: return ' ';
    case 0x2d: return shift ? '_' : '-';
    case 0x2e: return shift ? '+' : '=';
    case 0x2f: return shift ? '{' : '[';
    case 0x30: return shift ? '}' : ']';
    case 0x31: return shift ? '|' : '\\';
    case 0x33: return shift ? ':' : ';';
    case 0x34: return shift ? '"' : '\'';
    case 0x35: return shift ? '~' : '`';
    case 0x36: return shift ? '<' : ',';
    case 0x37: return shift ? '>' : '.';
    case 0x38: return shift ? '?' : '/';
    case 0x28: case 0x58: return '\n'; // Enter / keypad Enter
    default: return 0;
  }
}

// ---------- barcode assembly from HID reports ----------
static String g_code;
static uint8_t g_prev[6] = {0};
static uint32_t g_lastKeyMs = 0;          // when the last character arrived
static const uint32_t CODE_GAP_MS = 150;  // flush after this idle gap (no terminator over BLE HID)

static void flushCode(){
  if(g_code.length()){
    char buf[128]; strncpy(buf, g_code.c_str(), sizeof(buf)-1); buf[sizeof(buf)-1]=0;
    xQueueSend(g_bcQueue, buf, 0);
    g_code = "";
  }
}

// HID boot keyboard input report: [modifiers, reserved, k0..k5]
static void onHidReport(const uint8_t* data, size_t len){
  if(len < 3) return;
  uint8_t mods = data[0];
  bool shift = (mods & 0x22) != 0; // L/R shift
  const uint8_t* keys = data + 2;
  size_t nk = len - 2; if(nk > 6) nk = 6;
  // register keys present now that were not in the previous report (new key-downs)
  for(size_t i=0;i<nk;i++){
    uint8_t k = keys[i];
    if(k==0 || k==1) continue;
    bool wasDown=false;
    for(size_t j=0;j<6;j++){ if(g_prev[j]==k){ wasDown=true; break; } }
    if(wasDown) continue;
    char c = hidToChar(k, shift);
    if(c=='\n') flushCode();
    else if(c){ g_code += c; g_lastKeyMs = millis(); }
  }
  for(size_t j=0;j<6;j++) g_prev[j] = (j<nk)? keys[j] : 0;
}

static void notifyCB(NimBLERemoteCharacteristic* ch, uint8_t* data, size_t len, bool){
  RawRep r; r.handle = ch->getHandle(); r.len = len>40?40:len; memcpy(r.d, data, r.len);
  xQueueSend(g_rawQueue, &r, 0);
}

// ---------- BLE central ----------
static volatile bool g_doConnect=false;
static volatile bool g_connected=false;
static NimBLEAdvertisedDevice* g_target=nullptr;

class ScanCB : public NimBLEAdvertisedDeviceCallbacks {
  void onResult(NimBLEAdvertisedDevice* d) override {
    bool match = d->getAddress().toString() == TARGET_MAC;
    if(!match && d->haveServiceUUID() && d->isAdvertisingService(NimBLEUUID((uint16_t)0x1812))) match=true;
    if(!match && d->haveName() && String(d->getName().c_str()).indexOf(TARGET_NAME) >= 0) match=true;
    if(match){
      logf("[ble] found %s rssi=%d", d->getAddress().toString().c_str(), d->getRSSI());
      NimBLEDevice::getScan()->stop();
      g_target = new NimBLEAdvertisedDevice(*d);
      g_doConnect = true;
    }
  }
};

class ClientCB : public NimBLEClientCallbacks {
  void onConnect(NimBLEClient*) override { logf("[ble] connected"); }
  void onDisconnect(NimBLEClient*) override {
    g_connected=false; logf("[ble] disconnected"); setLed(CRGB(20,10,0));
  }
};
static ClientCB g_clientCB;

static bool connectTarget(){
  NimBLEClient* c = NimBLEDevice::getClientListSize() ? NimBLEDevice::getDisconnectedClient() : nullptr;
  if(!c) c = NimBLEDevice::createClient();
  c->setClientCallbacks(&g_clientCB, false);
  c->setConnectionParams(12,12,0,150);
  c->setConnectTimeout(10);
  if(!c->connect(g_target)){ logf("[ble] connect failed"); return false; }
  if(!c->secureConnection()){ logf("[ble] secureConnection(bond) failed"); c->disconnect(); return false; }
  logf("[ble] bonded; discovering HID service 0x1812");
  NimBLERemoteService* hid = c->getService(NimBLEUUID((uint16_t)0x1812));
  if(!hid){ logf("[ble] no HID service"); c->disconnect(); return false; }

  // HID Information (0x2A4A)
  NimBLERemoteCharacteristic* hinfo = hid->getCharacteristic(NimBLEUUID((uint16_t)0x2A4A));
  if(hinfo){ std::string v=hinfo->readValue(); logf("[ble] HID info len=%u", (unsigned)v.size()); }
  // Report Map (0x2A4B) — some devices won't stream until the host reads it
  NimBLERemoteCharacteristic* rmap = hid->getCharacteristic(NimBLEUUID((uint16_t)0x2A4B));
  if(rmap){ std::string v=rmap->readValue(); logf("[ble] read ReportMap len=%u", (unsigned)v.size()); }
  // Protocol Mode (0x2A4E): force Report Protocol (1) so the Report char streams
  NimBLERemoteCharacteristic* pmode = hid->getCharacteristic(NimBLEUUID((uint16_t)0x2A4E));
  if(pmode){
    uint8_t before = pmode->canRead()? (uint8_t)pmode->readValue<uint8_t>() : 255;
    uint8_t one=1; pmode->writeValue(&one,1,false);
    logf("[ble] ProtocolMode was=%u -> set Report(1)", before);
  } else logf("[ble] no ProtocolMode char");

  int subs=0;
  for(auto ch : *hid->getCharacteristics(true)){
    // subscribe to every notifiable Report (0x2A4D) + boot keyboard input (0x2A22)
    bool isReport = ch->getUUID() == NimBLEUUID((uint16_t)0x2A4D);
    bool isBootKbd = ch->getUUID() == NimBLEUUID((uint16_t)0x2A22);
    if((isReport||isBootKbd) && ch->canNotify()){
      int rid=-1, rtype=-1;
      NimBLERemoteDescriptor* rr = ch->getDescriptor(NimBLEUUID((uint16_t)0x2908));
      if(rr){ std::string v=rr->readValue(); if(v.size()>=2){ rid=(uint8_t)v[0]; rtype=(uint8_t)v[1]; } }
      if(ch->subscribe(true, notifyCB)){ subs++; logf("[ble] sub %s reportId=%d type=%d", ch->getUUID().toString().c_str(), rid, rtype); }
    }
  }
  if(subs==0){ logf("[ble] no notifiable HID report chars"); c->disconnect(); return false; }
  g_connected=true; setLed(CRGB::Green);
  logf("[ble] READY — %d report streams; scan a barcode", subs);
  return true;
}

static void startScan(){
  NimBLEScan* s = NimBLEDevice::getScan();
  s->setAdvertisedDeviceCallbacks(new ScanCB(), false);
  s->setActiveScan(true);
  s->setInterval(45); s->setWindow(45);
  s->start(0, nullptr, false);
  logf("[ble] scanning for %s / %s ...", TARGET_MAC, TARGET_NAME);
}

void setup(){
  Serial.begin(115200); delay(150);
  Serial.println("\n[barcode-relay BLE-HID central] boot");
  FastLED.addLeds<SK6812,LED_PIN,GRB>(led,1); FastLED.setBrightness(60); setLed(CRGB(20,0,0));

  g_bcQueue = xQueueCreate(8, 128);
  g_rawQueue = xQueueCreate(32, sizeof(RawRep));

  // BLE first (coex), then WiFi
  NimBLEDevice::init("barcode-relay");
  NimBLEDevice::setPower(ESP_PWR_LVL_P9);
  NimBLEDevice::setSecurityAuth(true, false, true); // bond, no MITM, SC
  NimBLEDevice::setSecurityIOCap(BLE_HS_IO_NO_INPUT_OUTPUT); // Just Works

  WiFi.mode(WIFI_STA); WiFi.begin(WIFI_SSID,WIFI_PASS);
  uint32_t t0=millis(); while(WiFi.status()!=WL_CONNECTED && millis()-t0<15000){ delay(300); Serial.print("."); }
  if(WiFi.status()==WL_CONNECTED){ g_bcast=WiFi.localIP(); g_bcast[3]=255; logf("[wifi] %s -> ws %s:%u, udp log :9999", WiFi.localIP().toString().c_str(), WS_HOST, WS_PORT); }
  ws.begin(WS_HOST, WS_PORT, WS_PATH); ws.onEvent(wsEvent); ws.setReconnectInterval(4000);

  startScan();
}

static void relay(const char* code){
  logf("[barcode] %s (ws=%d)", code, wsConnected);
  if(wsConnected){
    JsonDocument d; d["source"]="barcode-relay"; d["type"]="scan"; d["device"]="ds2278"; d["code"]=code; d["ts"]=(uint32_t)millis();
    String out; serializeJson(d,out); ws.sendTXT(out);
    setLed(CRGB::Blue); delay(60); setLed(g_connected?CRGB::Green:CRGB(20,10,0));
  }
}

void loop(){
  ws.loop();

  if(g_doConnect){ g_doConnect=false; if(!connectTarget()){ delay(800); startScan(); } }

  RawRep r;
  while(xQueueReceive(g_rawQueue, &r, 0) == pdTRUE){
    char hex[96]; int o=0;
    for(int i=0;i<r.len && o<90;i++) o+=snprintf(hex+o,sizeof(hex)-o,"%02x ",r.d[i]);
    logf("[hid] h=%u len=%u %s", r.handle, r.len, hex);
    onHidReport(r.d, r.len);
  }

  // no terminator over BLE HID: flush the barcode once input goes idle
  if(g_code.length() && (millis()-g_lastKeyMs) > CODE_GAP_MS) flushCode();

  char buf[128];
  while(xQueueReceive(g_bcQueue, buf, 0) == pdTRUE) relay(buf);

  static uint32_t hb=0; if(millis()-hb>5000){ hb=millis(); logf("[hb] up %us ws=%d ble=%d", millis()/1000, wsConnected, g_connected); }
}

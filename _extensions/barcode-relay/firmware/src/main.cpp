// barcode-relay — M5Stack ATOM Lite as a BLE HID HOST for a Zebra DS2278 in
// HID-Bluetooth-Low-Energy mode (standard HID-over-GATT / HOGP).
//
// WHY HID not SSI: Zebra's "SSI Bluetooth Low Energy" is their proprietary RSM /
// CoreScanner attribute protocol (only reachable via Zebra's closed SDK) — not
// replicable on an ESP (see DEV-STATUS.md). HID-BLE is the STANDARD keyboard
// profile: the gun emits USB-HID keyboard input reports, one per scanned char,
// terminated by Enter. We bond, subscribe to the HID Report chars, decode the
// reports to ASCII, assemble the barcode, and relay it.
//
// Gun setup: scan the "HID Bluetooth Low Energy (Discoverable)" host barcode.
// Logs + scans stream over WiFi UDP :9999 (serial link is flaky — see DEV-STATUS).
//
// STATUS: written but NOT yet tested end-to-end (needs the gun in HID-BLE mode).
// Compile-verified only.

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <NimBLEDevice.h>
#include <FastLED.h>

#define LED_PIN 27
static CRGB led[1];
static void setLed(const CRGB& c){ led[0]=c; FastLED.show(); }

// DIAGNOSTIC creds — fill in locally, do NOT commit real values.
static const char* WIFI_SSID = "YOUR_SSID";
static const char* WIFI_PASS = "YOUR_WIFI_PASS";
static WiFiUDP udp; static IPAddress g_bcast; static const uint16_t LOG_PORT=9999;
static void logf(const char* fmt, ...){
  char buf[300]; va_list ap; va_start(ap,fmt); vsnprintf(buf,sizeof(buf),fmt,ap); va_end(ap);
  Serial.println(buf);
  if(WiFi.status()==WL_CONNECTED){
    udp.beginPacket(g_bcast,LOG_PORT); udp.write((const uint8_t*)buf,strlen(buf)); udp.write((const uint8_t*)"\n",1); udp.endPacket();
    udp.beginPacket(IPAddress(255,255,255,255),LOG_PORT); udp.write((const uint8_t*)buf,strlen(buf)); udp.write((const uint8_t*)"\n",1); udp.endPacket();
  }
}

// Standard BLE HID service + input report characteristic.
static NimBLEUUID SVC_HID((uint16_t)0x1812);
static NimBLEUUID CHR_REPORT((uint16_t)0x2A4D);   // HID Report (input reports notify here)

static NimBLEAdvertisedDevice* g_adv=nullptr;
static volatile bool g_doConnect=false;
static NimBLEClient* g_client=nullptr;
static NimBLERemoteService* g_hid=nullptr;

// --- HID US-keyboard usage -> ASCII (barcode chars: digits, A-Z, common symbols) ---
static char hidChar(uint8_t usage, bool shift){
  if(usage>=0x04 && usage<=0x1d){ char c='a'+(usage-0x04); return shift? (c-32):c; }         // a-z / A-Z
  if(usage>=0x1e && usage<=0x26){ const char* n="123456789"; const char* s="!@#$%^&*("; return shift? s[usage-0x1e]:n[usage-0x1e]; }
  switch(usage){
    case 0x27: return shift?')':'0';
    case 0x2d: return shift?'_':'-';
    case 0x2e: return shift?'+':'=';
    case 0x2c: return ' ';
    case 0x2f: return shift?'{':'[';
    case 0x30: return shift?'}':']';
    case 0x33: return shift?':':';';
    case 0x34: return shift?'"':'\'';
    case 0x36: return shift?'<':',';
    case 0x37: return shift?'>':'.';
    case 0x38: return shift?'?':'/';
    case 0x31: return shift?'|':'\\';
    default: return 0;
  }
}

static String g_barcode;
static uint8_t g_lastKeys[6]={0};

static void emitBarcode(){
  if(g_barcode.length()==0) return;
  logf(">>> SCAN  \"%s\"  (len %d)", g_barcode.c_str(), g_barcode.length());
  // TODO relay: WS client to DaylightStation event bus (source 'barcode-relay', code=g_barcode)
  g_barcode="";
  setLed(CRGB::Green); delay(80); setLed(CRGB(0,0,20));
}

// HID input report: [modifiers][reserved][k1..k6] (boot-keyboard layout; report-protocol
// may prefix a report-id — we scan for keycodes in the tail either way).
static void onReport(NimBLERemoteCharacteristic* chr, uint8_t* d, size_t len, bool){
  if(len<3) return;
  // Heuristic: find the modifier byte + key array. Boot report = 8 bytes from offset 0;
  // a report-id byte may shift it by 1. Try offset 0, then offset 1.
  int off = (len>=8)?0: (len>=3?0:0);
  uint8_t mod = d[off];
  bool shift = mod & 0x22;                        // L/R shift
  const uint8_t* keys = d+off+2;
  int nkeys = (int)len-(off+2);
  for(int i=0;i<nkeys && i<6;i++){
    uint8_t u=keys[i];
    if(u==0) continue;
    // only process keys not held from the previous report (avoid repeats)
    bool held=false; for(int j=0;j<6;j++) if(g_lastKeys[j]==u) held=true;
    if(held) continue;
    if(u==0x28){ emitBarcode(); }                 // Enter -> end of barcode
    else { char c=hidChar(u,shift); if(c) g_barcode+=c; }
  }
  for(int i=0;i<6;i++) g_lastKeys[i]= (i<nkeys)?keys[i]:0;
}

class ScanCB : public NimBLEAdvertisedDeviceCallbacks {
  void onResult(NimBLEAdvertisedDevice* dev) override {
    bool hid = dev->isAdvertisingService(SVC_HID);
    bool name = dev->haveName() && dev->getName().rfind("DS2278",0)==0;
    if(hid || name){
      logf("[ble] found %s (%s) hidSvc=%d", dev->haveName()?dev->getName().c_str():"?", dev->getAddress().toString().c_str(), hid);
      NimBLEDevice::getScan()->stop(); g_adv=new NimBLEAdvertisedDevice(*dev); g_doConnect=true;
    }
  }
};
class ClientCB : public NimBLEClientCallbacks {
  void onDisconnect(NimBLEClient*) override { logf("[ble] DISCONNECTED"); g_hid=nullptr; setLed(CRGB(20,0,0)); }
  bool onConnParamsUpdateRequest(NimBLEClient*, const ble_gap_upd_params*) override { return true; }
};
static ClientCB g_ccb;

static bool connectAndSub(){
  if(g_client) NimBLEDevice::deleteClient(g_client);
  g_client=NimBLEDevice::createClient(); g_client->setClientCallbacks(&g_ccb,false);
  if(!g_client->connect(g_adv)){ logf("[ble] connect failed"); return false; }
  logf("[ble] connected MTU=%u; bonding...", g_client->getMTU());
  logf(g_client->secureConnection()?"[ble] bonded OK":"[ble] secureConnection FALSE");
  g_hid=g_client->getService(SVC_HID);
  if(!g_hid){ logf("[ble] HID service 0x1812 missing — is the gun in HID-BLE mode?"); return false; }
  int subbed=0;
  auto chars = g_hid->getCharacteristics(true);
  for(auto* c: *chars){
    if(c->getUUID()==CHR_REPORT && c->canNotify()){
      if(c->subscribe(true,onReport)) subbed++;
    }
  }
  logf("[ble] subscribed to %d HID report char(s) — SCAN A BARCODE", subbed);
  return subbed>0;
}
static void startScan(){ auto* s=NimBLEDevice::getScan(); s->setAdvertisedDeviceCallbacks(new ScanCB(),false);
  s->setActiveScan(true); s->setInterval(45); s->setWindow(15); s->start(0,nullptr,false); }

void setup(){
  Serial.begin(115200); delay(200);
  Serial.println("\n[barcode-relay HID-host] boot");
  FastLED.addLeds<SK6812,LED_PIN,GRB>(led,1); FastLED.setBrightness(60); setLed(CRGB(20,0,20));

  NimBLEDevice::init("");
  NimBLEDevice::setPower(ESP_PWR_LVL_P9);
  NimBLEDevice::setSecurityAuth(true,false,true);              // bond, no MITM, LE Secure Connections
  NimBLEDevice::setSecurityIOCap(BLE_HS_IO_NO_INPUT_OUTPUT);   // Just Works

  WiFi.mode(WIFI_STA); WiFi.begin(WIFI_SSID,WIFI_PASS);
  uint32_t t0=millis(); while(WiFi.status()!=WL_CONNECTED && millis()-t0<15000){ delay(300); Serial.print("."); }
  if(WiFi.status()==WL_CONNECTED){ g_bcast=WiFi.localIP(); g_bcast[3]=255; logf("[wifi] %s -> UDP log :9999", WiFi.localIP().toString().c_str()); }
  else Serial.println("[wifi] FAILED (serial-only)");

  logf("[ble] scanning for DS2278 in HID-BLE mode — pull the trigger to wake it...");
  startScan();
}

void loop(){
  if(g_doConnect){ g_doConnect=false; if(!connectAndSub()){ delay(500); startScan(); } else setLed(CRGB(0,0,20)); }
  if(!g_hid && !g_doConnect && !NimBLEDevice::getScan()->isScanning()) startScan();
  static uint32_t last=0;
  if(g_hid && millis()-last>5000){ last=millis(); logf("[hb] HID connected — scan a barcode"); }
  delay(10);
}

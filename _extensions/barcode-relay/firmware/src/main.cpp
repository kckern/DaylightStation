// barcode-relay DIAGNOSTIC v3 — M5Stack ATOM Lite + Zebra DS2278 (SSI over BLE)
//
// The FTDI serial link is physically flaky and was corrupting/dropping the logs,
// so this build mirrors every log line over WiFi UDP broadcast (port 9999) — a
// reliable channel to see what the SSI handshake actually does. (Also the
// direction the real relay goes: WiFi to the backend.)
//
// Listen on the Mac:  nc -ul 9999   (or the python listener in scratchpad)

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <NimBLEDevice.h>
#include <FastLED.h>

#define LED_PIN 27
static CRGB led[1];
static void setLed(const CRGB& c){ led[0]=c; FastLED.show(); }

// --- WiFi + UDP log mirror -------------------------------------------------
// DIAGNOSTIC: fill these in locally before flashing (do NOT commit real creds).
static const char* WIFI_SSID = "YOUR_SSID";
static const char* WIFI_PASS = "YOUR_WIFI_PASS";
static WiFiUDP udp;
static WiFiUDP rx;                 // inbound command channel (port 9998) — iterate live, no reflash
static IPAddress g_bcast;
static const uint16_t LOG_PORT = 9999;
static const uint16_t CMD_PORT = 9998;
static bool g_softTrig = true;

static void logf(const char* fmt, ...){
  char buf[300];
  va_list ap; va_start(ap, fmt); vsnprintf(buf, sizeof(buf), fmt, ap); va_end(ap);
  Serial.println(buf);
  if (WiFi.status()==WL_CONNECTED){
    udp.beginPacket(g_bcast, LOG_PORT); udp.write((const uint8_t*)buf, strlen(buf)); udp.write((const uint8_t*)"\n",1); udp.endPacket();
    udp.beginPacket(IPAddress(255,255,255,255), LOG_PORT); udp.write((const uint8_t*)buf, strlen(buf)); udp.write((const uint8_t*)"\n",1); udp.endPacket();
  }
}

static const char* SVC = "a2f0037b-4e26-4981-8a2d-eda9e1689868";
static const char* NOTIFS[] = {
  "256a0615-c232-4eec-8187-9afb38226a5a",
  "f3ae6f04-8407-44b6-85a3-59c6feb21924",
  "4b0e1f59-c0f4-4eee-91ad-da9a1532ea00",
};
static const char* WRITES[] = {
  "21f9e2b9-e59c-4e49-84e9-8cf2be479d0b",
  "89ae8d0b-8905-45a7-a4b2-d61b94cb20de",
  "91a765f5-ec8f-4882-a9eb-cc0e5b0915af",
};

static NimBLEAdvertisedDevice* g_adv = nullptr;
static volatile bool g_doConnect = false;
static NimBLEClient* g_client = nullptr;
static NimBLERemoteService* g_svc = nullptr;
static uint32_t g_connMs = 0;
static volatile bool g_ackPending = false;   // set in notify cb, serviced in loop (never write GATT from cb)

static size_t ssi(uint8_t* out, uint8_t opcode, const uint8_t* data=nullptr, uint8_t n=0){
  uint8_t len=4+n; out[0]=len; out[1]=opcode; out[2]=0x04; out[3]=0x00;
  for(uint8_t i=0;i<n;i++) out[4+i]=data[i];
  uint16_t sum=0; for(uint8_t i=0;i<4+n;i++) sum+=out[i];
  uint16_t ck=(0x10000-sum)&0xFFFF; out[4+n]=ck>>8; out[5+n]=ck&0xFF; return 6+n;
}
static void writeCmd(int idx, uint8_t opcode){
  uint8_t pkt[8]; size_t n=ssi(pkt,opcode);
  auto* w=g_svc?g_svc->getCharacteristic(WRITES[idx]):nullptr;
  if(w){ bool ok=w->writeValue(pkt,n,false); logf("[ssi] wrote op=0x%02x to write[%d] %s ok=%d", opcode, idx, WRITES[idx]+0, ok); }
}
static void ackAll(){ for(int i=0;i<3;i++){ uint8_t pkt[8]; size_t n=ssi(pkt,0xD0); auto* w=g_svc->getCharacteristic(WRITES[i]); if(w) w->writeValue(pkt,n,false);} }

static const char* symName(uint8_t t){ switch(t){ case 0x03:return"Code128";case 0x01:return"Code39";
  case 0x0b:return"EAN13";case 0x0c:return"EAN8";case 0x0d:return"UPCA";case 0x0e:return"UPCE";
  case 0x16:return"I2of5";case 0x1a:return"QR";case 0x24:return"DataMatrix";default:return"?";} }

static void onNotify(NimBLERemoteCharacteristic* chr, uint8_t* d, size_t len, bool){
  char hex[600]={0}; for(size_t i=0;i<len && i<290;i++) sprintf(hex+i*2,"%02x",d[i]);
  logf("[NOTIFY %s] len=%u %s", chr->getUUID().toString().substr(4,4).c_str(), (unsigned)len, hex);
  g_ackPending = true;  // defer the ACK to loop() — NEVER write GATT from the notify callback (hangs the stack)
  if(len>=6 && d[1]==0xF3){
    uint8_t bt=d[4]; int n=(int)d[0]-5; if(n<0)n=0; char code[260]={0};
    for(int i=0;i<n && (5+i)<(int)len && i<255;i++) code[i]=(d[5+i]>=32&&d[5+i]<127)?d[5+i]:'.';
    logf(">>> SCAN  %s(0x%02x)  \"%s\"", symName(bt), bt, code);
    setLed(CRGB::Green); delay(80); setLed(CRGB(0,0,20));
  }
}

class ScanCB : public NimBLEAdvertisedDeviceCallbacks {
  void onResult(NimBLEAdvertisedDevice* dev) override {
    if(dev->haveName() && dev->getName().rfind("DS2278",0)==0){
      logf("[ble] found %s (%s)", dev->getName().c_str(), dev->getAddress().toString().c_str());
      NimBLEDevice::getScan()->stop(); g_adv=new NimBLEAdvertisedDevice(*dev); g_doConnect=true;
    }
  }
};
class ClientCB : public NimBLEClientCallbacks {
  void onDisconnect(NimBLEClient*) override { logf("[ble] DISCONNECTED"); g_svc=nullptr; setLed(CRGB(20,0,0)); }
  bool onConnParamsUpdateRequest(NimBLEClient*, const ble_gap_upd_params*) override { return true; }
};
static ClientCB g_ccb;

static bool connectAndBond(){
  if(g_client) NimBLEDevice::deleteClient(g_client);
  g_client=NimBLEDevice::createClient(); g_client->setClientCallbacks(&g_ccb,false);
  if(!g_client->connect(g_adv)){ logf("[ble] connect failed"); return false; }
  logf("[ble] connected MTU=%u; bonding...", g_client->getMTU());
  logf(g_client->secureConnection()?"[ble] bonded OK":"[ble] secureConnection FALSE");
  g_svc=g_client->getService(SVC);
  if(!g_svc){ logf("[ble] SSI service missing"); return false; }
  int subbed=0;
  for(int i=0;i<3;i++){ auto* c=g_svc->getCharacteristic(NOTIFS[i]);
    if(c&&c->canNotify()&&c->subscribe(true,onNotify)){ subbed++; logf("[ble] subscribed notify[%d] %s", i, NOTIFS[i]); } }
  logf("[ble] subscribed %d/3; kicking SSI session...", subbed);
  for(int i=0;i<3;i++){ writeCmd(i,0xD0); }      // ACK on each write char
  delay(150);
  for(int i=0;i<3;i++){ writeCmd(i,0xA3); }      // REQUEST_REVISION on each -> should elicit a reply
  logf("[ssi] SESSION READY — SCAN A BARCODE NOW");
  g_connMs=millis(); return subbed>0;
}
static void startScan(){ auto* s=NimBLEDevice::getScan(); s->setAdvertisedDeviceCallbacks(new ScanCB(),false);
  s->setActiveScan(true); s->setInterval(45); s->setWindow(15); s->start(0,nullptr,false); }

// Live command channel (UDP :9998). Grammar:
//   "w<idx> <hex>"  -> write raw hex bytes to WRITES[idx]  e.g. "w0 04e40400ff14"
//   "t0" / "t1"     -> soft-trigger off / on
static uint8_t hx(char c){ if(c>='0'&&c<='9')return c-'0'; c|=0x20; if(c>='a'&&c<='f')return c-'a'+10; return 0; }
static void handleCmd(char* s){
  logf("[cmd] recv: %s", s);
  if(s[0]=='t' && (s[1]=='0'||s[1]=='1')){ g_softTrig=(s[1]=='1'); logf("[cmd] softTrig=%d",g_softTrig); return; }
  if((s[0]=='w'||s[0]=='W') && g_svc){          // lowercase w = no-response, uppercase W = acknowledged write
    bool resp = (s[0]=='W');
    int idx=s[1]-'0'; if(idx<0||idx>2){ logf("[cmd] bad idx"); return; }
    char* p=s+2; while(*p==' ')p++;
    uint8_t buf[80]; int n=0;
    while(p[0]&&p[1]&&n<80){ if(p[0]==' '){p++;continue;} buf[n++]=(hx(p[0])<<4)|hx(p[1]); p+=2; }
    auto* w=g_svc->getCharacteristic(WRITES[idx]);
    if(w){ bool ok=w->writeValue(buf,n,resp); logf("[cmd] wrote %d bytes to write[%d] resp=%d ok=%d",n,idx,resp,ok); }
    else logf("[cmd] no write char");
  }
}

void setup(){
  Serial.begin(115200); delay(200);
  Serial.println("\n[barcode-relay diag v4 udp-cmd] boot");
  FastLED.addLeds<SK6812,LED_PIN,GRB>(led,1); FastLED.setBrightness(60); setLed(CRGB(20,0,20));

  // BLE first (coex), then WiFi — same ordering as food-scale-relay.
  NimBLEDevice::init("");
  NimBLEDevice::setPower(ESP_PWR_LVL_P9);
  NimBLEDevice::setMTU(247);
  NimBLEDevice::setSecurityAuth(true,false,true);
  NimBLEDevice::setSecurityIOCap(BLE_HS_IO_NO_INPUT_OUTPUT);

  WiFi.mode(WIFI_STA); WiFi.begin(WIFI_SSID, WIFI_PASS);
  uint32_t t0=millis(); while(WiFi.status()!=WL_CONNECTED && millis()-t0<15000){ delay(300); Serial.print("."); }
  if(WiFi.status()==WL_CONNECTED){ g_bcast=WiFi.localIP(); g_bcast[3]=255; rx.begin(CMD_PORT); logf("[wifi] %s -> UDP log %s:9999, cmd :9998", WiFi.localIP().toString().c_str(), g_bcast.toString().c_str()); }
  else Serial.println("[wifi] FAILED (serial-only logs)");

  logf("[ble] pull the DS2278 trigger to wake it...");
  startScan();
}

void loop(){
  if(g_doConnect){ g_doConnect=false; if(!connectAndBond()){ delay(500); startScan(); } else setLed(CRGB(0,0,20)); }
  if(!g_svc && !g_doConnect && !NimBLEDevice::getScan()->isScanning()) startScan();
  if(g_svc && g_ackPending){ g_ackPending=false; ackAll(); }   // service deferred ACK safely in loop context
  // Live UDP commands (:9998) — iterate protocol without reflashing.
  int pl=rx.parsePacket();
  if(pl>0){ char b[160]; int n=rx.read((uint8_t*)b,sizeof(b)-1); if(n<0)n=0; b[n]=0;
    while(n>0&&(b[n-1]=='\n'||b[n-1]=='\r'||b[n-1]==' ')){b[--n]=0;} if(n>0) handleCmd(b); }
  static uint32_t last=0, lastTrig=0;
  if(g_svc && millis()-last>3000){ last=millis(); logf("[hb] connected %us",(millis()-g_connMs)/1000); }
  if(g_svc && g_softTrig && millis()-lastTrig>4000){ lastTrig=millis();
    auto* w=g_svc->getCharacteristic(WRITES[0]);
    if(w){ uint8_t pkt[8]; size_t n=ssi(pkt,0xE4); w->writeValue(pkt,n,false); } }
  delay(20);
}

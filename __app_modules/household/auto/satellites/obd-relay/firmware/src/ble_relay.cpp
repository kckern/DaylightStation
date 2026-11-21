#ifdef ENABLE_RELAY_BLE

#include <BLEDevice.h>
#include <BLESecurity.h>

#include "ble_relay.h"
#include "ble_status.h"

namespace obdrelay {
namespace {
constexpr char SERVICE[] = "6f2da9b0-7f19-4c7b-a8a8-525a39116f05";
constexpr char STATUS[] = "6f2da9b1-7f19-4c7b-a8a8-525a39116f05";
BLECharacteristic* status = nullptr;

class Reconnect : public BLEServerCallbacks {
  void onDisconnect(BLEServer*) override { BLEDevice::startAdvertising(); }
};
Reconnect reconnect;
} // namespace

void startBleRelay() {
  BLEDevice::init("Daylight OBD Relay");
  BLEDevice::setEncryptionLevel(ESP_BLE_SEC_ENCRYPT);
  BLESecurity security;
  security.setAuthenticationMode(ESP_LE_AUTH_BOND);
  security.setCapability(ESP_IO_CAP_NONE);
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(&reconnect);
  BLEService* service = server->createService(SERVICE);
  status = service->createCharacteristic(STATUS, BLECharacteristic::PROPERTY_READ);
  status->setAccessPermissions(ESP_GATT_PERM_READ_ENCRYPTED);
  updateBleRelay(false, UINT32_MAX, 0, 0, 0, 0, 0);
  service->start();
  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE);
  advertising->setScanResponse(true);
  advertising->setMinInterval(800);
  advertising->setMaxInterval(1200);
  advertising->start();
}

void updateBleRelay(bool ecuLinked, uint32_t sampleAgeMs, uint8_t fields, int16_t speedKph, int16_t rpm,
                    int16_t coolantC, uint16_t batteryMv) {
  if (!status) return;
  uint8_t payload[12];
  encodeBleStatus(payload, ecuLinked, sampleAgeMs, fields, speedKph, rpm, coolantC, batteryMv);
  status->setValue(payload, sizeof(payload));
}

} // namespace obdrelay

#endif

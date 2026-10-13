#pragma once

#include <Arduino.h>
#include <NimBLEDevice.h>

namespace schoolcalc_ble {

static constexpr size_t CONFIGURED_ADDRESS_BYTES = 18;
static constexpr size_t LABEL_BYTES = 40;
static constexpr size_t ERROR_BYTES = 112;
static constexpr size_t RAW_REPORT_BYTES = 8;
static constexpr size_t RAW_REPORT_QUEUE_CAPACITY = 16;

enum class State : uint8_t {
  Disabled,
  InvalidConfig,
  Initializing,
  Unpaired,
  PairingWindow,
  Backoff,
  Connecting,
  Securing,
  Discovering,
  Connected,
  Fault,
};

struct RawReport {
  uint32_t receivedAtMs = 0;
  uint8_t bytes[RAW_REPORT_BYTES]{};
};

struct Status {
  State state = State::Disabled;
  uint32_t stateRevision = 0;
  uint32_t stateChangedMs = 0;
  bool enabled = false;
  bool initialized = false;
  bool configured = false;
  bool connected = false;
  bool bonded = false;
  bool encrypted = false;
  bool authenticated = false;
  bool identityVerified = false;
  bool subscribed = false;
  bool pairingOpen = false;
  uint32_t pairingRemainingMs = 0;
  uint32_t pairingPasskey = 0;
  uint32_t connectAttempts = 0;
  uint32_t connectSuccesses = 0;
  uint32_t connectFailures = 0;
  uint32_t disconnects = 0;
  uint32_t authenticationFailures = 0;
  uint32_t reportsReceived = 0;
  uint32_t reportsDropped = 0;
  uint32_t invalidReports = 0;
  uint32_t lastReportMs = 0;
  uint32_t lastLivenessMs = 0;
  uint32_t nextConnectMs = 0;
  int32_t rssi = 0;
  int32_t lastReason = 0;
  size_t reportQueueDepth = 0;
  char configuredAddress[CONFIGURED_ADDRESS_BYTES]{};
  char resolvedAddress[CONFIGURED_ADDRESS_BYTES]{};
  char label[LABEL_BYTES]{};
  char lastError[ERROR_BYTES] = "none";
};

/**
 * Exact-address, bonded BLE HID Boot Keyboard central.
 *
 * NimBLE connection/security/discovery work runs in a dedicated low-priority
 * core-0 task. Notifications only copy fixed eight-byte reports into a FreeRTOS
 * queue; the Arduino loop owns translation and TI delivery.
 */
class KeyboardHost final : private NimBLEClientCallbacks {
public:
  KeyboardHost() = default;

  bool begin(bool enabled, const char* configuredAddress, uint8_t addressType,
             const char* label, uint32_t pairingWindowMs,
             bool requireMitm = true);
  bool openPairingWindow(uint32_t nowMs);
  bool forgetBond();
  bool popReport(RawReport& output);
  Status status(uint32_t nowMs) const;

private:
  static constexpr uint32_t CONNECT_TIMEOUT_MS = 5000;
  static constexpr uint32_t RETRY_MIN_MS = 1000;
  static constexpr uint32_t RETRY_MAX_MS = 30000;
  static constexpr uint32_t LIVENESS_PERIOD_MS = 2000;

  mutable portMUX_TYPE mux_ = portMUX_INITIALIZER_UNLOCKED;
  QueueHandle_t reports_ = nullptr;
  TaskHandle_t task_ = nullptr;
  NimBLEClient* client_ = nullptr;
  NimBLEAddress address_{};
  Status status_{};
  uint8_t addressType_ = BLE_ADDR_PUBLIC;
  uint32_t pairingWindowMs_ = 60000;
  uint32_t pairingDeadlineMs_ = 0;
  uint32_t retryDelayMs_ = RETRY_MIN_MS;
  bool requireMitm_ = true;
  bool pairingRequested_ = false;
  bool forgetRequested_ = false;

  static void taskEntry(void* context);
  void taskLoop();
  bool connectAndConfigure(uint32_t nowMs);
  void scheduleRetry(uint32_t nowMs, const char* error, int reason = 0,
                     bool countConnectFailure = true,
                     bool replaceExistingError = true);
  void transition(State state, const char* error = nullptr, int reason = 0);
  void handleReport(uint8_t* data, size_t length);

  void onConnect(NimBLEClient* client) override;
  void onConnectFail(NimBLEClient* client, int reason) override;
  void onDisconnect(NimBLEClient* client, int reason) override;
  void onPassKeyEntry(NimBLEConnInfo& connection) override;
  uint32_t onPassKeyDisplay(NimBLEConnInfo& connection) override;
  void onAuthenticationComplete(NimBLEConnInfo& connection) override;
  void onConfirmPasskey(NimBLEConnInfo& connection, uint32_t passkey) override;
  void onIdentity(NimBLEConnInfo& connection) override;
};

bool validIdentityAddress(const char* value);
const char* stateText(State state);

}  // namespace schoolcalc_ble

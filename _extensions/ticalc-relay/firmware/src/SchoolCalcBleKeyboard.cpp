#include "SchoolCalcBleKeyboard.h"

#include <esp_system.h>
#include <string.h>

namespace schoolcalc_ble {

namespace {

static constexpr uint16_t HID_SERVICE = 0x1812;
static constexpr uint16_t HID_PROTOCOL_MODE = 0x2A4E;
static constexpr uint16_t HID_BOOT_KEYBOARD_INPUT = 0x2A22;

static bool timeReached(uint32_t now, uint32_t deadline) {
  return static_cast<int32_t>(now - deadline) >= 0;
}

static bool hexDigit(char value) {
  return (value >= '0' && value <= '9')
    || (value >= 'A' && value <= 'F')
    || (value >= 'a' && value <= 'f');
}

}  // namespace

bool validIdentityAddress(const char* value) {
  if (value == nullptr || strlen(value) != 17) return false;
  for (size_t index = 0; index < 17; ++index) {
    if ((index + 1) % 3 == 0) {
      if (value[index] != ':') return false;
    } else if (!hexDigit(value[index])) return false;
  }
  return true;
}

bool KeyboardHost::begin(bool enabled, const char* configuredAddress,
                         uint8_t addressType, const char* label,
                         uint32_t pairingWindowMs, bool requireMitm) {
  portENTER_CRITICAL(&mux_);
  status_ = Status{};
  status_.enabled = enabled;
  snprintf(status_.configuredAddress, sizeof(status_.configuredAddress), "%s",
           configuredAddress == nullptr ? "" : configuredAddress);
  snprintf(status_.label, sizeof(status_.label), "%s", label == nullptr ? "" : label);
  portEXIT_CRITICAL(&mux_);
  if (!enabled) {
    transition(State::Disabled);
    return true;
  }
  if (!validIdentityAddress(configuredAddress)
      || (addressType != BLE_ADDR_PUBLIC && addressType != BLE_ADDR_RANDOM)
      || pairingWindowMs < 15000 || pairingWindowMs > 300000) {
    transition(State::InvalidConfig, "invalid BLE keyboard flash configuration");
    return false;
  }

  addressType_ = addressType;
  address_ = NimBLEAddress(std::string(configuredAddress), addressType_);
  pairingWindowMs_ = pairingWindowMs;
  requireMitm_ = requireMitm;
  transition(State::Initializing);
  reports_ = xQueueCreate(RAW_REPORT_QUEUE_CAPACITY, sizeof(RawReport));
  if (reports_ == nullptr) {
    transition(State::Fault, "could not allocate BLE report queue");
    return false;
  }
  if (!NimBLEDevice::init("SchoolCalc relay")) {
    transition(State::Fault, "NimBLE initialization failed");
    return false;
  }
  NimBLEDevice::setSecurityAuth(true, requireMitm_, true);
  NimBLEDevice::setSecurityIOCap(
    requireMitm_ ? BLE_HS_IO_DISPLAY_ONLY : BLE_HS_IO_NO_INPUT_OUTPUT);
  NimBLEDevice::setSecurityInitKey(BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID);
  NimBLEDevice::setSecurityRespKey(BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID);
  NimBLEDevice::whiteListAdd(address_);

  portENTER_CRITICAL(&mux_);
  status_.initialized = true;
  status_.configured = true;
  status_.bonded = NimBLEDevice::isBonded(address_);
  status_.nextConnectMs = millis();
  portEXIT_CRITICAL(&mux_);
  transition(status_.bonded ? State::Backoff : State::Unpaired);
  if (xTaskCreatePinnedToCore(taskEntry, "ble-keyboard", 6144, this, 2,
                              &task_, 0) != pdPASS) {
    task_ = nullptr;
    transition(State::Fault, "could not create BLE keyboard task");
    return false;
  }
  return true;
}

bool KeyboardHost::openPairingWindow(uint32_t nowMs) {
  portENTER_CRITICAL(&mux_);
  if (!status_.enabled || !status_.initialized || status_.state == State::Fault
      || status_.state == State::InvalidConfig) {
    portEXIT_CRITICAL(&mux_);
    return false;
  }
  pairingRequested_ = true;
  pairingDeadlineMs_ = nowMs + pairingWindowMs_;
  status_.pairingOpen = true;
  status_.pairingRemainingMs = pairingWindowMs_;
  status_.nextConnectMs = nowMs;
  portEXIT_CRITICAL(&mux_);
  transition(State::PairingWindow);
  return true;
}

bool KeyboardHost::forgetBond() {
  portENTER_CRITICAL(&mux_);
  if (!status_.enabled || !status_.initialized) {
    portEXIT_CRITICAL(&mux_);
    return false;
  }
  forgetRequested_ = true;
  portEXIT_CRITICAL(&mux_);
  return true;
}

bool KeyboardHost::popReport(RawReport& output) {
  return reports_ != nullptr && xQueueReceive(reports_, &output, 0) == pdTRUE;
}

Status KeyboardHost::status(uint32_t nowMs) const {
  portENTER_CRITICAL(&mux_);
  Status snapshot = status_;
  const uint32_t deadline = pairingDeadlineMs_;
  portEXIT_CRITICAL(&mux_);
  snapshot.reportQueueDepth = reports_ == nullptr ? 0 : uxQueueMessagesWaiting(reports_);
  snapshot.pairingRemainingMs = snapshot.pairingOpen && !timeReached(nowMs, deadline)
    ? deadline - nowMs : 0;
  return snapshot;
}

void KeyboardHost::taskEntry(void* context) {
  static_cast<KeyboardHost*>(context)->taskLoop();
}

void KeyboardHost::taskLoop() {
  uint32_t lastLivenessPollMs = 0;
  for (;;) {
    const uint32_t now = millis();
    bool forget = false;
    bool pairingOpen = false;
    bool bonded = false;
    bool connected = false;
    uint32_t nextConnect = 0;
    portENTER_CRITICAL(&mux_);
    forget = forgetRequested_;
    forgetRequested_ = false;
    pairingOpen = status_.pairingOpen;
    bonded = status_.bonded;
    connected = status_.connected;
    nextConnect = status_.nextConnectMs;
    portEXIT_CRITICAL(&mux_);

    if (forget) {
      portENTER_CRITICAL(&mux_);
      status_.bonded = false;
      status_.encrypted = false;
      status_.authenticated = false;
      status_.identityVerified = false;
      status_.subscribed = false;
      status_.connected = false;
      status_.pairingOpen = false;
      status_.pairingPasskey = 0;
      pairingRequested_ = false;
      pairingDeadlineMs_ = 0;
      portEXIT_CRITICAL(&mux_);
      transition(State::Unpaired, "configured keyboard bond removed");
      if (client_ != nullptr && client_->isConnected()) client_->disconnect();
      NimBLEDevice::deleteBond(address_);
      if (reports_ != nullptr) xQueueReset(reports_);
      retryDelayMs_ = RETRY_MIN_MS;
      bonded = false;
      connected = false;
      pairingOpen = false;
    }

    if (pairingOpen && timeReached(now, pairingDeadlineMs_)) {
      portENTER_CRITICAL(&mux_);
      status_.pairingOpen = false;
      status_.pairingPasskey = 0;
      pairingRequested_ = false;
      portEXIT_CRITICAL(&mux_);
      if (!bonded) {
        transition(State::Unpaired, "pairing window expired");
        if (client_ != nullptr && client_->isConnected()) client_->disconnect();
      }
      pairingOpen = false;
    }

    if (!connected && (bonded || pairingOpen) && timeReached(now, nextConnect)) {
      connectAndConfigure(now);
    } else if (connected && now - lastLivenessPollMs >= LIVENESS_PERIOD_MS) {
      lastLivenessPollMs = now;
      if (client_ == nullptr || !client_->isConnected()) {
        scheduleRetry(now, "BLE client no longer connected");
      } else {
        const int rssi = client_->getRssi();
        portENTER_CRITICAL(&mux_);
        status_.rssi = rssi;
        status_.lastLivenessMs = now;
        portEXIT_CRITICAL(&mux_);
      }
    }
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

bool KeyboardHost::connectAndConfigure(uint32_t nowMs) {
  transition(State::Connecting);
  portENTER_CRITICAL(&mux_);
  status_.connectAttempts++;
  portEXIT_CRITICAL(&mux_);
  if (client_ == nullptr) {
    client_ = NimBLEDevice::createClient();
    if (client_ == nullptr) {
      scheduleRetry(nowMs, "NimBLE client allocation failed");
      return false;
    }
    client_->setClientCallbacks(this, false);
    client_->setConnectionParams(12, 24, 0, 200);
    client_->setConnectTimeout(CONNECT_TIMEOUT_MS);
  }
  if (!client_->connect(address_, true, false, true)) {
    scheduleRetry(nowMs, "configured keyboard connection failed");
    return false;
  }

  transition(State::Securing);
  if (!client_->secureConnection(false)) {
    client_->disconnect();
    portENTER_CRITICAL(&mux_);
    status_.authenticationFailures++;
    portEXIT_CRITICAL(&mux_);
    scheduleRetry(nowMs, "keyboard encryption/bonding failed");
    return false;
  }
  const NimBLEConnInfo connection = client_->getConnInfo();
  const bool identityVerified = connection.getIdAddress() == address_;
  if (!connection.isEncrypted() || !connection.isBonded()
      || (requireMitm_ && !connection.isAuthenticated())) {
    client_->disconnect();
    portENTER_CRITICAL(&mux_);
    status_.authenticationFailures++;
    portEXIT_CRITICAL(&mux_);
    scheduleRetry(nowMs, requireMitm_
      ? "keyboard connection lacks bonded authenticated encryption"
      : "keyboard connection is not encrypted and bonded");
    return false;
  }
  if (!identityVerified) {
    const std::string resolved = connection.getIdAddress().toString();
    portENTER_CRITICAL(&mux_);
    status_.authenticationFailures++;
    status_.identityVerified = false;
    snprintf(status_.resolvedAddress, sizeof(status_.resolvedAddress), "%s",
             resolved.c_str());
    portEXIT_CRITICAL(&mux_);
    client_->disconnect();
    scheduleRetry(nowMs, "resolved keyboard identity does not match flash config");
    return false;
  }

  transition(State::Discovering);
  NimBLERemoteService* service = client_->getService(NimBLEUUID(HID_SERVICE));
  if (service == nullptr) {
    client_->disconnect();
    scheduleRetry(nowMs, "configured peer has no HID service 0x1812");
    return false;
  }
  NimBLERemoteCharacteristic* protocol = service->getCharacteristic(
    NimBLEUUID(HID_PROTOCOL_MODE));
  NimBLERemoteCharacteristic* input = service->getCharacteristic(
    NimBLEUUID(HID_BOOT_KEYBOARD_INPUT));
  const uint8_t bootMode = 0;
  if (protocol == nullptr || !protocol->canWrite()
      || !protocol->writeValue(&bootMode, sizeof(bootMode), true)) {
    client_->disconnect();
    scheduleRetry(nowMs, "keyboard cannot enter HID Boot Protocol");
    return false;
  }
  if (input == nullptr || !input->canNotify()
      || !input->subscribe(true,
        [this](NimBLERemoteCharacteristic*, uint8_t* data,
               size_t length, bool) { handleReport(data, length); }, true)) {
    client_->disconnect();
    scheduleRetry(nowMs, "keyboard Boot Input notification subscription failed");
    return false;
  }

  const int rssi = client_->getRssi();
  const std::string resolved = connection.getIdAddress().toString();
  portENTER_CRITICAL(&mux_);
  status_.connected = true;
  status_.bonded = true;
  status_.encrypted = true;
  status_.authenticated = connection.isAuthenticated();
  status_.identityVerified = true;
  status_.subscribed = true;
  status_.pairingOpen = false;
  status_.pairingPasskey = 0;
  status_.connectSuccesses++;
  status_.lastLivenessMs = millis();
  status_.rssi = rssi;
  snprintf(status_.resolvedAddress, sizeof(status_.resolvedAddress), "%s",
           resolved.c_str());
  pairingRequested_ = false;
  pairingDeadlineMs_ = 0;
  portEXIT_CRITICAL(&mux_);
  retryDelayMs_ = RETRY_MIN_MS;
  transition(State::Connected);
  return true;
}

void KeyboardHost::scheduleRetry(uint32_t nowMs, const char* error, int reason,
                                 bool countConnectFailure,
                                 bool replaceExistingError) {
  portENTER_CRITICAL(&mux_);
  const bool alreadyScheduled = status_.state == State::Backoff
    && !timeReached(nowMs, status_.nextConnectMs);
  status_.connected = false;
  status_.encrypted = false;
  status_.authenticated = false;
  status_.subscribed = false;
  if (!alreadyScheduled) {
    if (countConnectFailure) status_.connectFailures++;
    status_.nextConnectMs = nowMs + retryDelayMs_;
  }
  portEXIT_CRITICAL(&mux_);
  if (!alreadyScheduled || replaceExistingError) {
    transition(State::Backoff, error, reason);
  }
  if (!alreadyScheduled) {
    retryDelayMs_ = retryDelayMs_ >= RETRY_MAX_MS / 2
      ? RETRY_MAX_MS : retryDelayMs_ * 2;
  }
}

void KeyboardHost::transition(State state, const char* error, int reason) {
  portENTER_CRITICAL(&mux_);
  status_.state = state;
  status_.stateRevision++;
  status_.stateChangedMs = millis();
  status_.lastReason = reason;
  if (error != nullptr) {
    snprintf(status_.lastError, sizeof(status_.lastError), "%s", error);
  } else if (state == State::Connected || state == State::Disabled
             || state == State::Unpaired || state == State::PairingWindow) {
    snprintf(status_.lastError, sizeof(status_.lastError), "none");
  }
  portEXIT_CRITICAL(&mux_);
}

void KeyboardHost::handleReport(uint8_t* data, size_t length) {
  if (data == nullptr || length != RAW_REPORT_BYTES) {
    portENTER_CRITICAL(&mux_);
    status_.invalidReports++;
    portEXIT_CRITICAL(&mux_);
    return;
  }
  portENTER_CRITICAL(&mux_);
  const bool trusted = status_.connected && status_.bonded
    && status_.encrypted && status_.subscribed;
  portEXIT_CRITICAL(&mux_);
  if (!trusted) return;
  RawReport report{};
  report.receivedAtMs = millis();
  memcpy(report.bytes, data, sizeof(report.bytes));
  const bool accepted = reports_ != nullptr
    && xQueueSend(reports_, &report, 0) == pdTRUE;
  portENTER_CRITICAL(&mux_);
  if (accepted) {
    status_.reportsReceived++;
    status_.lastReportMs = report.receivedAtMs;
  } else {
    status_.reportsDropped++;
  }
  portEXIT_CRITICAL(&mux_);
}

void KeyboardHost::onConnect(NimBLEClient*) {
  portENTER_CRITICAL(&mux_);
  status_.connected = true;
  portEXIT_CRITICAL(&mux_);
}

void KeyboardHost::onConnectFail(NimBLEClient*, int reason) {
  portENTER_CRITICAL(&mux_);
  status_.lastReason = reason;
  portEXIT_CRITICAL(&mux_);
}

void KeyboardHost::onDisconnect(NimBLEClient*, int reason) {
  const uint32_t now = millis();
  portENTER_CRITICAL(&mux_);
  const State previousState = status_.state;
  const bool reconnectEligible = status_.bonded || status_.pairingOpen;
  status_.connected = false;
  status_.encrypted = false;
  status_.authenticated = false;
  status_.subscribed = false;
  status_.disconnects++;
  status_.lastReason = reason;
  status_.nextConnectMs = now + retryDelayMs_;
  portEXIT_CRITICAL(&mux_);
  if (reconnectEligible && previousState != State::Fault
      && previousState != State::InvalidConfig
      && previousState != State::Disabled
      && previousState != State::Unpaired) {
    scheduleRetry(now, "keyboard disconnected", reason, false, false);
  }
}

void KeyboardHost::onPassKeyEntry(NimBLEConnInfo& connection) {
  // This relay has no trustworthy way to obtain a passkey displayed by the
  // keyboard. Fail closed; supported keyboard pairing has the relay display a
  // random key through the local web status and the user types it on keyboard.
  transition(State::Fault, "keyboard requested unsupported host passkey entry");
  if (client_ != nullptr && client_->isConnected()) client_->disconnect();
}

uint32_t KeyboardHost::onPassKeyDisplay(NimBLEConnInfo&) {
  const uint32_t passkey = 100000 + (esp_random() % 900000);
  portENTER_CRITICAL(&mux_);
  status_.pairingPasskey = passkey;
  portEXIT_CRITICAL(&mux_);
  return passkey;
}

void KeyboardHost::onAuthenticationComplete(NimBLEConnInfo& connection) {
  portENTER_CRITICAL(&mux_);
  status_.encrypted = connection.isEncrypted();
  status_.bonded = connection.isBonded();
  status_.authenticated = connection.isAuthenticated();
  if (!status_.encrypted || !status_.bonded
      || (requireMitm_ && !status_.authenticated)) {
    status_.authenticationFailures++;
  }
  portEXIT_CRITICAL(&mux_);
}

void KeyboardHost::onConfirmPasskey(NimBLEConnInfo& connection, uint32_t) {
  NimBLEDevice::injectConfirmPasskey(connection, false);
  transition(State::Fault, "numeric-comparison pairing is unsupported");
  if (client_ != nullptr && client_->isConnected()) client_->disconnect();
}

void KeyboardHost::onIdentity(NimBLEConnInfo& connection) {
  const NimBLEAddress identity = connection.getIdAddress();
  const bool verified = identity == address_;
  const std::string resolved = identity.toString();
  portENTER_CRITICAL(&mux_);
  status_.identityVerified = verified;
  if (!verified) status_.authenticationFailures++;
  snprintf(status_.resolvedAddress, sizeof(status_.resolvedAddress), "%s",
           resolved.c_str());
  portEXIT_CRITICAL(&mux_);
  if (!verified) {
    transition(State::Fault, "resolved keyboard identity does not match flash config");
    if (client_ != nullptr && client_->isConnected()) client_->disconnect();
  }
}

const char* stateText(State state) {
  switch (state) {
    case State::Disabled: return "disabled";
    case State::InvalidConfig: return "invalid_config";
    case State::Initializing: return "initializing";
    case State::Unpaired: return "unpaired";
    case State::PairingWindow: return "pairing_window";
    case State::Backoff: return "backoff";
    case State::Connecting: return "connecting";
    case State::Securing: return "securing";
    case State::Discovering: return "discovering";
    case State::Connected: return "connected";
    case State::Fault: return "fault";
  }
  return "unknown";
}

}  // namespace schoolcalc_ble

// ticalc-relay — safe M5/ESP32 bring-up for a TI 2.5 mm TRS link.
//
// The calculator bus is 5 V open-collector. The sink outputs remain released
// by default; an explicitly enabled, read-only screenshot diagnostic uses the
// level-shifted inputs and external open-drain sinks through TiLinkTransport.
#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <FastLED.h>
#include "config.h"
#include "SchoolCalcDiagnostics.h"
#include "SchoolCalcBleKeyboard.h"
#include "SchoolCalcEspAdapters.h"
#include "SchoolCalcInput.h"
#include "SchoolCalcRelaySession.h"
#include "SchoolCalcTransportAwareness.h"
#include "TiLinkTransport.h"

#ifndef TI_TRANSMIT_ENABLED
#define TI_TRANSMIT_ENABLED 0
#endif
#ifndef AUTO_SYNC_ENABLED
#define AUTO_SYNC_ENABLED 0
#endif
#ifndef FOREGROUND_LISTENER_ENABLED
#define FOREGROUND_LISTENER_ENABLED 1
#endif
#ifndef FIRMWARE_CONFIG_FINGERPRINT
#define FIRMWARE_CONFIG_FINGERPRINT "legacy-config"
#endif
#ifndef BLE_KEYBOARD_ENABLED
#define BLE_KEYBOARD_ENABLED 0
#endif
#ifndef BLE_KEYBOARD_ADDRESS
#define BLE_KEYBOARD_ADDRESS ""
#endif
#ifndef BLE_KEYBOARD_ADDRESS_TYPE
#define BLE_KEYBOARD_ADDRESS_TYPE 0
#endif
#ifndef BLE_KEYBOARD_LABEL
#define BLE_KEYBOARD_LABEL ""
#endif
#ifndef BLE_KEYBOARD_PAIRING_WINDOW_MS
#define BLE_KEYBOARD_PAIRING_WINDOW_MS 60000
#endif
#ifndef BLE_KEYBOARD_REQUIRE_MITM
#define BLE_KEYBOARD_REQUIRE_MITM 1
#endif
#ifndef PLUG_DETECT_PIN
#define PLUG_DETECT_PIN -1
#endif
#ifndef PLUG_DETECT_ACTIVE_HIGH
#define PLUG_DETECT_ACTIVE_HIGH 1
#endif

static WebServer http(80);
static WebSocketsClient ws;
static CRGB led[1];
static volatile bool wsConnected = false;
static uint32_t bootMs, lineChanges = 0, syncRequests = 0;
static bool lastTip = false, lastRing = false;
static uint32_t lastTipChange = 0, lastRingChange = 0;
static uint32_t bothLowSinceMs = 0;
static bool bothLowFaultActive = false;
static uint32_t lastWifiTryMs = 0;
static constexpr uint32_t PLUG_DETECT_DEBOUNCE_MS = 75;
static bool plugDetectInitialized = false;
static bool plugDetectRaw = false, plugInserted = false;
static uint32_t plugDetectRawChangedMs = 0, plugDetectChangedMs = 0;

static portMUX_TYPE diagnosticMux = portMUX_INITIALIZER_UNLOCKED;
static schoolcalc_diagnostics::Journal diagnosticJournal;
static schoolcalc_diagnostics::Event diagnosticSnapshot[
  schoolcalc_diagnostics::EVENT_CAPACITY];

struct RelayIoMetrics {
  uint32_t calculatorOperations = 0;
  uint32_t calculatorFailures = 0;
  uint32_t calculatorBytes = 0;
  uint32_t foregroundFramesTx = 0;
  uint32_t foregroundFramesRx = 0;
  uint32_t foregroundFailures = 0;
  uint32_t foregroundBytesTx = 0;
  uint32_t foregroundBytesRx = 0;
  uint32_t httpRequests = 0;
  uint32_t httpSuccesses = 0;
  uint32_t httpFailures = 0;
  uint32_t httpRequestBytes = 0;
  uint32_t httpResponseBytes = 0;
  int lastHttpStatus = 0;
  uint32_t lastHttpDurationMs = 0;
  uint32_t lastHttpAtMs = 0;
  char lastHttpOperation[20] = "none";
  char lastHttpError[96] = "none";
};

static RelayIoMetrics relayIoMetrics;
static uint32_t wifiConnectAttempts = 0, wifiConnectSuccesses = 0;
static uint32_t wifiConnectFailures = 0, wifiLastChangeMs = 0;
static uint32_t wifiLastConnectDurationMs = 0;
static uint32_t wsConnectCount = 0, wsDisconnectCount = 0, wsErrorCount = 0;
static uint32_t wsMessagesRx = 0, wsMessagesTx = 0, wsBytesRx = 0, wsBytesTx = 0;
static uint32_t wsHeartbeatSuccesses = 0, wsHeartbeatFailures = 0;
static uint32_t wsLastChangeMs = 0, wsLastRxMs = 0, wsLastTxMs = 0;
static char wsLastError[96] = "none";
// Mirrors the currently queued/running TI operation for payload-free journal
// correlation. It is deliberately separate from tiStatusMux so I/O observers
// can attach one parent ID without taking the status lock recursively.
static uint32_t diagnosticOperationId = 0;

static uint32_t recordDiagnostic(
  schoolcalc_diagnostics::Subsystem subsystem,
  schoolcalc_diagnostics::Severity severity,
  const char* name, const char* detail = nullptr,
  uint32_t correlation = 0, uint32_t bytes = 0,
  int32_t status = 0, uint32_t durationMs = 0) {
  portENTER_CRITICAL(&diagnosticMux);
  const uint32_t sequence = diagnosticJournal.record(
    millis(), subsystem, severity, name, detail,
    correlation, bytes, status, durationMs);
  portEXIT_CRITICAL(&diagnosticMux);
  return sequence;
}

static uint32_t currentDiagnosticOperation() {
  portENTER_CRITICAL(&diagnosticMux);
  const uint32_t operationId = diagnosticOperationId;
  portEXIT_CRITICAL(&diagnosticMux);
  return operationId;
}

static void setDiagnosticOperation(uint32_t operationId) {
  portENTER_CRITICAL(&diagnosticMux);
  diagnosticOperationId = operationId;
  portEXIT_CRITICAL(&diagnosticMux);
}

static void clearDiagnosticOperation(uint32_t operationId) {
  portENTER_CRITICAL(&diagnosticMux);
  // A new operation may have been queued immediately after the old task
  // released ownership. Never let the old completion erase the new context.
  if (diagnosticOperationId == operationId) diagnosticOperationId = 0;
  portEXIT_CRITICAL(&diagnosticMux);
}

class RelayIoObserver final : public schoolcalc_relay::IRelayIoObserver {
public:
  void onCalculatorIo(const char* operation, const char* resource,
                      bool ok, uint32_t bytes, uint32_t durationMs,
                      const char* detail) override {
    portENTER_CRITICAL(&diagnosticMux);
    relayIoMetrics.calculatorOperations++;
    if (!ok) relayIoMetrics.calculatorFailures++;
    relayIoMetrics.calculatorBytes += bytes;
    portEXIT_CRITICAL(&diagnosticMux);
    char safeDetail[schoolcalc_diagnostics::EVENT_DETAIL_BYTES];
    snprintf(safeDetail, sizeof(safeDetail), "%s %s: %s",
             operation == nullptr ? "io" : operation,
             resource == nullptr ? "unknown" : resource,
             detail == nullptr ? "unknown" : detail);
    recordDiagnostic(schoolcalc_diagnostics::Subsystem::TiSession,
                     ok ? schoolcalc_diagnostics::Severity::Info
                        : schoolcalc_diagnostics::Severity::Error,
                     "calculator_variable", safeDetail,
                     currentDiagnosticOperation(), bytes,
                     ok ? 0 : -1, durationMs);
  }

  void onForegroundFrame(bool outbound, bool ok, uint16_t bytes,
                         uint32_t durationMs, const char* detail) override {
    portENTER_CRITICAL(&diagnosticMux);
    if (outbound) {
      relayIoMetrics.foregroundFramesTx++;
      relayIoMetrics.foregroundBytesTx += bytes;
    } else {
      relayIoMetrics.foregroundFramesRx++;
      relayIoMetrics.foregroundBytesRx += bytes;
    }
    if (!ok) relayIoMetrics.foregroundFailures++;
    portEXIT_CRITICAL(&diagnosticMux);
    recordDiagnostic(schoolcalc_diagnostics::Subsystem::TiPacket,
                     ok ? schoolcalc_diagnostics::Severity::Debug
                        : schoolcalc_diagnostics::Severity::Error,
                     outbound ? "foreground_tx" : "foreground_rx",
                     detail, currentDiagnosticOperation(), bytes,
                     ok ? 0 : -1, durationMs);
  }

  void onHttpIo(const char* operation, bool ok, int status,
                uint32_t requestBytes, uint32_t responseBytes,
                uint32_t durationMs, const char* detail) override {
    portENTER_CRITICAL(&diagnosticMux);
    relayIoMetrics.httpRequests++;
    if (ok) relayIoMetrics.httpSuccesses++;
    else relayIoMetrics.httpFailures++;
    relayIoMetrics.httpRequestBytes += requestBytes;
    relayIoMetrics.httpResponseBytes += responseBytes;
    relayIoMetrics.lastHttpStatus = status;
    relayIoMetrics.lastHttpDurationMs = durationMs;
    relayIoMetrics.lastHttpAtMs = millis();
    snprintf(relayIoMetrics.lastHttpOperation,
             sizeof(relayIoMetrics.lastHttpOperation), "%s",
             operation == nullptr ? "unknown" : operation);
    snprintf(relayIoMetrics.lastHttpError,
             sizeof(relayIoMetrics.lastHttpError), "%s",
             ok ? "none" : (detail == nullptr ? "unknown" : detail));
    portEXIT_CRITICAL(&diagnosticMux);
    const uint32_t totalBytes = requestBytes + responseBytes;
    recordDiagnostic(schoolcalc_diagnostics::Subsystem::HttpApi,
                     ok ? schoolcalc_diagnostics::Severity::Info
                        : schoolcalc_diagnostics::Severity::Error,
                     operation == nullptr ? "http" : operation,
                     ok ? "complete" : detail,
                     currentDiagnosticOperation(), totalBytes,
                     status, durationMs);
  }
};

static RelayIoObserver relayIoObserver;
static schoolcalc_ble::KeyboardHost keyboardHost;
static schoolcalc_input::BootKeyboardTranslator keyboardTranslator;
static schoolcalc_input::InputQueue inputQueue;
static portMUX_TYPE inputMux = portMUX_INITIALIZER_UNLOCKED;
static uint32_t lastBleStateRevision = 0;
static uint32_t lastBleReportsDropped = 0;
static uint32_t inputDeliveryAttempts = 0, inputDeliverySuccesses = 0;
static uint32_t inputDeliveryFailures = 0, inputUnsupportedReports = 0;
static uint32_t inputLastDeliveredSequence = 0, inputLastDeliveryLatencyMs = 0;
static uint32_t inputRetryNotBeforeMs = 0;
static char inputLastDelivery[24] = "none";
static char inputLastError[96] = "none";

static constexpr uint32_t WIFI_CONNECT_TIMEOUT_MS = 20000;
static constexpr uint32_t WIFI_RETRY_PERIOD_MS = 15000;
static constexpr uint32_t WS_HEARTBEAT_MS = 30000;
static constexpr uint32_t AUTO_SYNC_PERIOD_MS = 15000;
static uint32_t lastWsHeartbeatMs = 0;
static uint32_t lastAutoSyncMs = 0;
static bool calculatorAttached();
static bool deadlineReached(uint32_t now, uint32_t deadline) {
  return static_cast<int32_t>(now - deadline) >= 0;
}

// TI edge timing runs in one high-priority task on core 1. ESP32 Wi-Fi runs on
// core 0; the lower-priority Arduino loop cannot stretch a cable handshake.
enum class TiJob : uint8_t { Screenshot, SilentSync, ForegroundSync, RemoteKey };
static QueueHandle_t tiJobs = nullptr;
static TiLinkTransport tiLink(TIP_SENSE_PIN, TIP_SINK_PIN, RING_SENSE_PIN, RING_SINK_PIN, TI_TRANSMIT_ENABLED);
static schoolcalc_relay::TiCalculatorVariables calculatorVariables(tiLink);
static schoolcalc_relay::TiForegroundFrameChannel foregroundFrameChannel(tiLink);
static schoolcalc_relay::SchoolCalcHttpApi schoolCalcApi(
  BACKEND_SCHEME, BACKEND_HOST, BACKEND_PORT, API_BASE_PATH, RELAY_ID, API_TOKEN);
static uint8_t screenshot[1024];

// Bounded transaction workspace. It is reserved once at boot (never churned)
// because the ESP32's fixed DRAM segment is smaller than its total heap.
static constexpr uint16_t IDENTITY_CAPACITY = 512;
static constexpr uint16_t DEVICE_INFO_CAPACITY = 4096;
static constexpr uint16_t INSTALLED_STATE_CAPACITY = schoolcalc_relay::TI86_SYNC_MANIFEST_MAX_BYTES;
static constexpr uint16_t RESULT_QUEUE_CAPACITY = schoolcalc_relay::TI86_RESULT_QUEUE_MAX_BYTES;
static constexpr uint16_t DELIVERY_REQUEST_CAPACITY = schoolcalc_relay::TI86_DELIVERY_REQUEST_MAX_BYTES;
static constexpr uint16_t INTERACTION_REQUEST_CAPACITY = schoolcalc_relay::TI86_INTERACTION_REQUEST_MAX_BYTES;
static constexpr uint16_t LEARNER_ROSTER_CAPACITY = schoolcalc_relay::TI86_LEARNER_ROSTER_MAX_BYTES;
static constexpr uint16_t PROGRESS_PROJECTION_CAPACITY = schoolcalc_relay::TI86_PROGRESS_PROJECTION_MAX_BYTES;
static constexpr uint16_t INTERACTION_RESPONSE_CAPACITY = schoolcalc_relay::TI86_INTERACTION_RESPONSE_MAX_BYTES;
static constexpr uint16_t STUDY_ENTRY_CAPACITY = schoolcalc_relay::TI86_STUDY_ENTRY_MAX_BYTES;
static constexpr uint16_t STUDY_PRESCRIPTION_CAPACITY = schoolcalc_relay::TI86_STUDY_PRESCRIPTION_MAX_BYTES;
static constexpr uint16_t STUDY_COMMIT_CAPACITY = schoolcalc_relay::TI86_STUDY_COMMIT_MAX_BYTES;
static constexpr uint16_t ACKNOWLEDGEMENT_CAPACITY = schoolcalc_relay::TI86_ACKNOWLEDGEMENT_MAX_BYTES;
static constexpr uint16_t MANIFEST_CAPACITY = schoolcalc_relay::TI86_SYNC_MANIFEST_MAX_BYTES;
static constexpr uint16_t TRANSFER_CAPACITY = schoolcalc_relay::TI86_ARTIFACT_MAX_BYTES;
static constexpr size_t SYNC_WORKSPACE_BYTES = IDENTITY_CAPACITY + DEVICE_INFO_CAPACITY
  + INSTALLED_STATE_CAPACITY + RESULT_QUEUE_CAPACITY
  + DELIVERY_REQUEST_CAPACITY + INTERACTION_REQUEST_CAPACITY
  + LEARNER_ROSTER_CAPACITY + PROGRESS_PROJECTION_CAPACITY
  + INTERACTION_RESPONSE_CAPACITY
  + STUDY_ENTRY_CAPACITY + STUDY_PRESCRIPTION_CAPACITY + STUDY_COMMIT_CAPACITY
  + ACKNOWLEDGEMENT_CAPACITY
  + MANIFEST_CAPACITY + TRANSFER_CAPACITY;
static uint8_t* syncWorkspace = nullptr;

static portMUX_TYPE tiStatusMux = portMUX_INITIALIZER_UNLOCKED;
static bool tiBusy = false, tiJobPending = false, tiScreenshotReady = false;
static bool tiLastSyncReady = false;
static uint32_t tiScreenshotCount = 0, tiFailureCount = 0, tiLastScreenshotMs = 0;
static uint32_t tiSyncCount = 0, tiSyncSuccessCount = 0, tiLastSyncMs = 0;
static uint32_t tiCalculatorInitiatedSyncCount = 0;
static uint32_t tiNextOperationId = 1, tiActiveOperationId = 0, tiLastOperationId = 0;
static uint8_t tiLastArtifactsStaged = 0;
static bool tiLastProfilesStaged = false;
static bool tiLastProgressStaged = false;
static bool tiLastInteractionStaged = false;
static uint8_t tiItemsCompleted = 0, tiItemsTotal = 0;
static bool tiSafeToUnplug = true;
static bool tiPeerVerifiedThisSession = false;
static uint32_t tiPhaseChangedMs = 0, tiPeerSeenMs = 0;
static char tiLastOperation[16] = "none";
static char tiLastTransport[16] = "none";
static char tiLastInitiator[16] = "none";
static char tiLastDeviceId[schoolcalc_relay::MAX_DEVICE_ID_BYTES + 1] = "";
static char tiLastState[40] = "idle";
static char tiDirection[24] = "idle";
static char tiLastError[112] = "not tested";

static String apiUrl(const char* suffix) {
  return String(BACKEND_SCHEME) + "://" + BACKEND_HOST + ":" + BACKEND_PORT + API_BASE_PATH + suffix;
}

static schoolcalc_relay::SessionBuffers sessionBuffers() {
  schoolcalc_relay::SessionBuffers buffers{};
  uint8_t* cursor = syncWorkspace;
  buffers.identity.bytes = cursor;
  buffers.identity.capacity = IDENTITY_CAPACITY;
  cursor += IDENTITY_CAPACITY;
  buffers.deviceInfo.bytes = cursor;
  buffers.deviceInfo.capacity = DEVICE_INFO_CAPACITY;
  cursor += DEVICE_INFO_CAPACITY;
  buffers.installedState.bytes = cursor;
  buffers.installedState.capacity = INSTALLED_STATE_CAPACITY;
  cursor += INSTALLED_STATE_CAPACITY;
  buffers.resultQueue.bytes = cursor;
  buffers.resultQueue.capacity = RESULT_QUEUE_CAPACITY;
  cursor += RESULT_QUEUE_CAPACITY;
  buffers.deliveryRequests.bytes = cursor;
  buffers.deliveryRequests.capacity = DELIVERY_REQUEST_CAPACITY;
  cursor += DELIVERY_REQUEST_CAPACITY;
  buffers.interactionRequest.bytes = cursor;
  buffers.interactionRequest.capacity = INTERACTION_REQUEST_CAPACITY;
  cursor += INTERACTION_REQUEST_CAPACITY;
  buffers.learnerRoster.bytes = cursor;
  buffers.learnerRoster.capacity = LEARNER_ROSTER_CAPACITY;
  cursor += LEARNER_ROSTER_CAPACITY;
  buffers.progressProjection.bytes = cursor;
  buffers.progressProjection.capacity = PROGRESS_PROJECTION_CAPACITY;
  cursor += PROGRESS_PROJECTION_CAPACITY;
  buffers.interactionResponse.bytes = cursor;
  buffers.interactionResponse.capacity = INTERACTION_RESPONSE_CAPACITY;
  cursor += INTERACTION_RESPONSE_CAPACITY;
  buffers.acknowledgement.bytes = cursor;
  buffers.acknowledgement.capacity = ACKNOWLEDGEMENT_CAPACITY;
  cursor += ACKNOWLEDGEMENT_CAPACITY;
  buffers.manifest.bytes = cursor;
  buffers.manifest.capacity = MANIFEST_CAPACITY;
  cursor += MANIFEST_CAPACITY;
  buffers.transfer.bytes = cursor;
  buffers.transfer.capacity = TRANSFER_CAPACITY;
  cursor += TRANSFER_CAPACITY;
  buffers.studyEntry.bytes = cursor;
  buffers.studyEntry.capacity = STUDY_ENTRY_CAPACITY;
  cursor += STUDY_ENTRY_CAPACITY;
  buffers.studyPrescription.bytes = cursor;
  buffers.studyPrescription.capacity = STUDY_PRESCRIPTION_CAPACITY;
  cursor += STUDY_PRESCRIPTION_CAPACITY;
  buffers.studyCommit.bytes = cursor;
  buffers.studyCommit.capacity = STUDY_COMMIT_CAPACITY;
  return buffers;
}

static const char* tiJobText(TiJob job) {
  switch (job) {
    case TiJob::Screenshot: return "screenshot";
    case TiJob::SilentSync: return "silent_sync";
    case TiJob::ForegroundSync: return "foreground_sync";
    case TiJob::RemoteKey: return "remote_key";
  }
  return "unknown";
}

static bool queueTiJob(TiJob job, uint32_t* acceptedOperationId = nullptr) {
  if (acceptedOperationId != nullptr) *acceptedOperationId = 0;
  const bool needsWorkspace = job == TiJob::SilentSync || job == TiJob::ForegroundSync;
  if (!tiJobs || (needsWorkspace && syncWorkspace == nullptr)) return false;
  portENTER_CRITICAL(&tiStatusMux);
  const bool busy = tiBusy || tiJobPending;
  uint32_t operationId = 0;
  if (!busy) {
    tiJobPending = true;
    if (tiNextOperationId == 0) tiNextOperationId = 1;
    tiActiveOperationId = tiNextOperationId++;
    operationId = tiActiveOperationId;
  }
  if (!busy) {
    tiSafeToUnplug = false;
    tiPeerVerifiedThisSession = false;
    tiItemsCompleted = 0;
    tiItemsTotal = 0;
    tiPhaseChangedMs = millis();
    snprintf(tiLastState, sizeof(tiLastState), "queued");
    snprintf(tiDirection, sizeof(tiDirection), "idle");
  }
  portEXIT_CRITICAL(&tiStatusMux);
  if (busy) {
    recordDiagnostic(schoolcalc_diagnostics::Subsystem::TiSession,
                     schoolcalc_diagnostics::Severity::Warning,
                     "job_rejected", "TI link task is busy");
    return false;
  }
  setDiagnosticOperation(operationId);
  if (xQueueSend(tiJobs, &job, 0) == pdTRUE) {
    if (acceptedOperationId != nullptr) *acceptedOperationId = operationId;
    recordDiagnostic(schoolcalc_diagnostics::Subsystem::TiSession,
                     schoolcalc_diagnostics::Severity::Info,
                     "job_queued",
                     tiJobText(job),
                     operationId);
    return true;
  }
  portENTER_CRITICAL(&tiStatusMux);
  tiJobPending = false;
  tiLastOperationId = tiActiveOperationId;
  tiActiveOperationId = 0;
  tiSafeToUnplug = true;
  snprintf(tiLastState, sizeof(tiLastState), "idle");
  portEXIT_CRITICAL(&tiStatusMux);
  clearDiagnosticOperation(operationId);
  recordDiagnostic(schoolcalc_diagnostics::Subsystem::TiSession,
                   schoolcalc_diagnostics::Severity::Error,
                   "job_queue_failed", "FreeRTOS TI job queue rejected operation",
                   operationId);
  return false;
}

static bool copyInputHead(schoolcalc_input::InputEvent& output) {
  portENTER_CRITICAL(&inputMux);
  const schoolcalc_input::InputEvent* head = inputQueue.peek();
  const bool found = head != nullptr;
  if (found) output = *head;
  portEXIT_CRITICAL(&inputMux);
  return found;
}

static bool acknowledgeInput(uint32_t sequence, const char* delivery,
                             uint32_t deliveredAtMs) {
  uint32_t latency = 0;
  schoolcalc_input::AcknowledgeStatus acknowledgement =
    schoolcalc_input::AcknowledgeStatus::Empty;
  portENTER_CRITICAL(&inputMux);
  const schoolcalc_input::InputEvent* head = inputQueue.peek();
  if (head != nullptr && head->sequence == sequence) {
    latency = deliveredAtMs - head->enqueuedAtMs;
  }
  acknowledgement = inputQueue.acknowledge(sequence);
  if (acknowledgement == schoolcalc_input::AcknowledgeStatus::Accepted) {
    inputDeliverySuccesses++;
    inputLastDeliveredSequence = sequence;
    inputLastDeliveryLatencyMs = latency;
    snprintf(inputLastDelivery, sizeof(inputLastDelivery), "%s",
             delivery == nullptr ? "unknown" : delivery);
    snprintf(inputLastError, sizeof(inputLastError), "none");
  }
  portEXIT_CRITICAL(&inputMux);
  if (acknowledgement == schoolcalc_input::AcknowledgeStatus::Accepted) {
    recordDiagnostic(schoolcalc_diagnostics::Subsystem::InputQueue,
                     schoolcalc_diagnostics::Severity::Info,
                     "input_acknowledged", delivery, sequence, 0, 0, latency);
    return true;
  }
  recordDiagnostic(schoolcalc_diagnostics::Subsystem::InputQueue,
                   schoolcalc_diagnostics::Severity::Error,
                   "input_ack_mismatch",
                   schoolcalc_input::acknowledgeStatusText(acknowledgement), sequence);
  return false;
}

static void enqueueInputSpec(const schoolcalc_input::InputSpec& input,
                             uint32_t nowMs) {
  uint32_t sequence = 0;
  portENTER_CRITICAL(&inputMux);
  const schoolcalc_input::EnqueueStatus status = inputQueue.enqueue(
    input, nowMs, &sequence);
  portEXIT_CRITICAL(&inputMux);
  if (status != schoolcalc_input::EnqueueStatus::Accepted) {
    recordDiagnostic(schoolcalc_diagnostics::Subsystem::InputQueue,
                     schoolcalc_diagnostics::Severity::Error,
                     "input_rejected", schoolcalc_input::enqueueStatusText(status));
  }
}

static void serviceKeyboardInput() {
  const uint32_t now = millis();
  const schoolcalc_ble::Status ble = keyboardHost.status(now);
  if (ble.stateRevision != lastBleStateRevision) {
    lastBleStateRevision = ble.stateRevision;
    if (ble.state != schoolcalc_ble::State::Connected) keyboardTranslator.reset();
    recordDiagnostic(schoolcalc_diagnostics::Subsystem::BleKeyboard,
                     ble.state == schoolcalc_ble::State::Fault
                         || ble.state == schoolcalc_ble::State::InvalidConfig
                       ? schoolcalc_diagnostics::Severity::Error
                       : (ble.state == schoolcalc_ble::State::Backoff
                          ? schoolcalc_diagnostics::Severity::Warning
                          : schoolcalc_diagnostics::Severity::Info),
                     schoolcalc_ble::stateText(ble.state), ble.lastError,
                     0, 0, ble.lastReason);
  }
  if (ble.reportsDropped != lastBleReportsDropped) {
    const uint32_t dropped = ble.reportsDropped - lastBleReportsDropped;
    lastBleReportsDropped = ble.reportsDropped;
    recordDiagnostic(schoolcalc_diagnostics::Subsystem::BleKeyboard,
                     schoolcalc_diagnostics::Severity::Error,
                     "report_queue_overflow", "raw HID report dropped", 0, dropped);
  }

  schoolcalc_ble::RawReport report{};
  uint8_t reportsProcessed = 0;
  while (reportsProcessed < 8 && keyboardHost.popReport(report)) {
    schoolcalc_input::InputSpec translated[
      schoolcalc_input::BOOT_KEYBOARD_KEY_SLOTS]{};
    const schoolcalc_input::TranslationResult result = keyboardTranslator.update(
      report.bytes, sizeof(report.bytes), report.receivedAtMs,
      translated, schoolcalc_input::BOOT_KEYBOARD_KEY_SLOTS);
    if (result.status != schoolcalc_input::ReportStatus::Ok) {
      inputUnsupportedReports++;
      recordDiagnostic(schoolcalc_diagnostics::Subsystem::BleKeyboard,
                       schoolcalc_diagnostics::Severity::Warning,
                       "invalid_hid_report",
                       schoolcalc_input::reportStatusText(result.status));
    }
    inputUnsupportedReports += result.unsupported;
    for (size_t index = 0; index < result.count; ++index) {
      enqueueInputSpec(translated[index], report.receivedAtMs);
    }
    reportsProcessed++;
  }
  if (ble.connected) {
    schoolcalc_input::InputSpec repeated{};
    if (keyboardTranslator.tick(now, &repeated, 1) == 1) {
      enqueueInputSpec(repeated, now);
    }
  }

  bool occupied = false;
  portENTER_CRITICAL(&tiStatusMux);
  occupied = tiBusy || tiJobPending;
  portEXIT_CRITICAL(&tiStatusMux);
  schoolcalc_input::InputEvent head{};
  if (TI_TRANSMIT_ENABLED && !occupied
      && deadlineReached(now, inputRetryNotBeforeMs)
      && copyInputHead(head)) {
    queueTiJob(TiJob::RemoteKey);
  }
}

static void setLed(const CRGB& color) { led[0] = color; FastLED.show(); }

class RelaySessionObserver final : public schoolcalc_relay::ISchoolCalcSessionObserver {
public:
  void onSessionProgress(schoolcalc_relay::SessionState state,
                         schoolcalc_relay::SessionDirection direction,
                         uint8_t itemsCompleted, uint8_t itemsTotal) override {
    uint32_t operationId = 0;
    bool safeToUnplug = false;
    portENTER_CRITICAL(&tiStatusMux);
    snprintf(tiLastState, sizeof(tiLastState), "%s",
             schoolcalc_relay::sessionStateText(state));
    snprintf(tiDirection, sizeof(tiDirection), "%s",
             schoolcalc_relay::sessionDirectionText(direction));
    tiItemsCompleted = itemsCompleted;
    tiItemsTotal = itemsTotal;
    tiPhaseChangedMs = millis();
    tiSafeToUnplug = state == schoolcalc_relay::SessionState::AwaitingCalculatorCommit
      || state == schoolcalc_relay::SessionState::Failed;
    safeToUnplug = tiSafeToUnplug;
    operationId = tiActiveOperationId;
    if (state == schoolcalc_relay::SessionState::Identifying) {
      tiPeerVerifiedThisSession = true;
      tiPeerSeenMs = millis();
    }
    portEXIT_CRITICAL(&tiStatusMux);

    char detail[schoolcalc_diagnostics::EVENT_DETAIL_BYTES];
    snprintf(detail, sizeof(detail), "%s %u/%u safe_to_unplug=%s",
             schoolcalc_relay::sessionDirectionText(direction),
             static_cast<unsigned>(itemsCompleted),
             static_cast<unsigned>(itemsTotal),
             safeToUnplug ? "true" : "false");
    recordDiagnostic(schoolcalc_diagnostics::Subsystem::TiSession,
                     state == schoolcalc_relay::SessionState::Failed
                       ? schoolcalc_diagnostics::Severity::Error
                       : schoolcalc_diagnostics::Severity::Info,
                     schoolcalc_relay::sessionStateText(state), detail,
                     operationId);

    switch (direction) {
      case schoolcalc_relay::SessionDirection::Negotiating: setLed(CRGB::Blue); break;
      case schoolcalc_relay::SessionDirection::CalculatorToRelay: setLed(CRGB::Cyan); break;
      case schoolcalc_relay::SessionDirection::Network: setLed(CRGB::Yellow); break;
      case schoolcalc_relay::SessionDirection::RelayToCalculator: setLed(CRGB::Purple); break;
      case schoolcalc_relay::SessionDirection::Idle:
        setLed(state == schoolcalc_relay::SessionState::Failed ? CRGB::Red : CRGB::Green);
        break;
    }
  }
};

static RelaySessionObserver relaySessionObserver;

static void wsEvent(WStype_t type, uint8_t* payload, size_t length) {
  if (type == WStype_CONNECTED) {
    wsConnected = true;
    portENTER_CRITICAL(&diagnosticMux);
    wsConnectCount++;
    wsLastChangeMs = millis();
    snprintf(wsLastError, sizeof(wsLastError), "none");
    portEXIT_CRITICAL(&diagnosticMux);
    recordDiagnostic(schoolcalc_diagnostics::Subsystem::WebSocket,
                     schoolcalc_diagnostics::Severity::Info,
                     "connected", WS_PATH);
    Serial.println("[ws] connected");
    if (!tiBusy && !tiJobPending) setLed(CRGB::Green);
  } else if (type == WStype_DISCONNECTED) {
    wsConnected = false;
    portENTER_CRITICAL(&diagnosticMux);
    wsDisconnectCount++;
    wsLastChangeMs = millis();
    snprintf(wsLastError, sizeof(wsLastError), "connection closed");
    portEXIT_CRITICAL(&diagnosticMux);
    recordDiagnostic(schoolcalc_diagnostics::Subsystem::WebSocket,
                     schoolcalc_diagnostics::Severity::Warning,
                     "disconnected", "connection closed");
    Serial.println("[ws] disconnected");
    if (!tiBusy && !tiJobPending) setLed(CRGB::Orange);
  } else if (type == WStype_TEXT && payload && length) {
    portENTER_CRITICAL(&diagnosticMux);
    wsMessagesRx++;
    wsBytesRx += length;
    wsLastRxMs = millis();
    portEXIT_CRITICAL(&diagnosticMux);
    JsonDocument command;
    const DeserializationError parseError = deserializeJson(command, payload, length);
    if (!parseError && command["action"] == "sync") {
      syncRequests++;
      const bool foreground = command["transport"] == "foreground";
      const bool queued = TI_TRANSMIT_ENABLED && queueTiJob(
        foreground ? TiJob::ForegroundSync : TiJob::SilentSync);
      JsonDocument reply; reply["source"] = "ticalc-relay"; reply["type"] = "sync_ack";
      reply["relayId"] = RELAY_ID; reply["ok"] = queued;
      reply["state"] = queued ? "queued" : (TI_TRANSMIT_ENABLED ? "busy" : "transmit_disabled");
      String body; serializeJson(reply, body);
      const bool sent = ws.sendTXT(body);
      portENTER_CRITICAL(&diagnosticMux);
      if (sent) {
        wsMessagesTx++;
        wsBytesTx += body.length();
        wsLastTxMs = millis();
      } else {
        wsErrorCount++;
        snprintf(wsLastError, sizeof(wsLastError), "sync acknowledgement send failed");
      }
      portEXIT_CRITICAL(&diagnosticMux);
      recordDiagnostic(schoolcalc_diagnostics::Subsystem::WebSocket,
                       sent ? schoolcalc_diagnostics::Severity::Info
                            : schoolcalc_diagnostics::Severity::Error,
                       "sync_command", queued ? "queued" : "rejected",
                       0, static_cast<uint32_t>(length), sent ? 0 : -1);
    } else if (parseError) {
      portENTER_CRITICAL(&diagnosticMux);
      wsErrorCount++;
      snprintf(wsLastError, sizeof(wsLastError), "invalid JSON command");
      portEXIT_CRITICAL(&diagnosticMux);
      recordDiagnostic(schoolcalc_diagnostics::Subsystem::WebSocket,
                       schoolcalc_diagnostics::Severity::Warning,
                       "invalid_message", "JSON parse failed", 0,
                       static_cast<uint32_t>(length));
    } else {
      recordDiagnostic(schoolcalc_diagnostics::Subsystem::WebSocket,
                       schoolcalc_diagnostics::Severity::Warning,
                       "unknown_command", "unsupported action", 0,
                       static_cast<uint32_t>(length));
    }
  } else if (type == WStype_ERROR) {
    portENTER_CRITICAL(&diagnosticMux);
    wsErrorCount++;
    wsLastChangeMs = millis();
    snprintf(wsLastError, sizeof(wsLastError), "websocket transport error");
    portEXIT_CRITICAL(&diagnosticMux);
    recordDiagnostic(schoolcalc_diagnostics::Subsystem::WebSocket,
                     schoolcalc_diagnostics::Severity::Error,
                     "transport_error", "websocket library reported an error",
                     0, static_cast<uint32_t>(length));
  }
}

static void sendWsHeartbeat() {
  if (!wsConnected) return;
  JsonDocument d; d["source"] = "ticalc-relay"; d["type"] = "health";
  d["relayId"] = RELAY_ID; d["upS"] = (uint32_t)((millis() - bootMs) / 1000);
  d["calculatorActivity"] = calculatorAttached();
  d["lineChanges"] = lineChanges;
  String body; serializeJson(d, body);
  const bool sent = ws.sendTXT(body);
  portENTER_CRITICAL(&diagnosticMux);
  if (sent) {
    wsHeartbeatSuccesses++;
    wsMessagesTx++;
    wsBytesTx += body.length();
    wsLastTxMs = millis();
  } else {
    wsHeartbeatFailures++;
    wsErrorCount++;
    snprintf(wsLastError, sizeof(wsLastError), "heartbeat send failed");
  }
  portEXIT_CRITICAL(&diagnosticMux);
  if (!sent) {
    recordDiagnostic(schoolcalc_diagnostics::Subsystem::WebSocket,
                     schoolcalc_diagnostics::Severity::Error,
                     "heartbeat_failed", "sendTXT returned false");
  }
  lastWsHeartbeatMs = millis();
}

static bool calculatorAttached() {
  // A calculator line is normally pulled high by the calculator/interface;
  // either sensed-low line is enough to report activity, not attachment proof.
  return digitalRead(TIP_SENSE_PIN) == LOW || digitalRead(RING_SENSE_PIN) == LOW;
}

static bool drainForegroundInputs(
  schoolcalc_relay::ForegroundCalculatorVariables& calculator,
  char* error, size_t errorCapacity) {
  if ((calculator.selectedCapabilities()
       & schoolcalc_foreground::CapabilityKeyInput) == 0) return true;
  for (uint8_t delivered = 0; delivered < 16; ++delivered) {
    schoolcalc_input::InputEvent event{};
    if (!copyInputHead(event)) return true;
    portENTER_CRITICAL(&inputMux);
    inputDeliveryAttempts++;
    portEXIT_CRITICAL(&inputMux);
    if (!calculator.sendInput(event)) {
      portENTER_CRITICAL(&inputMux);
      inputDeliveryFailures++;
      inputRetryNotBeforeMs = millis() + 500;
      snprintf(inputLastError, sizeof(inputLastError), "%s",
               calculator.lastError());
      portEXIT_CRITICAL(&inputMux);
      snprintf(error, errorCapacity, "foreground input %lu: %s",
               static_cast<unsigned long>(event.sequence), calculator.lastError());
      return false;
    }
    if (!acknowledgeInput(event.sequence, "foreground", millis())) {
      snprintf(error, errorCapacity, "foreground input queue ACK mismatch");
      return false;
    }
  }
  return true;
}

static void tiTask(void*) {
  TiJob job;
  // Require an observed both-high idle interval before accepting one asserted
  // line as a new calculator-originated start. This prevents an unplugged
  // divider input, stuck-low line, or both-low fault from producing an endless
  // series of foreground attempts.
  bool foregroundListenerArmed = false;
  for (;;) {
    const bool listenerAvailable = TI_TRANSMIT_ENABLED
      && FOREGROUND_LISTENER_ENABLED && syncWorkspace != nullptr;
    const TickType_t queueWait = listenerAvailable ? 1 : portMAX_DELAY;
    const bool queued = xQueueReceive(tiJobs, &job, queueWait) == pdTRUE;
    bool calculatorInitiated = false;

    if (!queued) {
      const bool tipLow = digitalRead(TIP_SENSE_PIN) == LOW;
      const bool ringLow = digitalRead(RING_SENSE_PIN) == LOW;
      bool occupied = false;
      portENTER_CRITICAL(&tiStatusMux);
      occupied = tiBusy || tiJobPending;
      portEXIT_CRITICAL(&tiStatusMux);
      const schoolcalc_relay::ForegroundListenerStatus listener =
        schoolcalc_relay::describeForegroundListener(
          TI_TRANSMIT_ENABLED, listenerAvailable, occupied, tipLow, ringLow);

      if (!tipLow && !ringLow) {
        foregroundListenerArmed = true;
        continue;
      }
      if (tipLow && ringLow) {
        foregroundListenerArmed = false;
        continue;
      }
      if (!foregroundListenerArmed || !listener.shouldAcceptHello) continue;

      // Re-check ownership under the same lock used by queueTiJob. Either the
      // calculator HELLO candidate or an explicit queued job wins, never both.
      bool claimed = false;
      portENTER_CRITICAL(&tiStatusMux);
      if (!tiBusy && !tiJobPending) {
        tiBusy = true;
        if (tiNextOperationId == 0) tiNextOperationId = 1;
        tiActiveOperationId = tiNextOperationId++;
        tiSafeToUnplug = false;
        tiPeerVerifiedThisSession = false;
        tiItemsCompleted = 0;
        tiItemsTotal = 0;
        tiPhaseChangedMs = millis();
        tiCalculatorInitiatedSyncCount++;
        claimed = true;
      }
      portEXIT_CRITICAL(&tiStatusMux);
      if (!claimed) continue;

      foregroundListenerArmed = false;
      calculatorInitiated = true;
      job = TiJob::ForegroundSync;
      setDiagnosticOperation(tiActiveOperationId);
    } else {
      // An explicit operation owns the next wire exchange. Re-arm only after
      // that operation ends and the listener observes both lines released.
      foregroundListenerArmed = false;
    }

    portENTER_CRITICAL(&tiStatusMux);
    if (!calculatorInitiated) {
      tiJobPending = false;
      tiBusy = true;
    }
    snprintf(tiLastOperation, sizeof(tiLastOperation), "%s",
             job == TiJob::Screenshot ? "screenshot"
               : (job == TiJob::RemoteKey ? "key" : "sync"));
    snprintf(tiLastTransport, sizeof(tiLastTransport), "%s",
             job == TiJob::RemoteKey ? "direct_key"
               : (job == TiJob::Screenshot ? "silent"
               : (job == TiJob::ForegroundSync ? "foreground" : "silent")));
    snprintf(tiLastInitiator, sizeof(tiLastInitiator), "%s",
             calculatorInitiated ? "calculator" : "relay");
    snprintf(tiLastState, sizeof(tiLastState), "%s",
             job == TiJob::Screenshot ? "capturing"
               : (job == TiJob::RemoteKey ? "sending_key"
               : (calculatorInitiated ? "hello_detected" : "starting")));
    snprintf(tiDirection, sizeof(tiDirection), "%s",
             job == TiJob::ForegroundSync ? "negotiating" : "idle");
    tiLastError[0] = '\0';
    const uint32_t operationId = tiActiveOperationId;
    portEXIT_CRITICAL(&tiStatusMux);
    recordDiagnostic(schoolcalc_diagnostics::Subsystem::TiSession,
                     schoolcalc_diagnostics::Severity::Info,
                     "job_started",
                     tiJobText(job),
                     operationId);
    if (job == TiJob::ForegroundSync) setLed(CRGB::Blue);
    bool ok = false;
    schoolcalc_relay::SessionOutcome syncOutcome{
      false,
      schoolcalc_relay::SessionState::Failed,
      schoolcalc_relay::SessionError::None,
      "session did not start",
      {},
      false,
      0,
    };
    char foregroundError[128] = "";
    if (job == TiJob::Screenshot) {
      ok = tiLink.captureScreenshot(screenshot);
    } else if (job == TiJob::RemoteKey) {
      schoolcalc_input::InputEvent event{};
      schoolcalc_input::Ti86Input mapped{};
      if (copyInputHead(event) && schoolcalc_input::mapTi86Input(event.input, mapped)) {
        portENTER_CRITICAL(&inputMux);
        inputDeliveryAttempts++;
        portEXIT_CRITICAL(&inputMux);
        ok = tiLink.sendRemoteKey(mapped.scanCode);
        if (ok) {
          ok = acknowledgeInput(event.sequence, "direct_key", millis());
        } else {
          portENTER_CRITICAL(&inputMux);
          inputDeliveryFailures++;
          inputRetryNotBeforeMs = millis() + 500;
          snprintf(inputLastError, sizeof(inputLastError), "%s",
                   tiLink.lastErrorText());
          portEXIT_CRITICAL(&inputMux);
        }
      } else {
        snprintf(foregroundError, sizeof(foregroundError),
                 "input queue empty or TI-86 mapping failed");
      }
    } else if (job == TiJob::ForegroundSync) {
      schoolcalc_relay::ForegroundCalculatorVariables foregroundCalculator(
        foregroundFrameChannel, schoolcalc_foreground::DEFAULT_CHUNK_BYTES,
        &relaySessionObserver);
      if (!foregroundCalculator.accept()) {
        snprintf(foregroundError, sizeof(foregroundError), "%s",
                 foregroundCalculator.lastError());
      } else {
        portENTER_CRITICAL(&tiStatusMux);
        tiPeerVerifiedThisSession = true;
        tiPeerSeenMs = millis();
        portEXIT_CRITICAL(&tiStatusMux);
        schoolcalc_relay::SchoolCalcRelaySession session(
          foregroundCalculator, schoolCalcApi, sessionBuffers(), &foregroundCalculator);
        syncOutcome = session.run();
        if (syncOutcome.ok
            && !drainForegroundInputs(foregroundCalculator,
                                      foregroundError, sizeof(foregroundError))) {
          syncOutcome.ok = false;
          syncOutcome.state = schoolcalc_relay::SessionState::Failed;
          syncOutcome.ready = false;
        }
        if (syncOutcome.ok) {
          ok = foregroundCalculator.finish(syncOutcome.ready
            ? schoolcalc_foreground::CompleteCode::Ready
            : schoolcalc_foreground::CompleteCode::Blocked);
          if (!ok) {
            snprintf(foregroundError, sizeof(foregroundError), "%s",
                     foregroundCalculator.lastError());
            syncOutcome.state = schoolcalc_relay::SessionState::Failed;
            syncOutcome.ready = false;
          }
        } else {
          snprintf(foregroundError, sizeof(foregroundError), "%s: %s",
                   schoolcalc_relay::sessionErrorText(syncOutcome.error),
                   syncOutcome.detail == nullptr ? "unknown" : syncOutcome.detail);
          foregroundCalculator.cancel();
        }
      }
    } else if (job == TiJob::SilentSync) {
      schoolcalc_relay::SchoolCalcRelaySession session(
        calculatorVariables, schoolCalcApi, sessionBuffers(), &relaySessionObserver);
      syncOutcome = session.run();
      ok = syncOutcome.ok;
    }
    portENTER_CRITICAL(&tiStatusMux);
    tiBusy = false;
    tiSafeToUnplug = true;
    snprintf(tiDirection, sizeof(tiDirection), "idle");
    if (job == TiJob::Screenshot && ok) {
      tiScreenshotReady = true; tiScreenshotCount++; tiLastScreenshotMs = millis();
      snprintf(tiLastState, sizeof(tiLastState), "complete");
      snprintf(tiLastError, sizeof(tiLastError), "none");
    } else if (job == TiJob::SilentSync || job == TiJob::ForegroundSync) {
      tiSyncCount++;
      tiLastSyncMs = millis();
      tiLastSyncReady = syncOutcome.ready;
      tiLastArtifactsStaged = syncOutcome.artifactsStaged;
      tiLastProfilesStaged = syncOutcome.profilesStaged;
      tiLastProgressStaged = syncOutcome.progressStaged;
      tiLastInteractionStaged = syncOutcome.interactionStaged;
      snprintf(tiLastDeviceId, sizeof(tiLastDeviceId), "%s", syncOutcome.identity.deviceId);
      snprintf(tiLastState, sizeof(tiLastState), "%s",
               schoolcalc_relay::sessionStateText(syncOutcome.state));
      if (ok) {
        tiSyncSuccessCount++;
        snprintf(tiLastError, sizeof(tiLastError), "none");
      } else {
        tiFailureCount++;
        if (foregroundError[0] != '\0') {
          snprintf(tiLastError, sizeof(tiLastError), "%s", foregroundError);
        } else {
          snprintf(tiLastError, sizeof(tiLastError), "%s: %s",
                   schoolcalc_relay::sessionErrorText(syncOutcome.error),
                   syncOutcome.detail == nullptr ? "unknown" : syncOutcome.detail);
        }
      }
    } else if (job == TiJob::RemoteKey) {
      if (ok) {
        snprintf(tiLastState, sizeof(tiLastState), "key_acknowledged");
        snprintf(tiLastError, sizeof(tiLastError), "none");
      } else {
        tiFailureCount++;
        snprintf(tiLastState, sizeof(tiLastState), "key_failed");
        snprintf(tiLastError, sizeof(tiLastError), "%s",
                 foregroundError[0] ? foregroundError : tiLink.lastErrorText());
      }
    } else {
      tiFailureCount++;
      snprintf(tiLastState, sizeof(tiLastState), "failed");
      snprintf(tiLastError, sizeof(tiLastError), "%s", tiLink.lastErrorText());
    }
    tiLastOperationId = tiActiveOperationId;
    tiActiveOperationId = 0;
    portEXIT_CRITICAL(&tiStatusMux);
    recordDiagnostic(schoolcalc_diagnostics::Subsystem::TiSession,
                     ok ? schoolcalc_diagnostics::Severity::Info
                        : schoolcalc_diagnostics::Severity::Error,
                     ok ? "job_complete" : "job_failed",
                     ok ? "acknowledged" : tiLastError,
                     operationId, 0, ok ? 0 : -1);
    clearDiagnosticOperation(operationId);
    setLed(ok ? CRGB::Green : CRGB::Red);
  }
}

static void connectWifi() {
  portENTER_CRITICAL(&diagnosticMux);
  wifiConnectAttempts++;
  portEXIT_CRITICAL(&diagnosticMux);
  recordDiagnostic(schoolcalc_diagnostics::Subsystem::Wifi,
                   schoolcalc_diagnostics::Severity::Info,
                   "connect_attempt", "station connect started");
  WiFi.mode(WIFI_STA); WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  const uint32_t started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < WIFI_CONNECT_TIMEOUT_MS) delay(250);
  const uint32_t durationMs = millis() - started;
  const bool connected = WiFi.status() == WL_CONNECTED;
  portENTER_CRITICAL(&diagnosticMux);
  if (connected) wifiConnectSuccesses++;
  else wifiConnectFailures++;
  wifiLastChangeMs = millis();
  wifiLastConnectDurationMs = durationMs;
  portEXIT_CRITICAL(&diagnosticMux);
  if (connected) {
    const String ip = WiFi.localIP().toString();
    recordDiagnostic(schoolcalc_diagnostics::Subsystem::Wifi,
                     schoolcalc_diagnostics::Severity::Info,
                     "connected", ip.c_str(), 0, 0,
                     static_cast<int32_t>(WiFi.status()), durationMs);
    Serial.printf("[wifi] %s\n", ip.c_str());
  } else {
    recordDiagnostic(schoolcalc_diagnostics::Subsystem::Wifi,
                     schoolcalc_diagnostics::Severity::Error,
                     "connect_timeout", "will retry", 0, 0,
                     static_cast<int32_t>(WiFi.status()), durationMs);
    Serial.println("[wifi] unavailable; will retry");
  }
  lastWifiTryMs = millis();
}

static void sampleLines() {
  const bool tip = digitalRead(TIP_SENSE_PIN) == LOW;
  const bool ring = digitalRead(RING_SENSE_PIN) == LOW;
  const uint32_t now = millis();
  if (tip != lastTip) { lastTip = tip; lastTipChange = now; lineChanges++; }
  if (ring != lastRing) { lastRing = ring; lastRingChange = now; lineChanges++; }
  if (tip && ring) {
    if (bothLowSinceMs == 0) bothLowSinceMs = now;
    if (!bothLowFaultActive && now - bothLowSinceMs >= 100) {
      bothLowFaultActive = true;
      recordDiagnostic(schoolcalc_diagnostics::Subsystem::TiElectrical,
                       schoolcalc_diagnostics::Severity::Error,
                       "both_lines_low",
                       "possible short, stuck bus, or invalid link state",
                       currentDiagnosticOperation());
    }
  } else {
    bothLowSinceMs = 0;
    if (bothLowFaultActive) {
      bothLowFaultActive = false;
      recordDiagnostic(schoolcalc_diagnostics::Subsystem::TiElectrical,
                       schoolcalc_diagnostics::Severity::Info,
                       "both_lines_released", "electrical fault state cleared",
                       currentDiagnosticOperation());
    }
  }
}

static bool plugDetectConfigured() {
  return PLUG_DETECT_PIN >= 0;
}

static bool readPlugDetect() {
#if PLUG_DETECT_PIN >= 0
  const bool high = digitalRead(PLUG_DETECT_PIN) == HIGH;
  return PLUG_DETECT_ACTIVE_HIGH ? high : !high;
#else
  return false;
#endif
}

static const char* physicalPresence() {
  if (!plugDetectConfigured() || !plugDetectInitialized) return "unknown";
  return plugInserted ? "inserted" : "absent";
}

static void samplePlugDetect() {
  if (!plugDetectConfigured()) return;
  const uint32_t now = millis();
  const bool raw = readPlugDetect();
  if (!plugDetectInitialized) {
    plugDetectInitialized = true;
    plugDetectRaw = raw;
    plugDetectRawChangedMs = now;
    return;
  }
  if (raw != plugDetectRaw) {
    plugDetectRaw = raw;
    plugDetectRawChangedMs = now;
  }
  if (plugInserted == plugDetectRaw || now - plugDetectRawChangedMs < PLUG_DETECT_DEBOUNCE_MS) return;
  plugInserted = plugDetectRaw;
  plugDetectChangedMs = now;
  recordDiagnostic(schoolcalc_diagnostics::Subsystem::TiElectrical,
                   schoolcalc_diagnostics::Severity::Info,
                   plugInserted ? "plug_inserted" : "plug_removed",
                   "mechanical switched-jack contact", currentDiagnosticOperation());
}

static void status() {
  sampleLines();
  const uint32_t now = millis();
  const bool lineAsserted = calculatorAttached();
  const uint32_t lastLineChange = lastTipChange > lastRingChange ? lastTipChange : lastRingChange;
  const bool recentLineActivity = lineAsserted
    || (lastLineChange != 0 && now - lastLineChange <= 1000);
  const TiLinkTransport::Metrics linkMetrics = tiLink.metrics();
  const schoolcalc_ble::Status bleStatus = keyboardHost.status(now);
  size_t queuedInputs = 0, inputCapacity = 0;
  bool inputFull = false;
  uint32_t inputsAccepted = 0, inputsAcknowledged = 0, inputsRejectedFull = 0;
  uint32_t lastAcknowledgedInput = 0, deliveryAttempts = 0;
  uint32_t deliverySuccesses = 0, deliveryFailures = 0;
  uint32_t lastDeliveredInput = 0, lastDeliveryLatency = 0;
  char lastInputDelivery[sizeof(inputLastDelivery)]{};
  char lastInputError[sizeof(inputLastError)]{};
  portENTER_CRITICAL(&inputMux);
  queuedInputs = inputQueue.size();
  inputCapacity = inputQueue.capacity();
  inputFull = inputQueue.full();
  inputsAccepted = inputQueue.acceptedCount();
  inputsAcknowledged = inputQueue.acknowledgedCount();
  inputsRejectedFull = inputQueue.rejectedFullCount();
  lastAcknowledgedInput = inputQueue.lastAcknowledgedSequence();
  deliveryAttempts = inputDeliveryAttempts;
  deliverySuccesses = inputDeliverySuccesses;
  deliveryFailures = inputDeliveryFailures;
  lastDeliveredInput = inputLastDeliveredSequence;
  lastDeliveryLatency = inputLastDeliveryLatencyMs;
  snprintf(lastInputDelivery, sizeof(lastInputDelivery), "%s", inputLastDelivery);
  snprintf(lastInputError, sizeof(lastInputError), "%s", inputLastError);
  portEXIT_CRITICAL(&inputMux);
  RelayIoMetrics ioMetrics{};
  uint32_t wifiAttempts = 0, wifiSuccesses = 0, wifiFailures = 0;
  uint32_t wifiChangedMs = 0, wifiDurationMs = 0;
  uint32_t websocketConnects = 0, websocketDisconnects = 0, websocketErrors = 0;
  uint32_t websocketMessagesRx = 0, websocketMessagesTx = 0;
  uint32_t websocketBytesRx = 0, websocketBytesTx = 0;
  uint32_t heartbeatSuccesses = 0, heartbeatFailures = 0;
  uint32_t websocketChangedMs = 0, websocketLastRx = 0, websocketLastTx = 0;
  char websocketLastError[sizeof(wsLastError)]{};
  schoolcalc_diagnostics::Event lastDiagnostic{};
  size_t diagnosticEvents = 0;
  uint32_t diagnosticRecorded = 0, diagnosticOverwritten = 0;
  uint32_t diagnosticNextSequence = 0, diagnosticCorrelation = 0;
  portENTER_CRITICAL(&diagnosticMux);
  ioMetrics = relayIoMetrics;
  wifiAttempts = wifiConnectAttempts;
  wifiSuccesses = wifiConnectSuccesses;
  wifiFailures = wifiConnectFailures;
  wifiChangedMs = wifiLastChangeMs;
  wifiDurationMs = wifiLastConnectDurationMs;
  websocketConnects = wsConnectCount;
  websocketDisconnects = wsDisconnectCount;
  websocketErrors = wsErrorCount;
  websocketMessagesRx = wsMessagesRx;
  websocketMessagesTx = wsMessagesTx;
  websocketBytesRx = wsBytesRx;
  websocketBytesTx = wsBytesTx;
  heartbeatSuccesses = wsHeartbeatSuccesses;
  heartbeatFailures = wsHeartbeatFailures;
  websocketChangedMs = wsLastChangeMs;
  websocketLastRx = wsLastRxMs;
  websocketLastTx = wsLastTxMs;
  snprintf(websocketLastError, sizeof(websocketLastError), "%s", wsLastError);
  diagnosticEvents = diagnosticJournal.size();
  diagnosticRecorded = diagnosticJournal.totalRecorded();
  diagnosticOverwritten = diagnosticJournal.overwrittenCount();
  diagnosticNextSequence = diagnosticJournal.nextSequence();
  diagnosticCorrelation = diagnosticOperationId;
  diagnosticJournal.copyOldest(&lastDiagnostic, 1);
  portEXIT_CRITICAL(&diagnosticMux);
  JsonDocument d;
  d["device"] = "ticalc-relay"; d["relay_id"] = RELAY_ID;
  d["up_s"] = (uint32_t)((millis() - bootMs) / 1000);
  JsonObject memory = d["memory"].to<JsonObject>();
  memory["heap_size_bytes"] = ESP.getHeapSize();
  memory["free_heap_bytes"] = ESP.getFreeHeap();
  memory["minimum_free_heap_bytes"] = ESP.getMinFreeHeap();
  memory["largest_free_block_bytes"] = ESP.getMaxAllocHeap();
  d["wifi"]["connected"] = WiFi.status() == WL_CONNECTED;
  d["wifi"]["ip"] = WiFi.localIP().toString();
  d["wifi"]["rssi_dbm"] = WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0;
  d["wifi"]["connect_attempts"] = wifiAttempts;
  d["wifi"]["connect_successes"] = wifiSuccesses;
  d["wifi"]["connect_failures"] = wifiFailures;
  d["wifi"]["last_connect_duration_ms"] = wifiDurationMs;
  d["wifi"]["last_change_ms_ago"] = wifiChangedMs ? now - wifiChangedMs : 0;
  d["backend"]["host"] = BACKEND_HOST; d["backend"]["port"] = BACKEND_PORT;
  JsonObject api = d["backend"]["api"].to<JsonObject>();
  api["requests"] = ioMetrics.httpRequests;
  api["successes"] = ioMetrics.httpSuccesses;
  api["failures"] = ioMetrics.httpFailures;
  api["request_bytes"] = ioMetrics.httpRequestBytes;
  api["response_bytes"] = ioMetrics.httpResponseBytes;
  api["last_operation"] = ioMetrics.lastHttpOperation;
  api["last_status"] = ioMetrics.lastHttpStatus;
  api["last_duration_ms"] = ioMetrics.lastHttpDurationMs;
  api["last_error"] = ioMetrics.lastHttpError;
  api["last_request_ms_ago"] = ioMetrics.lastHttpAtMs ? now - ioMetrics.lastHttpAtMs : 0;
  d["ws"]["connected"] = wsConnected; d["ws"]["path"] = WS_PATH;
  d["ws"]["connect_count"] = websocketConnects;
  d["ws"]["disconnect_count"] = websocketDisconnects;
  d["ws"]["error_count"] = websocketErrors;
  d["ws"]["messages_rx"] = websocketMessagesRx;
  d["ws"]["messages_tx"] = websocketMessagesTx;
  d["ws"]["bytes_rx"] = websocketBytesRx;
  d["ws"]["bytes_tx"] = websocketBytesTx;
  d["ws"]["heartbeat_successes"] = heartbeatSuccesses;
  d["ws"]["heartbeat_failures"] = heartbeatFailures;
  d["ws"]["last_error"] = websocketLastError;
  d["ws"]["last_change_ms_ago"] = websocketChangedMs ? now - websocketChangedMs : 0;
  d["ws"]["last_rx_ms_ago"] = websocketLastRx ? now - websocketLastRx : 0;
  d["ws"]["last_tx_ms_ago"] = websocketLastTx ? now - websocketLastTx : 0;
  d["tr"]["tip_low"] = lastTip; d["tr"]["ring_low"] = lastRing;
  d["tr"]["line_asserted"] = lineAsserted;
  d["tr"]["recent_activity"] = recentLineActivity;
  d["tr"]["line_changes"] = lineChanges;
  d["tr"]["both_low_fault"] = bothLowFaultActive;
  d["tr"]["physical_presence"] = physicalPresence();
  d["tr"]["jack_detect_configured"] = plugDetectConfigured();
  if (plugDetectConfigured() && plugDetectInitialized) {
    d["tr"]["jack_inserted"] = plugInserted;
    if (plugDetectChangedMs) d["tr"]["jack_changed_ms_ago"] = now - plugDetectChangedMs;
    else d["tr"]["jack_changed_ms_ago"] = nullptr;
  } else {
    d["tr"]["jack_inserted"] = nullptr;
    d["tr"]["jack_changed_ms_ago"] = nullptr;
  }
  portENTER_CRITICAL(&tiStatusMux);
  const schoolcalc_relay::TransportPresence transportPresence =
    schoolcalc_relay::describeTransportPresence(
      tiBusy, tiPeerVerifiedThisSession, recentLineActivity);
  const schoolcalc_relay::ForegroundListenerStatus foregroundListener =
    schoolcalc_relay::describeForegroundListener(
      TI_TRANSMIT_ENABLED,
      FOREGROUND_LISTENER_ENABLED && syncWorkspace != nullptr,
      tiBusy || tiJobPending,
      lastTip,
      lastRing);
  JsonObject ti = d["ti_link"].to<JsonObject>();
  ti["transmit_enabled"] = (bool)TI_TRANSMIT_ENABLED;
  ti["auto_sync_enabled"] = (bool)AUTO_SYNC_ENABLED;
  ti["foreground_listener_enabled"] = (bool)FOREGROUND_LISTENER_ENABLED;
  ti["foreground_listener_state"] = foregroundListener.state;
  ti["busy"] = tiBusy; ti["queued"] = tiJobPending;
  ti["connection"] = transportPresence.connection;
  ti["presence"] = transportPresence.evidence;
  ti["peer_verified_this_session"] = tiPeerVerifiedThisSession;
  ti["direction"] = tiDirection;
  ti["safe_to_unplug"] = tiSafeToUnplug;
  ti["items_completed"] = tiItemsCompleted;
  ti["items_total"] = tiItemsTotal;
  ti["screenshot_ready"] = tiScreenshotReady;
  ti["workspace_bytes"] = static_cast<unsigned>(SYNC_WORKSPACE_BYTES);
  ti["workspace_ready"] = syncWorkspace != nullptr;
  ti["last_operation"] = tiLastOperation; ti["last_state"] = tiLastState;
  ti["active_operation_id"] = tiActiveOperationId;
  ti["last_operation_id"] = tiLastOperationId;
  ti["last_transport"] = tiLastTransport;
  ti["last_initiator"] = tiLastInitiator;
  ti["last_device_id"] = tiLastDeviceId[0] ? tiLastDeviceId : nullptr;
  ti["last_sync_ready"] = tiLastSyncReady;
  ti["last_artifacts_staged"] = tiLastArtifactsStaged;
  ti["last_profiles_staged"] = tiLastProfilesStaged;
  ti["last_progress_staged"] = tiLastProgressStaged;
  ti["last_interaction_staged"] = tiLastInteractionStaged;
  ti["screenshot_count"] = tiScreenshotCount; ti["failures"] = tiFailureCount;
  ti["sync_count"] = tiSyncCount; ti["sync_success_count"] = tiSyncSuccessCount;
  ti["calculator_initiated_sync_count"] = tiCalculatorInitiatedSyncCount;
  ti["last_error"] = tiLastError;
  JsonObject packets = ti["packets"].to<JsonObject>();
  packets["tx"] = linkMetrics.packetsTx;
  packets["rx"] = linkMetrics.packetsRx;
  packets["bytes_tx"] = linkMetrics.bytesTx;
  packets["bytes_rx"] = linkMetrics.bytesRx;
  packets["errors"] = linkMetrics.errors;
  packets["edge_timeouts"] = linkMetrics.edgeTimeouts;
  packets["bus_busy_errors"] = linkMetrics.busBusyErrors;
  packets["checksum_errors"] = linkMetrics.checksumErrors;
  packets["unexpected_packets"] = linkMetrics.unexpectedPackets;
  packets["last_activity_ms_ago"] = linkMetrics.lastActivityMs
    ? now - linkMetrics.lastActivityMs : 0;
  packets["last_direction"] = linkMetrics.lastPacketOutbound ? "relay_to_ti" : "ti_to_relay";
  packets["last_machine_id"] = linkMetrics.lastMachineId;
  packets["last_command"] = linkMetrics.lastCommand;
  packets["last_declared_length"] = linkMetrics.lastDeclaredLength;
  packets["last_data_length"] = linkMetrics.lastDataLength;
  if (tiLastScreenshotMs) ti["last_screenshot_ms_ago"] = millis() - tiLastScreenshotMs;
  else ti["last_screenshot_ms_ago"] = nullptr;
  if (tiLastSyncMs) ti["last_sync_ms_ago"] = millis() - tiLastSyncMs;
  else ti["last_sync_ms_ago"] = nullptr;
  if (tiPhaseChangedMs) ti["phase_changed_ms_ago"] = millis() - tiPhaseChangedMs;
  else ti["phase_changed_ms_ago"] = nullptr;
  if (tiPeerSeenMs) ti["last_verified_peer_ms_ago"] = millis() - tiPeerSeenMs;
  else ti["last_verified_peer_ms_ago"] = nullptr;
  portEXIT_CRITICAL(&tiStatusMux);
  JsonObject calculatorIo = d["calculator_io"].to<JsonObject>();
  calculatorIo["variable_operations"] = ioMetrics.calculatorOperations;
  calculatorIo["variable_failures"] = ioMetrics.calculatorFailures;
  calculatorIo["variable_bytes"] = ioMetrics.calculatorBytes;
  calculatorIo["foreground_frames_tx"] = ioMetrics.foregroundFramesTx;
  calculatorIo["foreground_frames_rx"] = ioMetrics.foregroundFramesRx;
  calculatorIo["foreground_failures"] = ioMetrics.foregroundFailures;
  calculatorIo["foreground_bytes_tx"] = ioMetrics.foregroundBytesTx;
  calculatorIo["foreground_bytes_rx"] = ioMetrics.foregroundBytesRx;

  JsonObject input = d["input"]["ble_keyboard"].to<JsonObject>();
  input["enabled"] = bleStatus.enabled;
  input["initialized"] = bleStatus.initialized;
  input["configured"] = bleStatus.configured;
  input["configured_address"] = bleStatus.configuredAddress[0]
    ? bleStatus.configuredAddress : nullptr;
  input["resolved_address"] = bleStatus.resolvedAddress[0]
    ? bleStatus.resolvedAddress : nullptr;
  input["address_type"] = BLE_KEYBOARD_ADDRESS_TYPE == 0 ? "public" : "random";
  input["label"] = bleStatus.label[0] ? bleStatus.label : nullptr;
  input["require_mitm"] = (bool)BLE_KEYBOARD_REQUIRE_MITM;
  input["pairing_window_ms"] = BLE_KEYBOARD_PAIRING_WINDOW_MS;
  input["pairing_open"] = bleStatus.pairingOpen;
  input["pairing_remaining_ms"] = bleStatus.pairingRemainingMs;
  if (bleStatus.pairingPasskey != 0) {
    char pairingPasskey[7];
    snprintf(pairingPasskey, sizeof(pairingPasskey), "%06lu",
             static_cast<unsigned long>(bleStatus.pairingPasskey));
    input["pairing_passkey"] = pairingPasskey;
  } else {
    input["pairing_passkey"] = nullptr;
  }
  input["state"] = schoolcalc_ble::stateText(bleStatus.state);
  input["connected"] = bleStatus.connected;
  input["bonded"] = bleStatus.bonded;
  input["encrypted"] = bleStatus.encrypted;
  input["authenticated"] = bleStatus.authenticated;
  input["identity_verified"] = bleStatus.identityVerified;
  input["boot_input_subscribed"] = bleStatus.subscribed;
  input["trusted_ready"] = bleStatus.connected && bleStatus.bonded
    && bleStatus.encrypted
    && (!BLE_KEYBOARD_REQUIRE_MITM || bleStatus.authenticated)
    && bleStatus.identityVerified && bleStatus.subscribed;
  input["liveness_fresh"] = bleStatus.connected && bleStatus.lastLivenessMs
    && now - bleStatus.lastLivenessMs <= 5000;
  input["rssi_dbm"] = bleStatus.rssi;
  input["connect_attempts"] = bleStatus.connectAttempts;
  input["connect_successes"] = bleStatus.connectSuccesses;
  input["connect_failures"] = bleStatus.connectFailures;
  input["disconnects"] = bleStatus.disconnects;
  input["authentication_failures"] = bleStatus.authenticationFailures;
  input["reports_received"] = bleStatus.reportsReceived;
  input["reports_dropped"] = bleStatus.reportsDropped;
  input["invalid_reports"] = bleStatus.invalidReports;
  input["raw_report_queue_depth"] = bleStatus.reportQueueDepth;
  input["last_report_ms_ago"] = bleStatus.lastReportMs
    ? now - bleStatus.lastReportMs : 0;
  input["last_liveness_ms_ago"] = bleStatus.lastLivenessMs
    ? now - bleStatus.lastLivenessMs : 0;
  input["next_connect_ms"] = bleStatus.nextConnectMs
    && !deadlineReached(now, bleStatus.nextConnectMs)
      ? bleStatus.nextConnectMs - now : 0;
  input["last_reason"] = bleStatus.lastReason;
  input["last_error"] = bleStatus.lastError;
  JsonObject inputDelivery = d["input"]["delivery"].to<JsonObject>();
  inputDelivery["mapping_version"] = schoolcalc_input::INPUT_MAPPING_VERSION;
  inputDelivery["queued"] = queuedInputs;
  inputDelivery["capacity"] = inputCapacity;
  inputDelivery["full"] = inputFull;
  inputDelivery["accepted"] = inputsAccepted;
  inputDelivery["acknowledged"] = inputsAcknowledged;
  inputDelivery["rejected_full"] = inputsRejectedFull;
  inputDelivery["unsupported"] = inputUnsupportedReports;
  inputDelivery["attempts"] = deliveryAttempts;
  inputDelivery["successes"] = deliverySuccesses;
  inputDelivery["failures"] = deliveryFailures;
  inputDelivery["last_acknowledged_sequence"] = lastAcknowledgedInput;
  inputDelivery["last_delivered_sequence"] = lastDeliveredInput;
  inputDelivery["last_delivery"] = lastInputDelivery;
  inputDelivery["last_latency_ms"] = lastDeliveryLatency;
  inputDelivery["last_error"] = lastInputError;

  JsonObject diagnostics = d["diagnostics"].to<JsonObject>();
  diagnostics["events"] = diagnosticEvents;
  diagnostics["capacity"] = schoolcalc_diagnostics::EVENT_CAPACITY;
  diagnostics["total_recorded"] = diagnosticRecorded;
  diagnostics["overwritten"] = diagnosticOverwritten;
  diagnostics["next_sequence"] = diagnosticNextSequence;
  if (diagnosticCorrelation != 0) {
    diagnostics["active_correlation"] = diagnosticCorrelation;
  } else {
    diagnostics["active_correlation"] = nullptr;
  }
  diagnostics["events_url"] = "/diagnostics/events";
  diagnostics["config_url"] = "/diagnostics/config";
  if (lastDiagnostic.sequence != 0) {
    diagnostics["last"]["sequence"] = lastDiagnostic.sequence;
    diagnostics["last"]["subsystem"] = schoolcalc_diagnostics::subsystemText(
      lastDiagnostic.subsystem);
    diagnostics["last"]["severity"] = schoolcalc_diagnostics::severityText(
      lastDiagnostic.severity);
    diagnostics["last"]["name"] = lastDiagnostic.name;
    diagnostics["last"]["detail"] = lastDiagnostic.detail;
    diagnostics["last"]["ms_ago"] = now - lastDiagnostic.atMs;
  }
  JsonArray faults = d["faults"].to<JsonArray>();
  if (WiFi.status() != WL_CONNECTED) faults.add("wifi_disconnected");
  if (!wsConnected) faults.add("websocket_disconnected");
  if (syncWorkspace == nullptr) faults.add("sync_workspace_unavailable");
  if (bothLowFaultActive) faults.add("ti_both_lines_low");
  if (BLE_KEYBOARD_ENABLED && BLE_KEYBOARD_ADDRESS[0] == '\0') {
    faults.add("ble_keyboard_address_missing");
  }
  if (bleStatus.state == schoolcalc_ble::State::Fault
      || bleStatus.state == schoolcalc_ble::State::InvalidConfig) {
    faults.add("ble_keyboard_fault");
  }
  if (BLE_KEYBOARD_ENABLED && !bleStatus.bonded) faults.add("ble_keyboard_unpaired");
  if (inputFull) faults.add("input_queue_full");
  d["sync_requests"] = syncRequests;
  String body; serializeJson(d, body); http.send(200, "application/json", body);
}

static bool parseDiagnosticUnsigned(const String& value, uint32_t& output) {
  if (value.isEmpty()) return false;
  uint32_t parsed = 0;
  for (size_t index = 0; index < value.length(); ++index) {
    const char digit = value[index];
    if (digit < '0' || digit > '9') return false;
    const uint8_t numeric = static_cast<uint8_t>(digit - '0');
    if (parsed > (UINT32_MAX - numeric) / 10U) return false;
    parsed = parsed * 10U + numeric;
  }
  output = parsed;
  return true;
}

static bool parseDiagnosticSeverity(const String& value,
                                    schoolcalc_diagnostics::Severity& severity) {
  for (uint8_t candidate = 0; candidate <= 3; ++candidate) {
    const auto parsed = static_cast<schoolcalc_diagnostics::Severity>(candidate);
    if (value == schoolcalc_diagnostics::severityText(parsed)) {
      severity = parsed;
      return true;
    }
  }
  return false;
}

static bool isDiagnosticSubsystem(const String& value) {
  for (uint8_t candidate = 0; candidate <= 8; ++candidate) {
    const auto parsed = static_cast<schoolcalc_diagnostics::Subsystem>(candidate);
    if (value == schoolcalc_diagnostics::subsystemText(parsed)) return true;
  }
  return false;
}

static bool diagnosticEventMatches(
    const schoolcalc_diagnostics::Event& event,
    bool hasAfter, uint32_t after,
    bool hasCorrelation, uint32_t correlation,
    const String& subsystem,
    bool hasMinimumSeverity,
    schoolcalc_diagnostics::Severity minimumSeverity) {
  if (hasAfter && event.sequence <= after) return false;
  if (hasCorrelation && event.correlation != correlation) return false;
  if (!subsystem.isEmpty()
      && subsystem != schoolcalc_diagnostics::subsystemText(event.subsystem)) {
    return false;
  }
  return !hasMinimumSeverity
    || static_cast<uint8_t>(event.severity)
      >= static_cast<uint8_t>(minimumSeverity);
}

static void diagnosticsEventsHook() {
  size_t requested = schoolcalc_diagnostics::EVENT_CAPACITY;
  if (http.hasArg("limit")) {
    uint32_t parsed = 0;
    if (!parseDiagnosticUnsigned(http.arg("limit"), parsed) || parsed == 0) {
      http.send(400, "application/json",
                "{\"ok\":false,\"error\":\"limit must be positive\"}");
      return;
    }
    if (parsed < requested) {
      requested = static_cast<size_t>(parsed);
    }
  }
  const bool hasAfter = http.hasArg("after");
  uint32_t after = 0;
  if (hasAfter && !parseDiagnosticUnsigned(http.arg("after"), after)) {
    http.send(400, "application/json",
              "{\"ok\":false,\"error\":\"after must be uint32\"}");
    return;
  }
  const bool hasCorrelation = http.hasArg("correlation");
  uint32_t correlation = 0;
  if (hasCorrelation
      && !parseDiagnosticUnsigned(http.arg("correlation"), correlation)) {
    http.send(400, "application/json",
              "{\"ok\":false,\"error\":\"correlation must be uint32\"}");
    return;
  }
  const String subsystem = http.hasArg("subsystem")
    ? http.arg("subsystem") : String();
  if (!subsystem.isEmpty() && !isDiagnosticSubsystem(subsystem)) {
    http.send(400, "application/json",
              "{\"ok\":false,\"error\":\"unknown subsystem\"}");
    return;
  }
  schoolcalc_diagnostics::Severity minimumSeverity =
    schoolcalc_diagnostics::Severity::Debug;
  const bool hasMinimumSeverity = http.hasArg("min_severity");
  if (hasMinimumSeverity
      && !parseDiagnosticSeverity(http.arg("min_severity"), minimumSeverity)) {
    http.send(400, "application/json",
              "{\"ok\":false,\"error\":\"unknown min_severity\"}");
    return;
  }

  size_t snapshotCount = 0;
  uint32_t total = 0, overwritten = 0, nextSequence = 0;
  portENTER_CRITICAL(&diagnosticMux);
  snapshotCount = diagnosticJournal.copyOldest(
    diagnosticSnapshot, schoolcalc_diagnostics::EVENT_CAPACITY);
  total = diagnosticJournal.totalRecorded();
  overwritten = diagnosticJournal.overwrittenCount();
  nextSequence = diagnosticJournal.nextSequence();
  portEXIT_CRITICAL(&diagnosticMux);

  size_t matched = 0;
  for (size_t index = 0; index < snapshotCount; ++index) {
    if (diagnosticEventMatches(
          diagnosticSnapshot[index], hasAfter, after,
          hasCorrelation, correlation, subsystem,
          hasMinimumSeverity, minimumSeverity)) {
      matched++;
    }
  }
  const size_t count = matched < requested ? matched : requested;
  size_t matchesToSkip = matched - count;

  http.setContentLength(CONTENT_LENGTH_UNKNOWN);
  http.send(200, "application/json", "");
  JsonDocument header;
  header["count"] = count;
  header["matched"] = matched;
  header["total_recorded"] = total;
  header["overwritten"] = overwritten;
  header["next_sequence"] = nextSequence;
  JsonObject filters = header["filters"].to<JsonObject>();
  if (hasAfter) filters["after"] = after;
  if (hasCorrelation) filters["correlation"] = correlation;
  if (!subsystem.isEmpty()) filters["subsystem"] = subsystem;
  if (hasMinimumSeverity) {
    filters["min_severity"] = schoolcalc_diagnostics::severityText(
      minimumSeverity);
  }
  String chunk = "{";
  String fields;
  serializeJson(header, fields);
  // Drop the outer braces so the streamed event array remains one JSON object.
  chunk += fields.substring(1, fields.length() - 1);
  chunk += ",\"events\":[";
  http.sendContent(chunk);
  const uint32_t now = millis();
  size_t emitted = 0;
  for (size_t index = 0; index < snapshotCount; ++index) {
    const schoolcalc_diagnostics::Event& event = diagnosticSnapshot[index];
    if (!diagnosticEventMatches(
          event, hasAfter, after, hasCorrelation, correlation, subsystem,
          hasMinimumSeverity, minimumSeverity)) {
      continue;
    }
    if (matchesToSkip != 0) {
      matchesToSkip--;
      continue;
    }
    JsonDocument item;
    item["sequence"] = event.sequence;
    item["at_ms"] = event.atMs;
    item["ms_ago"] = now - event.atMs;
    item["subsystem"] = schoolcalc_diagnostics::subsystemText(event.subsystem);
    item["severity"] = schoolcalc_diagnostics::severityText(event.severity);
    item["name"] = event.name;
    if (event.detail[0] != '\0') item["detail"] = event.detail;
    if (event.correlation != 0) item["correlation"] = event.correlation;
    if (event.bytes != 0) item["bytes"] = event.bytes;
    if (event.status != 0) item["status"] = event.status;
    if (event.durationMs != 0) item["duration_ms"] = event.durationMs;
    chunk = emitted == 0 ? "" : ",";
    serializeJson(item, chunk);
    http.sendContent(chunk);
    emitted++;
  }
  http.sendContent("]}");
  http.sendContent("");
}

static void diagnosticsConfigHook() {
  JsonDocument d;
  d["relay_id"] = RELAY_ID;
  d["relay_label"] = RELAY_LABEL;
  d["config_fingerprint"] = FIRMWARE_CONFIG_FINGERPRINT;
  d["build_date"] = __DATE__;
  d["build_time"] = __TIME__;
  d["wifi"]["ssid"] = WIFI_SSID;
  d["wifi"]["password_configured"] = WIFI_PASSWORD[0] != '\0';
  d["backend"]["scheme"] = BACKEND_SCHEME;
  d["backend"]["host"] = BACKEND_HOST;
  d["backend"]["port"] = BACKEND_PORT;
  d["backend"]["api_base_path"] = API_BASE_PATH;
  d["backend"]["ws_path"] = WS_PATH;
  d["backend"]["api_token_configured"] = strlen(API_TOKEN) >= 32;
  d["ti_link"]["transmit_enabled"] = (bool)TI_TRANSMIT_ENABLED;
  d["ti_link"]["foreground_listener_enabled"] = (bool)FOREGROUND_LISTENER_ENABLED;
  d["ti_link"]["auto_sync_enabled"] = (bool)AUTO_SYNC_ENABLED;
  d["ti_link"]["pins"]["tip_sense"] = TIP_SENSE_PIN;
  d["ti_link"]["pins"]["tip_sink"] = TIP_SINK_PIN;
  d["ti_link"]["pins"]["ring_sense"] = RING_SENSE_PIN;
  d["ti_link"]["pins"]["ring_sink"] = RING_SINK_PIN;
  if (PLUG_DETECT_PIN >= 0) d["ti_link"]["pins"]["plug_detect"] = PLUG_DETECT_PIN;
  else d["ti_link"]["pins"]["plug_detect"] = nullptr;
  d["ti_link"]["plug_detect_active_high"] = (bool)PLUG_DETECT_ACTIVE_HIGH;
  d["ble_keyboard"]["enabled"] = (bool)BLE_KEYBOARD_ENABLED;
  d["ble_keyboard"]["address"] = BLE_KEYBOARD_ADDRESS[0] ? BLE_KEYBOARD_ADDRESS : nullptr;
  d["ble_keyboard"]["address_type"] = BLE_KEYBOARD_ADDRESS_TYPE == 0 ? "public" : "random";
  d["ble_keyboard"]["label"] = BLE_KEYBOARD_LABEL[0] ? BLE_KEYBOARD_LABEL : nullptr;
  d["ble_keyboard"]["pairing_window_ms"] = BLE_KEYBOARD_PAIRING_WINDOW_MS;
  d["ble_keyboard"]["require_mitm"] = (bool)BLE_KEYBOARD_REQUIRE_MITM;
  d["redaction"]["payload_bodies"] = "never_logged";
  d["redaction"]["api_token"] = "configured_boolean_only";
  d["redaction"]["wifi_password"] = "configured_boolean_only";
  String body;
  serializeJson(d, body);
  http.send(200, "application/json", body);
}

static void keyboardPairHook() {
  const bool opened = keyboardHost.openPairingWindow(millis());
  const schoolcalc_ble::Status current = keyboardHost.status(millis());
  recordDiagnostic(schoolcalc_diagnostics::Subsystem::BleKeyboard,
                   opened ? schoolcalc_diagnostics::Severity::Info
                          : schoolcalc_diagnostics::Severity::Error,
                   "pairing_requested", opened ? "window opened" : current.lastError);
  JsonDocument d;
  d["ok"] = opened;
  d["state"] = schoolcalc_ble::stateText(current.state);
  d["configured_address"] = current.configuredAddress[0]
    ? current.configuredAddress : nullptr;
  d["pairing_remaining_ms"] = current.pairingRemainingMs;
  d["instruction"] = opened && BLE_KEYBOARD_REQUIRE_MITM
    ? "poll /status and type the six-digit pairing_passkey on the configured keyboard"
    : (opened ? "make the configured keyboard connectable" : "inspect /status and /diagnostics/events");
  d["status_url"] = "/status";
  d["events_url"] = "/diagnostics/events";
  if (!opened) d["error"] = current.lastError;
  String body;
  serializeJson(d, body);
  http.send(opened ? 202 : 409, "application/json", body);
}

static void keyboardForgetHook() {
  const bool requested = keyboardHost.forgetBond();
  recordDiagnostic(schoolcalc_diagnostics::Subsystem::BleKeyboard,
                   requested ? schoolcalc_diagnostics::Severity::Warning
                             : schoolcalc_diagnostics::Severity::Error,
                   "forget_bond_requested",
                   requested ? "configured keyboard only" : "request rejected");
  JsonDocument d;
  d["ok"] = requested;
  d["state"] = requested ? "queued" : "rejected";
  d["scope"] = "configured_keyboard_only";
  String body;
  serializeJson(d, body);
  http.send(requested ? 202 : 409, "application/json", body);
}

static void syncHook() {
  syncRequests++;
  if (!TI_TRANSMIT_ENABLED) {
    http.send(409, "application/json", "{\"ok\":false,\"error\":\"TI transmit is disabled; verify the protected interface, then enable link.transmit_enabled\"}");
    return;
  }
  uint32_t operationId = 0;
  const bool queued = queueTiJob(TiJob::SilentSync, &operationId);
  JsonDocument d; d["ok"] = queued; d["state"] = queued ? "queued" : "busy";
  if (queued) d["operation_id"] = operationId;
  String body; serializeJson(d, body); http.send(queued ? 202 : 409, "application/json", body);
}

static void foregroundSyncHook() {
  syncRequests++;
  if (!TI_TRANSMIT_ENABLED) {
    http.send(409, "application/json", "{\"ok\":false,\"error\":\"TI transmit is disabled; verify the protected interface, then enable link.transmit_enabled\"}");
    return;
  }
  uint32_t operationId = 0;
  const bool queued = queueTiJob(TiJob::ForegroundSync, &operationId);
  JsonDocument d;
  d["ok"] = queued;
  d["state"] = queued ? "foreground_waiting_for_hello" : "busy";
  if (queued) d["operation_id"] = operationId;
  String body;
  serializeJson(d, body);
  http.send(queued ? 202 : 409, "application/json", body);
}

static void requestScreenshot() {
  if (!TI_TRANSMIT_ENABLED) {
    http.send(409, "application/json", "{\"ok\":false,\"error\":\"TI transmit is disabled; set link.transmit_enabled: true only after wiring is verified\"}");
    return;
  }
  const TiJob job = TiJob::Screenshot;
  uint32_t operationId = 0;
  if (!queueTiJob(job, &operationId)) {
    http.send(409, "application/json", "{\"ok\":false,\"error\":\"TI link task is busy\"}"); return;
  }
  JsonDocument d;
  d["ok"] = true;
  d["state"] = "screenshot_queued";
  d["operation_id"] = operationId;
  String body;
  serializeJson(d, body);
  http.send(202, "application/json", body);
}

static void serveScreenshotRaw() {
  uint8_t copy[1024];
  portENTER_CRITICAL(&tiStatusMux);
  const bool ready = tiScreenshotReady;
  if (ready) memcpy(copy, screenshot, sizeof(copy));
  portEXIT_CRITICAL(&tiStatusMux);
  if (!ready) { http.send(404, "application/json", "{\"ok\":false,\"error\":\"no screenshot captured yet\"}"); return; }
  http.setContentLength(sizeof(copy));
  http.sendHeader("Content-Disposition", "attachment; filename=ti86-screen.raw");
  http.send(200, "application/octet-stream", "");
  http.client().write(copy, sizeof(copy));
}

void setup() {
  Serial.begin(115200); delay(100); bootMs = millis();
  recordDiagnostic(schoolcalc_diagnostics::Subsystem::System,
                   schoolcalc_diagnostics::Severity::Info,
                   "boot", FIRMWARE_CONFIG_FINGERPRINT);
  calculatorVariables.setObserver(&relayIoObserver);
  foregroundFrameChannel.setObserver(&relayIoObserver);
  schoolCalcApi.setObserver(&relayIoObserver);
  tiLink.begin();
#if PLUG_DETECT_PIN >= 0
  pinMode(PLUG_DETECT_PIN, INPUT);
#endif
  syncWorkspace = static_cast<uint8_t*>(malloc(SYNC_WORKSPACE_BYTES));
  if (syncWorkspace == nullptr) {
    snprintf(tiLastError, sizeof(tiLastError),
             "could not reserve %u-byte sync workspace",
             static_cast<unsigned>(SYNC_WORKSPACE_BYTES));
    recordDiagnostic(schoolcalc_diagnostics::Subsystem::System,
                     schoolcalc_diagnostics::Severity::Error,
                     "workspace_allocation_failed", tiLastError, 0,
                     static_cast<uint32_t>(SYNC_WORKSPACE_BYTES));
  } else {
    recordDiagnostic(schoolcalc_diagnostics::Subsystem::System,
                     schoolcalc_diagnostics::Severity::Info,
                     "workspace_ready", "sync workspace reserved", 0,
                     static_cast<uint32_t>(SYNC_WORKSPACE_BYTES));
  }
  FastLED.addLeds<SK6812, LED_PIN, GRB>(led, 1); FastLED.setBrightness(35); setLed(CRGB::Black);
  http.on("/", HTTP_GET, status); http.on("/status", HTTP_GET, status); http.on("/health", HTTP_GET, status);
  http.on("/sync", HTTP_POST, syncHook);
  http.on("/sync/foreground", HTTP_POST, foregroundSyncHook);
  // Local bring-up only: this is deliberately outside the SchoolCalc product
  // API. It proves the physical link with a read-only platform diagnostic.
  http.on("/diagnostics/link/screenshot", HTTP_POST, requestScreenshot);
  http.on("/diagnostics/link/screenshot.raw", HTTP_GET, serveScreenshotRaw);
  http.on("/diagnostics/events", HTTP_GET, diagnosticsEventsHook);
  http.on("/diagnostics/config", HTTP_GET, diagnosticsConfigHook);
  http.on("/input/ble/pair", HTTP_POST, keyboardPairHook);
  http.on("/input/ble/forget", HTTP_POST, keyboardForgetHook);
  http.onNotFound([]() { http.send(404, "application/json", "{\"ok\":false,\"error\":\"not found\"}"); });
  http.begin();
  tiJobs = xQueueCreate(1, sizeof(TiJob));
  if (!tiJobs) {
    snprintf(tiLastError, sizeof(tiLastError), "could not create TI link command queue");
    recordDiagnostic(schoolcalc_diagnostics::Subsystem::System,
                     schoolcalc_diagnostics::Severity::Error,
                     "ti_queue_create_failed", tiLastError);
  } else {
    if (xTaskCreatePinnedToCore(tiTask, "ti-link", 10240, nullptr, 4, nullptr, 1) != pdPASS) {
      snprintf(tiLastError, sizeof(tiLastError), "could not create TI link task");
      vQueueDelete(tiJobs);
      tiJobs = nullptr;
      recordDiagnostic(schoolcalc_diagnostics::Subsystem::System,
                       schoolcalc_diagnostics::Severity::Error,
                       "ti_task_create_failed", tiLastError);
    } else {
      recordDiagnostic(schoolcalc_diagnostics::Subsystem::System,
                       schoolcalc_diagnostics::Severity::Info,
                       "ti_task_ready", "core=1 priority=4");
    }
  }
  keyboardHost.begin(BLE_KEYBOARD_ENABLED, BLE_KEYBOARD_ADDRESS,
                     BLE_KEYBOARD_ADDRESS_TYPE, BLE_KEYBOARD_LABEL,
                     BLE_KEYBOARD_PAIRING_WINDOW_MS,
                     BLE_KEYBOARD_REQUIRE_MITM);
  connectWifi();
  ws.onEvent(wsEvent); ws.setReconnectInterval(3000); ws.begin(BACKEND_HOST, BACKEND_PORT, WS_PATH);
  Serial.printf("[ticalc] %s ready; TI transmit=%s; API=%s\n", RELAY_ID,
                TI_TRANSMIT_ENABLED ? "ENABLED" : "disabled", apiUrl("").c_str());
}

void loop() {
  sampleLines();
  samplePlugDetect();
  serviceKeyboardInput();
  ws.loop();
  http.handleClient();
  if (WiFi.status() != WL_CONNECTED && millis() - lastWifiTryMs > WIFI_RETRY_PERIOD_MS) connectWifi();
  if (AUTO_SYNC_ENABLED && TI_TRANSMIT_ENABLED && WiFi.status() == WL_CONNECTED
      && millis() - lastAutoSyncMs > AUTO_SYNC_PERIOD_MS) {
    lastAutoSyncMs = millis();
    if (queueTiJob(TiJob::SilentSync)) syncRequests++;
  }
  if (millis() - lastWsHeartbeatMs > WS_HEARTBEAT_MS) sendWsHeartbeat();
  delay(2);
}

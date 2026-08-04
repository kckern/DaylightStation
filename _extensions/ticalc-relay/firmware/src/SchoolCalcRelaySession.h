#pragma once

#include <stddef.h>
#include <stdint.h>

namespace schoolcalc_relay {

static constexpr uint8_t MAX_ARTIFACTS_PER_SYNC = 8;
// Mirrored from the TI-86 adapter's executable resource contract. The relay
// enforces these before any network upload or calculator write.
static constexpr uint16_t TI86_CATALOG_RECORD_MAX_BYTES = 5832;
static constexpr uint16_t TI86_RESULT_QUEUE_MAX_BYTES = 6144;
static constexpr uint16_t TI86_DELIVERY_REQUEST_MAX_BYTES = 2048;
static constexpr uint16_t TI86_LEARNER_ROSTER_MAX_BYTES = 512;
static constexpr uint16_t TI86_PROGRESS_PROJECTION_MAX_BYTES = 4096;
static constexpr uint16_t TI86_INTERACTION_REQUEST_MAX_BYTES = 512;
static constexpr uint16_t TI86_INTERACTION_RESPONSE_MAX_BYTES = 2048;
static constexpr uint16_t TI86_ARTIFACT_MAX_BYTES = 12288;
static constexpr uint16_t TI86_ACKNOWLEDGEMENT_MAX_BYTES = 544;
static constexpr uint16_t TI86_SYNC_MANIFEST_MAX_BYTES = 6144;
static constexpr size_t MAX_DEVICE_ID_BYTES = 16;
static constexpr size_t MAX_PLATFORM_ID_BYTES = 31;
static constexpr size_t MAX_ARTIFACT_ID_BYTES = 127;
static constexpr size_t MAX_GENERATION_BYTES = 79;

struct ByteView {
  const uint8_t* bytes = nullptr;
  uint16_t length = 0;
};

struct MutableBytes {
  uint8_t* bytes = nullptr;
  uint16_t capacity = 0;
  uint16_t length = 0;
};

enum class VariableReadStatus : uint8_t { Found, Missing, TooLarge, Failed };

class ICalculatorVariables {
public:
  virtual ~ICalculatorVariables() = default;
  virtual VariableReadStatus read(const char* name, MutableBytes& output) = 0;
  virtual bool write(const char* name, ByteView payload) = 0;
  virtual const char* lastError() const = 0;
};

struct DeviceIdentity {
  char deviceId[MAX_DEVICE_ID_BYTES + 1] = { 0 };
  char platformId[MAX_PLATFORM_ID_BYTES + 1] = { 0 };
};

struct SyncRequest {
  const char* deviceId = nullptr;
  ByteView deviceInfo;
  ByteView installedState;
  ByteView resultQueue;
  ByteView deliveryRequests;
  ByteView interactionRequest;
  const char* catalogGeneration = nullptr;
};

struct ArtifactDescriptor {
  char artifactId[MAX_ARTIFACT_ID_BYTES + 1] = { 0 };
  char variableName[9] = { 0 };
  uint16_t byteLength = 0;
  char byteDigest[65] = { 0 };
};

struct SyncPlan {
  bool ready = false;
  bool catalogChanged = false;
  char catalogGeneration[MAX_GENERATION_BYTES + 1] = { 0 };
  uint8_t artifactCount = 0;
  ArtifactDescriptor artifacts[MAX_ARTIFACTS_PER_SYNC];
  uint16_t acknowledgementLength = 0;
  uint16_t manifestLength = 0;
  uint16_t learnerRosterLength = 0;
  uint16_t progressProjectionLength = 0;
  uint16_t interactionResponseLength = 0;
};

/** Optional liveness service used while a concrete network call is blocked. */
class INetworkWaitObserver {
public:
  virtual ~INetworkWaitObserver() = default;
  virtual bool serviceNetworkWait(uint32_t elapsedMs) = 0;
};

class ISchoolCalcApi {
public:
  virtual ~ISchoolCalcApi() = default;
  virtual bool identify(ByteView identityRecord, DeviceIdentity& identity) = 0;
  virtual bool sync(const SyncRequest& request, SyncPlan& plan,
                    MutableBytes& acknowledgement, MutableBytes& manifest,
                    MutableBytes& learnerRoster,
                    MutableBytes& progressProjection,
                    MutableBytes& interactionResponse,
                    INetworkWaitObserver* waitObserver = nullptr) = 0;
  virtual bool fetchCatalog(const char* deviceId, const char* expectedGeneration,
                            MutableBytes& output) = 0;
  // This method promises length and SHA-256 validation against `artifact`.
  virtual bool fetchArtifact(const ArtifactDescriptor& artifact, MutableBytes& output) = 0;
  virtual const char* lastError() const = 0;
};

struct SessionBuffers {
  MutableBytes identity;
  MutableBytes deviceInfo;
  MutableBytes installedState;
  MutableBytes resultQueue;
  MutableBytes deliveryRequests;
  MutableBytes interactionRequest;
  MutableBytes learnerRoster;
  MutableBytes progressProjection;
  MutableBytes interactionResponse;
  MutableBytes acknowledgement;
  MutableBytes manifest;
  MutableBytes transfer;
};

enum class SessionState : uint8_t {
  Idle,
  ReadingIdentity,
  Identifying,
  ReadingInputs,
  Synchronizing,
  StagingProfiles,
  StagingProgress,
  StagingInteraction,
  StagingCatalog,
  StagingArtifacts,
  StagingAcknowledgements,
  PublishingManifest,
  AwaitingCalculatorCommit,
  Failed,
};

enum class SessionDirection : uint8_t {
  Idle,
  Negotiating,
  CalculatorToRelay,
  Network,
  RelayToCalculator,
};

enum class SessionError : uint8_t {
  None,
  TransportAwareness,
  IdentityMissing,
  CalculatorRead,
  InvalidIdentityEnvelope,
  IdentifyRejected,
  DeviceInfoMissing,
  InvalidDeviceInfoEnvelope,
  InvalidInstalledStateEnvelope,
  InstalledStateTooLarge,
  InvalidResultQueueEnvelope,
  ResultQueueTooLarge,
  InvalidDeliveryRequestEnvelope,
  DeliveryRequestTooLarge,
  SyncRejected,
  InvalidPlan,
  InvalidAcknowledgementEnvelope,
  InvalidManifestEnvelope,
  InvalidLearnerRosterEnvelope,
  LearnerRosterTooLarge,
  InvalidProgressProjectionEnvelope,
  ProgressProjectionTooLarge,
  InvalidInteractionRequestEnvelope,
  InteractionRequestTooLarge,
  InvalidInteractionResponseEnvelope,
  InteractionResponseTooLarge,
  CatalogFetch,
  CatalogTooLarge,
  InvalidCatalogEnvelope,
  InvalidArtifactDescriptor,
  ArtifactTooLarge,
  ArtifactFetch,
  InvalidArtifactEnvelope,
  CalculatorWrite,
};

struct SessionOutcome {
  bool ok;
  SessionState state;
  SessionError error;
  const char* detail;
  DeviceIdentity identity;
  bool ready;
  uint8_t artifactsStaged;
  bool profilesStaged;
  bool progressStaged;
  bool interactionStaged;
};

class ISchoolCalcSessionObserver : public INetworkWaitObserver {
public:
  virtual ~ISchoolCalcSessionObserver() = default;
  virtual void onSessionProgress(SessionState state, SessionDirection direction,
                                 uint8_t itemsCompleted, uint8_t itemsTotal) = 0;
  // A local LED/status observer remains healthy by default. A cooperative
  // foreground observer overrides these methods because losing its peer is a
  // transaction failure, not merely missing telemetry.
  virtual bool healthy() const { return true; }
  virtual const char* observerError() const { return "none"; }
  bool serviceNetworkWait(uint32_t) override { return healthy(); }
};

/**
 * Deterministic offline-first sync transaction.
 *
 * The commit manifest is always the final calculator write. Any earlier
 * disconnect can leave only ignored staging variables; it cannot authorize the
 * shell to remove an old artifact or consume a queued result.
 */
class SchoolCalcRelaySession {
public:
  SchoolCalcRelaySession(ICalculatorVariables& calculator, ISchoolCalcApi& api,
                         SessionBuffers buffers,
                         ISchoolCalcSessionObserver* observer = nullptr);

  SessionOutcome run(const char* catalogGeneration = nullptr);
  SessionState state() const { return state_; }
  SessionError lastError() const { return error_; }
  const char* lastErrorText() const;

private:
  ICalculatorVariables& calculator_;
  ISchoolCalcApi& api_;
  SessionBuffers buffers_;
  SessionState state_ = SessionState::Idle;
  SessionError error_ = SessionError::None;
  const char* detail_ = "none";
  DeviceIdentity identity_{};
  uint8_t artifactsStaged_ = 0;
  bool profilesStaged_ = false;
  bool progressStaged_ = false;
  bool interactionStaged_ = false;
  ISchoolCalcSessionObserver* observer_ = nullptr;

  bool transition(SessionState state, uint8_t itemsCompleted = 0,
                  uint8_t itemsTotal = 0);

  bool readRequired(const char* name, MutableBytes& output,
                    const char magic[4], SessionError missing,
                    SessionError invalid,
                    SessionError tooLarge = SessionError::CalculatorRead);
  bool readOptional(const char* name, MutableBytes& output,
                    const char magic[4], SessionError invalid,
                    SessionError tooLarge = SessionError::CalculatorRead);
  bool writeRecord(const char* name, ByteView record);
  bool validateRecord(ByteView record, const char magic[4], SessionError error);
  SessionOutcome outcome(bool ok, bool ready = false) const;
  bool fail(SessionError error, const char* detail);
};

const char* sessionStateText(SessionState state);
const char* sessionDirectionText(SessionDirection direction);
const char* sessionErrorText(SessionError error);

}  // namespace schoolcalc_relay

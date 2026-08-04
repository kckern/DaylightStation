#include "SchoolCalcRelaySession.h"

#include "SchoolCalcWire.h"

#include <string.h>

namespace schoolcalc_relay {

using schoolcalc_wire::DecodeStatus;

static constexpr const char* VAR_IDENTITY = "DSID";
static constexpr const char* VAR_DEVICE_INFO = "DSINFO";
static constexpr const char* VAR_INSTALLED_STATE = "DSINST";
static constexpr const char* VAR_RESULT_QUEUE = "DSQ";
static constexpr const char* VAR_DELIVERY_REQUESTS = "DSREQ";
static constexpr const char* VAR_INTERACTION_REQUEST = "DSTREQ";
// Staging names are deliberately distinct from the shell's canonical state.
// TI silent-link writes overwrite duplicate names automatically.
static constexpr const char* VAR_LEARNER_ROSTER_STAGE = "DSUSRNEW";
static constexpr const char* VAR_PROGRESS_STAGE = "DSPRGNEW";
static constexpr const char* VAR_INTERACTION_STAGE = "DSTNEW";
static constexpr const char* VAR_CATALOG_STAGE = "DSCATNEW";
static constexpr const char* VAR_ACK_STAGE = "DSACKNEW";
static constexpr const char* VAR_SYNC_MANIFEST = "DSSYNC";

static ByteView view(const MutableBytes& bytes);
static void resetLength(MutableBytes& bytes);
static bool boundedText(const char* value, size_t maxLength);
static bool validArtifactLocator(const ArtifactDescriptor& artifact);

SchoolCalcRelaySession::SchoolCalcRelaySession(ICalculatorVariables& calculator,
                                               ISchoolCalcApi& api,
                                               SessionBuffers buffers,
                                               ISchoolCalcSessionObserver* observer)
  : calculator_(calculator), api_(api), buffers_(buffers), observer_(observer) {}

SessionOutcome SchoolCalcRelaySession::run(const char* catalogGeneration) {
  error_ = SessionError::None;
  detail_ = "none";
  identity_ = DeviceIdentity{};
  artifactsStaged_ = 0;
  profilesStaged_ = false;
  progressStaged_ = false;
  interactionStaged_ = false;
  resetLength(buffers_.identity);
  resetLength(buffers_.deviceInfo);
  resetLength(buffers_.installedState);
  resetLength(buffers_.resultQueue);
  resetLength(buffers_.deliveryRequests);
  resetLength(buffers_.interactionRequest);
  resetLength(buffers_.learnerRoster);
  resetLength(buffers_.progressProjection);
  resetLength(buffers_.interactionResponse);
  resetLength(buffers_.acknowledgement);
  resetLength(buffers_.manifest);
  resetLength(buffers_.transfer);

  if (!transition(SessionState::ReadingIdentity, 0, 1)) return outcome(false);

  if (!readRequired(VAR_IDENTITY, buffers_.identity, "SCI1",
                    SessionError::IdentityMissing,
                    SessionError::InvalidIdentityEnvelope)) return outcome(false);
  if (!transition(SessionState::ReadingIdentity, 1, 1)) return outcome(false);

  if (!transition(SessionState::Identifying, 0, 1)) return outcome(false);
  if (!api_.identify(view(buffers_.identity), identity_)) {
    fail(SessionError::IdentifyRejected, api_.lastError());
    return outcome(false);
  }
  if (!boundedText(identity_.deviceId, MAX_DEVICE_ID_BYTES)
      || !boundedText(identity_.platformId, MAX_PLATFORM_ID_BYTES)) {
    fail(SessionError::IdentifyRejected, "API returned an invalid device identity");
    return outcome(false);
  }

  if (!transition(SessionState::ReadingInputs, 0, 5)) return outcome(false);
  if (!readRequired(VAR_DEVICE_INFO, buffers_.deviceInfo, "SCI1",
                    SessionError::DeviceInfoMissing,
                    SessionError::InvalidDeviceInfoEnvelope)) return outcome(false);
  if (!transition(SessionState::ReadingInputs, 1, 5)) return outcome(false);
  if (!readOptional(VAR_INSTALLED_STATE, buffers_.installedState, "SCM1",
                    SessionError::InvalidInstalledStateEnvelope,
                    SessionError::InstalledStateTooLarge)) return outcome(false);
  if (!transition(SessionState::ReadingInputs, 2, 5)) return outcome(false);
  if (!readOptional(VAR_RESULT_QUEUE, buffers_.resultQueue, "SCQ1",
                    SessionError::InvalidResultQueueEnvelope,
                    SessionError::ResultQueueTooLarge)) return outcome(false);
  if (!transition(SessionState::ReadingInputs, 3, 5)) return outcome(false);
  if (!readOptional(VAR_DELIVERY_REQUESTS, buffers_.deliveryRequests, "SCD1",
                    SessionError::InvalidDeliveryRequestEnvelope,
                    SessionError::DeliveryRequestTooLarge)) return outcome(false);
  if (!transition(SessionState::ReadingInputs, 4, 5)) return outcome(false);
  if (!readOptional(VAR_INTERACTION_REQUEST, buffers_.interactionRequest, "SCTQ",
                    SessionError::InvalidInteractionRequestEnvelope,
                    SessionError::InteractionRequestTooLarge)) return outcome(false);
  if (!transition(SessionState::ReadingInputs, 5, 5)) return outcome(false);
  if (buffers_.installedState.length > TI86_SYNC_MANIFEST_MAX_BYTES) {
    fail(SessionError::InstalledStateTooLarge, "DSINST exceeds the TI-86 6144-byte state limit");
    return outcome(false);
  }
  if (buffers_.resultQueue.length > TI86_RESULT_QUEUE_MAX_BYTES) {
    fail(SessionError::ResultQueueTooLarge, "DSQ exceeds the TI-86 6144-byte queue limit");
    return outcome(false);
  }
  if (buffers_.interactionRequest.length > TI86_INTERACTION_REQUEST_MAX_BYTES) {
    fail(SessionError::InteractionRequestTooLarge,
         "DSTREQ exceeds the TI-86 512-byte interaction-request limit");
    return outcome(false);
  }

  if (!transition(SessionState::Synchronizing, 0, 1)) return outcome(false);
  SyncPlan plan{};
  SyncRequest request{};
  request.deviceId = identity_.deviceId;
  request.deviceInfo = view(buffers_.deviceInfo);
  request.installedState = view(buffers_.installedState);
  request.resultQueue = view(buffers_.resultQueue);
  request.deliveryRequests = view(buffers_.deliveryRequests);
  request.interactionRequest = view(buffers_.interactionRequest);
  request.catalogGeneration = catalogGeneration;
  if (!api_.sync(request, plan, buffers_.acknowledgement, buffers_.manifest,
                 buffers_.learnerRoster, buffers_.progressProjection,
                 buffers_.interactionResponse, observer_)) {
    fail(SessionError::SyncRejected, api_.lastError());
    return outcome(false);
  }
  if (plan.artifactCount > MAX_ARTIFACTS_PER_SYNC
      || plan.acknowledgementLength != buffers_.acknowledgement.length
      || plan.manifestLength != buffers_.manifest.length
      || plan.learnerRosterLength != buffers_.learnerRoster.length
      || plan.progressProjectionLength != buffers_.progressProjection.length
      || plan.interactionResponseLength != buffers_.interactionResponse.length
      || (buffers_.interactionRequest.length == 0) != (buffers_.interactionResponse.length == 0)
      || !boundedText(plan.catalogGeneration, MAX_GENERATION_BYTES)) {
    fail(SessionError::InvalidPlan, "API returned an invalid sync plan");
    return outcome(false);
  }
  if (!validateRecord(view(buffers_.acknowledgement), "SCA1",
                      SessionError::InvalidAcknowledgementEnvelope)
      || !validateRecord(view(buffers_.manifest), "SCM1",
                         SessionError::InvalidManifestEnvelope)) {
    return outcome(false);
  }
  if (buffers_.learnerRoster.length > TI86_LEARNER_ROSTER_MAX_BYTES) {
    fail(SessionError::LearnerRosterTooLarge,
         "SCU1 exceeds the TI-86 512-byte learner-roster limit");
    return outcome(false);
  }
  if (!validateRecord(view(buffers_.learnerRoster), "SCU1",
                      SessionError::InvalidLearnerRosterEnvelope)) {
    return outcome(false);
  }
  if (buffers_.progressProjection.length > TI86_PROGRESS_PROJECTION_MAX_BYTES) {
    fail(SessionError::ProgressProjectionTooLarge,
         "SCG1 exceeds the TI-86 4096-byte progress-projection limit");
    return outcome(false);
  }
  if (!validateRecord(view(buffers_.progressProjection), "SCG1",
                      SessionError::InvalidProgressProjectionEnvelope)) {
    return outcome(false);
  }
  if (buffers_.interactionResponse.length > TI86_INTERACTION_RESPONSE_MAX_BYTES) {
    fail(SessionError::InteractionResponseTooLarge,
         "SCTR exceeds the TI-86 2048-byte interaction-response limit");
    return outcome(false);
  }
  if (buffers_.interactionResponse.length > 0
      && !validateRecord(view(buffers_.interactionResponse), "SCTR",
                         SessionError::InvalidInteractionResponseEnvelope)) {
    return outcome(false);
  }
  if (!transition(SessionState::Synchronizing, 1, 1)) return outcome(false);

  // The roster is a replaceable, device-bound projection rather than part of
  // the content transaction. Stage it under a non-canonical name; SCUSER can
  // validate and promote the complete SCU1 idempotently. A cut during this
  // write therefore leaves the previous DSUSERS untouched.
  if (!transition(SessionState::StagingProfiles, 0, 1)) return outcome(false);
  if (!writeRecord(VAR_LEARNER_ROSTER_STAGE, view(buffers_.learnerRoster))) {
    return outcome(false);
  }
  profilesStaged_ = true;
  if (!transition(SessionState::StagingProfiles, 1, 1)) return outcome(false);

  // Progress is a replaceable, device-bound projection too. A torn write to
  // DSPRGNEW therefore leaves the previous committed DSPROG intact.
  if (!transition(SessionState::StagingProgress, 0, 1)) return outcome(false);
  if (!writeRecord(VAR_PROGRESS_STAGE, view(buffers_.progressProjection))) {
    return outcome(false);
  }
  progressStaged_ = true;
  if (!transition(SessionState::StagingProgress, 1, 1)) return outcome(false);

  // Tutor/action responses are independently recoverable. DSTREQ remains the
  // durable idempotency source until SCPROF validates and promotes an SCTR
  // response that echoes its exact device, learner, and request IDs.
  if (buffers_.interactionResponse.length > 0) {
    if (!transition(SessionState::StagingInteraction, 0, 1)) return outcome(false);
    if (!writeRecord(VAR_INTERACTION_STAGE, view(buffers_.interactionResponse))) {
      return outcome(false);
    }
    interactionStaged_ = true;
    if (!transition(SessionState::StagingInteraction, 1, 1)) return outcome(false);
  }

  if (plan.ready && plan.catalogChanged) {
    if (!transition(SessionState::StagingCatalog, 0, 1)) return outcome(false);
    resetLength(buffers_.transfer);
    if (!api_.fetchCatalog(identity_.deviceId, plan.catalogGeneration, buffers_.transfer)) {
      fail(SessionError::CatalogFetch, api_.lastError());
      return outcome(false);
    }
    if (buffers_.transfer.length > TI86_CATALOG_RECORD_MAX_BYTES) {
      fail(SessionError::CatalogTooLarge, "SCC1 exceeds the TI-86 5832-byte Catalog record limit");
      return outcome(false);
    }
    if (!validateRecord(view(buffers_.transfer), "SCC1", SessionError::InvalidCatalogEnvelope)
        || !writeRecord(VAR_CATALOG_STAGE, view(buffers_.transfer))) return outcome(false);
    if (!transition(SessionState::StagingCatalog, 1, 1)) return outcome(false);
  }

  if (plan.ready) {
    if (!transition(SessionState::StagingArtifacts, 0, plan.artifactCount)) {
      return outcome(false);
    }
    for (uint8_t index = 0; index < plan.artifactCount; ++index) {
      if (!transition(SessionState::StagingArtifacts, index, plan.artifactCount)) {
        return outcome(false);
      }
      const ArtifactDescriptor& artifact = plan.artifacts[index];
      uint8_t ignored[12];
      if (artifact.byteLength > TI86_ARTIFACT_MAX_BYTES) {
        fail(SessionError::ArtifactTooLarge, "artifact exceeds the TI-86 12288-byte hard ceiling");
        return outcome(false);
      }
      if (!boundedText(artifact.artifactId, MAX_ARTIFACT_ID_BYTES)
          || !validArtifactLocator(artifact)
          || artifact.byteLength == 0 || artifact.byteLength > 0xFFFD
          || strlen(artifact.byteDigest) != 64
          || schoolcalc_wire::encodePaddedVariableHeader(
               static_cast<uint16_t>(artifact.byteLength + 2),
               schoolcalc_wire::TYPE_STRING, artifact.variableName, ignored)
             != DecodeStatus::Ok) {
        fail(SessionError::InvalidArtifactDescriptor, "API returned an invalid artifact descriptor");
        return outcome(false);
      }
      resetLength(buffers_.transfer);
      if (!api_.fetchArtifact(artifact, buffers_.transfer)) {
        fail(SessionError::ArtifactFetch, api_.lastError());
        return outcome(false);
      }
      if (buffers_.transfer.length != artifact.byteLength
          || !validateRecord(view(buffers_.transfer), "SCP1", SessionError::InvalidArtifactEnvelope)
          || !writeRecord(artifact.variableName, view(buffers_.transfer))) return outcome(false);
      artifactsStaged_ += 1;
      if (!transition(SessionState::StagingArtifacts, artifactsStaged_,
                      plan.artifactCount)) return outcome(false);
    }
  }

  if (!transition(SessionState::StagingAcknowledgements, 0, 1)) return outcome(false);
  if (!writeRecord(VAR_ACK_STAGE, view(buffers_.acknowledgement))) return outcome(false);
  if (!transition(SessionState::StagingAcknowledgements, 1, 1)) return outcome(false);

  // Commit marker LAST. The shell ignores every staging variable unless this
  // envelope is complete and agrees with their IDs/digests/generation.
  if (!transition(SessionState::PublishingManifest, 0, 1)) return outcome(false);
  if (!writeRecord(VAR_SYNC_MANIFEST, view(buffers_.manifest))) return outcome(false);
  if (!transition(SessionState::PublishingManifest, 1, 1)) return outcome(false);

  if (!transition(SessionState::AwaitingCalculatorCommit, 1, 1)) return outcome(false);
  return outcome(true, plan.ready);
}

bool SchoolCalcRelaySession::transition(SessionState state, uint8_t itemsCompleted,
                                        uint8_t itemsTotal) {
  state_ = state;
  if (observer_ == nullptr) return true;
  SessionDirection direction = SessionDirection::Idle;
  if (state == SessionState::ReadingIdentity) {
    direction = SessionDirection::Negotiating;
  } else if (state == SessionState::ReadingInputs) {
    direction = SessionDirection::CalculatorToRelay;
  } else if (state == SessionState::Identifying || state == SessionState::Synchronizing) {
    direction = SessionDirection::Network;
  } else if (state == SessionState::StagingProfiles
             || state == SessionState::StagingProgress
             || state == SessionState::StagingInteraction
             || state == SessionState::StagingCatalog
             || state == SessionState::StagingArtifacts
             || state == SessionState::StagingAcknowledgements
             || state == SessionState::PublishingManifest) {
    direction = SessionDirection::RelayToCalculator;
  }
  observer_->onSessionProgress(state, direction, itemsCompleted, itemsTotal);
  if (state != SessionState::Failed && !observer_->healthy()) {
    error_ = SessionError::TransportAwareness;
    detail_ = observer_->observerError();
    state_ = SessionState::Failed;
    observer_->onSessionProgress(SessionState::Failed, SessionDirection::Idle, 0, 0);
    return false;
  }
  return true;
}

bool SchoolCalcRelaySession::readRequired(const char* name, MutableBytes& output,
                                          const char magic[4], SessionError missing,
                                          SessionError invalid,
                                          SessionError tooLarge) {
  const VariableReadStatus status = calculator_.read(name, output);
  if (status == VariableReadStatus::Failed) return fail(SessionError::CalculatorRead, calculator_.lastError());
  if (status == VariableReadStatus::TooLarge) return fail(tooLarge, calculator_.lastError());
  if (status == VariableReadStatus::Missing) return fail(missing, name);
  return validateRecord(view(output), magic, invalid);
}

bool SchoolCalcRelaySession::readOptional(const char* name, MutableBytes& output,
                                          const char magic[4], SessionError invalid,
                                          SessionError tooLarge) {
  const VariableReadStatus status = calculator_.read(name, output);
  if (status == VariableReadStatus::Failed) return fail(SessionError::CalculatorRead, calculator_.lastError());
  if (status == VariableReadStatus::TooLarge) return fail(tooLarge, calculator_.lastError());
  if (status == VariableReadStatus::Missing) { output.length = 0; return true; }
  return validateRecord(view(output), magic, invalid);
}

bool SchoolCalcRelaySession::writeRecord(const char* name, ByteView record) {
  if (!calculator_.write(name, record)) return fail(SessionError::CalculatorWrite, calculator_.lastError());
  return true;
}

bool SchoolCalcRelaySession::validateRecord(ByteView record, const char magic[4],
                                            SessionError error) {
  const DecodeStatus status = schoolcalc_wire::validateSchoolCalcEnvelope(
    record.bytes, record.length, magic);
  if (status != DecodeStatus::Ok) return fail(error, schoolcalc_wire::decodeStatusText(status));
  return true;
}

SessionOutcome SchoolCalcRelaySession::outcome(bool ok, bool ready) const {
  SessionOutcome result{};
  result.ok = ok;
  result.state = state_;
  result.error = error_;
  result.detail = detail_;
  result.identity = identity_;
  result.ready = ready;
  result.artifactsStaged = artifactsStaged_;
  result.profilesStaged = profilesStaged_;
  result.progressStaged = progressStaged_;
  result.interactionStaged = interactionStaged_;
  return result;
}

bool SchoolCalcRelaySession::fail(SessionError error, const char* detail) {
  error_ = error;
  detail_ = detail == nullptr ? "unknown" : detail;
  transition(SessionState::Failed);
  return false;
}

const char* SchoolCalcRelaySession::lastErrorText() const { return sessionErrorText(error_); }

const char* sessionStateText(SessionState state) {
  switch (state) {
    case SessionState::Idle: return "idle";
    case SessionState::ReadingIdentity: return "reading_identity";
    case SessionState::Identifying: return "identifying";
    case SessionState::ReadingInputs: return "reading_inputs";
    case SessionState::Synchronizing: return "synchronizing";
    case SessionState::StagingProfiles: return "staging_profiles";
    case SessionState::StagingProgress: return "staging_progress";
    case SessionState::StagingInteraction: return "staging_interaction";
    case SessionState::StagingCatalog: return "staging_catalog";
    case SessionState::StagingArtifacts: return "staging_artifacts";
    case SessionState::StagingAcknowledgements: return "staging_acknowledgements";
    case SessionState::PublishingManifest: return "publishing_manifest";
    case SessionState::AwaitingCalculatorCommit: return "awaiting_calculator_commit";
    case SessionState::Failed: return "failed";
  }
  return "unknown";
}

const char* sessionDirectionText(SessionDirection direction) {
  switch (direction) {
    case SessionDirection::Idle: return "idle";
    case SessionDirection::Negotiating: return "negotiating";
    case SessionDirection::CalculatorToRelay: return "calculator_to_relay";
    case SessionDirection::Network: return "network";
    case SessionDirection::RelayToCalculator: return "relay_to_calculator";
  }
  return "unknown";
}

const char* sessionErrorText(SessionError error) {
  switch (error) {
    case SessionError::None: return "none";
    case SessionError::TransportAwareness: return "calculator foreground awareness failed";
    case SessionError::IdentityMissing: return "provisioned DSID is missing";
    case SessionError::CalculatorRead: return "calculator variable read failed";
    case SessionError::InvalidIdentityEnvelope: return "DSID envelope is invalid";
    case SessionError::IdentifyRejected: return "backend rejected calculator identity";
    case SessionError::DeviceInfoMissing: return "DSINFO is missing";
    case SessionError::InvalidDeviceInfoEnvelope: return "DSINFO envelope is invalid";
    case SessionError::InvalidInstalledStateEnvelope: return "DSINST envelope is invalid";
    case SessionError::InstalledStateTooLarge: return "DSINST exceeds the TI-86 state limit";
    case SessionError::InvalidResultQueueEnvelope: return "DSQ envelope is invalid";
    case SessionError::ResultQueueTooLarge: return "DSQ exceeds the TI-86 queue limit";
    case SessionError::InvalidDeliveryRequestEnvelope: return "DSREQ envelope is invalid";
    case SessionError::DeliveryRequestTooLarge: return "DSREQ exceeds the TI-86 2048-byte request limit";
    case SessionError::SyncRejected: return "backend sync failed";
    case SessionError::InvalidPlan: return "backend sync plan is invalid";
    case SessionError::InvalidAcknowledgementEnvelope: return "SCA1 acknowledgement is invalid";
    case SessionError::InvalidManifestEnvelope: return "SCM1 commit manifest is invalid";
    case SessionError::InvalidLearnerRosterEnvelope: return "SCU1 learner roster is invalid";
    case SessionError::LearnerRosterTooLarge: return "SCU1 exceeds the TI-86 learner-roster limit";
    case SessionError::InvalidProgressProjectionEnvelope: return "SCG1 progress projection is invalid";
    case SessionError::ProgressProjectionTooLarge: return "SCG1 exceeds the TI-86 progress-projection limit";
    case SessionError::InvalidInteractionRequestEnvelope: return "SCTQ interaction request is invalid";
    case SessionError::InteractionRequestTooLarge: return "SCTQ exceeds the TI-86 interaction-request limit";
    case SessionError::InvalidInteractionResponseEnvelope: return "SCTR interaction response is invalid";
    case SessionError::InteractionResponseTooLarge: return "SCTR exceeds the TI-86 interaction-response limit";
    case SessionError::CatalogFetch: return "Catalog download failed";
    case SessionError::CatalogTooLarge: return "SCC1 Catalog exceeds the TI-86 storage limit";
    case SessionError::InvalidCatalogEnvelope: return "SCC1 Catalog is invalid";
    case SessionError::InvalidArtifactDescriptor: return "artifact descriptor is invalid";
    case SessionError::ArtifactTooLarge: return "artifact exceeds the TI-86 hard ceiling";
    case SessionError::ArtifactFetch: return "artifact download or digest verification failed";
    case SessionError::InvalidArtifactEnvelope: return "SCP1 artifact is invalid";
    case SessionError::CalculatorWrite: return "calculator variable write failed";
  }
  return "unknown";
}

static ByteView view(const MutableBytes& bytes) {
  ByteView result{};
  result.bytes = bytes.bytes;
  result.length = bytes.length;
  return result;
}

static void resetLength(MutableBytes& bytes) { bytes.length = 0; }

static bool boundedText(const char* value, size_t maxLength) {
  return value != nullptr && value[0] != '\0' && strnlen(value, maxLength + 1) <= maxLength;
}

static bool validArtifactLocator(const ArtifactDescriptor& artifact) {
  static constexpr char PREFIX[] = "sc:ti86:";
  if (strlen(artifact.artifactId) != 18
      || strncmp(artifact.artifactId, PREFIX, sizeof(PREFIX) - 1) != 0
      || strlen(artifact.variableName) != 8
      || artifact.variableName[0] != 'D'
      || artifact.variableName[1] != 'P') return false;
  const char* key = artifact.artifactId + sizeof(PREFIX) - 1;
  for (uint8_t index = 0; index < 10; ++index) {
    const char value = key[index];
    if (!((value >= 'A' && value <= 'Z') || (value >= '2' && value <= '7'))) return false;
    if (index < 6 && artifact.variableName[index + 2] != value) return false;
  }
  return true;
}

}  // namespace schoolcalc_relay

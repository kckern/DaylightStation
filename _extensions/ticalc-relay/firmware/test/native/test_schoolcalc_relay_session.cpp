#include "SchoolCalcRelaySession.h"
#include "SchoolCalcWire.h"

#include <assert.h>
#include <string.h>

#include <map>
#include <string>
#include <vector>

using namespace schoolcalc_relay;

static std::vector<uint8_t> sizedEnvelope(const char magic[4], size_t totalLength,
                                          uint8_t value = 0x2A) {
  assert(totalLength >= 9 && totalLength <= 0xFFFF);
  const uint16_t bodyLength = static_cast<uint16_t>(totalLength - 9);
  std::vector<uint8_t> bytes(totalLength, value);
  bytes[0] = static_cast<uint8_t>(magic[0]);
  bytes[1] = static_cast<uint8_t>(magic[1]);
  bytes[2] = static_cast<uint8_t>(magic[2]);
  bytes[3] = static_cast<uint8_t>(magic[3]);
  bytes[4] = 1;
  bytes[5] = static_cast<uint8_t>(bodyLength & 0xFF);
  bytes[6] = static_cast<uint8_t>(bodyLength >> 8);
  const uint16_t crc = schoolcalc_wire::crc16Ccitt(bytes.data(), bytes.size() - 2);
  bytes[bytes.size() - 2] = static_cast<uint8_t>(crc & 0xFF);
  bytes[bytes.size() - 1] = static_cast<uint8_t>(crc >> 8);
  return bytes;
}

static std::vector<uint8_t> envelope(const char magic[4], uint8_t value = 0x2A) {
  return sizedEnvelope(magic, 10, value);
}

class FakeCalculator final : public ICalculatorVariables {
public:
  std::map<std::string, std::vector<uint8_t>> variables;
  std::vector<std::string> writes;
  std::string failRead;
  std::string failWrite;

  VariableReadStatus read(const char* name, MutableBytes& output) override {
    if (failRead == name) { error = "forced read failure"; return VariableReadStatus::Failed; }
    const auto found = variables.find(name);
    if (found == variables.end()) return VariableReadStatus::Missing;
    if (found->second.size() > output.capacity) {
      error = "buffer too small"; return VariableReadStatus::TooLarge;
    }
    memcpy(output.bytes, found->second.data(), found->second.size());
    output.length = static_cast<uint16_t>(found->second.size());
    return VariableReadStatus::Found;
  }

  bool write(const char* name, ByteView payload) override {
    if (failWrite == name) { error = "forced write failure"; return false; }
    writes.emplace_back(name);
    variables[name] = std::vector<uint8_t>(payload.bytes, payload.bytes + payload.length);
    return true;
  }

  const char* lastError() const override { return error.c_str(); }

private:
  std::string error = "none";
};

class FakeApi final : public ISchoolCalcApi {
public:
  bool identifyOk = true;
  bool syncOk = true;
  bool catalogOk = true;
  bool artifactOk = true;
  bool ready = true;
  bool catalogChanged = true;
  bool corruptArtifact = false;
  bool syncCalled = false;
  bool catalogFetchCalled = false;
  bool artifactFetchCalled = false;
  SyncRequest seenRequest{};
  std::vector<std::string> identifiedDeviceIds;
  std::vector<std::string> syncedDeviceIds;
  std::vector<uint8_t> resultQueueMarkers;
  std::vector<uint16_t> installedStateLengths;
  std::vector<uint16_t> deliveryRequestLengths;
  std::vector<std::string> catalogFetchDeviceIds;
  std::vector<ArtifactDescriptor> descriptors;
  std::vector<uint8_t> catalogBytes = envelope("SCC1");
  std::vector<uint8_t> learnerRosterBytes = envelope("SCU1");
  std::vector<uint8_t> progressProjectionBytes = envelope("SCG1");
  std::vector<uint8_t> interactionResponseBytes = envelope("SCTR");

  bool identify(ByteView record, DeviceIdentity& identity) override {
    if (!identifyOk) { error = "identity refused"; return false; }
    const uint8_t marker = record.length > 7 ? record.bytes[7] : 0;
    const char* deviceId = marker == 2 ? "86B002" : marker == 3 ? "86C003" : "86A001";
    strcpy(identity.deviceId, deviceId);
    strcpy(identity.platformId, "ti86");
    identifiedDeviceIds.emplace_back(deviceId);
    return true;
  }

  bool sync(const SyncRequest& request, SyncPlan& plan,
            MutableBytes& acknowledgement, MutableBytes& manifest,
            MutableBytes& learnerRoster,
            MutableBytes& progressProjection,
            MutableBytes& interactionResponse,
            INetworkWaitObserver*) override {
    syncCalled = true;
    seenRequest = request;
    syncedDeviceIds.emplace_back(request.deviceId);
    resultQueueMarkers.push_back(
      request.resultQueue.length > 7 ? request.resultQueue.bytes[7] : 0);
    installedStateLengths.push_back(request.installedState.length);
    deliveryRequestLengths.push_back(request.deliveryRequests.length);
    if (!syncOk) { error = "sync refused"; return false; }
    plan.ready = ready;
    plan.catalogChanged = catalogChanged;
    strcpy(plan.catalogGeneration, "sha256:catalog");
    plan.artifactCount = static_cast<uint8_t>(descriptors.size());
    for (size_t index = 0; index < descriptors.size(); ++index) plan.artifacts[index] = descriptors[index];
    fill(acknowledgement, envelope("SCA1"));
    fill(manifest, envelope("SCM1"));
    fill(learnerRoster, learnerRosterBytes);
    fill(progressProjection, progressProjectionBytes);
    if (request.interactionRequest.length > 0) {
      fill(interactionResponse, interactionResponseBytes);
    } else {
      interactionResponse.length = 0;
    }
    plan.acknowledgementLength = acknowledgement.length;
    plan.manifestLength = manifest.length;
    plan.learnerRosterLength = learnerRoster.length;
    plan.progressProjectionLength = progressProjection.length;
    plan.interactionResponseLength = interactionResponse.length;
    return true;
  }

  bool fetchCatalog(const char* deviceId, const char*, MutableBytes& output) override {
    catalogFetchCalled = true;
    catalogFetchDeviceIds.emplace_back(deviceId);
    if (!catalogOk) { error = "catalog failed"; return false; }
    fill(output, catalogBytes);
    return true;
  }

  bool fetchArtifact(const ArtifactDescriptor& artifact, MutableBytes& output) override {
    artifactFetchCalled = true;
    if (!artifactOk) { error = "artifact failed"; return false; }
    auto bytes = envelope(corruptArtifact ? "BAD1" : "SCP1");
    assert(bytes.size() == artifact.byteLength);
    fill(output, bytes);
    return true;
  }

  const char* lastError() const override { return error.c_str(); }

private:
  std::string error = "none";

  static void fill(MutableBytes& output, const std::vector<uint8_t>& bytes) {
    assert(bytes.size() <= output.capacity);
    memcpy(output.bytes, bytes.data(), bytes.size());
    output.length = static_cast<uint16_t>(bytes.size());
  }
};

struct ObservedProgress {
  SessionState state;
  SessionDirection direction;
  uint8_t completed;
  uint8_t total;
};

class FakeObserver final : public ISchoolCalcSessionObserver {
public:
  std::vector<ObservedProgress> events;

  void onSessionProgress(SessionState state, SessionDirection direction,
                         uint8_t completed, uint8_t total) override {
    events.push_back({ state, direction, completed, total });
  }
};

struct Fixture {
  uint8_t identity[64]{};
  uint8_t info[64]{};
  uint8_t installedState[TI86_SYNC_MANIFEST_MAX_BYTES]{};
  uint8_t queue[TI86_RESULT_QUEUE_MAX_BYTES + 1]{};
  uint8_t requests[64]{};
  uint8_t interactionRequest[TI86_INTERACTION_REQUEST_MAX_BYTES + 1]{};
  uint8_t learnerRoster[TI86_LEARNER_ROSTER_MAX_BYTES + 1]{};
  uint8_t progressProjection[TI86_PROGRESS_PROJECTION_MAX_BYTES + 1]{};
  uint8_t interactionResponse[TI86_INTERACTION_RESPONSE_MAX_BYTES + 1]{};
  uint8_t acknowledgement[64]{};
  uint8_t manifest[64]{};
  uint8_t transfer[TI86_ARTIFACT_MAX_BYTES]{};
  FakeCalculator calculator;
  FakeApi api;
  SessionBuffers buffers;

  Fixture() : buffers{
    { identity, sizeof(identity), 0 },
    { info, sizeof(info), 0 },
    { installedState, sizeof(installedState), 0 },
    { queue, sizeof(queue), 0 },
    { requests, sizeof(requests), 0 },
    { interactionRequest, sizeof(interactionRequest), 0 },
    { learnerRoster, sizeof(learnerRoster), 0 },
    { progressProjection, sizeof(progressProjection), 0 },
    { interactionResponse, sizeof(interactionResponse), 0 },
    { acknowledgement, sizeof(acknowledgement), 0 },
    { manifest, sizeof(manifest), 0 },
    { transfer, sizeof(transfer), 0 },
  } {
    calculator.variables["DSID"] = envelope("SCI1", 1);
    calculator.variables["DSINFO"] = envelope("SCI1", 2);
    calculator.variables["DSINST"] = envelope("SCM1", 5);
    calculator.variables["DSQ"] = envelope("SCQ1", 3);
    calculator.variables["DSREQ"] = envelope("SCD1", 4);
    ArtifactDescriptor descriptor{};
    strcpy(descriptor.artifactId, "sc:ti86:ABC234DEFG");
    strcpy(descriptor.variableName, "DPABC234");
    descriptor.byteLength = static_cast<uint16_t>(envelope("SCP1").size());
    memset(descriptor.byteDigest, 'a', 64);
    descriptor.byteDigest[64] = '\0';
    api.descriptors.push_back(descriptor);
  }
};

static void happyPathPublishesManifestLast() {
  Fixture f;
  FakeObserver observer;
  SchoolCalcRelaySession session(f.calculator, f.api, f.buffers, &observer);
  const SessionOutcome result = session.run("sha256:old");
  assert(result.ok && result.ready && result.artifactsStaged == 1
         && result.profilesStaged && result.progressStaged);
  assert(result.state == SessionState::AwaitingCalculatorCommit);
  const std::vector<std::string> expected = {
    "DSUSRNEW", "DSPRGNEW", "DSCATNEW", "DPABC234", "DSACKNEW", "DSSYNC",
  };
  assert(f.calculator.writes == expected);
  assert(f.api.syncCalled);
  assert(strcmp(f.api.seenRequest.deviceId, "86A001") == 0);
  assert(f.api.seenRequest.resultQueue.length > 0);
  assert(f.api.seenRequest.installedState.length > 0);
  assert(f.api.seenRequest.deliveryRequests.length > 0);
  assert(f.api.seenRequest.interactionRequest.length == 0);
  assert(strcmp(f.api.seenRequest.catalogGeneration, "sha256:old") == 0);
  assert(observer.events.front().state == SessionState::ReadingIdentity);
  assert(observer.events.front().direction == SessionDirection::Negotiating);
  assert(observer.events.back().state == SessionState::AwaitingCalculatorCommit);
  assert(observer.events.back().direction == SessionDirection::Idle);
  bool sawNetwork = false;
  bool sawUplink = false;
  bool sawDownlink = false;
  bool sawAllInputsRead = false;
  bool sawArtifactComplete = false;
  for (const ObservedProgress& event : observer.events) {
    sawNetwork = sawNetwork || event.direction == SessionDirection::Network;
    sawUplink = sawUplink || event.direction == SessionDirection::CalculatorToRelay;
    sawDownlink = sawDownlink || event.direction == SessionDirection::RelayToCalculator;
    sawAllInputsRead = sawAllInputsRead
      || (event.state == SessionState::ReadingInputs
          && event.completed == 5 && event.total == 5);
    sawArtifactComplete = sawArtifactComplete
      || (event.state == SessionState::StagingArtifacts
          && event.completed == 1 && event.total == 1);
  }
  assert(sawNetwork && sawUplink && sawDownlink && sawAllInputsRead && sawArtifactComplete);
  assert(strcmp(sessionDirectionText(SessionDirection::Negotiating),
                "negotiating") == 0);
  assert(strcmp(sessionDirectionText(SessionDirection::CalculatorToRelay),
                "calculator_to_relay") == 0);
}

static void missingOptionalQueuesRemainValid() {
  Fixture f;
  f.calculator.variables.erase("DSQ");
  f.calculator.variables.erase("DSREQ");
  f.calculator.variables.erase("DSINST");
  f.api.catalogChanged = false;
  f.api.descriptors.clear();
  SchoolCalcRelaySession session(f.calculator, f.api, f.buffers);
  const SessionOutcome result = session.run();
  assert(result.ok);
  assert(f.api.seenRequest.resultQueue.length == 0);
  assert(f.api.seenRequest.deliveryRequests.length == 0);
  assert(f.api.seenRequest.installedState.length == 0);
  const std::vector<std::string> expected = {
    "DSUSRNEW", "DSPRGNEW", "DSACKNEW", "DSSYNC",
  };
  assert(f.calculator.writes == expected);
}

static void malformedQueueNeverReachesNetwork() {
  Fixture f;
  f.calculator.variables["DSQ"][7] ^= 1;
  SchoolCalcRelaySession session(f.calculator, f.api, f.buffers);
  const SessionOutcome result = session.run();
  assert(!result.ok && result.error == SessionError::InvalidResultQueueEnvelope);
  assert(!f.api.syncCalled && f.calculator.writes.empty());
}

static void durableInteractionIsValidatedAndStagedIndependently() {
  Fixture f;
  f.calculator.variables["DSTREQ"] = envelope("SCTQ", 6);
  f.api.catalogChanged = false;
  f.api.descriptors.clear();
  SchoolCalcRelaySession session(f.calculator, f.api, f.buffers);
  const SessionOutcome result = session.run();
  assert(result.ok && result.interactionStaged);
  assert(f.api.seenRequest.interactionRequest.length > 0);
  assert(f.calculator.writes == std::vector<std::string>({
    "DSUSRNEW", "DSPRGNEW", "DSTNEW", "DSACKNEW", "DSSYNC",
  }));
  assert(f.calculator.variables["DSTNEW"] == f.api.interactionResponseBytes);

  Fixture malformed;
  malformed.calculator.variables["DSTREQ"] = envelope("SCTQ");
  malformed.calculator.variables["DSTREQ"][7] ^= 1;
  SchoolCalcRelaySession invalidRequest(malformed.calculator, malformed.api, malformed.buffers);
  assert(invalidRequest.run().error == SessionError::InvalidInteractionRequestEnvelope);
  assert(!malformed.api.syncCalled);

  Fixture badResponse;
  badResponse.calculator.variables["DSTREQ"] = envelope("SCTQ");
  badResponse.api.interactionResponseBytes = envelope("BAD1");
  SchoolCalcRelaySession invalidResponse(badResponse.calculator, badResponse.api, badResponse.buffers);
  assert(invalidResponse.run().error == SessionError::InvalidInteractionResponseEnvelope);
  assert(badResponse.calculator.writes.empty());
}

static void oversizedQueueNeverReachesNetwork() {
  Fixture f;
  f.calculator.variables["DSQ"] = sizedEnvelope(
    "SCQ1", static_cast<size_t>(TI86_RESULT_QUEUE_MAX_BYTES) + 1);
  SchoolCalcRelaySession session(f.calculator, f.api, f.buffers);
  const SessionOutcome result = session.run();
  assert(!result.ok && result.error == SessionError::ResultQueueTooLarge);
  assert(!f.api.syncCalled && f.calculator.writes.empty());
}

static void oversizedInstalledStateNeverReachesNetwork() {
  Fixture f;
  f.calculator.variables["DSINST"] = sizedEnvelope(
    "SCM1", static_cast<size_t>(TI86_SYNC_MANIFEST_MAX_BYTES) + 1);
  SchoolCalcRelaySession session(f.calculator, f.api, f.buffers);
  const SessionOutcome result = session.run();
  assert(!result.ok && result.error == SessionError::InstalledStateTooLarge);
  assert(!f.api.syncCalled && f.calculator.writes.empty());
}

static void oversizedCatalogNeverReachesCalculator() {
  Fixture f;
  f.api.catalogBytes = sizedEnvelope(
    "SCC1", static_cast<size_t>(TI86_CATALOG_RECORD_MAX_BYTES) + 1);
  SchoolCalcRelaySession session(f.calculator, f.api, f.buffers);
  const SessionOutcome result = session.run();
  assert(!result.ok && result.error == SessionError::CatalogTooLarge);
  assert(f.calculator.writes
         == std::vector<std::string>({ "DSUSRNEW", "DSPRGNEW" }));
}

static void malformedLearnerRosterNeverReachesCalculator() {
  Fixture f;
  f.api.learnerRosterBytes[7] ^= 1;
  SchoolCalcRelaySession session(f.calculator, f.api, f.buffers);
  const SessionOutcome result = session.run();
  assert(!result.ok && result.error == SessionError::InvalidLearnerRosterEnvelope);
  assert(f.calculator.writes.empty());
}

static void oversizedLearnerRosterNeverReachesCalculator() {
  Fixture f;
  f.api.learnerRosterBytes = sizedEnvelope(
    "SCU1", static_cast<size_t>(TI86_LEARNER_ROSTER_MAX_BYTES) + 1);
  SchoolCalcRelaySession session(f.calculator, f.api, f.buffers);
  const SessionOutcome result = session.run();
  assert(!result.ok && result.error == SessionError::LearnerRosterTooLarge);
  assert(f.calculator.writes.empty());
}

static void malformedProgressProjectionNeverReachesCalculator() {
  Fixture f;
  f.api.progressProjectionBytes[7] ^= 1;
  SchoolCalcRelaySession session(f.calculator, f.api, f.buffers);
  const SessionOutcome result = session.run();
  assert(!result.ok && result.error == SessionError::InvalidProgressProjectionEnvelope);
  assert(f.calculator.writes.empty());
}

static void oversizedProgressProjectionNeverReachesCalculator() {
  Fixture f;
  f.api.progressProjectionBytes = sizedEnvelope(
    "SCG1", static_cast<size_t>(TI86_PROGRESS_PROJECTION_MAX_BYTES) + 1);
  SchoolCalcRelaySession session(f.calculator, f.api, f.buffers);
  const SessionOutcome result = session.run();
  assert(!result.ok && result.error == SessionError::ProgressProjectionTooLarge);
  assert(f.calculator.writes.empty());
}

static void oversizedArtifactDescriptorNeverFetchesArtifactOrPublishesManifest() {
  Fixture f;
  f.api.catalogChanged = false;
  f.api.descriptors[0].byteLength = TI86_ARTIFACT_MAX_BYTES + 1;
  SchoolCalcRelaySession session(f.calculator, f.api, f.buffers);
  const SessionOutcome result = session.run();
  assert(!result.ok && result.error == SessionError::ArtifactTooLarge);
  assert(!f.api.artifactFetchCalled);
  assert(f.calculator.writes
         == std::vector<std::string>({ "DSUSRNEW", "DSPRGNEW" }));
}

static void mismatchedArtifactLocatorNeverFetchesArtifactOrPublishesManifest() {
  Fixture f;
  f.api.catalogChanged = false;
  strcpy(f.api.descriptors[0].variableName, "DPZZZ234");
  SchoolCalcRelaySession session(f.calculator, f.api, f.buffers);
  const SessionOutcome result = session.run();
  assert(!result.ok && result.error == SessionError::InvalidArtifactDescriptor);
  assert(!f.api.artifactFetchCalled);
  assert(f.calculator.writes
         == std::vector<std::string>({ "DSUSRNEW", "DSPRGNEW" }));
}

static void artifactFailureNeverPublishesManifest() {
  Fixture f;
  f.api.corruptArtifact = true;
  SchoolCalcRelaySession session(f.calculator, f.api, f.buffers);
  const SessionOutcome result = session.run();
  assert(!result.ok && result.error == SessionError::InvalidArtifactEnvelope);
  assert(f.calculator.writes.size() == 3);
  assert(f.calculator.writes[0] == "DSUSRNEW");
  assert(f.calculator.writes[1] == "DSPRGNEW");
  assert(f.calculator.writes[2] == "DSCATNEW");
  assert(f.calculator.variables.count("DSSYNC") == 0);
}

static void blockedPlanCanPublishDiagnosticsWithoutArtifacts() {
  Fixture f;
  f.api.ready = false;
  SchoolCalcRelaySession session(f.calculator, f.api, f.buffers);
  const SessionOutcome result = session.run();
  assert(result.ok && !result.ready && result.artifactsStaged == 0);
  assert(!f.api.catalogFetchCalled);
  const std::vector<std::string> expected = {
    "DSUSRNEW", "DSPRGNEW", "DSACKNEW", "DSSYNC",
  };
  assert(f.calculator.writes == expected);
}

static void writeFailureLeavesCommitMarkerAbsent() {
  Fixture f;
  f.calculator.failWrite = "DPABC234";
  SchoolCalcRelaySession session(f.calculator, f.api, f.buffers);
  const SessionOutcome result = session.run();
  assert(!result.ok && result.error == SessionError::CalculatorWrite);
  assert(f.calculator.variables.count("DSSYNC") == 0);
}

static void identityIsRequiredAndServerResolved() {
  Fixture missing;
  missing.calculator.variables.erase("DSID");
  SchoolCalcRelaySession first(missing.calculator, missing.api, missing.buffers);
  assert(first.run().error == SessionError::IdentityMissing);
  assert(!missing.api.syncCalled);

  Fixture refused;
  refused.api.identifyOk = false;
  SchoolCalcRelaySession second(refused.calculator, refused.api, refused.buffers);
  assert(second.run().error == SessionError::IdentifyRejected);
  assert(!refused.api.syncCalled);
}

static void sequentialCalculatorsNeverShareSessionState() {
  Fixture f;
  f.api.descriptors.clear();
  SchoolCalcRelaySession session(f.calculator, f.api, f.buffers);

  f.calculator.variables["DSID"] = envelope("SCI1", 1);
  f.calculator.variables["DSINFO"] = envelope("SCI1", 11);
  f.calculator.variables["DSINST"] = envelope("SCM1", 21);
  f.calculator.variables["DSQ"] = envelope("SCQ1", 31);
  f.calculator.variables["DSREQ"] = envelope("SCD1", 41);
  const SessionOutcome first = session.run("sha256:a-old");
  assert(first.ok && strcmp(first.identity.deviceId, "86A001") == 0);
  assert(f.calculator.writes
         == std::vector<std::string>({
           "DSUSRNEW", "DSPRGNEW", "DSCATNEW", "DSACKNEW", "DSSYNC",
         }));

  // The next calculator has a different durable identity and queue, and omits
  // records that A supplied. Reusing the exact session and backing buffers is
  // deliberately stricter than the production loop, which constructs a fresh
  // session wrapper for every foreground job.
  f.calculator.writes.clear();
  f.calculator.variables["DSID"] = envelope("SCI1", 2);
  f.calculator.variables["DSINFO"] = envelope("SCI1", 12);
  f.calculator.variables.erase("DSINST");
  f.calculator.variables["DSQ"] = envelope("SCQ1", 32);
  f.calculator.variables.erase("DSREQ");
  const SessionOutcome second = session.run("sha256:b-old");
  assert(second.ok && strcmp(second.identity.deviceId, "86B002") == 0);
  assert(f.calculator.writes
         == std::vector<std::string>({
           "DSUSRNEW", "DSPRGNEW", "DSCATNEW", "DSACKNEW", "DSSYNC",
         }));

  assert(f.api.identifiedDeviceIds
         == std::vector<std::string>({ "86A001", "86B002" }));
  assert(f.api.syncedDeviceIds
         == std::vector<std::string>({ "86A001", "86B002" }));
  assert(f.api.resultQueueMarkers == std::vector<uint8_t>({ 31, 32 }));
  assert(f.api.installedStateLengths == std::vector<uint16_t>({ 10, 0 }));
  assert(f.api.deliveryRequestLengths == std::vector<uint16_t>({ 10, 0 }));
  assert(f.api.catalogFetchDeviceIds
         == std::vector<std::string>({ "86A001", "86B002" }));
}

void runSchoolCalcRelaySessionTests() {
  happyPathPublishesManifestLast();
  missingOptionalQueuesRemainValid();
  malformedQueueNeverReachesNetwork();
  durableInteractionIsValidatedAndStagedIndependently();
  oversizedQueueNeverReachesNetwork();
  oversizedInstalledStateNeverReachesNetwork();
  oversizedCatalogNeverReachesCalculator();
  malformedLearnerRosterNeverReachesCalculator();
  oversizedLearnerRosterNeverReachesCalculator();
  malformedProgressProjectionNeverReachesCalculator();
  oversizedProgressProjectionNeverReachesCalculator();
  oversizedArtifactDescriptorNeverFetchesArtifactOrPublishesManifest();
  mismatchedArtifactLocatorNeverFetchesArtifactOrPublishesManifest();
  artifactFailureNeverPublishesManifest();
  blockedPlanCanPublishDiagnosticsWithoutArtifacts();
  writeFailureLeavesCommitMarkerAbsent();
  identityIsRequiredAndServerResolved();
  sequentialCalculatorsNeverShareSessionState();
}

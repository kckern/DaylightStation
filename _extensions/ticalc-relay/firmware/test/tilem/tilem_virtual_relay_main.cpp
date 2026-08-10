#include "TilemBlackLinkBridge.h"
#include "TilemHostArduinoShim.h"

#include "SchoolCalcForegroundSession.h"
#include "SchoolCalcRelaySession.h"
#include "SchoolCalcTiLinkAdapters.h"
#include "SchoolCalcWire.h"
#include "TiLinkTransport.h"

#include <array>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <iterator>
#include <string>
#include <thread>
#include <vector>

namespace {

constexpr uint8_t TIP_SENSE_PIN = 1;
constexpr uint8_t TIP_SINK_PIN = 2;
constexpr uint8_t RING_SENSE_PIN = 3;
constexpr uint8_t RING_SINK_PIN = 4;

using schoolcalc_relay::ByteView;
using schoolcalc_relay::MutableBytes;

bool hasEnvelope(ByteView record, const char magic[5]) {
  return record.bytes != nullptr && record.length >= 9
    && std::memcmp(record.bytes, magic, 4) == 0
    && schoolcalc_wire::validateSchoolCalcEnvelope(record.bytes, record.length, magic)
      == schoolcalc_wire::DecodeStatus::Ok;
}

bool isExact(ByteView record, const std::vector<uint8_t>& expected) {
  return record.bytes != nullptr && record.length == expected.size()
    && std::memcmp(record.bytes, expected.data(), expected.size()) == 0;
}

bool copyRecord(const std::vector<uint8_t>& source, MutableBytes& destination) {
  if (destination.bytes == nullptr || destination.capacity < source.size()) return false;
  std::memcpy(destination.bytes, source.data(), source.size());
  destination.length = static_cast<uint16_t>(source.size());
  return true;
}

class FixtureApi final : public schoolcalc_relay::ISchoolCalcApi {
public:
  explicit FixtureApi(const char* fixtureDirectory) {
    load(fixtureDirectory, "DSID", "SCI1", identity_);
    load(fixtureDirectory, "DSINFO", "SCI1", deviceInfo_);
    load(fixtureDirectory, "DSINST", "SCM1", installedState_);
    load(fixtureDirectory, "DSQ", "SCQ1", resultQueue_);
    load(fixtureDirectory, "DSREQ", "SCD1", deliveryRequests_);
    load(fixtureDirectory, "DSTREQ", "SCTQ", interactionRequest_);
    load(fixtureDirectory, "DSENTRY", "SCE1", studyEntry_);
    load(fixtureDirectory, "SCA1", acknowledgement_);
    load(fixtureDirectory, "SCM1", manifest_);
    load(fixtureDirectory, "SCU1", roster_);
    load(fixtureDirectory, "SCG1", progress_);
    load(fixtureDirectory, "SCTR", interaction_);
    load(fixtureDirectory, "SCC1", catalog_);
    load(fixtureDirectory, "SCP1", artifact_);
    load(fixtureDirectory, "SCSP", prescription_);
    load(fixtureDirectory, "SCSA", studyCommit_);
  }

  bool ready() const { return error_[0] == '\0'; }

  bool identify(ByteView identity, schoolcalc_relay::DeviceIdentity& output) override {
    if (!isExact(identity, identity_)) return fail("DSID differs from the generated semantic fixture");
    std::snprintf(output.deviceId, sizeof(output.deviceId), "%s", "86A001");
    std::snprintf(output.platformId, sizeof(output.platformId), "%s", "ti86");
    ++identifyCalls;
    return true;
  }

  bool sync(const schoolcalc_relay::SyncRequest& request,
            schoolcalc_relay::SyncPlan& plan,
            MutableBytes& acknowledgement, MutableBytes& manifest,
            MutableBytes& roster, MutableBytes& progress,
            MutableBytes& interaction,
            schoolcalc_relay::INetworkWaitObserver* waitObserver) override {
    if (request.deviceId == nullptr || std::strcmp(request.deviceId, "86A001") != 0
        || !isExact(request.deviceInfo, deviceInfo_)
        || !isExact(request.installedState, installedState_)
        || !isExact(request.resultQueue, resultQueue_)
        || !isExact(request.deliveryRequests, deliveryRequests_)
        || !isExact(request.interactionRequest, interactionRequest_)
        || !isExact(request.studyEntry, studyEntry_)) {
      return fail("sync input differs from the generated semantic fixture");
    }
    if (!copyRecord(acknowledgement_, acknowledgement) || !copyRecord(manifest_, manifest)
        || !copyRecord(roster_, roster) || !copyRecord(progress_, progress)
        || !copyRecord(interaction_, interaction)
        || request.studyPrescriptionOutput == nullptr || request.studyCommitOutput == nullptr
        || request.studyArtifactOutput == nullptr
        || !copyRecord(prescription_, *request.studyPrescriptionOutput)
        || !copyRecord(studyCommit_, *request.studyCommitOutput)
        || !copyRecord(artifact_, *request.studyArtifactOutput)) {
      return fail("fixture output buffer too small");
    }
    if (waitObserver != nullptr && !waitObserver->serviceNetworkWait(1)) {
      return fail("foreground transport became unhealthy during fixture network wait");
    }
    plan = schoolcalc_relay::SyncPlan{};
    plan.ready = true;
    plan.catalogChanged = true;
    std::snprintf(plan.catalogGeneration, sizeof(plan.catalogGeneration), "%s", "sha256:tilem-catalog-v1");
    plan.artifactCount = 1;
    auto& artifact = plan.artifacts[0];
    std::snprintf(artifact.artifactId, sizeof(artifact.artifactId), "%s", "sc:ti86:7L3CWYLASV");
    std::snprintf(artifact.variableName, sizeof(artifact.variableName), "%s", "DP7L3CWY");
    artifact.byteLength = static_cast<uint32_t>(artifact_.size());
    std::snprintf(artifact.byteDigest, sizeof(artifact.byteDigest), "%s",
                  "b1197821d4540e63e217284066a7fd13008a491284f1ac297f7501682b71ef3a");
    plan.acknowledgementLength = acknowledgement.length;
    plan.manifestLength = manifest.length;
    plan.learnerRosterLength = roster.length;
    plan.progressProjectionLength = progress.length;
    plan.interactionResponseLength = interaction.length;
    plan.studyResolved = true;
    plan.studyArtifactIncluded = true;
    plan.studyPrescriptionLength = request.studyPrescriptionOutput->length;
    plan.studyCommitLength = request.studyCommitOutput->length;
    plan.studyArtifact = artifact;
    ++syncCalls;
    return true;
  }

  bool fetchCatalog(const char* deviceId, const char* generation, MutableBytes& output) override {
    if (deviceId == nullptr || generation == nullptr || std::strcmp(deviceId, "86A001") != 0
        || std::strcmp(generation, "sha256:tilem-catalog-v1") != 0) {
      return fail("catalog fetch used an unexpected device or generation");
    }
    ++catalogFetchCalls;
    return copyRecord(catalog_, output) || fail("catalog fixture output buffer too small");
  }

  bool fetchArtifact(const schoolcalc_relay::ArtifactDescriptor& artifact,
                     MutableBytes& output) override {
    if (std::strcmp(artifact.variableName, "DP7L3CWY") != 0
        || artifact.byteLength != artifact_.size()) {
      return fail("artifact fetch used an unexpected descriptor");
    }
    ++artifactFetchCalls;
    return copyRecord(artifact_, output) || fail("artifact fixture output buffer too small");
  }

  const char* lastError() const override { return error_; }

  uint32_t identifyCalls = 0;
  uint32_t syncCalls = 0;
  uint32_t catalogFetchCalls = 0;
  uint32_t artifactFetchCalls = 0;

private:
  std::vector<uint8_t> identity_, deviceInfo_, installedState_, resultQueue_, deliveryRequests_, interactionRequest_;
  std::vector<uint8_t> acknowledgement_, manifest_, roster_, progress_, interaction_, catalog_, artifact_;
  std::vector<uint8_t> studyEntry_, prescription_, studyCommit_;
  char error_[160] = {};

  void load(const char* directory, const char* name, const char* magic, std::vector<uint8_t>& destination) {
    const std::string file = std::string(directory == nullptr ? "" : directory) + "/" + name + ".bin";
    std::ifstream input(file, std::ios::binary);
    if (!input) {
      std::snprintf(error_, sizeof(error_), "missing semantic fixture %s", name);
      return;
    }
    destination.assign(std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>());
    if (!hasEnvelope({ destination.data(), static_cast<uint16_t>(destination.size()) }, magic)) {
      std::snprintf(error_, sizeof(error_), "invalid semantic fixture %s", name);
    }
  }

  void load(const char* directory, const char* name, std::vector<uint8_t>& destination) {
    load(directory, name, name, destination);
  }

  bool fail(const char* text) {
    std::snprintf(error_, sizeof(error_), "%s", text);
    return false;
  }
};

struct Buffers {
  std::array<uint8_t, 512> identity{};
  std::array<uint8_t, 4096> info{};
  std::array<uint8_t, 6144> installed{};
  std::array<uint8_t, 6144> queue{};
  std::array<uint8_t, 2048> requests{};
  std::array<uint8_t, 512> interactionRequest{};
  std::array<uint8_t, 512> roster{};
  std::array<uint8_t, 4096> progress{};
  std::array<uint8_t, 2048> interactionResponse{};
  std::array<uint8_t, 544> acknowledgement{};
  std::array<uint8_t, 6144> manifest{};
  std::array<uint8_t, 12288> transfer{};
  std::array<uint8_t, 64> studyEntry{};
  std::array<uint8_t, 512> studyPrescription{};
  std::array<uint8_t, 256> studyCommit{};

  schoolcalc_relay::SessionBuffers view() {
    return {
      bytes(identity), bytes(info), bytes(installed), bytes(queue), bytes(requests),
      bytes(interactionRequest), bytes(roster), bytes(progress), bytes(interactionResponse),
      bytes(acknowledgement), bytes(manifest), bytes(transfer), bytes(studyEntry),
      bytes(studyPrescription), bytes(studyCommit),
    };
  }

private:
  template <size_t N>
  static MutableBytes bytes(std::array<uint8_t, N>& value) {
    return { value.data(), static_cast<uint16_t>(value.size()), 0 };
  }
};

bool writeComplete(const char* path, uint8_t phaseAcks,
                   const schoolcalc_tilem::TilemBlackLinkBridge& bridge) {
  std::ofstream file(path, std::ios::trunc);
  if (!file) return false;
  file << "ok=true\n";
  file << "state=raw-foreground-frames\n";
  file << "phaseAcks=" << static_cast<unsigned>(phaseAcks) << "\n";
  file << "calculatorEvents=" << bridge.calculatorEvents() << "\n";
  file << "relayEvents=" << bridge.relayEvents() << "\n";
  file << "keyboardTransitions=" << bridge.keyboardTransitions() << "\n";
  file << "port7Writes=" << bridge.port7Writes() << "\n";
  return static_cast<bool>(file);
}

bool sendPhaseAndReceiveAck(schoolcalc_relay::TiForegroundFrameChannel& channel,
                            uint16_t sequence,
                            schoolcalc_foreground::PhaseCode phase,
                            schoolcalc_foreground::DirectionCode direction,
                            uint8_t completed, uint8_t total, bool safeToUnplug,
                            std::string& error) {
  using namespace schoolcalc_foreground;
  PhasePayload phasePayload{};
  phasePayload.phase = phase;
  phasePayload.direction = direction;
  phasePayload.itemsCompleted = completed;
  phasePayload.itemsTotal = total;
  phasePayload.safeToUnplug = safeToUnplug;
  uint8_t phaseBytes[PHASE_PAYLOAD_BYTES];
  encodePhasePayload(phasePayload, phaseBytes);
  uint8_t outbound[FRAME_HEADER_BYTES + PHASE_PAYLOAD_BYTES + FRAME_CRC_BYTES];
  size_t outboundLength = 0;
  if (encodeFrame(FrameType::Phase, sequence, phaseBytes, sizeof(phaseBytes),
                  outbound, sizeof(outbound), outboundLength) != DecodeStatus::Ok
      || !channel.send(outbound, static_cast<uint16_t>(outboundLength))) {
    error = channel.lastError();
    return false;
  }
  uint8_t inbound[FRAME_HEADER_BYTES + ACK_PAYLOAD_BYTES + FRAME_CRC_BYTES];
  uint16_t inboundLength = 0;
  if (channel.receive(inbound, sizeof(inbound), inboundLength)
      != schoolcalc_relay::ForegroundChannelStatus::Ok) {
    error = channel.lastError();
    return false;
  }
  FrameView acknowledgement{};
  AckPayload acknowledgementPayload{};
  if (decodeFrame(inbound, inboundLength, acknowledgement) != DecodeStatus::Ok
      || acknowledgement.type != FrameType::Ack || acknowledgement.sequence != sequence
      || decodeAckPayload(acknowledgement.payload, acknowledgement.payloadLength,
                          acknowledgementPayload) != DecodeStatus::Ok
      || acknowledgementPayload.acknowledgedType != FrameType::Phase
      || acknowledgementPayload.nextOffset != 0) {
    error = "SCSYNC did not acknowledge the relay phase frame";
    return false;
  }
  return true;
}

void usage() {
  std::fputs("Usage: tilem_virtual_relay --rom PATH --ram-image PATH --execution-image PATH --cpu-context PATH --program-image PATH --fixture-dir PATH --complete-file PATH\n", stderr);
}

}  // namespace

int main(int argc, char* argv[]) {
  const char* rom = nullptr;
  const char* ramImage = nullptr;
  const char* executionImage = nullptr;
  const char* cpuContext = nullptr;
  const char* programImage = nullptr;
  const char* fixtureDirectory = nullptr;
  const char* completeFile = nullptr;
  for (int index = 1; index < argc; ++index) {
    if (std::strcmp(argv[index], "--rom") == 0 && index + 1 < argc) rom = argv[++index];
    else if (std::strcmp(argv[index], "--ram-image") == 0 && index + 1 < argc) ramImage = argv[++index];
    else if (std::strcmp(argv[index], "--execution-image") == 0 && index + 1 < argc) executionImage = argv[++index];
    else if (std::strcmp(argv[index], "--cpu-context") == 0 && index + 1 < argc) cpuContext = argv[++index];
    else if (std::strcmp(argv[index], "--program-image") == 0 && index + 1 < argc) programImage = argv[++index];
    else if (std::strcmp(argv[index], "--fixture-dir") == 0 && index + 1 < argc) fixtureDirectory = argv[++index];
    else if (std::strcmp(argv[index], "--complete-file") == 0 && index + 1 < argc) completeFile = argv[++index];
    else { usage(); return 64; }
  }
  if (rom == nullptr || ramImage == nullptr || executionImage == nullptr || cpuContext == nullptr || programImage == nullptr
      || fixtureDirectory == nullptr
      || completeFile == nullptr) {
    usage();
    return 64;
  }

  schoolcalc_tilem::TilemBlackLinkBridge bridge;
  std::string error;
  if (!bridge.boot(rom, error)) {
    std::fprintf(stderr, "TICALC_TILEM_RELAY_FAIL stage=boot detail=%s\n", error.c_str());
    return 1;
  }
  if (!bridge.exerciseKeyboard(error)) {
    std::fprintf(stderr, "TICALC_TILEM_RELAY_FAIL stage=keyboard detail=%s\n", error.c_str());
    return 1;
  }
  if (!bridge.restoreForegroundCheckpoint(ramImage, executionImage, cpuContext, programImage, error)) {
    std::fprintf(stderr, "TICALC_TILEM_RELAY_FAIL stage=provision detail=%s\n", error.c_str());
    return 1;
  }
  schoolcalc_tilem::installHostArduinoShim(bridge, TIP_SENSE_PIN, TIP_SINK_PIN,
                                           RING_SENSE_PIN, RING_SINK_PIN);
  TiLinkTransport transport(TIP_SENSE_PIN, TIP_SINK_PIN, RING_SENSE_PIN, RING_SINK_PIN, true);
  transport.begin();
  schoolcalc_relay::TiForegroundFrameChannel channel(transport);
  if (!bridge.start(error)) {
    schoolcalc_tilem::clearHostArduinoShim();
    std::fprintf(stderr, "TICALC_TILEM_RELAY_FAIL stage=sync-start detail=%s\n", error.c_str());
    return 1;
  }

  schoolcalc_relay::ForegroundCalculatorVariables calculator(channel);
  if (!calculator.accept()) {
    bridge.stop();
    schoolcalc_tilem::clearHostArduinoShim();
    const std::string diagnostic = bridge.diagnostic();
    const TiLinkTransport::Metrics metrics = transport.metrics();
    std::fprintf(stderr, "TICALC_TILEM_RELAY_FAIL stage=accept detail=%s bridge=%s packets=tx%u/rx%u edges=%u/%u diagnostic=%s\n",
                 calculator.lastError(), bridge.lastError(),
                 static_cast<unsigned>(metrics.packetsTx), static_cast<unsigned>(metrics.packetsRx),
                 static_cast<unsigned>(metrics.edgeTimeouts), static_cast<unsigned>(metrics.busBusyErrors),
                 diagnostic.c_str());
    return 1;
  }

  // This is the raw-emulator lane. It moves real SCF1 phase/progress frames
  // through TilEm's emulated port 7 and verifies SCSYNC's acknowledgements.
  // The MAME-provisioned RAM restores the actual installed foreground binary;
  // the separate semantic relay lane exercises the ROM-variable catalog,
  // progress, quiz, and staging transaction using these same fixture records.
  uint8_t phaseAcks = 0;
  if (sendPhaseAndReceiveAck(channel, 1, schoolcalc_foreground::PhaseCode::ReadingInputs,
                             schoolcalc_foreground::DirectionCode::CalculatorToRelay,
                             2, 5, false, error)) ++phaseAcks;
  if (error.empty() && sendPhaseAndReceiveAck(channel, 2,
                                               schoolcalc_foreground::PhaseCode::StagingCatalog,
                                               schoolcalc_foreground::DirectionCode::RelayToCalculator,
                                               1, 1, true, error)) ++phaseAcks;
  const bool finished = phaseAcks == 2;
  bridge.stop();
  schoolcalc_tilem::clearHostArduinoShim();
  if (!finished) {
    const std::string diagnostic = bridge.diagnostic();
    std::fprintf(stderr, "TICALC_TILEM_RELAY_FAIL stage=raw-phase detail=%s bridge=%s diagnostic=%s\n",
                 error.c_str(), bridge.lastError(), diagnostic.c_str());
    return 1;
  }
  if (!writeComplete(completeFile, phaseAcks, bridge)) {
    std::fprintf(stderr, "TICALC_TILEM_RELAY_FAIL stage=report detail=could-not-write-complete-file\n");
    return 1;
  }
  std::printf("TICALC_TILEM_RELAY_PASS state=raw-foreground-frames keyboard=ON phaseAcks=%u\n",
              static_cast<unsigned>(phaseAcks));
  return 0;
}

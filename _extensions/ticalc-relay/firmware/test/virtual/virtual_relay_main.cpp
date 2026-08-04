#include "SchoolCalcRelaySession.h"
#include "SchoolCalcWire.h"

#include <array>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <iterator>
#include <map>
#include <string>
#include <vector>

namespace {

using schoolcalc_relay::ByteView;
using schoolcalc_relay::MutableBytes;

bool envelope(ByteView value, const char* magic) {
  return value.bytes != nullptr && value.length >= 9
    && std::memcmp(value.bytes, magic, 4) == 0
    && schoolcalc_wire::validateSchoolCalcEnvelope(value.bytes, value.length, magic)
      == schoolcalc_wire::DecodeStatus::Ok;
}

bool exact(ByteView value, const std::vector<uint8_t>& expected) {
  return value.bytes != nullptr && value.length == expected.size()
    && std::memcmp(value.bytes, expected.data(), expected.size()) == 0;
}

bool copy(const std::vector<uint8_t>& source, MutableBytes& target) {
  if (target.bytes == nullptr || target.capacity < source.size()) return false;
  std::memcpy(target.bytes, source.data(), source.size());
  target.length = static_cast<uint16_t>(source.size());
  return true;
}

std::vector<uint8_t> readFixture(const char* directory, const char* name, const char* magic) {
  const std::string path = std::string(directory) + "/" + name + ".bin";
  std::ifstream input(path, std::ios::binary);
  if (!input) throw std::runtime_error("missing fixture " + std::string(name));
  std::vector<uint8_t> bytes(std::istreambuf_iterator<char>(input), {});
  if (!envelope({ bytes.data(), static_cast<uint16_t>(bytes.size()) }, magic)) {
    throw std::runtime_error("invalid fixture " + std::string(name));
  }
  return bytes;
}

class VirtualCalculator final : public schoolcalc_relay::ICalculatorVariables {
public:
  explicit VirtualCalculator(const char* directory) {
    inputs_.emplace("DSID", readFixture(directory, "DSID", "SCI1"));
    inputs_.emplace("DSINFO", readFixture(directory, "DSINFO", "SCI1"));
    inputs_.emplace("DSINST", readFixture(directory, "DSINST", "SCM1"));
    inputs_.emplace("DSQ", readFixture(directory, "DSQ", "SCQ1"));
    inputs_.emplace("DSREQ", readFixture(directory, "DSREQ", "SCD1"));
    inputs_.emplace("DSTREQ", readFixture(directory, "DSTREQ", "SCTQ"));
    expectedWrites_.emplace("DSUSRNEW", readFixture(directory, "SCU1", "SCU1"));
    expectedWrites_.emplace("DSPRGNEW", readFixture(directory, "SCG1", "SCG1"));
    expectedWrites_.emplace("DSTNEW", readFixture(directory, "SCTR", "SCTR"));
    expectedWrites_.emplace("DSCATNEW", readFixture(directory, "SCC1", "SCC1"));
    expectedWrites_.emplace("DP7L3CWY", readFixture(directory, "SCP1", "SCP1"));
    expectedWrites_.emplace("DSACKNEW", readFixture(directory, "SCA1", "SCA1"));
    expectedWrites_.emplace("DSSYNC", readFixture(directory, "SCM1", "SCM1"));
  }

  schoolcalc_relay::VariableReadStatus read(const char* name, MutableBytes& output) override {
    reads_.emplace_back(name == nullptr ? "" : name);
    const auto found = inputs_.find(name == nullptr ? "" : name);
    if (found == inputs_.end()) return schoolcalc_relay::VariableReadStatus::Missing;
    if (!copy(found->second, output)) {
      error_ = "read buffer too small";
      return schoolcalc_relay::VariableReadStatus::TooLarge;
    }
    return schoolcalc_relay::VariableReadStatus::Found;
  }

  bool write(const char* name, ByteView payload) override {
    static const char* const allowed[] = {
      "DSUSRNEW", "DSPRGNEW", "DSTNEW", "DSCATNEW", "DP7L3CWY", "DSACKNEW", "DSSYNC",
    };
    bool permitted = false;
    for (const char* candidate : allowed) if (std::strcmp(name, candidate) == 0) permitted = true;
    if (!permitted) { error_ = "forbidden relay write"; return false; }
    if (!exact(payload, expectedWrites_.at(name))) { error_ = "staged bytes differ from semantic fixture"; return false; }
    values_[name] = std::vector<uint8_t>(payload.bytes, payload.bytes + payload.length);
    writes_.emplace_back(name);
    return true;
  }

  const char* lastError() const override { return error_.c_str(); }
  const std::vector<std::string>& reads() const { return reads_; }
  const std::vector<std::string>& writes() const { return writes_; }
  const std::vector<uint8_t>& value(const char* name) const { return values_.at(name); }

private:
  std::map<std::string, std::vector<uint8_t>> inputs_;
  std::map<std::string, std::vector<uint8_t>> expectedWrites_;
  std::map<std::string, std::vector<uint8_t>> values_;
  std::vector<std::string> reads_;
  std::vector<std::string> writes_;
  std::string error_ = "none";
};

class FixtureApi final : public schoolcalc_relay::ISchoolCalcApi {
public:
  explicit FixtureApi(const char* directory)
    : identity_(readFixture(directory, "DSID", "SCI1")),
      info_(readFixture(directory, "DSINFO", "SCI1")),
      installed_(readFixture(directory, "DSINST", "SCM1")),
      queue_(readFixture(directory, "DSQ", "SCQ1")),
      requests_(readFixture(directory, "DSREQ", "SCD1")),
      interactionRequest_(readFixture(directory, "DSTREQ", "SCTQ")),
      acknowledgement_(readFixture(directory, "SCA1", "SCA1")),
      manifest_(readFixture(directory, "SCM1", "SCM1")),
      roster_(readFixture(directory, "SCU1", "SCU1")),
      progress_(readFixture(directory, "SCG1", "SCG1")),
      interaction_(readFixture(directory, "SCTR", "SCTR")),
      catalog_(readFixture(directory, "SCC1", "SCC1")),
      artifact_(readFixture(directory, "SCP1", "SCP1")) {}

  bool identify(ByteView value, schoolcalc_relay::DeviceIdentity& identity) override {
    if (!exact(value, identity_)) return fail("identity differs from semantic fixture");
    std::snprintf(identity.deviceId, sizeof(identity.deviceId), "%s", "86A001");
    std::snprintf(identity.platformId, sizeof(identity.platformId), "%s", "ti86");
    ++identifyCalls;
    return true;
  }

  bool sync(const schoolcalc_relay::SyncRequest& request, schoolcalc_relay::SyncPlan& plan,
            MutableBytes& acknowledgement, MutableBytes& manifest, MutableBytes& roster,
            MutableBytes& progress, MutableBytes& interaction,
            schoolcalc_relay::INetworkWaitObserver*) override {
    if (request.deviceId == nullptr || std::strcmp(request.deviceId, "86A001") != 0
        || !exact(request.deviceInfo, info_) || !exact(request.installedState, installed_)
        || !exact(request.resultQueue, queue_) || !exact(request.deliveryRequests, requests_)
        || !exact(request.interactionRequest, interactionRequest_)
        || !copy(acknowledgement_, acknowledgement) || !copy(manifest_, manifest)
        || !copy(roster_, roster) || !copy(progress_, progress) || !copy(interaction_, interaction)) {
      return fail("sync input or output differs from semantic fixture");
    }
    plan = schoolcalc_relay::SyncPlan{};
    plan.ready = true; plan.catalogChanged = true; plan.artifactCount = 1;
    std::snprintf(plan.catalogGeneration, sizeof(plan.catalogGeneration), "%s", "sha256:tilem-catalog-v1");
    auto& artifact = plan.artifacts[0];
    std::snprintf(artifact.artifactId, sizeof(artifact.artifactId), "%s", "sc:ti86:7L3CWYLASV");
    std::snprintf(artifact.variableName, sizeof(artifact.variableName), "%s", "DP7L3CWY");
    artifact.byteLength = static_cast<uint16_t>(artifact_.size());
    std::snprintf(artifact.byteDigest, sizeof(artifact.byteDigest), "%s",
                  "b1197821d4540e63e217284066a7fd13008a491284f1ac297f7501682b71ef3a");
    plan.acknowledgementLength = acknowledgement.length; plan.manifestLength = manifest.length;
    plan.learnerRosterLength = roster.length; plan.progressProjectionLength = progress.length;
    plan.interactionResponseLength = interaction.length;
    ++syncCalls;
    return true;
  }

  bool fetchCatalog(const char* deviceId, const char* generation, MutableBytes& output) override {
    if (deviceId == nullptr || generation == nullptr || std::strcmp(deviceId, "86A001") != 0
        || std::strcmp(generation, "sha256:tilem-catalog-v1") != 0 || !copy(catalog_, output)) {
      return fail("catalog request differs from semantic fixture");
    }
    ++catalogCalls; return true;
  }

  bool fetchArtifact(const schoolcalc_relay::ArtifactDescriptor& descriptor, MutableBytes& output) override {
    if (std::strcmp(descriptor.variableName, "DP7L3CWY") != 0
        || descriptor.byteLength != artifact_.size() || !copy(artifact_, output)) {
      return fail("artifact request differs from semantic fixture");
    }
    ++artifactCalls; return true;
  }

  const char* lastError() const override { return error_.c_str(); }
  uint32_t identifyCalls = 0, syncCalls = 0, catalogCalls = 0, artifactCalls = 0;

private:
  std::vector<uint8_t> identity_, info_, installed_, queue_, requests_, interactionRequest_;
  std::vector<uint8_t> acknowledgement_, manifest_, roster_, progress_, interaction_, catalog_, artifact_;
  std::string error_ = "none";
  bool fail(const char* text) { error_ = text; return false; }
};

struct Buffers {
  std::array<uint8_t, 512> identity{}; std::array<uint8_t, 4096> info{};
  std::array<uint8_t, 6144> installed{}; std::array<uint8_t, 6144> queue{};
  std::array<uint8_t, 2048> requests{}; std::array<uint8_t, 512> interactionRequest{};
  std::array<uint8_t, 512> roster{}; std::array<uint8_t, 4096> progress{};
  std::array<uint8_t, 2048> interactionResponse{}; std::array<uint8_t, 544> acknowledgement{};
  std::array<uint8_t, 6144> manifest{}; std::array<uint8_t, 12288> transfer{};
  template <size_t N> static MutableBytes mutableBytes(std::array<uint8_t, N>& value) {
    return { value.data(), static_cast<uint16_t>(value.size()), 0 };
  }
  schoolcalc_relay::SessionBuffers view() { return {
    mutableBytes(identity), mutableBytes(info), mutableBytes(installed), mutableBytes(queue),
    mutableBytes(requests), mutableBytes(interactionRequest), mutableBytes(roster), mutableBytes(progress),
    mutableBytes(interactionResponse), mutableBytes(acknowledgement), mutableBytes(manifest), mutableBytes(transfer),
  }; }
};

}  // namespace

int main(int argc, char* argv[]) {
  if (argc != 5 || std::strcmp(argv[1], "--fixture-dir") != 0 || std::strcmp(argv[3], "--report") != 0) {
    std::fputs("Usage: virtual_relay --fixture-dir PATH --report PATH\n", stderr); return 64;
  }
  try {
    VirtualCalculator calculator(argv[2]); FixtureApi api(argv[2]); Buffers buffers;
    schoolcalc_relay::SchoolCalcRelaySession session(calculator, api, buffers.view());
    const auto outcome = session.run();
    const std::vector<std::string> expectedReads = { "DSID", "DSINFO", "DSINST", "DSQ", "DSREQ", "DSTREQ" };
    const std::vector<std::string> expectedWrites = { "DSUSRNEW", "DSPRGNEW", "DSTNEW", "DSCATNEW", "DP7L3CWY", "DSACKNEW", "DSSYNC" };
    if (!outcome.ok || outcome.state != schoolcalc_relay::SessionState::AwaitingCalculatorCommit
        || calculator.reads() != expectedReads || calculator.writes() != expectedWrites
        || api.identifyCalls != 1 || api.syncCalls != 1
        || api.catalogCalls != 1 || api.artifactCalls != 1) {
      std::fprintf(stderr, "TICALC_VIRTUAL_RELAY_FAIL state=%s error=%s api=%s\n",
                   schoolcalc_relay::sessionStateText(outcome.state),
                   schoolcalc_relay::sessionErrorText(outcome.error), api.lastError());
      return 1;
    }
    std::ofstream report(argv[4], std::ios::trunc);
    report << "ok=true\nstate=awaiting_calculator_commit\nreads=6\nwrites=DSUSRNEW,DSPRGNEW,DSTNEW,DSCATNEW,DP7L3CWY,DSACKNEW,DSSYNC\n";
    std::puts("TICALC_VIRTUAL_RELAY_PASS catalog=1 quiz=1 progress=1");
  } catch (const std::exception& error) {
    std::fprintf(stderr, "TICALC_VIRTUAL_RELAY_FAIL detail=%s\n", error.what()); return 1;
  }
  return 0;
}

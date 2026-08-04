#include "HostArduinoShim.h"
#include "MameBitSocketBridge.h"

#include "SchoolCalcForegroundSession.h"
#include "SchoolCalcRelaySession.h"
#include "SchoolCalcTiLinkAdapters.h"
#include "SchoolCalcWire.h"
#include "TiLinkTransport.h"

#include <array>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <string>
#include <thread>

namespace {

constexpr uint8_t TIP_SENSE_PIN = 1;
constexpr uint8_t TIP_SINK_PIN = 2;
constexpr uint8_t RING_SENSE_PIN = 3;
constexpr uint8_t RING_SINK_PIN = 4;

class FixtureApi final : public schoolcalc_relay::ISchoolCalcApi {
public:
  bool identify(schoolcalc_relay::ByteView identity,
                schoolcalc_relay::DeviceIdentity& output) override {
    if (!hasEnvelope(identity, "SCI1")) return fail("expected SCI1 DSID");
    std::snprintf(output.deviceId, sizeof(output.deviceId), "%s", "TI86A");
    std::snprintf(output.platformId, sizeof(output.platformId), "%s", "ti86");
    identifyCalls++;
    return true;
  }

  bool sync(const schoolcalc_relay::SyncRequest& request,
            schoolcalc_relay::SyncPlan& plan,
            schoolcalc_relay::MutableBytes& acknowledgement,
            schoolcalc_relay::MutableBytes& manifest,
            schoolcalc_relay::MutableBytes& roster,
            schoolcalc_relay::MutableBytes& progress,
            schoolcalc_relay::MutableBytes& interaction,
            schoolcalc_relay::INetworkWaitObserver*) override {
    if (request.deviceId == nullptr || std::strcmp(request.deviceId, "TI86A") != 0
        || !hasEnvelope(request.deviceInfo, "SCI1")) {
      return fail("expected TI86A SCI1 DSINFO");
    }
    const auto ack = emptyEnvelope("SCA1");
    const auto commit = emptyEnvelope("SCM1");
    const auto users = emptyEnvelope("SCU1");
    const auto projection = emptyEnvelope("SCG1");
    if (!copy(ack, acknowledgement) || !copy(commit, manifest)
        || !copy(users, roster) || !copy(projection, progress)) {
      return fail("fixture output buffer too small");
    }
    interaction.length = 0;
    plan = schoolcalc_relay::SyncPlan{};
    plan.ready = true;
    plan.acknowledgementLength = acknowledgement.length;
    plan.manifestLength = manifest.length;
    plan.learnerRosterLength = roster.length;
    plan.progressProjectionLength = progress.length;
    syncCalls++;
    return true;
  }

  bool fetchCatalog(const char*, const char*, schoolcalc_relay::MutableBytes&) override {
    return fail("fixture did not plan a Catalog fetch");
  }

  bool fetchArtifact(const schoolcalc_relay::ArtifactDescriptor&,
                     schoolcalc_relay::MutableBytes&) override {
    return fail("fixture did not plan an artifact fetch");
  }

  const char* lastError() const override { return error_; }

  uint32_t identifyCalls = 0;
  uint32_t syncCalls = 0;

private:
  char error_[96] = "none";

  bool fail(const char* text) {
    std::snprintf(error_, sizeof(error_), "%s", text);
    return false;
  }

  static bool hasEnvelope(schoolcalc_relay::ByteView record, const char magic[5]) {
    return record.length >= 9 && record.bytes != nullptr
      && std::memcmp(record.bytes, magic, 4) == 0;
  }

  static std::array<uint8_t, 9> emptyEnvelope(const char magic[5]) {
    std::array<uint8_t, 9> record{};
    std::memcpy(record.data(), magic, 4);
    record[4] = 1;
    const uint16_t checksum = schoolcalc_wire::crc16Ccitt(record.data(), 7);
    record[7] = static_cast<uint8_t>(checksum & 0xFF);
    record[8] = static_cast<uint8_t>(checksum >> 8);
    return record;
  }

  static bool copy(const std::array<uint8_t, 9>& source,
                   schoolcalc_relay::MutableBytes& destination) {
    if (destination.bytes == nullptr || destination.capacity < source.size()) return false;
    std::memcpy(destination.bytes, source.data(), source.size());
    destination.length = static_cast<uint16_t>(source.size());
    return true;
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

  schoolcalc_relay::SessionBuffers view() {
    return {
      bytes(identity), bytes(info), bytes(installed), bytes(queue), bytes(requests),
      bytes(interactionRequest), bytes(roster), bytes(progress), bytes(interactionResponse),
      bytes(acknowledgement), bytes(manifest), bytes(transfer),
    };
  }

private:
  template <size_t N>
  static schoolcalc_relay::MutableBytes bytes(std::array<uint8_t, N>& value) {
    return { value.data(), static_cast<uint16_t>(value.size()), 0 };
  }
};

class LinkReporter final {
public:
  explicit LinkReporter(const schoolcalc_mame::MameBitSocketBridge& bridge) : bridge_(bridge) {
    thread_ = std::thread([this]() {
      while (running_.load()) {
        std::this_thread::sleep_for(std::chrono::seconds(1));
        if (running_.load()) {
          std::fprintf(stderr, "TICALC_MAME_RELAY_LINK calculator_events=%u relay_events=%u\n",
                       bridge_.calculatorEvents(), bridge_.relayEvents());
        }
      }
    });
  }

  ~LinkReporter() {
    running_.store(false);
    if (thread_.joinable()) thread_.join();
  }

  LinkReporter(const LinkReporter&) = delete;
  LinkReporter& operator=(const LinkReporter&) = delete;

private:
  const schoolcalc_mame::MameBitSocketBridge& bridge_;
  std::atomic<bool> running_{true};
  std::thread thread_;
};

bool writeComplete(const char* path, const schoolcalc_relay::SessionOutcome& outcome,
                   const FixtureApi& api, const schoolcalc_mame::MameBitSocketBridge& bridge) {
  std::ofstream file(path, std::ios::trunc);
  if (!file) return false;
  file << "ok=" << (outcome.ok ? "true" : "false") << "\n";
  file << "state=" << schoolcalc_relay::sessionStateText(outcome.state) << "\n";
  file << "error=" << schoolcalc_relay::sessionErrorText(outcome.error) << "\n";
  file << "identifyCalls=" << api.identifyCalls << "\n";
  file << "syncCalls=" << api.syncCalls << "\n";
  file << "calculatorEvents=" << bridge.calculatorEvents() << "\n";
  file << "relayEvents=" << bridge.relayEvents() << "\n";
  return static_cast<bool>(file);
}

void usage() {
  std::fputs("Usage: virtual_relay_main --pty PATH --complete-file PATH\n", stderr);
}

}  // namespace

int main(int argc, char* argv[]) {
  const char* pty = nullptr;
  const char* completeFile = nullptr;
  for (int index = 1; index < argc; ++index) {
    if (std::strcmp(argv[index], "--pty") == 0 && index + 1 < argc) pty = argv[++index];
    else if (std::strcmp(argv[index], "--complete-file") == 0 && index + 1 < argc) completeFile = argv[++index];
    else { usage(); return 64; }
  }
  if (pty == nullptr || completeFile == nullptr) { usage(); return 64; }

  schoolcalc_mame::MameBitSocketBridge bridge(pty);
  std::string bridgeError;
  if (!bridge.start(bridgeError)) {
    std::fprintf(stderr, "TICALC_MAME_RELAY_FAIL stage=bridge detail=%s\n", bridgeError.c_str());
    return 1;
  }
  LinkReporter reporter(bridge);
  schoolcalc_mame::installHostArduinoShim(bridge, TIP_SENSE_PIN, TIP_SINK_PIN,
                                          RING_SENSE_PIN, RING_SINK_PIN);
  TiLinkTransport transport(TIP_SENSE_PIN, TIP_SINK_PIN, RING_SENSE_PIN, RING_SINK_PIN, true);
  transport.begin();
  schoolcalc_relay::TiForegroundFrameChannel channel(transport);
  std::fprintf(stderr, "TICALC_MAME_RELAY_WAITING foreground-hello\n");

  for (uint8_t attempt = 0; attempt < 30; ++attempt) {
    schoolcalc_relay::ForegroundCalculatorVariables calculator(channel);
    if (!calculator.accept()) {
      if (calculator.error() == schoolcalc_relay::ForegroundSessionError::Channel) {
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
        continue;
      }
      std::fprintf(stderr, "TICALC_MAME_RELAY_FAIL stage=accept detail=%s\n", calculator.lastError());
      schoolcalc_mame::clearHostArduinoShim();
      return 1;
    }

    FixtureApi api;
    Buffers buffers;
    schoolcalc_relay::SchoolCalcRelaySession session(calculator, api, buffers.view(), &calculator);
    const schoolcalc_relay::SessionOutcome outcome = session.run();
    if (!outcome.ok || api.identifyCalls != 1 || api.syncCalls != 1) {
      std::fprintf(stderr, "TICALC_MAME_RELAY_FAIL stage=session state=%s error=%s detail=%s api=%s\n",
                   schoolcalc_relay::sessionStateText(outcome.state),
                   schoolcalc_relay::sessionErrorText(outcome.error), outcome.detail, api.lastError());
      schoolcalc_mame::clearHostArduinoShim();
      return 1;
    }
    if (!calculator.finish(schoolcalc_foreground::CompleteCode::Ready)) {
      std::fprintf(stderr, "TICALC_MAME_RELAY_FAIL stage=finish detail=%s\n", calculator.lastError());
      schoolcalc_mame::clearHostArduinoShim();
      return 1;
    }
    if (!writeComplete(completeFile, outcome, api, bridge)) {
      std::fprintf(stderr, "TICALC_MAME_RELAY_FAIL stage=report detail=could-not-write-complete-file\n");
      schoolcalc_mame::clearHostArduinoShim();
      return 1;
    }
    std::printf("TICALC_MAME_RELAY_PASS state=%s reads=DSID,DSINFO,DSINST writes=DSUSRNEW,DSPRGNEW,DSACKNEW,DSSYNC calculator_events=%u relay_events=%u\n",
                schoolcalc_relay::sessionStateText(outcome.state), bridge.calculatorEvents(), bridge.relayEvents());
    schoolcalc_mame::clearHostArduinoShim();
    return 0;
  }

  std::fprintf(stderr, "TICALC_MAME_RELAY_FAIL stage=accept detail=timed-out-waiting-for-scsync\n");
  schoolcalc_mame::clearHostArduinoShim();
  return 1;
}

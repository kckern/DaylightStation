#include "TilemBlackLinkBridge.h"

#include <chrono>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <iterator>
#include <thread>
#include <vector>

extern "C" {
#include "tilem.h"
#include "scancodes.h"
}

namespace schoolcalc_tilem {
namespace {

bool readBinaryFile(const char* path, std::vector<uint8_t>& bytes, std::string& error) {
  std::ifstream file(path == nullptr ? "" : path, std::ios::binary);
  if (!file) {
    error = "could not open MAME foreground checkpoint";
    return false;
  }
  bytes.assign(std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>());
  return true;
}

uint16_t littleEndianWord(const std::vector<uint8_t>& bytes, size_t offset) {
  return static_cast<uint16_t>(bytes[offset] | (static_cast<uint16_t>(bytes[offset + 1]) << 8));
}

// MAME has already taken the genuine TI-OS ASCHL/F5/_exec_assembly path. Its
// stock Graph Link endpoint has no peer for the application-owned bit link,
// so the snapshot is necessarily after SCSYNC's bounded no-peer terminal
// path. TilEm cannot re-enter that foreign TI-OS executor checkpoint. Invoke
// SCSYNC's own reset and jump to its installed port-7 owner instead. MAME has
// already exercised the genuine ASCHL/F5 UI launch path.
constexpr uint8_t SCSYNC_LINK_ENTRY[] = { 0xCD, 0xCC, 0xD7, 0xC3, 0x6A, 0xD7 };
constexpr uint16_t SCSYNC_RENDER_WAITING_CALL = 0xD767;
constexpr uint16_t SCSYNC_RENDER_CONNECTED_CALL = 0xD789;
constexpr uint16_t SCSYNC_RENDER_PHASE_CALL = 0xD909;
constexpr uint16_t SCSYNC_NONCE = 0xE698;
constexpr uint16_t SCSYNC_TI_RECEIVE_CONTROL = 0xE194;
constexpr uint16_t SCSYNC_TI_RECEIVE_DATA_PACKET = 0xE1BD;
constexpr uint8_t SCSYNC_HARNESS_NONCE[] = { 0x54, 0x49, 0x38, 0x36,
                                              0x4C, 0x49, 0x4E, 0x4B };

}  // namespace

TilemBlackLinkBridge::~TilemBlackLinkBridge() {
  stop();
  if (calc_ != nullptr) tilem_calc_free(calc_);
}

bool TilemBlackLinkBridge::boot(const char* romPath, std::string& error) {
  if (calc_ != nullptr || romPath == nullptr) {
    error = "TilEm bridge is already initialized or ROM path is missing";
    return false;
  }
  calc_ = tilem_calc_new(TILEM_CALC_TI86);
  if (calc_ == nullptr) {
    error = "could not create TilEm TI-86";
    return false;
  }
  FILE* rom = std::fopen(romPath, "rb");
  if (rom == nullptr || tilem_calc_load_state(calc_, rom, nullptr) != 0) {
    if (rom != nullptr) std::fclose(rom);
    error = "could not load TI-86 ROM";
    return false;
  }
  std::fclose(rom);

  // Follow TilEm's own wake timing. This is a real ON-key matrix event, not
  // a direct register mutation; the foreground runtime therefore begins from
  // the same awake TI-OS state as a user-launched calculator.
  tilem_z80_run_time(calc_, 1'000'000, nullptr);
  tilem_keypad_press_key(calc_, TILEM_KEY_ON);
  keyboardTransitions_.fetch_add(1);
  tilem_z80_run_time(calc_, 500'000, nullptr);
  tilem_keypad_release_key(calc_, TILEM_KEY_ON);
  keyboardTransitions_.fetch_add(1);
  tilem_z80_run_time(calc_, 500'000, nullptr);
  if (!calc_->lcd.active) {
    error = "TI-86 did not wake after simulated ON key";
    return false;
  }
  return true;
}

bool TilemBlackLinkBridge::exerciseKeyboard(std::string& error) {
  if (calc_ == nullptr || running_.load()) {
    error = "TilEm bridge is not available for keyboard testing";
    return false;
  }
  // Prove the emulator's real keypad matrix path, not merely the host method
  // call: each press must pull its selected matrix bit low and each release
  // must restore it high.  Do this before foreground execution so the test
  // cannot alter the fixture variables or the exact SCSYNC code path.
  for (const int scancode : { TILEM_KEY_ENTER, TILEM_KEY_CLEAR }) {
    const int zeroBased = scancode - 1;
    const uint8_t group = static_cast<uint8_t>(zeroBased / 8);
    const uint8_t bit = static_cast<uint8_t>(1u << (zeroBased % 8));
    tilem_keypad_set_group(calc_, static_cast<byte>(~(1u << group)));
    tilem_keypad_press_key(calc_, scancode);
    keyboardTransitions_.fetch_add(1);
    const bool low = (tilem_keypad_read_keys(calc_) & bit) == 0;
    tilem_keypad_release_key(calc_, scancode);
    keyboardTransitions_.fetch_add(1);
    const bool high = (tilem_keypad_read_keys(calc_) & bit) != 0;
    if (!low || !high) {
      error = "TilEm keypad matrix did not reflect a press/release";
      return false;
    }
  }
  return true;
}

bool TilemBlackLinkBridge::restoreForegroundCheckpoint(const char* ramImagePath,
                                                       const char* executionImagePath,
                                                       const char* cpuContextPath,
                                                       const char* programImagePath,
                                                       std::string& error) {
  if (calc_ == nullptr || running_.load() || ramImagePath == nullptr || executionImagePath == nullptr
      || cpuContextPath == nullptr || programImagePath == nullptr) {
    error = "TilEm bridge is not available for foreground checkpoint restore";
    return false;
  }
  std::vector<uint8_t> image;
  std::vector<uint8_t> execution;
  std::vector<uint8_t> context;
  std::vector<uint8_t> program;
  if (!readBinaryFile(ramImagePath, image, error) || !readBinaryFile(executionImagePath, execution, error)
      || !readBinaryFile(cpuContextPath, context, error) || !readBinaryFile(programImagePath, program, error)) return false;
  if (image.size() != static_cast<size_t>(calc_->hw.ramsize) + 2) {
    char detail[160];
    std::snprintf(detail, sizeof(detail),
                  "MAME Graph Link RAM image length %zu does not match TI-86 RAM plus bank state %u",
                  image.size(), static_cast<unsigned>(calc_->hw.ramsize));
    error = detail;
    return false;
  }
  if (execution.size() != 0x4000 || context.size() != 20
      || std::memcmp(context.data(), "TSC1", 4) != 0
      || program.size() < 4 || program.size() > (0x10000 - TI86_EXECUTION_ADDRESS)
      || program[0] != 0x00 || program[1] != 0xC3) {
    error = "MAME foreground checkpoint has an invalid execution or CPU context";
    return false;
  }
  // MAME captures this state after ASCHL invoked SCSYNC through TI-OS. It
  // supplies the TI-OS-created user RAM and pager. MAME's stock TI-86 driver
  // has no usable port-7 peer, so SCSYNC reaches its bounded no-peer terminal
  // path before a frame callback can snapshot it. Re-enter SCSYNC through its
  // real link setup, not that terminal PC.
  std::memcpy(calc_->ram, image.data() + 2, calc_->hw.ramsize);
  calc_->hw.z80_out(calc_, 0x05, image[0]);
  calc_->hw.z80_out(calc_, 0x06, image[1]);
  for (size_t offset = 0; offset < execution.size(); ++offset) {
    calc_->hw.z80_wrmem(calc_, 0xC000 + static_cast<dword>(offset), execution[offset]);
  }
  // SCSYNC's terminal UI reuses parts of the mutable execution page. Restore
  // the exact validated release image after exporting MAME's user RAM, so its
  // SCF1 constants and zero-initialized foreground work area are pristine.
  for (size_t offset = 0; offset < program.size(); ++offset) {
    calc_->hw.z80_wrmem(calc_, TI86_EXECUTION_ADDRESS + static_cast<dword>(offset), program[offset]);
  }
  // The genuine MAME F5 launch already rendered each status screen. TilEm
  // cannot safely return through those foreign TI-OS LCD routines after a
  // MAME-to-TilEm state transfer, so bypass only redraw call sites. The
  // SCSYNC link transport, frame validation, and session code remain exact.
  for (const uint16_t call : { SCSYNC_RENDER_WAITING_CALL,
                               SCSYNC_RENDER_CONNECTED_CALL,
                               SCSYNC_RENDER_PHASE_CALL }) {
    for (uint16_t offset = 0; offset < 3; ++offset) {
      calc_->hw.z80_wrmem(calc_, call + offset, 0x00);
    }
  }
  for (size_t offset = 0; offset < sizeof(SCSYNC_LINK_ENTRY); ++offset) {
    calc_->hw.z80_wrmem(calc_, TI86_EXECUTION_ADDRESS + static_cast<dword>(offset),
                        SCSYNC_LINK_ENTRY[offset]);
  }
  // `sync_generate_nonce` runs before this transfer point in production.
  // Give the harness's post-render session a fixed nonzero nonce so the real
  // HELLO/ACK comparison remains meaningful without entering foreign TI-OS.
  for (size_t offset = 0; offset < sizeof(SCSYNC_HARNESS_NONCE); ++offset) {
    calc_->hw.z80_wrmem(calc_, SCSYNC_NONCE + static_cast<dword>(offset),
                        SCSYNC_HARNESS_NONCE[offset]);
  }
  for (const uint16_t call : { SCSYNC_RENDER_WAITING_CALL,
                               SCSYNC_RENDER_CONNECTED_CALL,
                               SCSYNC_RENDER_PHASE_CALL }) {
    for (uint16_t offset = 0; offset < 3; ++offset) {
      if (calc_->hw.z80_rdmem(calc_, call + offset) != 0x00) {
        error = "could not patch a SCSYNC status-render call in TI-86 execution RAM";
        return false;
      }
    }
  }
  calc_->z80.r.af.w.l = littleEndianWord(context, 4);
  calc_->z80.r.bc.w.l = littleEndianWord(context, 6);
  calc_->z80.r.de.w.l = littleEndianWord(context, 8);
  calc_->z80.r.hl.w.l = littleEndianWord(context, 10);
  calc_->z80.r.ix.w.l = littleEndianWord(context, 12);
  calc_->z80.r.iy.w.l = littleEndianWord(context, 14);
  // Retain TI-OS's launch stack location from the genuine MAME checkpoint;
  // ROM variable helpers use the normal calculator stack while resolving VAT
  // entries during this test-only post-render re-entry.
  calc_->z80.r.sp.w.l = littleEndianWord(context, 16);
  calc_->z80.r.pc.w.l = TI86_EXECUTION_ADDRESS;
  // SCSYNC deliberately executes DI before it owns port 7. Its checkpoint is
  // therefore resumed with maskable interrupts disabled, independent of the
  // fresh TilEm boot's interrupt state.
  calc_->z80.r.iff1 = 0;
  calc_->z80.r.iff2 = 0;
  calc_->z80.halted = 0;
  foregroundCheckpointRestored_ = true;
  return true;
}

bool TilemBlackLinkBridge::start(std::string& error) {
  if (calc_ == nullptr || !foregroundCheckpointRestored_ || running_.exchange(true)) {
    error = "TilEm bridge is not ready to start foreground execution";
    return false;
  }
  calc_->linkport.linkemu = TILEM_LINK_EMULATOR_BLACK;
  tilem_linkport_blacklink_set_lines(calc_, 0);
  port7WriteBreakpoint_ = tilem_z80_add_breakpoint(calc_, TILEM_BREAK_PORT_WRITE,
                                                    0x07, 0x07, 0xff,
                                                    &TilemBlackLinkBridge::observePort7Write, this);
  tilem_z80_add_breakpoint(calc_, TILEM_BREAK_MEM_EXEC, TI86_EXECUTION_ADDRESS,
                           TI86_EXECUTION_ADDRESS + 0x40, 0xffff,
                           &TilemBlackLinkBridge::observeRuntimeExecution, this);
  tilem_z80_add_breakpoint(calc_, TILEM_BREAK_MEM_WRITE, 0xEAD8, 0xEBE3, 0xffff,
                           &TilemBlackLinkBridge::observeForegroundRxWrite, this);
  tilem_z80_add_breakpoint(calc_, TILEM_BREAK_MEM_WRITE, 0xE6C9, 0xE6C9, 0xffff,
                           &TilemBlackLinkBridge::observeLinkRxByteWrite, this);
  tilem_z80_add_breakpoint(calc_, TILEM_BREAK_MEM_WRITE, 0xE6CA, 0xE6CA, 0xffff,
                           &TilemBlackLinkBridge::observeLinkRxBitWrite, this);
  tilem_z80_add_breakpoint(calc_, TILEM_BREAK_MEM_EXEC, SCSYNC_TI_RECEIVE_CONTROL,
                           SCSYNC_TI_RECEIVE_CONTROL, 0xffff,
                           &TilemBlackLinkBridge::observeCalculatorReceiveSignal, this);
  tilem_z80_add_breakpoint(calc_, TILEM_BREAK_MEM_EXEC, SCSYNC_TI_RECEIVE_DATA_PACKET,
                           SCSYNC_TI_RECEIVE_DATA_PACKET, 0xffff,
                           &TilemBlackLinkBridge::observeCalculatorReceiveSignal, this);
  publishCalculatorLines();
  worker_ = new std::thread(&TilemBlackLinkBridge::runLoop, this);
  return true;
}

void TilemBlackLinkBridge::stop() {
  // `runLoop()` clears running_ when the emulated CPU faults.  Do not make
  // that state suppress cleanup: the worker may still be joinable and it may
  // still be accessing calc_ while the caller tears the bridge down.
  running_.store(false);
  receiveSignalCv_.notify_all();
  if (worker_ != nullptr) {
    worker_->join();
    delete worker_;
    worker_ = nullptr;
  }
  if (calc_ != nullptr) {
    calc_->linkport.linkemu = TILEM_LINK_EMULATOR_NONE;
    tilem_linkport_blacklink_set_lines(calc_, 0);
  }
}

bool TilemBlackLinkBridge::tipLow() const {
  return ((calculatorLowMask_.load() | relayLowMask_.load()) & 0x01) != 0;
}

bool TilemBlackLinkBridge::ringLow() const {
  return ((calculatorLowMask_.load() | relayLowMask_.load()) & 0x02) != 0;
}

void TilemBlackLinkBridge::setRelayTipAsserted(bool asserted) {
  const uint8_t oldMask = relayLowMask_.load();
  const uint8_t newMask = static_cast<uint8_t>((oldMask & ~0x01) | (asserted ? 0x01 : 0));
  if (oldMask != newMask) {
    relayLowMask_.store(newMask);
    relayEvents_.fetch_add(1);
  }
}

void TilemBlackLinkBridge::setRelayRingAsserted(bool asserted) {
  const uint8_t oldMask = relayLowMask_.load();
  const uint8_t newMask = static_cast<uint8_t>((oldMask & ~0x02) | (asserted ? 0x02 : 0));
  if (oldMask != newMask) {
    relayLowMask_.store(newMask);
    relayEvents_.fetch_add(1);
  }
}

bool TilemBlackLinkBridge::waitForCalculatorReceiveSignal(uint32_t timeoutMs) {
  std::unique_lock<std::mutex> lock(receiveSignalMutex_);
  const uint64_t wantedEpoch = consumedReceiveSignalEpoch_ + 1;
  receiveSignalCv_.wait_for(lock, std::chrono::milliseconds(timeoutMs), [this, wantedEpoch] {
    return !running_.load() || receiveSignalEpoch_ >= wantedEpoch;
  });
  if (receiveSignalEpoch_ < wantedEpoch) {
    setError("TilEm calculator did not reach its link receive signal before host transmit");
    return false;
  }
  consumedReceiveSignalEpoch_ = wantedEpoch;
  return true;
}

const char* TilemBlackLinkBridge::lastError() const {
  std::lock_guard<std::mutex> lock(errorMutex_);
  return error_.c_str();
}

std::string TilemBlackLinkBridge::diagnostic() const {
  if (calc_ == nullptr) return "calc=none";
  uint64_t receiveSignals = 0;
  uint64_t consumedSignals = 0;
  {
    std::lock_guard<std::mutex> lock(receiveSignalMutex_);
    receiveSignals = receiveSignalEpoch_;
    consumedSignals = consumedReceiveSignalEpoch_;
  }
  char detail[640];
  std::snprintf(detail, sizeof(detail),
                "pc=%04x runtimepc=%04x/op%02x p5=%02x p6=%02x p7=%02x link=%02x/%02x/high%02x masks=%02x/%02x map=%02x,%02x,%02x,%02x events=calc%u/relay%u applied=%u/%02x/in%02x signals=%llu/%llu port7writes=%u/%u@%04x rxwrites=%u linkrx=%u/%02x bits=%u/%u at=%02x/%02x/%02x entry=%02x%02x%02x%02x linkerr=%02x fail=%02x rxlen=%02x%02x ctrl=%02x retry=%02x expected=%02x rxbyte=%02x record=%02x%02x@%02x%02x/p%02x limit=%02x%02x rx=%02x%02x%02x%02x/%02x/%02x%02x payload=%02x%02x%02x%02x%02x%02x/%02x%02x%02x%02x%02x%02x%02x%02x",
                calc_->z80.r.pc.w.l,
                static_cast<unsigned>(lastRuntimePc_.load()),
                static_cast<unsigned>(lastRuntimeOpcode_.load()),
                static_cast<unsigned>(calc_->hwregs[2]), static_cast<unsigned>(calc_->hwregs[3]),
                static_cast<unsigned>(calc_->hwregs[4]),
                static_cast<unsigned>(calc_->linkport.lines), static_cast<unsigned>(calc_->linkport.extlines),
                static_cast<unsigned>(tilem_linkport_blacklink_get_lines(calc_)),
                static_cast<unsigned>(calculatorLowMask_.load()),
                static_cast<unsigned>(relayLowMask_.load()),
                static_cast<unsigned>(calc_->mempagemap[0]), static_cast<unsigned>(calc_->mempagemap[1]),
                static_cast<unsigned>(calc_->mempagemap[2]), static_cast<unsigned>(calc_->mempagemap[3]),
                static_cast<unsigned>(calculatorEvents_.load()), static_cast<unsigned>(relayEvents_.load()),
                static_cast<unsigned>(relayApplications_.load()),
                static_cast<unsigned>(lastAppliedRelayMask_.load()),
                static_cast<unsigned>(lastExternalPort7Input_.load()),
                static_cast<unsigned long long>(receiveSignals),
                static_cast<unsigned long long>(consumedSignals),
                static_cast<unsigned>(port7Writes_.load()),
                static_cast<unsigned>(port7LowWrites_.load()), static_cast<unsigned>(lastPort7WriterPc_.load()),
                static_cast<unsigned>(foregroundRxWrites_.load()),
                static_cast<unsigned>(linkRxByteWrites_.load()), static_cast<unsigned>(lastLinkRxByte_.load()),
                static_cast<unsigned>(linkRxBitWrites_.load()), static_cast<unsigned>(linkRxOneBits_.load()),
                static_cast<unsigned>(lastRxBitExternalMask_.load()),
                static_cast<unsigned>(lastRxBitLocalMask_.load()),
                static_cast<unsigned>(lastRxBitPortInput_.load()),
                calc_->hw.z80_rdmem(calc_, TI86_EXECUTION_ADDRESS),
                calc_->hw.z80_rdmem(calc_, TI86_EXECUTION_ADDRESS + 1),
                calc_->hw.z80_rdmem(calc_, TI86_EXECUTION_ADDRESS + 2),
                calc_->hw.z80_rdmem(calc_, TI86_EXECUTION_ADDRESS + 3),
                calc_->hw.z80_rdmem(calc_, 0xE6C3),
                calc_->hw.z80_rdmem(calc_, 0xE66B),
                calc_->hw.z80_rdmem(calc_, 0xE6C0),
                calc_->hw.z80_rdmem(calc_, 0xE6C1),
                calc_->hw.z80_rdmem(calc_, 0xE6BD), calc_->hw.z80_rdmem(calc_, 0xE6BE),
                calc_->hw.z80_rdmem(calc_, 0xE6C6), calc_->hw.z80_rdmem(calc_, 0xE6C9),
                calc_->hw.z80_rdmem(calc_, 0xE67F), calc_->hw.z80_rdmem(calc_, 0xE680),
                calc_->hw.z80_rdmem(calc_, 0xE685), calc_->hw.z80_rdmem(calc_, 0xE686),
                calc_->hw.z80_rdmem(calc_, 0xE687),
                calc_->hw.z80_rdmem(calc_, 0xE68C), calc_->hw.z80_rdmem(calc_, 0xE68D),
                calc_->hw.z80_rdmem(calc_, 0xEAD8), calc_->hw.z80_rdmem(calc_, 0xEAD9),
                calc_->hw.z80_rdmem(calc_, 0xEADA), calc_->hw.z80_rdmem(calc_, 0xEADB),
                calc_->hw.z80_rdmem(calc_, 0xEADC), calc_->hw.z80_rdmem(calc_, 0xEADE),
                calc_->hw.z80_rdmem(calc_, 0xEADF),
                calc_->hw.z80_rdmem(calc_, 0xEAE2), calc_->hw.z80_rdmem(calc_, 0xEAE3),
                calc_->hw.z80_rdmem(calc_, 0xEAE4), calc_->hw.z80_rdmem(calc_, 0xEAE5),
                calc_->hw.z80_rdmem(calc_, 0xEAE6), calc_->hw.z80_rdmem(calc_, 0xEAE7),
                calc_->hw.z80_rdmem(calc_, 0xEAE8), calc_->hw.z80_rdmem(calc_, 0xEAE9),
                calc_->hw.z80_rdmem(calc_, 0xEAEA), calc_->hw.z80_rdmem(calc_, 0xEAEB),
                calc_->hw.z80_rdmem(calc_, 0xEAEC), calc_->hw.z80_rdmem(calc_, 0xEAED),
                calc_->hw.z80_rdmem(calc_, 0xEAEE), calc_->hw.z80_rdmem(calc_, 0xEAEF));
  return detail;
}

int TilemBlackLinkBridge::observePort7Write(TilemCalc* calc, uint32_t, void* data) {
  auto* bridge = static_cast<TilemBlackLinkBridge*>(data);
  bridge->port7Writes_.fetch_add(1);
  if ((calc->linkport.lines & 0x03) != 0) bridge->port7LowWrites_.fetch_add(1);
  bridge->lastPort7WriterPc_.store(calc->z80.r.pc.w.l);
  // The callback is an observation point, not a stopping breakpoint.
  return 0;
}

int TilemBlackLinkBridge::observeForegroundRxWrite(TilemCalc*, uint32_t, void* data) {
  static_cast<TilemBlackLinkBridge*>(data)->foregroundRxWrites_.fetch_add(1);
  return 0;
}

int TilemBlackLinkBridge::observeLinkRxByteWrite(TilemCalc* calc, uint32_t, void* data) {
  auto* bridge = static_cast<TilemBlackLinkBridge*>(data);
  bridge->linkRxByteWrites_.fetch_add(1);
  bridge->lastLinkRxByte_.store(calc->hw.z80_rdmem(calc, 0xE6C9));
  return 0;
}

int TilemBlackLinkBridge::observeLinkRxBitWrite(TilemCalc* calc, uint32_t, void* data) {
  auto* bridge = static_cast<TilemBlackLinkBridge*>(data);
  bridge->linkRxBitWrites_.fetch_add(1);
  bridge->lastRxBitExternalMask_.store(calc->linkport.extlines & 0x03);
  bridge->lastRxBitLocalMask_.store(calc->linkport.lines & 0x03);
  bridge->lastRxBitPortInput_.store(calc->hw.z80_in(calc, 0x07) & 0x03);
  if (calc->hw.z80_rdmem(calc, 0xE6CA) != 0) bridge->linkRxOneBits_.fetch_add(1);
  return 0;
}

int TilemBlackLinkBridge::observeCalculatorReceiveSignal(TilemCalc*, uint32_t, void* data) {
  auto* bridge = static_cast<TilemBlackLinkBridge*>(data);
  {
    std::lock_guard<std::mutex> lock(bridge->receiveSignalMutex_);
    ++bridge->receiveSignalEpoch_;
  }
  bridge->receiveSignalCv_.notify_one();
  // This callback fires after TilEm fetches the routine's first instruction,
  // so it cannot safely pause the CPU: the packet receiver must reach its own
  // input loop before a host thread can assert a line. It is a readiness
  // notification only; SCSYNC's bounded poll loop observes the cable edge.
  return 0;
}

int TilemBlackLinkBridge::observeRuntimeExecution(TilemCalc* calc, uint32_t address, void* data) {
  auto* bridge = static_cast<TilemBlackLinkBridge*>(data);
  bridge->lastRuntimePc_.store(static_cast<uint16_t>(address));
  bridge->lastRuntimeOpcode_.store(calc->hw.z80_rdmem(calc, address));
  return 0;
}

void TilemBlackLinkBridge::publishCalculatorLines() {
  // `linkport.lines` is the calculator's own open-drain output. Do not use
  // BlackLink's effective-line getter here: it also includes the relay's
  // assertion, which would make the two independently-owned cable ends race.
  const uint8_t lows = static_cast<uint8_t>(calc_->linkport.lines & 0x03);
  if (calculatorLowMask_.exchange(lows) != lows) calculatorEvents_.fetch_add(1);
}

void TilemBlackLinkBridge::runLoop() {
  // Give the foreground side a scheduling turn to enter receiveStart() before
  // the TI runtime emits its first edge. This is only a host-thread barrier:
  // the emulated calculator still performs every cable transition itself.
  std::this_thread::sleep_for(std::chrono::milliseconds(100));
  uint8_t lastRelayMask = 0xff;
  while (running_.load()) {
    const uint8_t relayMask = static_cast<uint8_t>(relayLowMask_.load() & 0x03);
    if (relayMask != lastRelayMask) {
      tilem_linkport_blacklink_set_lines(calc_, relayMask);
      relayApplications_.fetch_add(1);
      lastAppliedRelayMask_.store(relayMask);
      lastExternalPort7Input_.store(static_cast<uint8_t>(calc_->hw.z80_in(calc_, 0x07) & 0x03));
      lastRelayMask = relayMask;
    }
    // Keep a receiving calculator's bounded, cycle-counted wait loops from
    // racing past a host transition that was just published by the other
    // native thread. BlackLink still stops immediately on calculator output.
    const dword reason = tilem_z80_run(calc_, 20, nullptr);
    publishCalculatorLines();
    if ((reason & (TILEM_STOP_INVALID_INST | TILEM_STOP_EXCEPTION)) != 0) {
      setError("TilEm stopped on an invalid instruction or hardware exception");
      running_.store(false);
      break;
    }
    if ((reason & TILEM_STOP_LINK_STATE) != 0) {
      // BlackLink deliberately stops TilEm at each electrical transition.
      // Give the counterpart host thread a scheduling turn before the next
      // calculator-side bounded edge wait.
      std::this_thread::sleep_for(std::chrono::microseconds(100));
      continue;
    }
    if ((reason & TILEM_STOP_BREAKPOINT) != 0) {
      std::this_thread::sleep_for(std::chrono::microseconds(100));
      continue;
    }
    if (reason == TILEM_STOP_TIMEOUT) {
      // Let the host act between a few Z80 instructions. This retains the
      // runtime's actual cycle-bounded polling while preserving every cable
      // high interval for the native relay thread.
      std::this_thread::sleep_for(std::chrono::microseconds(10));
    }
  }
}

void TilemBlackLinkBridge::setError(const char* text) {
  std::lock_guard<std::mutex> lock(errorMutex_);
  error_ = text == nullptr ? "unknown TilEm error" : text;
}

}  // namespace schoolcalc_tilem

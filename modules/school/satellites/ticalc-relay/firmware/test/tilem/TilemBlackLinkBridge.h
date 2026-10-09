#pragma once

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <mutex>
#include <string>
#include <thread>

struct _TilemCalc;
typedef struct _TilemCalc TilemCalc;

namespace schoolcalc_tilem {

static constexpr uint16_t TI86_EXECUTION_ADDRESS = 0xD748;

/**
 * A test-only open-drain cable between TilEm's TI-86 port 7 and the exact
 * GPIO contract used by TiLinkTransport. TilEm owns calculator execution on
 * one thread; the relay uses only the atomic line state exposed here.
 */
class TilemBlackLinkBridge final {
public:
  TilemBlackLinkBridge() = default;
  ~TilemBlackLinkBridge();

  TilemBlackLinkBridge(const TilemBlackLinkBridge&) = delete;
  TilemBlackLinkBridge& operator=(const TilemBlackLinkBridge&) = delete;

  bool boot(const char* romPath, std::string& error);
  bool exerciseKeyboard(std::string& error);
  bool restoreForegroundCheckpoint(const char* ramImagePath, const char* executionImagePath,
                                   const char* cpuContextPath, const char* programImagePath,
                                   std::string& error);
  bool start(std::string& error);
  void stop();

  bool tipLow() const;
  bool ringLow() const;
  void setRelayTipAsserted(bool asserted);
  void setRelayRingAsserted(bool asserted);
  // Test-only readiness observation: wait until SCSYNC has entered one of
  // its actual TI-packet receive routines before driving a host packet.
  bool waitForCalculatorReceiveSignal(uint32_t timeoutMs);
  uint32_t calculatorEvents() const { return calculatorEvents_.load(); }
  uint32_t relayEvents() const { return relayEvents_.load(); }
  uint32_t keyboardTransitions() const { return keyboardTransitions_.load(); }
  uint32_t port7Writes() const { return port7Writes_.load(); }
  const char* lastError() const;
  std::string diagnostic() const;

private:
  TilemCalc* calc_ = nullptr;
  std::atomic<bool> running_{false};
  std::thread* worker_ = nullptr;
  std::atomic<uint8_t> relayLowMask_{0};
  mutable std::mutex receiveSignalMutex_;
  std::condition_variable receiveSignalCv_;
  uint64_t receiveSignalEpoch_ = 0;
  uint64_t consumedReceiveSignalEpoch_ = 0;
  std::atomic<uint8_t> calculatorLowMask_{0};
  std::atomic<uint32_t> calculatorEvents_{0};
  std::atomic<uint32_t> relayEvents_{0};
  std::atomic<uint32_t> relayApplications_{0};
  std::atomic<uint8_t> lastAppliedRelayMask_{0};
  std::atomic<uint8_t> lastExternalPort7Input_{0};
  std::atomic<uint32_t> keyboardTransitions_{0};
  std::atomic<uint32_t> port7Writes_{0};
  std::atomic<uint32_t> foregroundRxWrites_{0};
  std::atomic<uint32_t> linkRxByteWrites_{0};
  std::atomic<uint8_t> lastLinkRxByte_{0};
  std::atomic<uint32_t> linkRxBitWrites_{0};
  std::atomic<uint32_t> linkRxOneBits_{0};
  std::atomic<uint8_t> lastRxBitExternalMask_{0};
  std::atomic<uint8_t> lastRxBitLocalMask_{0};
  std::atomic<uint8_t> lastRxBitPortInput_{0};
  std::atomic<uint32_t> port7LowWrites_{0};
  std::atomic<uint16_t> lastPort7WriterPc_{0};
  std::atomic<uint16_t> lastRuntimePc_{0};
  std::atomic<uint8_t> lastRuntimeOpcode_{0};
  int port7WriteBreakpoint_ = 0;
  bool foregroundCheckpointRestored_ = false;
  mutable std::mutex errorMutex_;
  std::string error_ = "none";

  void runLoop();
  void publishCalculatorLines();
  void setError(const char* text);
  static int observePort7Write(TilemCalc*, uint32_t, void* data);
  static int observeForegroundRxWrite(TilemCalc*, uint32_t, void* data);
  static int observeLinkRxByteWrite(TilemCalc*, uint32_t, void* data);
  static int observeLinkRxBitWrite(TilemCalc*, uint32_t, void* data);
  static int observeCalculatorReceiveSignal(TilemCalc*, uint32_t, void* data);
  static int observeRuntimeExecution(TilemCalc*, uint32_t, void* data);
};

}  // namespace schoolcalc_tilem

#pragma once

#include <atomic>
#include <cstdint>
#include <mutex>
#include <string>
#include <thread>

namespace schoolcalc_mame {

/**
 * Historical, unsupported diagnostic bridge for MAME's TI-8x `bitsock`
 * image. Stock MAME does not implement TI-86 port 7, so it is intentionally
 * not wired into an executable pass/fail test.
 * Each byte is MAME's documented raw event: bit 0 is the released/high line
 * state, bit 1 selects TIP, and bit 2 selects RING.
 */
class MameBitSocketBridge final {
public:
  explicit MameBitSocketBridge(std::string devicePath);
  ~MameBitSocketBridge();

  MameBitSocketBridge(const MameBitSocketBridge&) = delete;
  MameBitSocketBridge& operator=(const MameBitSocketBridge&) = delete;

  bool start(std::string& error);
  void stop();

  bool tipLow() const;
  bool ringLow() const;
  void setRelayTipAsserted(bool asserted);
  void setRelayRingAsserted(bool asserted);

  uint32_t calculatorEvents() const { return calculatorEvents_.load(); }
  uint32_t relayEvents() const { return relayEvents_.load(); }
  const std::string& lastError() const { return lastError_; }

private:
  std::string devicePath_;
  int fd_ = -1;
  std::thread reader_;
  std::atomic<bool> running_{false};
  std::atomic<bool> calculatorTipReleased_{true};
  std::atomic<bool> calculatorRingReleased_{true};
  std::atomic<bool> relayTipAsserted_{false};
  std::atomic<bool> relayRingAsserted_{false};
  std::atomic<bool> publishedTipReleased_{true};
  std::atomic<bool> publishedRingReleased_{true};
  std::atomic<uint32_t> calculatorEvents_{0};
  std::atomic<uint32_t> relayEvents_{0};
  std::atomic<bool> calculatorAttached_{false};
  std::mutex writeMutex_;
  std::string lastError_ = "none";

  void readLoop();
  void publishCombinedLevels();
  void writeEvent(bool tip, bool released);
};

}  // namespace schoolcalc_mame

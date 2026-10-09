#include "MameBitSocketBridge.h"

#include <cerrno>
#include <cstring>
#include <fcntl.h>
#include <poll.h>
#include <termios.h>
#include <unistd.h>

namespace schoolcalc_mame {

MameBitSocketBridge::MameBitSocketBridge(std::string devicePath)
  : devicePath_(std::move(devicePath)) {}

MameBitSocketBridge::~MameBitSocketBridge() { stop(); }

bool MameBitSocketBridge::start(std::string& error) {
  fd_ = open(devicePath_.c_str(), O_RDWR | O_NOCTTY | O_NONBLOCK);
  if (fd_ < 0) {
    error = "could not open MAME bitsock device: " + std::string(strerror(errno));
    lastError_ = error;
    return false;
  }
  termios attributes{};
  if (tcgetattr(fd_, &attributes) != 0) {
    error = "could not read MAME bitsock terminal mode: " + std::string(strerror(errno));
    lastError_ = error;
    close(fd_);
    fd_ = -1;
    return false;
  }
  cfmakeraw(&attributes);
  attributes.c_cflag |= CLOCAL | CREAD;
  if (tcsetattr(fd_, TCSANOW, &attributes) != 0) {
    error = "could not set MAME bitsock raw mode: " + std::string(strerror(errno));
    lastError_ = error;
    close(fd_);
    fd_ = -1;
    return false;
  }
  running_.store(true);
  reader_ = std::thread(&MameBitSocketBridge::readLoop, this);
  // MAME starts the external link state high/released. Publish that explicit
  // initial state before either peer sends its first packet edge.
  writeEvent(true, true);
  writeEvent(false, true);
  return true;
}

void MameBitSocketBridge::stop() {
  if (!running_.exchange(false)) return;
  if (reader_.joinable()) reader_.join();
  if (fd_ >= 0) close(fd_);
  fd_ = -1;
}

bool MameBitSocketBridge::tipLow() const {
  return !calculatorTipReleased_.load() || relayTipAsserted_.load();
}

bool MameBitSocketBridge::ringLow() const {
  return !calculatorRingReleased_.load() || relayRingAsserted_.load();
}

void MameBitSocketBridge::setRelayTipAsserted(bool asserted) {
  if (relayTipAsserted_.exchange(asserted) != asserted) {
    relayEvents_.fetch_add(1);
    publishCombinedLevels();
  }
}

void MameBitSocketBridge::setRelayRingAsserted(bool asserted) {
  if (relayRingAsserted_.exchange(asserted) != asserted) {
    relayEvents_.fetch_add(1);
    publishCombinedLevels();
  }
}

void MameBitSocketBridge::readLoop() {
  uint8_t idlePolls = 0;
  while (running_.load()) {
    pollfd descriptor{ fd_, POLLIN, 0 };
    const int ready = poll(&descriptor, 1, 20);
    if (ready < 0) {
      if (errno == EINTR) continue;
      lastError_ = "MAME bitsock poll failed: " + std::string(strerror(errno));
      return;
    }
    if (ready == 0 || !(descriptor.revents & POLLIN)) {
      // MAME opens its bitbanger after the relay. Its serial backend can
      // discard bytes queued before that open, leaving both virtual inputs
      // low forever. Reassert the released/open-drain idle state until MAME
      // has actually published a calculator-side line event.
      if (!calculatorAttached_.load() && ++idlePolls == 5) {
        idlePolls = 0;
        writeEvent(true, true);
        writeEvent(false, true);
      }
      continue;
    }
    idlePolls = 0;
    uint8_t bytes[256];
    const ssize_t count = read(fd_, bytes, sizeof(bytes));
    if (count < 0) {
      if (errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR) continue;
      lastError_ = "MAME bitsock read failed: " + std::string(strerror(errno));
      return;
    }
    if (count == 0) continue;
    for (ssize_t index = 0; index < count; ++index) {
      const uint8_t event = bytes[index];
      const bool released = (event & 0x01) != 0;
      bool changed = false;
      if (event & 0x02) {
        calculatorAttached_.store(true);
        changed = calculatorTipReleased_.exchange(released) != released || changed;
      }
      if (event & 0x04) {
        calculatorAttached_.store(true);
        changed = calculatorRingReleased_.exchange(released) != released || changed;
      }
      if (changed) {
        calculatorEvents_.fetch_add(1);
        publishCombinedLevels();
      }
    }
  }
}

void MameBitSocketBridge::publishCombinedLevels() {
  const bool tipReleased = !tipLow();
  const bool ringReleased = !ringLow();
  if (publishedTipReleased_.exchange(tipReleased) != tipReleased) writeEvent(true, tipReleased);
  if (publishedRingReleased_.exchange(ringReleased) != ringReleased) writeEvent(false, ringReleased);
}

void MameBitSocketBridge::writeEvent(bool tip, bool released) {
  if (fd_ < 0) return;
  const uint8_t event = static_cast<uint8_t>((released ? 0x01 : 0x00) | (tip ? 0x02 : 0x04));
  std::lock_guard<std::mutex> lock(writeMutex_);
  const ssize_t written = write(fd_, &event, 1);
  if (written != 1 && errno != EAGAIN && errno != EWOULDBLOCK) {
    lastError_ = "MAME bitsock write failed: " + std::string(strerror(errno));
  }
}

}  // namespace schoolcalc_mame

#include "SchoolCalcTiLinkAdapters.h"

namespace schoolcalc_relay {

VariableReadStatus TiCalculatorVariables::read(const char* name, MutableBytes& output) {
  const uint32_t startedMs = millis();
  output.length = 0;
  bool found = false;
  uint16_t length = 0;
  if (!transport_.readStringVariable(name, output.bytes, output.capacity, length, found)) {
    if (transport_.lastError() == TiLinkTransport::Error::BufferTooSmall) {
      if (observer_ != nullptr) observer_->onCalculatorIo(
        "read", name, false, 0, millis() - startedMs, transport_.lastErrorText());
      return VariableReadStatus::TooLarge;
    }
    if (observer_ != nullptr) observer_->onCalculatorIo(
      "read", name, false, 0, millis() - startedMs, transport_.lastErrorText());
    return VariableReadStatus::Failed;
  }
  if (!found) {
    if (observer_ != nullptr) observer_->onCalculatorIo(
      "read", name, true, 0, millis() - startedMs, "missing");
    return VariableReadStatus::Missing;
  }
  output.length = length;
  if (observer_ != nullptr) observer_->onCalculatorIo(
    "read", name, true, length, millis() - startedMs, "found");
  return VariableReadStatus::Found;
}

bool TiCalculatorVariables::write(const char* name, ByteView payload) {
  const uint32_t startedMs = millis();
  const bool ok = transport_.writeStringVariable(name, payload.bytes, payload.length);
  if (observer_ != nullptr) observer_->onCalculatorIo(
    "write", name, ok, payload.length, millis() - startedMs,
    ok ? "stored" : transport_.lastErrorText());
  return ok;
}

const char* TiCalculatorVariables::lastError() const { return transport_.lastErrorText(); }

bool TiForegroundFrameChannel::send(const uint8_t* frame, uint16_t length) {
  const uint32_t startedMs = millis();
  const bool ok = transport_.sendForegroundFrame(frame, length);
  if (observer_ != nullptr) observer_->onForegroundFrame(
    true, ok, length, millis() - startedMs,
    ok ? "sent" : transport_.lastErrorText());
  return ok;
}

ForegroundChannelStatus TiForegroundFrameChannel::receive(uint8_t* output,
                                                           uint16_t capacity,
                                                           uint16_t& length) {
  const uint32_t startedMs = millis();
  if (transport_.receiveForegroundFrame(output, capacity, length)) {
    if (observer_ != nullptr) observer_->onForegroundFrame(
      false, true, length, millis() - startedMs, "received");
    return ForegroundChannelStatus::Ok;
  }
  if (observer_ != nullptr) observer_->onForegroundFrame(
    false, false, 0, millis() - startedMs, transport_.lastErrorText());
  return transport_.lastError() == TiLinkTransport::Error::EdgeTimeout
    ? ForegroundChannelStatus::Timeout : ForegroundChannelStatus::Failed;
}

void TiForegroundFrameChannel::release() { transport_.release(); }

const char* TiForegroundFrameChannel::lastError() const {
  return transport_.lastErrorText();
}

}  // namespace schoolcalc_relay

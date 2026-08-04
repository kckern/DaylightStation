#pragma once

#include <Arduino.h>

#include "SchoolCalcForegroundSession.h"
#include "SchoolCalcRelaySession.h"
#include "TiLinkTransport.h"

namespace schoolcalc_relay {

/** Payload-free operational telemetry emitted by concrete relay adapters. */
class IRelayIoObserver {
public:
  virtual ~IRelayIoObserver() = default;
  virtual void onCalculatorIo(const char* operation, const char* resource,
                              bool ok, uint32_t bytes, uint32_t durationMs,
                              const char* detail) = 0;
  virtual void onForegroundFrame(bool outbound, bool ok, uint16_t bytes,
                                 uint32_t durationMs, const char* detail) = 0;
  virtual void onHttpIo(const char* operation, bool ok, int status,
                        uint32_t requestBytes, uint32_t responseBytes,
                        uint32_t durationMs, const char* detail) = 0;
};

/** Narrow adapter from the session's variable port to TI-86 String transfers. */
class TiCalculatorVariables final : public ICalculatorVariables {
public:
  explicit TiCalculatorVariables(TiLinkTransport& transport,
                                 IRelayIoObserver* observer = nullptr)
    : transport_(transport), observer_(observer) {}

  VariableReadStatus read(const char* name, MutableBytes& output) override;
  bool write(const char* name, ByteView payload) override;
  const char* lastError() const override;
  void setObserver(IRelayIoObserver* observer) { observer_ = observer; }

private:
  TiLinkTransport& transport_;
  IRelayIoObserver* observer_;
};

/** TI DATA-packet binding for the pure SCF1 foreground session adapter. */
class TiForegroundFrameChannel final : public IForegroundFrameChannel {
public:
  explicit TiForegroundFrameChannel(TiLinkTransport& transport,
                                    IRelayIoObserver* observer = nullptr)
    : transport_(transport), observer_(observer) {}

  bool send(const uint8_t* frame, uint16_t length) override;
  ForegroundChannelStatus receive(uint8_t* output, uint16_t capacity,
                                  uint16_t& length) override;
  void release() override;
  const char* lastError() const override;
  void setObserver(IRelayIoObserver* observer) { observer_ = observer; }

private:
  TiLinkTransport& transport_;
  IRelayIoObserver* observer_;
};

}  // namespace schoolcalc_relay

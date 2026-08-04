#pragma once

#include <stddef.h>
#include <stdint.h>

#include "SchoolCalcForegroundWire.h"
#include "SchoolCalcInput.h"
#include "SchoolCalcRelaySession.h"

namespace schoolcalc_relay {

enum class ForegroundChannelStatus : uint8_t {
  Ok,
  Timeout,
  Disconnected,
  Failed,
};

/**
 * Carries exactly one encoded SCF1 frame inside one calculator-link DATA
 * packet. Packet checksums/retries belong below this boundary; SCF1 state,
 * offsets, and whole-record integrity belong above it.
 */
class IForegroundFrameChannel {
public:
  virtual ~IForegroundFrameChannel() = default;
  virtual bool send(const uint8_t* frame, uint16_t length) = 0;
  virtual ForegroundChannelStatus receive(uint8_t* output, uint16_t capacity,
                                          uint16_t& length) = 0;
  virtual void release() = 0;
  virtual const char* lastError() const = 0;
};

enum class ForegroundSessionState : uint8_t {
  AwaitingHello,
  Active,
  Complete,
  Failed,
};

enum class ForegroundSessionError : uint8_t {
  None,
  Channel,
  NotActive,
  Decode,
  UnexpectedFrame,
  InvalidSequence,
  InvalidPayload,
  InvalidName,
  NameMismatch,
  TooLarge,
  InvalidOffset,
  RecordChecksum,
  PeerError,
  Cancelled,
  SequenceExhausted,
};

/**
 * Foreground SCF1 implementation of the same variable-oriented port used by
 * Silent Link. One monotonically increasing sequence identifies each logical
 * operation; every request, response, chunk, and ACK belonging to that
 * operation echoes that sequence. A sequence is never reused for another
 * operation in the same accepted session.
 */
class ForegroundCalculatorVariables final : public ICalculatorVariables,
                                            public ISchoolCalcSessionObserver {
public:
  explicit ForegroundCalculatorVariables(
    IForegroundFrameChannel& channel,
    uint16_t preferredChunkBytes = schoolcalc_foreground::DEFAULT_CHUNK_BYTES,
    ISchoolCalcSessionObserver* downstreamObserver = nullptr);

  bool accept();
  // Deliver one canonical input event to a foreground SchoolCalc peer. The
  // caller owns queue removal and may remove the event only after true.
  bool sendInput(const schoolcalc_input::InputEvent& event);
  // Challenge-response liveness probe. Success proves that the calculator
  // foreground loop decoded this exact challenge and returned it intact.
  bool heartbeat(uint32_t token, uint32_t senderUptimeMs);
  bool finish(schoolcalc_foreground::CompleteCode outcome);
  bool cancel();

  VariableReadStatus read(const char* name, MutableBytes& output) override;
  bool write(const char* name, ByteView payload) override;
  const char* lastError() const override { return errorText_; }

  void onSessionProgress(SessionState state, SessionDirection direction,
                         uint8_t itemsCompleted, uint8_t itemsTotal) override;
  bool healthy() const override { return awarenessHealthy_; }
  const char* observerError() const override { return errorText_; }
  bool serviceNetworkWait(uint32_t elapsedMs) override;

  ForegroundSessionState state() const { return state_; }
  ForegroundSessionError error() const { return error_; }
  uint16_t negotiatedChunkBytes() const { return negotiatedChunkBytes_; }
  uint16_t selectedCapabilities() const { return selectedCapabilities_; }
  bool awarenessHealthy() const { return awarenessHealthy_; }
  const uint8_t* sessionNonce() const { return sessionNonce_; }

private:
  IForegroundFrameChannel& channel_;
  ISchoolCalcSessionObserver* downstreamObserver_;
  uint16_t preferredChunkBytes_;
  uint16_t negotiatedChunkBytes_ = 0;
  uint16_t selectedCapabilities_ = 0;
  uint16_t nextSequence_ = 1;
  uint8_t sessionNonce_[schoolcalc_foreground::SESSION_NONCE_BYTES]{};
  ForegroundSessionState state_ = ForegroundSessionState::AwaitingHello;
  ForegroundSessionError error_ = ForegroundSessionError::None;
  bool awarenessHealthy_ = true;
  char errorText_[128] = "none";
  uint8_t txFrame_[schoolcalc_foreground::MAX_FRAME_BYTES]{};
  uint8_t rxFrame_[schoolcalc_foreground::MAX_FRAME_BYTES]{};
  uint8_t payload_[schoolcalc_foreground::MAX_PAYLOAD_BYTES]{};

  bool beginOperation(uint16_t& sequence);
  bool sendFrame(schoolcalc_foreground::FrameType type, uint16_t sequence,
                 const uint8_t* payload, uint16_t payloadLength);
  bool receiveFrame(schoolcalc_foreground::FrameView& frame);
  bool receiveExpected(schoolcalc_foreground::FrameType type, uint16_t sequence,
                       schoolcalc_foreground::FrameView& frame);
  bool sendAck(uint16_t sequence, schoolcalc_foreground::FrameType type,
               uint16_t nextOffset);
  bool receiveAck(uint16_t sequence, schoolcalc_foreground::FrameType type,
                  uint16_t nextOffset);
  bool publishPhase(SessionState state, SessionDirection direction,
                    uint8_t itemsCompleted, uint8_t itemsTotal);
  bool rejectOperation(ForegroundSessionError error, const char* detail);
  bool fail(ForegroundSessionError error, const char* detail, bool release = true);
  bool failProtocol(ForegroundSessionError error,
                    schoolcalc_foreground::ErrorCode peerCode,
                    schoolcalc_foreground::FrameType offendingType,
                    uint16_t sequence, uint16_t expectedOffset,
                    const char* detail);
};

const char* foregroundSessionErrorText(ForegroundSessionError error);

}  // namespace schoolcalc_relay

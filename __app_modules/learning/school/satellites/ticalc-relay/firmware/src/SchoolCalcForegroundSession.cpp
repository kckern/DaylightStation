#include "SchoolCalcForegroundSession.h"

#include "SchoolCalcWire.h"

#include <stdio.h>
#include <string.h>

namespace schoolcalc_relay {

using namespace schoolcalc_foreground;

static bool mapPhase(SessionState state, PhaseCode& output) {
  switch (state) {
    case SessionState::ReadingIdentity: output = PhaseCode::ReadingIdentity; return true;
    case SessionState::Identifying: output = PhaseCode::Identifying; return true;
    case SessionState::ReadingInputs: output = PhaseCode::ReadingInputs; return true;
    case SessionState::Synchronizing: output = PhaseCode::Synchronizing; return true;
    case SessionState::StagingProfiles: output = PhaseCode::StagingProfiles; return true;
    case SessionState::StagingProgress: output = PhaseCode::StagingProgress; return true;
    case SessionState::StagingInteraction: output = PhaseCode::StagingInteraction; return true;
    case SessionState::StagingStudyArtifact: output = PhaseCode::StagingArtifacts; return true;
    case SessionState::StagingStudyPrescription: output = PhaseCode::StagingAcknowledgements; return true;
    case SessionState::StagingCatalog: output = PhaseCode::StagingCatalog; return true;
    case SessionState::StagingArtifacts: output = PhaseCode::StagingArtifacts; return true;
    case SessionState::StagingAcknowledgements:
      output = PhaseCode::StagingAcknowledgements; return true;
    case SessionState::PublishingManifest: output = PhaseCode::PublishingManifest; return true;
    case SessionState::AwaitingCalculatorCommit:
      output = PhaseCode::AwaitingCalculatorCommit; return true;
    case SessionState::Failed: output = PhaseCode::Failed; return true;
    case SessionState::Idle: return false;
  }
  return false;
}

static DirectionCode mapDirection(SessionDirection direction) {
  switch (direction) {
    case SessionDirection::Idle: return DirectionCode::Idle;
    case SessionDirection::Negotiating: return DirectionCode::Negotiating;
    case SessionDirection::CalculatorToRelay: return DirectionCode::CalculatorToRelay;
    case SessionDirection::Network: return DirectionCode::Network;
    case SessionDirection::RelayToCalculator: return DirectionCode::RelayToCalculator;
  }
  return DirectionCode::Idle;
}

static ErrorCode helloErrorCode(DecodeStatus status) {
  switch (status) {
    case DecodeStatus::UnsupportedVersion: return ErrorCode::UnsupportedProtocol;
    case DecodeStatus::UnsupportedPlatform: return ErrorCode::UnsupportedPlatform;
    case DecodeStatus::UnsupportedCapabilities: return ErrorCode::UnsupportedCapabilities;
    default: return ErrorCode::InvalidPayload;
  }
}

ForegroundCalculatorVariables::ForegroundCalculatorVariables(
  IForegroundFrameChannel& channel, uint16_t preferredChunkBytes,
  ISchoolCalcSessionObserver* downstreamObserver)
  : channel_(channel), downstreamObserver_(downstreamObserver),
    preferredChunkBytes_(preferredChunkBytes == 0
        || preferredChunkBytes > MAX_CHUNK_DATA_BYTES
      ? DEFAULT_CHUNK_BYTES : preferredChunkBytes) {}

bool ForegroundCalculatorVariables::accept() {
  state_ = ForegroundSessionState::AwaitingHello;
  error_ = ForegroundSessionError::None;
  awarenessHealthy_ = true;
  negotiatedChunkBytes_ = 0;
  selectedCapabilities_ = 0;
  nextSequence_ = 1;
  memset(sessionNonce_, 0, sizeof(sessionNonce_));
  snprintf(errorText_, sizeof(errorText_), "none");

  FrameView frame{};
  if (!receiveFrame(frame)) return false;
  if (frame.type != FrameType::Hello) {
    return failProtocol(ForegroundSessionError::UnexpectedFrame,
                        ErrorCode::UnexpectedFrame, frame.type, frame.sequence, 0,
                        "expected foreground HELLO");
  }
  if (frame.sequence != 0) {
    return failProtocol(ForegroundSessionError::InvalidSequence,
                        ErrorCode::InvalidSequence, frame.type, frame.sequence, 0,
                        "foreground HELLO must use operation sequence zero");
  }
  HelloPayload hello{};
  const DecodeStatus status = decodeHelloPayload(frame.payload, frame.payloadLength, hello);
  if (status != DecodeStatus::Ok) {
    return failProtocol(ForegroundSessionError::InvalidPayload,
                        helloErrorCode(status), frame.type, frame.sequence, 0,
                        decodeStatusText(status));
  }

  selectedCapabilities_ = hello.capabilities
    & (REQUIRED_SYNC_CAPABILITIES | CapabilityKeyInput | CapabilityHeartbeat);
  negotiatedChunkBytes_ = hello.maxChunkBytes < preferredChunkBytes_
    ? hello.maxChunkBytes : preferredChunkBytes_;
  memcpy(sessionNonce_, hello.nonce, sizeof(sessionNonce_));

  HelloPayload acknowledgement{};
  acknowledgement.version = PROTOCOL_VERSION;
  acknowledgement.platform = PLATFORM_TI86;
  acknowledgement.capabilities = selectedCapabilities_;
  acknowledgement.maxChunkBytes = negotiatedChunkBytes_;
  memcpy(acknowledgement.nonce, sessionNonce_, sizeof(sessionNonce_));
  uint8_t helloBytes[HELLO_PAYLOAD_BYTES];
  if (encodeHelloPayload(acknowledgement, helloBytes) != DecodeStatus::Ok
      || !sendFrame(FrameType::HelloAck, frame.sequence,
                    helloBytes, sizeof(helloBytes))) return false;
  state_ = ForegroundSessionState::Active;
  return true;
}

bool ForegroundCalculatorVariables::beginOperation(uint16_t& sequence) {
  if (state_ != ForegroundSessionState::Active) {
    return fail(ForegroundSessionError::NotActive,
                "foreground variable session is not active", false);
  }
  if (nextSequence_ == 0 || nextSequence_ == 0xFFFF) {
    return failProtocol(ForegroundSessionError::SequenceExhausted,
                        ErrorCode::SequenceExhausted, FrameType::Error,
                        nextSequence_, 0,
                        "foreground operation sequence space was exhausted");
  }
  sequence = nextSequence_++;
  return true;
}

bool ForegroundCalculatorVariables::sendFrame(FrameType type, uint16_t sequence,
                                              const uint8_t* payload,
                                              uint16_t payloadLength) {
  size_t encodedLength = 0;
  const DecodeStatus status = encodeFrame(type, sequence, payload, payloadLength,
                                          txFrame_, sizeof(txFrame_), encodedLength);
  if (status != DecodeStatus::Ok) {
    return fail(ForegroundSessionError::Decode, decodeStatusText(status));
  }
  if (!channel_.send(txFrame_, static_cast<uint16_t>(encodedLength))) {
    return fail(ForegroundSessionError::Channel, channel_.lastError());
  }
  return true;
}

bool ForegroundCalculatorVariables::receiveFrame(FrameView& frame) {
  uint16_t length = 0;
  const ForegroundChannelStatus channelStatus =
    channel_.receive(rxFrame_, sizeof(rxFrame_), length);
  if (channelStatus != ForegroundChannelStatus::Ok) {
    return fail(ForegroundSessionError::Channel, channel_.lastError());
  }
  const DecodeStatus status = decodeFrame(rxFrame_, length, frame);
  if (status != DecodeStatus::Ok) {
    return fail(ForegroundSessionError::Decode, decodeStatusText(status));
  }
  return true;
}

bool ForegroundCalculatorVariables::receiveExpected(FrameType type, uint16_t sequence,
                                                    FrameView& frame) {
  if (!receiveFrame(frame)) return false;
  if (frame.type == FrameType::Cancel) {
    if (frame.payloadLength != 0) {
      return failProtocol(ForegroundSessionError::InvalidPayload,
                          ErrorCode::InvalidPayload, frame.type, sequence, 0,
                          "foreground CANCEL payload must be empty");
    }
    return fail(ForegroundSessionError::Cancelled,
                "calculator cancelled the foreground session");
  }
  if (frame.type == FrameType::Error) {
    ErrorPayload peerError{};
    if (decodeErrorPayload(frame.payload, frame.payloadLength, peerError)
        != DecodeStatus::Ok) {
      return fail(ForegroundSessionError::InvalidPayload,
                  "calculator sent an invalid foreground ERROR payload");
    }
    snprintf(errorText_, sizeof(errorText_),
             "calculator reported foreground error %u for %s at offset %u",
             static_cast<unsigned>(peerError.code), frameTypeText(peerError.offendingType),
             static_cast<unsigned>(peerError.expectedOffset));
    error_ = ForegroundSessionError::PeerError;
    state_ = ForegroundSessionState::Failed;
    channel_.release();
    return false;
  }
  if (frame.sequence != sequence) {
    return failProtocol(ForegroundSessionError::InvalidSequence,
                        ErrorCode::InvalidSequence, frame.type, sequence, 0,
                        "foreground response sequence does not match its operation");
  }
  if (frame.type != type) {
    return failProtocol(ForegroundSessionError::UnexpectedFrame,
                        ErrorCode::UnexpectedFrame, frame.type, sequence, 0,
                        "unexpected foreground response frame");
  }
  return true;
}

bool ForegroundCalculatorVariables::sendAck(uint16_t sequence, FrameType type,
                                            uint16_t nextOffset) {
  uint8_t bytes[ACK_PAYLOAD_BYTES];
  AckPayload acknowledgement{};
  acknowledgement.acknowledgedType = type;
  acknowledgement.nextOffset = nextOffset;
  encodeAckPayload(acknowledgement, bytes);
  return sendFrame(FrameType::Ack, sequence, bytes, sizeof(bytes));
}

bool ForegroundCalculatorVariables::receiveAck(uint16_t sequence, FrameType type,
                                               uint16_t nextOffset) {
  FrameView frame{};
  if (!receiveExpected(FrameType::Ack, sequence, frame)) return false;
  AckPayload acknowledgement{};
  if (decodeAckPayload(frame.payload, frame.payloadLength, acknowledgement)
      != DecodeStatus::Ok) {
    return failProtocol(ForegroundSessionError::InvalidPayload,
                        ErrorCode::InvalidPayload, frame.type, sequence, nextOffset,
                        "invalid foreground ACK payload");
  }
  if (acknowledgement.acknowledgedType != type
      || acknowledgement.nextOffset != nextOffset) {
    return failProtocol(ForegroundSessionError::InvalidOffset,
                        ErrorCode::InvalidOffset, frame.type, sequence, nextOffset,
                        "foreground ACK does not confirm the expected frame and offset");
  }
  return true;
}

VariableReadStatus ForegroundCalculatorVariables::read(const char* name,
                                                       MutableBytes& output) {
  output.length = 0;
  if (!validVariableName(name)) {
    fail(ForegroundSessionError::InvalidName, "invalid foreground variable name");
    return VariableReadStatus::Failed;
  }
  if (output.bytes == nullptr && output.capacity != 0) {
    fail(ForegroundSessionError::InvalidPayload, "foreground read buffer is null");
    return VariableReadStatus::Failed;
  }
  uint16_t sequence = 0;
  if (!beginOperation(sequence)) return VariableReadStatus::Failed;
  uint16_t nameLength = 0;
  if (encodeVariableNamePayload(name, payload_, sizeof(payload_), nameLength)
        != DecodeStatus::Ok
      || !sendFrame(FrameType::ReadRequest, sequence, payload_, nameLength)) {
    return VariableReadStatus::Failed;
  }

  FrameView frame{};
  if (!receiveFrame(frame)) return VariableReadStatus::Failed;
  if (frame.sequence != sequence) {
    failProtocol(ForegroundSessionError::InvalidSequence, ErrorCode::InvalidSequence,
                 frame.type, sequence, 0,
                 "foreground read response sequence does not match its operation");
    return VariableReadStatus::Failed;
  }
  if (frame.type == FrameType::VariableMissing) {
    VariableName missing{};
    if (decodeVariableNamePayload(frame.payload, frame.payloadLength, missing)
          != DecodeStatus::Ok
        || strcmp(missing.value, name) != 0) {
      failProtocol(ForegroundSessionError::NameMismatch, ErrorCode::InvalidName,
                   frame.type, sequence, 0,
                   "foreground missing-variable response names another variable");
      return VariableReadStatus::Failed;
    }
    if (!sendAck(sequence, FrameType::VariableMissing, 0)) {
      return VariableReadStatus::Failed;
    }
    return VariableReadStatus::Missing;
  }
  if (frame.type == FrameType::Error || frame.type == FrameType::Cancel) {
    // Re-run the common terminal decoder without receiving another frame.
    if (frame.type == FrameType::Cancel) {
      fail(ForegroundSessionError::Cancelled,
           "calculator cancelled the foreground variable read");
    } else {
      ErrorPayload peerError{};
      if (decodeErrorPayload(frame.payload, frame.payloadLength, peerError)
          == DecodeStatus::Ok) {
        snprintf(errorText_, sizeof(errorText_),
                 "calculator reported foreground error %u during read",
                 static_cast<unsigned>(peerError.code));
        error_ = ForegroundSessionError::PeerError;
        state_ = ForegroundSessionState::Failed;
        channel_.release();
      } else {
        fail(ForegroundSessionError::InvalidPayload,
             "calculator sent an invalid foreground ERROR payload");
      }
    }
    return VariableReadStatus::Failed;
  }
  if (frame.type != FrameType::VariableBegin) {
    failProtocol(ForegroundSessionError::UnexpectedFrame, ErrorCode::UnexpectedFrame,
                 frame.type, sequence, 0,
                 "foreground read expected VARIABLE_BEGIN or VARIABLE_MISSING");
    return VariableReadStatus::Failed;
  }

  VariableDescriptor descriptor{};
  if (decodeVariableDescriptorPayload(frame.payload, frame.payloadLength, descriptor)
      != DecodeStatus::Ok) {
    failProtocol(ForegroundSessionError::InvalidPayload, ErrorCode::InvalidPayload,
                 frame.type, sequence, 0,
                 "foreground VARIABLE_BEGIN descriptor is invalid");
    return VariableReadStatus::Failed;
  }
  if (strcmp(descriptor.name.value, name) != 0) {
    failProtocol(ForegroundSessionError::NameMismatch, ErrorCode::InvalidName,
                 frame.type, sequence, 0,
                 "foreground VARIABLE_BEGIN names another variable");
    return VariableReadStatus::Failed;
  }
  if (descriptor.totalLength > output.capacity) {
    failProtocol(ForegroundSessionError::TooLarge, ErrorCode::TooLarge,
                 frame.type, sequence, output.capacity,
                 "foreground variable exceeds its relay buffer");
    return VariableReadStatus::TooLarge;
  }
  if (!sendAck(sequence, FrameType::VariableBegin, 0)) {
    return VariableReadStatus::Failed;
  }

  for (;;) {
    if (!receiveFrame(frame)) return VariableReadStatus::Failed;
    if (frame.sequence != sequence) {
      failProtocol(ForegroundSessionError::InvalidSequence, ErrorCode::InvalidSequence,
                   frame.type, sequence, output.length,
                   "foreground variable chunk sequence changed mid-operation");
      return VariableReadStatus::Failed;
    }
    if (frame.type == FrameType::VariableChunk) {
      ChunkView chunk{};
      if (decodeChunkPayload(frame.payload, frame.payloadLength, chunk)
            != DecodeStatus::Ok
          || chunk.length > negotiatedChunkBytes_) {
        failProtocol(ForegroundSessionError::InvalidPayload, ErrorCode::InvalidPayload,
                     frame.type, sequence, output.length,
                     "foreground VARIABLE_CHUNK payload is invalid");
        return VariableReadStatus::Failed;
      }
      if (chunk.offset != output.length
          || static_cast<uint32_t>(output.length) + chunk.length > descriptor.totalLength) {
        failProtocol(ForegroundSessionError::InvalidOffset, ErrorCode::InvalidOffset,
                     frame.type, sequence, output.length,
                     "foreground VARIABLE_CHUNK is not the next contiguous range");
        return VariableReadStatus::Failed;
      }
      memcpy(output.bytes + output.length, chunk.bytes, chunk.length);
      output.length = static_cast<uint16_t>(output.length + chunk.length);
      if (!sendAck(sequence, FrameType::VariableChunk, output.length)) {
        return VariableReadStatus::Failed;
      }
      continue;
    }
    if (frame.type != FrameType::VariableEnd) {
      failProtocol(ForegroundSessionError::UnexpectedFrame, ErrorCode::UnexpectedFrame,
                   frame.type, sequence, output.length,
                   "foreground variable read expected VARIABLE_CHUNK or VARIABLE_END");
      return VariableReadStatus::Failed;
    }
    TransferEndPayload end{};
    if (decodeTransferEndPayload(frame.payload, frame.payloadLength, end)
          != DecodeStatus::Ok
        || end.totalLength != descriptor.totalLength
        || end.recordCrc != descriptor.recordCrc
        || output.length != descriptor.totalLength) {
      failProtocol(ForegroundSessionError::InvalidPayload, ErrorCode::InvalidPayload,
                   frame.type, sequence, output.length,
                   "foreground VARIABLE_END does not match VARIABLE_BEGIN");
      return VariableReadStatus::Failed;
    }
    if (schoolcalc_wire::crc16Ccitt(output.bytes, output.length) != descriptor.recordCrc) {
      failProtocol(ForegroundSessionError::RecordChecksum, ErrorCode::RecordChecksum,
                   frame.type, sequence, output.length,
                   "foreground variable whole-record CRC failed");
      return VariableReadStatus::Failed;
    }
    if (!sendAck(sequence, FrameType::VariableEnd, output.length)) {
      return VariableReadStatus::Failed;
    }
    return VariableReadStatus::Found;
  }
}

bool ForegroundCalculatorVariables::write(const char* name, ByteView record) {
  if (!validVariableName(name)) {
    return fail(ForegroundSessionError::InvalidName,
                "invalid foreground variable name");
  }
  if (record.length > 0 && record.bytes == nullptr) {
    return fail(ForegroundSessionError::InvalidPayload,
                "foreground write payload is null");
  }
  uint16_t sequence = 0;
  if (!beginOperation(sequence)) return false;
  const uint16_t recordCrc = schoolcalc_wire::crc16Ccitt(record.bytes, record.length);
  uint16_t descriptorLength = 0;
  if (encodeVariableDescriptorPayload(name, record.length, recordCrc,
                                      payload_, sizeof(payload_), descriptorLength)
        != DecodeStatus::Ok
      || !sendFrame(FrameType::WriteBegin, sequence, payload_, descriptorLength)) {
    return false;
  }
  FrameView frame{};
  if (!receiveExpected(FrameType::WriteReady, sequence, frame)) return false;
  TransferEndPayload ready{};
  if (decodeTransferEndPayload(frame.payload, frame.payloadLength, ready)
        != DecodeStatus::Ok
      || ready.totalLength != record.length || ready.recordCrc != recordCrc) {
    return failProtocol(ForegroundSessionError::InvalidPayload, ErrorCode::InvalidPayload,
                        frame.type, sequence, 0,
                        "foreground WRITE_READY does not echo the transfer descriptor");
  }

  uint16_t offset = 0;
  while (offset < record.length) {
    const uint16_t remaining = static_cast<uint16_t>(record.length - offset);
    const uint16_t chunkLength = remaining < negotiatedChunkBytes_
      ? remaining : negotiatedChunkBytes_;
    uint16_t payloadLength = 0;
    if (encodeChunkPayload(offset, record.bytes + offset, chunkLength,
                           payload_, sizeof(payload_), payloadLength)
          != DecodeStatus::Ok
        || !sendFrame(FrameType::WriteChunk, sequence, payload_, payloadLength)) {
      return false;
    }
    offset = static_cast<uint16_t>(offset + chunkLength);
    if (!receiveAck(sequence, FrameType::WriteChunk, offset)) return false;
  }

  TransferEndPayload end{};
  end.totalLength = record.length;
  end.recordCrc = recordCrc;
  uint8_t endBytes[TRANSFER_END_PAYLOAD_BYTES];
  encodeTransferEndPayload(end, endBytes);
  if (!sendFrame(FrameType::WriteEnd, sequence, endBytes, sizeof(endBytes))
      || !receiveExpected(FrameType::VariableStored, sequence, frame)) return false;
  TransferEndPayload stored{};
  if (decodeTransferEndPayload(frame.payload, frame.payloadLength, stored)
        != DecodeStatus::Ok
      || stored.totalLength != record.length || stored.recordCrc != recordCrc) {
    return failProtocol(ForegroundSessionError::InvalidPayload, ErrorCode::InvalidPayload,
                        frame.type, sequence, record.length,
                        "foreground VARIABLE_STORED does not confirm the complete record");
  }
  return true;
}

bool ForegroundCalculatorVariables::publishPhase(SessionState state,
                                                 SessionDirection direction,
                                                 uint8_t itemsCompleted,
                                                 uint8_t itemsTotal) {
  PhaseCode phaseCode = PhaseCode::Failed;
  if (!mapPhase(state, phaseCode)) return true;
  uint16_t sequence = 0;
  if (!beginOperation(sequence)) return false;
  const bool safe = state == SessionState::AwaitingCalculatorCommit
    || state == SessionState::Failed;
  PhasePayload phase{};
  phase.phase = phaseCode;
  phase.direction = mapDirection(direction);
  phase.itemsCompleted = itemsCompleted;
  phase.itemsTotal = itemsTotal;
  phase.safeToUnplug = safe;
  uint8_t phaseBytes[PHASE_PAYLOAD_BYTES];
  encodePhasePayload(phase, phaseBytes);
  return sendFrame(FrameType::Phase, sequence, phaseBytes, sizeof(phaseBytes))
    && receiveAck(sequence, FrameType::Phase, 0);
}

bool ForegroundCalculatorVariables::sendInput(
  const schoolcalc_input::InputEvent& event) {
  if ((selectedCapabilities_ & CapabilityKeyInput) == 0) {
    return rejectOperation(ForegroundSessionError::InvalidPayload,
                           "foreground calculator did not negotiate key input");
  }
  uint16_t sequence = 0;
  if (!beginOperation(sequence)) return false;
  KeyInputPayload payload{};
  payload.mappingVersion = schoolcalc_input::INPUT_MAPPING_VERSION;
  payload.inputType = static_cast<uint8_t>(event.input.type);
  payload.value = event.input.value;
  payload.flags = event.input.flags;
  payload.eventSequence = event.sequence;
  uint8_t bytes[KEY_INPUT_PAYLOAD_BYTES];
  if (encodeKeyInputPayload(payload, bytes) != DecodeStatus::Ok) {
    return rejectOperation(ForegroundSessionError::InvalidPayload,
                           "foreground key input event is invalid");
  }
  return sendFrame(FrameType::KeyInput, sequence, bytes, sizeof(bytes))
    && receiveAck(sequence, FrameType::KeyInput, 0);
}

bool ForegroundCalculatorVariables::heartbeat(uint32_t token,
                                              uint32_t senderUptimeMs) {
  if ((selectedCapabilities_ & CapabilityHeartbeat) == 0) {
    return rejectOperation(ForegroundSessionError::InvalidPayload,
                           "foreground calculator did not negotiate heartbeat");
  }
  HeartbeatPayload challenge{ token, senderUptimeMs };
  uint8_t bytes[HEARTBEAT_PAYLOAD_BYTES];
  if (encodeHeartbeatPayload(challenge, bytes) != DecodeStatus::Ok) {
    return rejectOperation(ForegroundSessionError::InvalidPayload,
                           "foreground heartbeat challenge is invalid");
  }
  uint16_t sequence = 0;
  if (!beginOperation(sequence)) return false;
  if (!sendFrame(FrameType::Ping, sequence, bytes, sizeof(bytes))) {
    return false;
  }
  FrameView frame{};
  if (!receiveExpected(FrameType::Pong, sequence, frame)) return false;
  HeartbeatPayload response{};
  if (decodeHeartbeatPayload(frame.payload, frame.payloadLength, response)
        != DecodeStatus::Ok
      || response.token != challenge.token
      || response.senderUptimeMs != challenge.senderUptimeMs) {
    return failProtocol(ForegroundSessionError::InvalidPayload,
                        ErrorCode::InvalidPayload, frame.type, sequence, 0,
                        "foreground PONG does not echo the PING challenge");
  }
  return true;
}

bool ForegroundCalculatorVariables::serviceNetworkWait(uint32_t elapsedMs) {
  if (state_ != ForegroundSessionState::Active || !awarenessHealthy_) return false;
  // Correlation-only challenge. The session nonce already guards this SCF1
  // channel; elapsed time and the next operation sequence keep consecutive
  // liveness probes distinct without pretending to be cryptographic entropy.
  const uint32_t token = 0x53434842UL ^ elapsedMs ^ nextSequence_;
  const bool ok = heartbeat(token, elapsedMs);
  if (!ok) awarenessHealthy_ = false;
  return ok;
}

void ForegroundCalculatorVariables::onSessionProgress(SessionState state,
                                                      SessionDirection direction,
                                                      uint8_t itemsCompleted,
                                                      uint8_t itemsTotal) {
  if (downstreamObserver_ != nullptr) {
    downstreamObserver_->onSessionProgress(state, direction, itemsCompleted, itemsTotal);
  }
  if (state_ != ForegroundSessionState::Active) return;
  if (!publishPhase(state, direction, itemsCompleted, itemsTotal)) {
    awarenessHealthy_ = false;
  }
}

bool ForegroundCalculatorVariables::finish(CompleteCode outcome) {
  uint16_t sequence = 0;
  if (!beginOperation(sequence)) return false;
  uint8_t bytes[COMPLETE_PAYLOAD_BYTES];
  if (encodeCompletePayload(outcome, bytes) != DecodeStatus::Ok
      || !sendFrame(FrameType::Complete, sequence, bytes, sizeof(bytes))
      || !receiveAck(sequence, FrameType::Complete, 0)) return false;
  state_ = ForegroundSessionState::Complete;
  channel_.release();
  return true;
}

bool ForegroundCalculatorVariables::cancel() {
  if (state_ != ForegroundSessionState::Active) {
    channel_.release();
    return false;
  }
  uint16_t sequence = 0;
  if (!beginOperation(sequence)
      || !sendFrame(FrameType::Cancel, sequence, nullptr, 0)
      || !receiveAck(sequence, FrameType::Cancel, 0)) return false;
  state_ = ForegroundSessionState::Complete;
  channel_.release();
  return true;
}

bool ForegroundCalculatorVariables::failProtocol(ForegroundSessionError error,
                                                 ErrorCode peerCode,
                                                 FrameType offendingType,
                                                 uint16_t sequence,
                                                 uint16_t expectedOffset,
                                                 const char* detail) {
  ErrorPayload peerError{};
  peerError.code = peerCode;
  peerError.offendingType = offendingType;
  peerError.expectedOffset = expectedOffset;
  uint8_t errorBytes[ERROR_PAYLOAD_BYTES];
  encodeErrorPayload(peerError, errorBytes);
  size_t encodedLength = 0;
  if (encodeFrame(FrameType::Error, sequence, errorBytes, sizeof(errorBytes),
                  txFrame_, sizeof(txFrame_), encodedLength) == DecodeStatus::Ok) {
    // Best effort only: preserve the local protocol diagnosis if the cable is
    // already gone while reporting it to the peer.
    channel_.send(txFrame_, static_cast<uint16_t>(encodedLength));
  }
  return fail(error, detail);
}

bool ForegroundCalculatorVariables::rejectOperation(ForegroundSessionError error,
                                                     const char* detail) {
  error_ = error;
  snprintf(errorText_, sizeof(errorText_), "%s",
           detail == nullptr ? foregroundSessionErrorText(error) : detail);
  return false;
}

bool ForegroundCalculatorVariables::fail(ForegroundSessionError error,
                                         const char* detail, bool release) {
  error_ = error;
  state_ = ForegroundSessionState::Failed;
  snprintf(errorText_, sizeof(errorText_), "%s",
           detail == nullptr ? foregroundSessionErrorText(error) : detail);
  if (release) channel_.release();
  return false;
}

const char* foregroundSessionErrorText(ForegroundSessionError error) {
  switch (error) {
    case ForegroundSessionError::None: return "none";
    case ForegroundSessionError::Channel: return "foreground link channel failed";
    case ForegroundSessionError::NotActive: return "foreground session is not active";
    case ForegroundSessionError::Decode: return "foreground frame decode failed";
    case ForegroundSessionError::UnexpectedFrame: return "unexpected foreground frame";
    case ForegroundSessionError::InvalidSequence: return "foreground operation sequence is invalid";
    case ForegroundSessionError::InvalidPayload: return "foreground message payload is invalid";
    case ForegroundSessionError::InvalidName: return "foreground variable name is invalid";
    case ForegroundSessionError::NameMismatch: return "foreground variable name changed in transit";
    case ForegroundSessionError::TooLarge: return "foreground variable exceeds its bounded buffer";
    case ForegroundSessionError::InvalidOffset: return "foreground chunk offset is invalid";
    case ForegroundSessionError::RecordChecksum: return "foreground whole-record CRC failed";
    case ForegroundSessionError::PeerError: return "calculator reported a foreground error";
    case ForegroundSessionError::Cancelled: return "foreground session was cancelled";
    case ForegroundSessionError::SequenceExhausted: return "foreground operation sequence exhausted";
  }
  return "unknown foreground session error";
}

}  // namespace schoolcalc_relay

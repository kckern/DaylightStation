#include "SchoolCalcForegroundSession.h"
#include "SchoolCalcWire.h"

#include <assert.h>
#include <string.h>

#include <deque>
#include <map>
#include <string>
#include <vector>

using namespace schoolcalc_foreground;
using namespace schoolcalc_relay;

namespace {

static std::vector<uint8_t> envelope(const char magic[4], uint8_t value) {
  std::vector<uint8_t> bytes = {
    static_cast<uint8_t>(magic[0]), static_cast<uint8_t>(magic[1]),
    static_cast<uint8_t>(magic[2]), static_cast<uint8_t>(magic[3]),
    1, 1, 0, value, 0, 0,
  };
  const uint16_t crc = schoolcalc_wire::crc16Ccitt(bytes.data(), bytes.size() - 2);
  bytes[bytes.size() - 2] = static_cast<uint8_t>(crc & 0xFF);
  bytes[bytes.size() - 1] = static_cast<uint8_t>(crc >> 8);
  return bytes;
}

class VirtualCalculatorChannel final : public IForegroundFrameChannel {
public:
  std::map<std::string, std::vector<uint8_t>> variables;
  std::vector<std::string> reads;
  std::vector<std::string> writes;
  std::vector<PhasePayload> phases;
  std::vector<KeyInputPayload> inputs;
  std::vector<ErrorPayload> errorsFromRelay;
  bool released = false;
  bool corruptNextReadByte = false;
  bool offsetNextReadChunk = false;
  bool corruptNextWriteAck = false;
  bool failNextPhase = false;
  bool corruptNextInputAck = false;
  bool corruptNextPong = false;
  uint16_t helloCapabilities = REQUIRED_SYNC_CAPABILITIES;
  uint16_t helloChunkBytes = 5;

  VirtualCalculatorChannel() { queueHello(); }

  bool send(const uint8_t* bytes, uint16_t length) override {
    FrameView frame{};
    if (decodeFrame(bytes, length, frame) != DecodeStatus::Ok) {
      error_ = "relay sent an invalid SCF1 frame";
      return false;
    }
    switch (frame.type) {
      case FrameType::HelloAck: return receiveHelloAck(frame);
      case FrameType::Phase: return receivePhase(frame);
      case FrameType::ReadRequest: return receiveReadRequest(frame);
      case FrameType::Ack: return receiveAck(frame);
      case FrameType::WriteBegin: return receiveWriteBegin(frame);
      case FrameType::WriteChunk: return receiveWriteChunk(frame);
      case FrameType::WriteEnd: return receiveWriteEnd(frame);
      case FrameType::Complete: return receiveComplete(frame);
      case FrameType::KeyInput: return receiveKeyInput(frame);
      case FrameType::Ping: return receivePing(frame);
      case FrameType::Cancel:
        if (frame.payloadLength != 0) return fail("relay CANCEL payload is not empty");
        queueAck(frame.sequence, FrameType::Cancel, 0);
        return true;
      case FrameType::Error: {
        ErrorPayload payload{};
        if (decodeErrorPayload(frame.payload, frame.payloadLength, payload)
            != DecodeStatus::Ok) return fail("relay ERROR payload is invalid");
        errorsFromRelay.push_back(payload);
        return true;
      }
      default: return fail("relay sent a client-only foreground frame");
    }
  }

  ForegroundChannelStatus receive(uint8_t* output, uint16_t capacity,
                                  uint16_t& length) override {
    length = 0;
    if (outbound_.empty()) {
      error_ = "virtual calculator has no response queued";
      return ForegroundChannelStatus::Timeout;
    }
    const std::vector<uint8_t> frame = outbound_.front();
    outbound_.pop_front();
    if (frame.size() > capacity) {
      error_ = "virtual response exceeds relay frame buffer";
      return ForegroundChannelStatus::Failed;
    }
    memcpy(output, frame.data(), frame.size());
    length = static_cast<uint16_t>(frame.size());
    return ForegroundChannelStatus::Ok;
  }

  void release() override { released = true; }
  const char* lastError() const override { return error_.c_str(); }

  void resetHello(uint16_t capabilities, uint16_t chunkBytes = 5) {
    outbound_.clear();
    helloCapabilities = capabilities;
    helloChunkBytes = chunkBytes;
    released = false;
    queueHello();
  }

private:
  std::deque<std::vector<uint8_t>> outbound_;
  std::string error_ = "none";
  bool helloAccepted_ = false;
  uint16_t negotiatedChunkBytes_ = 0;
  bool reading_ = false;
  uint16_t readSequence_ = 0;
  std::string readName_;
  uint16_t readOffset_ = 0;
  uint16_t readCrc_ = 0;
  bool readByteCorrupted_ = false;
  bool writing_ = false;
  uint16_t writeSequence_ = 0;
  std::string writeName_;
  uint16_t writeLength_ = 0;
  uint16_t writeCrc_ = 0;
  std::vector<uint8_t> writeBytes_;

  bool fail(const char* text) {
    error_ = text;
    return false;
  }

  void queueHello() {
    HelloPayload hello{};
    hello.version = PROTOCOL_VERSION;
    hello.platform = PLATFORM_TI86;
    hello.capabilities = helloCapabilities;
    hello.maxChunkBytes = helloChunkBytes;
    for (size_t index = 0; index < SESSION_NONCE_BYTES; ++index) {
      hello.nonce[index] = static_cast<uint8_t>(0xA0 + index);
    }
    uint8_t payload[HELLO_PAYLOAD_BYTES];
    // Invalid-capability tests still need a structurally encoded HELLO, so
    // write that one field after creating a valid payload.
    const uint16_t requestedCapabilities = hello.capabilities;
    hello.capabilities = REQUIRED_SYNC_CAPABILITIES;
    assert(encodeHelloPayload(hello, payload) == DecodeStatus::Ok);
    payload[2] = static_cast<uint8_t>(requestedCapabilities & 0xFF);
    payload[3] = static_cast<uint8_t>(requestedCapabilities >> 8);
    queueFrame(FrameType::Hello, 0, payload, sizeof(payload));
  }

  void queueFrame(FrameType type, uint16_t sequence,
                  const uint8_t* payload, uint16_t payloadLength) {
    uint8_t bytes[MAX_FRAME_BYTES];
    size_t length = 0;
    assert(encodeFrame(type, sequence, payload, payloadLength,
                       bytes, sizeof(bytes), length) == DecodeStatus::Ok);
    outbound_.emplace_back(bytes, bytes + length);
  }

  void queueAck(uint16_t sequence, FrameType type, uint16_t nextOffset) {
    uint8_t payload[ACK_PAYLOAD_BYTES];
    encodeAckPayload({ type, nextOffset }, payload);
    queueFrame(FrameType::Ack, sequence, payload, sizeof(payload));
  }

  void queueTransferEnd(FrameType type, uint16_t sequence,
                        uint16_t length, uint16_t crc) {
    uint8_t payload[TRANSFER_END_PAYLOAD_BYTES];
    encodeTransferEndPayload({ length, crc }, payload);
    queueFrame(type, sequence, payload, sizeof(payload));
  }

  bool receiveHelloAck(const FrameView& frame) {
    if (frame.sequence != 0) return fail("HELLO_ACK sequence is not zero");
    HelloPayload acknowledgement{};
    if (decodeHelloPayload(frame.payload, frame.payloadLength, acknowledgement)
        != DecodeStatus::Ok) return fail("HELLO_ACK payload is invalid");
    for (size_t index = 0; index < SESSION_NONCE_BYTES; ++index) {
      if (acknowledgement.nonce[index] != static_cast<uint8_t>(0xA0 + index)) {
        return fail("HELLO_ACK nonce does not echo HELLO");
      }
    }
    const uint16_t expectedCapabilities = helloCapabilities
      & (REQUIRED_SYNC_CAPABILITIES | CapabilityKeyInput | CapabilityHeartbeat);
    if (acknowledgement.maxChunkBytes > helloChunkBytes
        || acknowledgement.capabilities != expectedCapabilities) {
      return fail("HELLO_ACK negotiation exceeds the client offer");
    }
    negotiatedChunkBytes_ = acknowledgement.maxChunkBytes;
    helloAccepted_ = true;
    return true;
  }

  bool receivePhase(const FrameView& frame) {
    if (failNextPhase) {
      failNextPhase = false;
      return fail("forced foreground phase failure");
    }
    PhasePayload phase{};
    if (!helloAccepted_
        || decodePhasePayload(frame.payload, frame.payloadLength, phase)
           != DecodeStatus::Ok) return fail("relay PHASE payload is invalid");
    phases.push_back(phase);
    queueAck(frame.sequence, FrameType::Phase, 0);
    return true;
  }

  bool receiveReadRequest(const FrameView& frame) {
    VariableName name{};
    if (!helloAccepted_ || reading_
        || decodeVariableNamePayload(frame.payload, frame.payloadLength, name)
           != DecodeStatus::Ok) return fail("relay READ_REQUEST is invalid");
    reads.emplace_back(name.value);
    const auto found = variables.find(name.value);
    if (found == variables.end()) {
      uint8_t payload[9];
      uint16_t payloadLength = 0;
      assert(encodeVariableNamePayload(name.value, payload, sizeof(payload), payloadLength)
             == DecodeStatus::Ok);
      queueFrame(FrameType::VariableMissing, frame.sequence, payload, payloadLength);
      return true;
    }
    reading_ = true;
    readSequence_ = frame.sequence;
    readName_ = name.value;
    readOffset_ = 0;
    readByteCorrupted_ = false;
    readCrc_ = schoolcalc_wire::crc16Ccitt(found->second.data(), found->second.size());
    uint8_t payload[16];
    uint16_t payloadLength = 0;
    assert(encodeVariableDescriptorPayload(name.value,
             static_cast<uint16_t>(found->second.size()), readCrc_,
             payload, sizeof(payload), payloadLength) == DecodeStatus::Ok);
    queueFrame(FrameType::VariableBegin, frame.sequence, payload, payloadLength);
    return true;
  }

  bool receiveAck(const FrameView& frame) {
    AckPayload acknowledgement{};
    if (decodeAckPayload(frame.payload, frame.payloadLength, acknowledgement)
        != DecodeStatus::Ok) return fail("relay ACK payload is invalid");
    if (!reading_) return true;
    if (frame.sequence != readSequence_) return fail("relay read ACK sequence changed");
    if (acknowledgement.acknowledgedType == FrameType::VariableBegin) {
      if (acknowledgement.nextOffset != 0) return fail("VARIABLE_BEGIN ACK offset is not zero");
      return queueNextReadPart();
    }
    if (acknowledgement.acknowledgedType == FrameType::VariableChunk) {
      if (acknowledgement.nextOffset != readOffset_) return fail("VARIABLE_CHUNK ACK offset changed");
      return queueNextReadPart();
    }
    if (acknowledgement.acknowledgedType == FrameType::VariableEnd) {
      const auto found = variables.find(readName_);
      if (found == variables.end() || acknowledgement.nextOffset != found->second.size()) {
        return fail("VARIABLE_END ACK length changed");
      }
      reading_ = false;
      return true;
    }
    if (acknowledgement.acknowledgedType == FrameType::VariableMissing) return true;
    return true;
  }

  bool queueNextReadPart() {
    const std::vector<uint8_t>& bytes = variables.at(readName_);
    if (readOffset_ == bytes.size()) {
      queueTransferEnd(FrameType::VariableEnd, readSequence_,
                       static_cast<uint16_t>(bytes.size()), readCrc_);
      return true;
    }
    const uint16_t remaining = static_cast<uint16_t>(bytes.size() - readOffset_);
    const uint16_t chunkLength = remaining < negotiatedChunkBytes_
      ? remaining : negotiatedChunkBytes_;
    std::vector<uint8_t> source(bytes.begin() + readOffset_,
                                bytes.begin() + readOffset_ + chunkLength);
    if (corruptNextReadByte && !readByteCorrupted_) {
      source[0] ^= 1;
      readByteCorrupted_ = true;
      corruptNextReadByte = false;
    }
    uint8_t payload[MAX_PAYLOAD_BYTES];
    uint16_t payloadLength = 0;
    const uint16_t emittedOffset = offsetNextReadChunk
      ? static_cast<uint16_t>(readOffset_ + 1) : readOffset_;
    offsetNextReadChunk = false;
    assert(encodeChunkPayload(emittedOffset, source.data(), chunkLength,
                              payload, sizeof(payload), payloadLength) == DecodeStatus::Ok);
    readOffset_ = static_cast<uint16_t>(readOffset_ + chunkLength);
    queueFrame(FrameType::VariableChunk, readSequence_, payload, payloadLength);
    return true;
  }

  bool receiveWriteBegin(const FrameView& frame) {
    VariableDescriptor descriptor{};
    if (!helloAccepted_ || writing_
        || decodeVariableDescriptorPayload(frame.payload, frame.payloadLength, descriptor)
           != DecodeStatus::Ok) return fail("relay WRITE_BEGIN is invalid");
    writing_ = true;
    writeSequence_ = frame.sequence;
    writeName_ = descriptor.name.value;
    writeLength_ = descriptor.totalLength;
    writeCrc_ = descriptor.recordCrc;
    writeBytes_.clear();
    queueTransferEnd(FrameType::WriteReady, frame.sequence, writeLength_, writeCrc_);
    return true;
  }

  bool receiveWriteChunk(const FrameView& frame) {
    ChunkView chunk{};
    if (!writing_ || frame.sequence != writeSequence_
        || decodeChunkPayload(frame.payload, frame.payloadLength, chunk) != DecodeStatus::Ok
        || chunk.offset != writeBytes_.size()
        || static_cast<uint32_t>(writeBytes_.size()) + chunk.length > writeLength_) {
      return fail("relay WRITE_CHUNK is not contiguous");
    }
    writeBytes_.insert(writeBytes_.end(), chunk.bytes, chunk.bytes + chunk.length);
    uint16_t nextOffset = static_cast<uint16_t>(writeBytes_.size());
    if (corruptNextWriteAck) {
      nextOffset = static_cast<uint16_t>(nextOffset + 1);
      corruptNextWriteAck = false;
    }
    queueAck(frame.sequence, FrameType::WriteChunk, nextOffset);
    return true;
  }

  bool receiveWriteEnd(const FrameView& frame) {
    TransferEndPayload end{};
    if (!writing_ || frame.sequence != writeSequence_
        || decodeTransferEndPayload(frame.payload, frame.payloadLength, end)
           != DecodeStatus::Ok
        || end.totalLength != writeLength_ || end.recordCrc != writeCrc_
        || writeBytes_.size() != writeLength_
        || schoolcalc_wire::crc16Ccitt(writeBytes_.data(), writeBytes_.size()) != writeCrc_) {
      return fail("relay WRITE_END does not match received bytes");
    }
    variables[writeName_] = writeBytes_;
    writes.push_back(writeName_);
    queueTransferEnd(FrameType::VariableStored, frame.sequence, writeLength_, writeCrc_);
    writing_ = false;
    return true;
  }

  bool receiveComplete(const FrameView& frame) {
    CompleteCode complete = CompleteCode::Blocked;
    if (decodeCompletePayload(frame.payload, frame.payloadLength, complete)
        != DecodeStatus::Ok) return fail("relay COMPLETE payload is invalid");
    queueAck(frame.sequence, FrameType::Complete, 0);
    return true;
  }

  bool receiveKeyInput(const FrameView& frame) {
    KeyInputPayload input{};
    if (!helloAccepted_ || (helloCapabilities & CapabilityKeyInput) == 0
        || decodeKeyInputPayload(frame.payload, frame.payloadLength, input)
           != DecodeStatus::Ok) return fail("relay KEY_INPUT payload is invalid");
    inputs.push_back(input);
    queueAck(frame.sequence, FrameType::KeyInput,
             corruptNextInputAck ? 1 : 0);
    corruptNextInputAck = false;
    return true;
  }

  bool receivePing(const FrameView& frame) {
    HeartbeatPayload challenge{};
    if (!helloAccepted_ || (helloCapabilities & CapabilityHeartbeat) == 0
        || decodeHeartbeatPayload(frame.payload, frame.payloadLength, challenge)
           != DecodeStatus::Ok) return fail("relay PING payload is invalid");
    if (corruptNextPong) {
      challenge.token++;
      corruptNextPong = false;
    }
    uint8_t payload[HEARTBEAT_PAYLOAD_BYTES];
    assert(encodeHeartbeatPayload(challenge, payload) == DecodeStatus::Ok);
    queueFrame(FrameType::Pong, frame.sequence, payload, sizeof(payload));
    return true;
  }
};

class FullSyncApi final : public ISchoolCalcApi {
public:
  bool identify(ByteView, DeviceIdentity& identity) override {
    strcpy(identity.deviceId, "86A001");
    strcpy(identity.platformId, "ti86");
    return true;
  }

  bool sync(const SyncRequest& request, SyncPlan& plan,
            MutableBytes& acknowledgement, MutableBytes& manifest,
            MutableBytes& learnerRoster,
            MutableBytes& progressProjection,
            MutableBytes& interactionResponse,
            INetworkWaitObserver* waitObserver) override {
    assert(strcmp(request.deviceId, "86A001") == 0);
    assert(request.deviceInfo.length > 0 && request.resultQueue.length > 0);
    const std::vector<uint8_t> ack = envelope("SCA1", 8);
    const std::vector<uint8_t> commit = envelope("SCM1", 9);
    const std::vector<uint8_t> profiles = envelope("SCU1", 10);
    const std::vector<uint8_t> progress = envelope("SCG1", 11);
    assert(ack.size() <= acknowledgement.capacity && commit.size() <= manifest.capacity
           && profiles.size() <= learnerRoster.capacity
           && progress.size() <= progressProjection.capacity);
    memcpy(acknowledgement.bytes, ack.data(), ack.size());
    acknowledgement.length = static_cast<uint16_t>(ack.size());
    memcpy(manifest.bytes, commit.data(), commit.size());
    manifest.length = static_cast<uint16_t>(commit.size());
    memcpy(learnerRoster.bytes, profiles.data(), profiles.size());
    learnerRoster.length = static_cast<uint16_t>(profiles.size());
    memcpy(progressProjection.bytes, progress.data(), progress.size());
    progressProjection.length = static_cast<uint16_t>(progress.size());
    plan.ready = true;
    plan.catalogChanged = false;
    strcpy(plan.catalogGeneration, "sha256:virtual");
    plan.acknowledgementLength = acknowledgement.length;
    plan.manifestLength = manifest.length;
    plan.learnerRosterLength = learnerRoster.length;
    plan.progressProjectionLength = progressProjection.length;
    interactionResponse.length = 0;
    plan.interactionResponseLength = 0;
    if (waitObserver != nullptr) assert(waitObserver->serviceNetworkWait(1000));
    return true;
  }

  bool fetchCatalog(const char*, const char*, MutableBytes&) override { return false; }
  bool fetchArtifact(const ArtifactDescriptor&, MutableBytes&) override { return false; }
  const char* lastError() const override { return "none"; }
};

static void handshakeReadWritePhaseAndFinish() {
  VirtualCalculatorChannel peer;
  peer.variables["DSINFO"] = { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 };
  ForegroundCalculatorVariables calculator(peer, 7);
  assert(calculator.accept());
  assert(calculator.negotiatedChunkBytes() == 5);
  assert(calculator.selectedCapabilities() == REQUIRED_SYNC_CAPABILITIES);
  assert(calculator.sessionNonce()[0] == 0xA0 && calculator.sessionNonce()[7] == 0xA7);

  uint8_t outputBytes[32]{};
  MutableBytes output{ outputBytes, sizeof(outputBytes), 0 };
  assert(calculator.read("DSINFO", output) == VariableReadStatus::Found);
  assert(output.length == peer.variables["DSINFO"].size());
  assert(memcmp(output.bytes, peer.variables["DSINFO"].data(), output.length) == 0);
  assert(calculator.read("DSQ", output) == VariableReadStatus::Missing);

  const uint8_t writeBytes[] = { 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0xAA, 0x55 };
  assert(calculator.write("DSSYNC", { writeBytes, sizeof(writeBytes) }));
  assert(peer.variables["DSSYNC"] == std::vector<uint8_t>(writeBytes,
                                                            writeBytes + sizeof(writeBytes)));
  calculator.onSessionProgress(SessionState::Synchronizing, SessionDirection::Network, 0, 1);
  assert(calculator.awarenessHealthy());
  assert(peer.phases.size() == 1);
  assert(peer.phases[0].phase == PhaseCode::Synchronizing);
  assert(peer.phases[0].direction == DirectionCode::Network);
  assert(calculator.finish(CompleteCode::Ready));
  assert(calculator.state() == ForegroundSessionState::Complete && peer.released);
}

static void malformedTransfersFailClosed() {
  {
    VirtualCalculatorChannel peer;
    peer.variables["DSINFO"] = { 1, 2, 3, 4, 5, 6 };
    peer.offsetNextReadChunk = true;
    ForegroundCalculatorVariables calculator(peer);
    assert(calculator.accept());
    uint8_t bytes[16]{};
    MutableBytes output{ bytes, sizeof(bytes), 0 };
    assert(calculator.read("DSINFO", output) == VariableReadStatus::Failed);
    assert(calculator.error() == ForegroundSessionError::InvalidOffset);
    assert(!peer.errorsFromRelay.empty());
    assert(peer.errorsFromRelay.back().code == ErrorCode::InvalidOffset);
  }
  {
    VirtualCalculatorChannel peer;
    peer.variables["DSINFO"] = { 1, 2, 3, 4, 5, 6 };
    peer.corruptNextReadByte = true;
    ForegroundCalculatorVariables calculator(peer);
    assert(calculator.accept());
    uint8_t bytes[16]{};
    MutableBytes output{ bytes, sizeof(bytes), 0 };
    assert(calculator.read("DSINFO", output) == VariableReadStatus::Failed);
    assert(calculator.error() == ForegroundSessionError::RecordChecksum);
    assert(peer.errorsFromRelay.back().code == ErrorCode::RecordChecksum);
  }
  {
    VirtualCalculatorChannel peer;
    peer.variables["DSINFO"] = std::vector<uint8_t>(20, 0xAA);
    ForegroundCalculatorVariables calculator(peer);
    assert(calculator.accept());
    uint8_t bytes[4]{};
    MutableBytes output{ bytes, sizeof(bytes), 0 };
    assert(calculator.read("DSINFO", output) == VariableReadStatus::TooLarge);
    assert(calculator.error() == ForegroundSessionError::TooLarge);
    assert(peer.errorsFromRelay.back().code == ErrorCode::TooLarge);
  }
  {
    VirtualCalculatorChannel peer;
    ForegroundCalculatorVariables calculator(peer);
    assert(calculator.accept());
    peer.corruptNextWriteAck = true;
    const uint8_t bytes[] = { 1, 2, 3, 4, 5, 6 };
    assert(!calculator.write("DSSYNC", { bytes, sizeof(bytes) }));
    assert(calculator.error() == ForegroundSessionError::InvalidOffset);
  }
}

static void handshakeRequiresTheLockedProtocol() {
  VirtualCalculatorChannel peer;
  peer.resetHello(CapabilityVariableIo);
  ForegroundCalculatorVariables calculator(peer);
  assert(!calculator.accept());
  assert(calculator.state() == ForegroundSessionState::Failed);
  assert(calculator.error() == ForegroundSessionError::InvalidPayload);
  assert(peer.errorsFromRelay.size() == 1);
  assert(peer.errorsFromRelay[0].code == ErrorCode::UnsupportedCapabilities);
  assert(peer.released);
}

static void foregroundInputNegotiationAndAckAreExact() {
  VirtualCalculatorChannel peer;
  peer.resetHello(REQUIRED_SYNC_CAPABILITIES | CapabilityKeyInput);
  ForegroundCalculatorVariables calculator(peer);
  assert(calculator.accept());
  assert(calculator.selectedCapabilities()
         == (REQUIRED_SYNC_CAPABILITIES | CapabilityKeyInput));
  const schoolcalc_input::InputEvent event{
    42,
    { schoolcalc_input::InputType::Text, static_cast<uint8_t>('q'),
      schoolcalc_input::InputFlagShift },
    100,
  };
  assert(calculator.sendInput(event));
  assert(peer.inputs.size() == 1);
  assert(peer.inputs[0].eventSequence == 42
         && peer.inputs[0].value == 'q'
         && peer.inputs[0].flags == schoolcalc_input::InputFlagShift);

  peer.corruptNextInputAck = true;
  assert(!calculator.sendInput({
    43,
    { schoolcalc_input::InputType::Key,
      static_cast<uint8_t>(schoolcalc_input::LogicalKey::Enter), 0 },
    101,
  }));
  assert(calculator.error() == ForegroundSessionError::InvalidOffset);

  VirtualCalculatorChannel noInputPeer;
  ForegroundCalculatorVariables noInput(noInputPeer);
  assert(noInput.accept());
  assert(!noInput.sendInput(event));
  assert(noInput.error() == ForegroundSessionError::InvalidPayload);
}

static void foregroundHeartbeatNegotiationAndChallengeAreExact() {
  VirtualCalculatorChannel peer;
  peer.resetHello(REQUIRED_SYNC_CAPABILITIES | CapabilityHeartbeat);
  ForegroundCalculatorVariables calculator(peer);
  assert(calculator.accept());
  assert((calculator.selectedCapabilities() & CapabilityHeartbeat) != 0);
  assert(calculator.heartbeat(0x12345678, 4500));

  peer.corruptNextPong = true;
  assert(!calculator.heartbeat(0x22334455, 9000));
  assert(calculator.error() == ForegroundSessionError::InvalidPayload);

  VirtualCalculatorChannel noHeartbeatPeer;
  ForegroundCalculatorVariables noHeartbeat(noHeartbeatPeer);
  assert(noHeartbeat.accept());
  assert(!noHeartbeat.heartbeat(1, 1));
  assert(noHeartbeat.state() == ForegroundSessionState::Active);
}

static void fullRelayTransactionUsesForegroundVariablePort() {
  VirtualCalculatorChannel peer;
  peer.resetHello(REQUIRED_SYNC_CAPABILITIES | CapabilityHeartbeat);
  peer.variables["DSID"] = envelope("SCI1", 1);
  peer.variables["DSINFO"] = envelope("SCI1", 2);
  peer.variables["DSINST"] = envelope("SCM1", 3);
  peer.variables["DSQ"] = envelope("SCQ1", 4);
  peer.variables["DSREQ"] = envelope("SCD1", 5);
  ForegroundCalculatorVariables calculator(peer);
  assert(calculator.accept());
  FullSyncApi api;
  uint8_t identity[64]{}, info[64]{}, installed[64]{}, queue[64]{}, requests[64]{};
  uint8_t interactionRequest[64]{}, profiles[64]{}, progress[64]{}, interactionResponse[64]{};
  uint8_t acknowledgement[64]{}, manifest[64]{}, transfer[64]{};
  SessionBuffers buffers{
    { identity, sizeof(identity), 0 }, { info, sizeof(info), 0 },
    { installed, sizeof(installed), 0 }, { queue, sizeof(queue), 0 },
    { requests, sizeof(requests), 0 }, { interactionRequest, sizeof(interactionRequest), 0 },
    { profiles, sizeof(profiles), 0 }, { progress, sizeof(progress), 0 },
    { interactionResponse, sizeof(interactionResponse), 0 },
    { acknowledgement, sizeof(acknowledgement), 0 },
    { manifest, sizeof(manifest), 0 }, { transfer, sizeof(transfer), 0 },
    {}, {}, {},
  };
  SchoolCalcRelaySession session(calculator, api, buffers, &calculator);
  const SessionOutcome result = session.run();
  assert(result.ok && result.ready);
  const std::vector<std::string> expectedReads = {
    "DSID", "DSINFO", "DSINST", "DSQ", "DSREQ", "DSTREQ", "DSENTRY",
  };
  const std::vector<std::string> expectedWrites = {
    "DSUSRNEW", "DSPRGNEW", "DSACKNEW", "DSSYNC",
  };
  assert(peer.reads == expectedReads);
  assert(peer.writes == expectedWrites);
  assert(peer.variables["DSACKNEW"] == envelope("SCA1", 8));
  assert(peer.variables["DSSYNC"] == envelope("SCM1", 9));
  assert(peer.variables["DSUSRNEW"] == envelope("SCU1", 10));
  assert(peer.variables["DSPRGNEW"] == envelope("SCG1", 11));
  bool sawUplink = false, sawNetwork = false, sawDownlink = false, sawSafe = false;
  for (const PhasePayload& phase : peer.phases) {
    sawUplink = sawUplink || phase.direction == DirectionCode::CalculatorToRelay;
    sawNetwork = sawNetwork || phase.direction == DirectionCode::Network;
    sawDownlink = sawDownlink || phase.direction == DirectionCode::RelayToCalculator;
    sawSafe = sawSafe || (phase.phase == PhaseCode::AwaitingCalculatorCommit
                          && phase.safeToUnplug);
  }
  assert(sawUplink && sawNetwork && sawDownlink && sawSafe);
  assert(calculator.finish(CompleteCode::Ready));
}

static void foregroundAwarenessFailureStopsBeforeVariableIo() {
  VirtualCalculatorChannel peer;
  ForegroundCalculatorVariables calculator(peer);
  assert(calculator.accept());
  peer.failNextPhase = true;
  FullSyncApi api;
  uint8_t identity[64]{}, info[64]{}, installed[64]{}, queue[64]{}, requests[64]{};
  uint8_t interactionRequest[64]{}, profiles[64]{}, progress[64]{}, interactionResponse[64]{};
  uint8_t acknowledgement[64]{}, manifest[64]{}, transfer[64]{};
  SessionBuffers buffers{
    { identity, sizeof(identity), 0 }, { info, sizeof(info), 0 },
    { installed, sizeof(installed), 0 }, { queue, sizeof(queue), 0 },
    { requests, sizeof(requests), 0 }, { interactionRequest, sizeof(interactionRequest), 0 },
    { profiles, sizeof(profiles), 0 }, { progress, sizeof(progress), 0 },
    { interactionResponse, sizeof(interactionResponse), 0 },
    { acknowledgement, sizeof(acknowledgement), 0 },
    { manifest, sizeof(manifest), 0 }, { transfer, sizeof(transfer), 0 },
    {}, {}, {},
  };
  SchoolCalcRelaySession session(calculator, api, buffers, &calculator);
  const SessionOutcome result = session.run();
  assert(!result.ok && result.error == SessionError::TransportAwareness);
  assert(peer.reads.empty() && peer.writes.empty());
  assert(!calculator.awarenessHealthy());
}

}  // namespace

void runSchoolCalcForegroundSessionTests() {
  handshakeReadWritePhaseAndFinish();
  malformedTransfersFailClosed();
  handshakeRequiresTheLockedProtocol();
  foregroundInputNegotiationAndAckAreExact();
  foregroundHeartbeatNegotiationAndChallengeAreExact();
  fullRelayTransactionUsesForegroundVariablePort();
  foregroundAwarenessFailureStopsBeforeVariableIo();
}

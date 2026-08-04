#pragma once

#include <stddef.h>
#include <stdint.h>

// Cooperative SchoolCalc foreground framing. These frames travel inside a
// normal TI DATA packet while the calculator shell, rather than TI-OS Silent
// Link, owns port 7. The extra CRC gives both endpoints one record boundary
// and integrity rule independent of the TI packet checksum.
namespace schoolcalc_foreground {

static constexpr size_t FRAME_HEADER_BYTES = 10;
static constexpr size_t FRAME_CRC_BYTES = 2;
static constexpr uint16_t MAX_PAYLOAD_BYTES = 256;
static constexpr size_t MAX_FRAME_BYTES =
  FRAME_HEADER_BYTES + MAX_PAYLOAD_BYTES + FRAME_CRC_BYTES;
static constexpr uint16_t DEFAULT_CHUNK_BYTES = 128;
static constexpr uint16_t MAX_CHUNK_DATA_BYTES = MAX_PAYLOAD_BYTES - 2;
static constexpr uint8_t PROTOCOL_VERSION = 1;
static constexpr uint8_t PLATFORM_TI86 = 0x86;
static constexpr size_t SESSION_NONCE_BYTES = 8;
static constexpr size_t HELLO_PAYLOAD_BYTES = 14;
static constexpr size_t TRANSFER_END_PAYLOAD_BYTES = 4;
static constexpr size_t ACK_PAYLOAD_BYTES = 3;
static constexpr size_t PHASE_PAYLOAD_BYTES = 5;
static constexpr size_t ERROR_PAYLOAD_BYTES = 4;
static constexpr size_t COMPLETE_PAYLOAD_BYTES = 1;
static constexpr size_t KEY_INPUT_PAYLOAD_BYTES = 8;
static constexpr size_t HEARTBEAT_PAYLOAD_BYTES = 8;
static constexpr uint8_t KEY_INPUT_MAPPING_VERSION = 1;
static constexpr uint8_t KEY_INPUT_TYPE_KEY = 1;
static constexpr uint8_t KEY_INPUT_TYPE_TEXT = 2;
static constexpr uint8_t KEY_INPUT_MAX_LOGICAL_KEY = 15;
static constexpr uint8_t KEY_INPUT_KNOWN_FLAGS = 0x03;

enum Capability : uint16_t {
  CapabilityVariableIo = 0x0001,
  CapabilityPhaseAwareness = 0x0002,
  CapabilityKeyInput = 0x0004,
  CapabilityHeartbeat = 0x0008,
};

static constexpr uint16_t REQUIRED_SYNC_CAPABILITIES =
  CapabilityVariableIo | CapabilityPhaseAwareness;

enum class FrameType : uint8_t {
  Hello = 0x01,
  HelloAck = 0x02,
  Phase = 0x03,
  Ping = 0x04,
  Pong = 0x05,

  ReadRequest = 0x10,
  VariableMissing = 0x11,
  VariableBegin = 0x12,
  VariableChunk = 0x13,
  VariableEnd = 0x14,

  WriteBegin = 0x20,
  WriteReady = 0x21,
  WriteChunk = 0x22,
  WriteEnd = 0x23,
  VariableStored = 0x24,

  Ack = 0x30,
  Error = 0x31,
  Cancel = 0x32,
  Complete = 0x33,

  KeyInput = 0x40,
};

enum class DecodeStatus : uint8_t {
  Ok,
  Truncated,
  TrailingBytes,
  OutputTooSmall,
  WrongMagic,
  UnknownType,
  InvalidFlags,
  InvalidLength,
  Checksum,
  InvalidPayload,
  InvalidName,
  UnsupportedVersion,
  UnsupportedPlatform,
  UnsupportedCapabilities,
  InvalidValue,
};

enum class PhaseCode : uint8_t {
  ReadingIdentity = 1,
  Identifying = 2,
  ReadingInputs = 3,
  Synchronizing = 4,
  StagingProfiles = 5,
  StagingCatalog = 6,
  StagingArtifacts = 7,
  StagingAcknowledgements = 8,
  PublishingManifest = 9,
  AwaitingCalculatorCommit = 10,
  Failed = 11,
  StagingProgress = 12,
  StagingInteraction = 13,
};

enum class DirectionCode : uint8_t {
  Idle = 0,
  Negotiating = 1,
  CalculatorToRelay = 2,
  Network = 3,
  RelayToCalculator = 4,
};

enum class ErrorCode : uint8_t {
  InvalidState = 1,
  InvalidPayload = 2,
  UnexpectedFrame = 3,
  InvalidSequence = 4,
  InvalidName = 5,
  TooLarge = 6,
  InvalidOffset = 7,
  RecordChecksum = 8,
  UnsupportedProtocol = 9,
  UnsupportedPlatform = 10,
  UnsupportedCapabilities = 11,
  SequenceExhausted = 12,
  Cancelled = 13,
};

enum class CompleteCode : uint8_t {
  Ready = 1,
  Blocked = 2,
};

struct FrameView {
  FrameType type;
  uint16_t sequence;
  const uint8_t* payload;
  uint16_t payloadLength;
};

struct HelloPayload {
  uint8_t version = 0;
  uint8_t platform = 0;
  uint16_t capabilities = 0;
  uint16_t maxChunkBytes = 0;
  uint8_t nonce[SESSION_NONCE_BYTES]{};
};

struct VariableName {
  uint8_t length = 0;
  char value[9]{};
};

struct VariableDescriptor {
  VariableName name;
  uint16_t totalLength = 0;
  uint16_t recordCrc = 0;
};

struct ChunkView {
  uint16_t offset = 0;
  const uint8_t* bytes = nullptr;
  uint16_t length = 0;
};

struct TransferEndPayload {
  uint16_t totalLength = 0;
  uint16_t recordCrc = 0;
};

struct AckPayload {
  FrameType acknowledgedType = FrameType::Error;
  uint16_t nextOffset = 0;
};

struct PhasePayload {
  PhaseCode phase = PhaseCode::Failed;
  DirectionCode direction = DirectionCode::Idle;
  uint8_t itemsCompleted = 0;
  uint8_t itemsTotal = 0;
  bool safeToUnplug = false;
};

struct ErrorPayload {
  ErrorCode code = ErrorCode::InvalidState;
  FrameType offendingType = FrameType::Error;
  uint16_t expectedOffset = 0;
};

struct KeyInputPayload {
  uint8_t mappingVersion = 0;
  uint8_t inputType = 0;
  uint8_t value = 0;
  uint8_t flags = 0;
  uint32_t eventSequence = 0;
};

// PING and PONG use the same opaque challenge. senderUptimeMs is diagnostic
// context only; neither endpoint infers wall time or clock synchronization.
struct HeartbeatPayload {
  uint32_t token = 0;
  uint32_t senderUptimeMs = 0;

  HeartbeatPayload() = default;
  HeartbeatPayload(uint32_t tokenValue, uint32_t uptimeValue)
    : token(tokenValue), senderUptimeMs(uptimeValue) {}
};

size_t encodedFrameSize(uint16_t payloadLength);
DecodeStatus encodeFrame(FrameType type, uint16_t sequence,
                         const uint8_t* payload, uint16_t payloadLength,
                         uint8_t* output, size_t outputCapacity,
                         size_t& outputLength);
DecodeStatus decodeFrame(const uint8_t* bytes, size_t length, FrameView& output);
bool validFrameType(uint8_t value);
const char* frameTypeText(FrameType type);
const char* decodeStatusText(DecodeStatus status);

DecodeStatus encodeHelloPayload(const HelloPayload& payload,
                                uint8_t output[HELLO_PAYLOAD_BYTES]);
DecodeStatus decodeHelloPayload(const uint8_t* bytes, uint16_t length,
                                HelloPayload& output);

DecodeStatus encodeVariableNamePayload(const char* name, uint8_t* output,
                                       size_t outputCapacity, uint16_t& outputLength);
DecodeStatus decodeVariableNamePayload(const uint8_t* bytes, uint16_t length,
                                       VariableName& output);
DecodeStatus encodeVariableDescriptorPayload(const char* name, uint16_t totalLength,
                                              uint16_t recordCrc, uint8_t* output,
                                              size_t outputCapacity,
                                              uint16_t& outputLength);
DecodeStatus decodeVariableDescriptorPayload(const uint8_t* bytes, uint16_t length,
                                              VariableDescriptor& output);

DecodeStatus encodeChunkPayload(uint16_t offset, const uint8_t* bytes, uint16_t length,
                                uint8_t* output, size_t outputCapacity,
                                uint16_t& outputLength);
DecodeStatus decodeChunkPayload(const uint8_t* bytes, uint16_t length, ChunkView& output);

void encodeTransferEndPayload(const TransferEndPayload& payload,
                              uint8_t output[TRANSFER_END_PAYLOAD_BYTES]);
DecodeStatus decodeTransferEndPayload(const uint8_t* bytes, uint16_t length,
                                      TransferEndPayload& output);
void encodeAckPayload(const AckPayload& payload, uint8_t output[ACK_PAYLOAD_BYTES]);
DecodeStatus decodeAckPayload(const uint8_t* bytes, uint16_t length, AckPayload& output);
void encodePhasePayload(const PhasePayload& payload, uint8_t output[PHASE_PAYLOAD_BYTES]);
DecodeStatus decodePhasePayload(const uint8_t* bytes, uint16_t length, PhasePayload& output);
void encodeErrorPayload(const ErrorPayload& payload, uint8_t output[ERROR_PAYLOAD_BYTES]);
DecodeStatus decodeErrorPayload(const uint8_t* bytes, uint16_t length, ErrorPayload& output);
DecodeStatus encodeCompletePayload(CompleteCode code,
                                   uint8_t output[COMPLETE_PAYLOAD_BYTES]);
DecodeStatus decodeCompletePayload(const uint8_t* bytes, uint16_t length,
                                   CompleteCode& output);
DecodeStatus encodeKeyInputPayload(const KeyInputPayload& payload,
                                   uint8_t output[KEY_INPUT_PAYLOAD_BYTES]);
DecodeStatus decodeKeyInputPayload(const uint8_t* bytes, uint16_t length,
                                   KeyInputPayload& output);
DecodeStatus encodeHeartbeatPayload(const HeartbeatPayload& payload,
                                    uint8_t output[HEARTBEAT_PAYLOAD_BYTES]);
DecodeStatus decodeHeartbeatPayload(const uint8_t* bytes, uint16_t length,
                                    HeartbeatPayload& output);

bool validVariableName(const char* name);
bool validPhaseCode(uint8_t value);
bool validDirectionCode(uint8_t value);
bool validErrorCode(uint8_t value);
bool validCompleteCode(uint8_t value);

}  // namespace schoolcalc_foreground

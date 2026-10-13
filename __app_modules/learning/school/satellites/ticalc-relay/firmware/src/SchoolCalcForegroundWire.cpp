#include "SchoolCalcForegroundWire.h"

#include "SchoolCalcWire.h"

#include <string.h>

namespace schoolcalc_foreground {

static constexpr uint8_t MAGIC[4] = { 'S', 'C', 'F', '1' };
static constexpr uint8_t FLAGS_V1 = 0;
static constexpr uint16_t KNOWN_CAPABILITIES =
  CapabilityVariableIo | CapabilityPhaseAwareness | CapabilityKeyInput
  | CapabilityHeartbeat;

static uint16_t readU16(const uint8_t* bytes) {
  return static_cast<uint16_t>(bytes[0] | (static_cast<uint16_t>(bytes[1]) << 8));
}

static void writeU16(uint8_t* bytes, uint16_t value) {
  bytes[0] = static_cast<uint8_t>(value & 0xFF);
  bytes[1] = static_cast<uint8_t>(value >> 8);
}

static uint32_t readU32(const uint8_t* bytes) {
  return static_cast<uint32_t>(bytes[0])
    | (static_cast<uint32_t>(bytes[1]) << 8)
    | (static_cast<uint32_t>(bytes[2]) << 16)
    | (static_cast<uint32_t>(bytes[3]) << 24);
}

static void writeU32(uint8_t* bytes, uint32_t value) {
  bytes[0] = static_cast<uint8_t>(value & 0xFF);
  bytes[1] = static_cast<uint8_t>((value >> 8) & 0xFF);
  bytes[2] = static_cast<uint8_t>((value >> 16) & 0xFF);
  bytes[3] = static_cast<uint8_t>(value >> 24);
}

static bool nonzeroNonce(const uint8_t nonce[SESSION_NONCE_BYTES]) {
  uint8_t combined = 0;
  for (size_t index = 0; index < SESSION_NONCE_BYTES; ++index) combined |= nonce[index];
  return combined != 0;
}

size_t encodedFrameSize(uint16_t payloadLength) {
  return FRAME_HEADER_BYTES + static_cast<size_t>(payloadLength) + FRAME_CRC_BYTES;
}

bool validFrameType(uint8_t value) {
  switch (static_cast<FrameType>(value)) {
    case FrameType::Hello:
    case FrameType::HelloAck:
    case FrameType::Phase:
    case FrameType::Ping:
    case FrameType::Pong:
    case FrameType::ReadRequest:
    case FrameType::VariableMissing:
    case FrameType::VariableBegin:
    case FrameType::VariableChunk:
    case FrameType::VariableEnd:
    case FrameType::WriteBegin:
    case FrameType::WriteReady:
    case FrameType::WriteChunk:
    case FrameType::WriteEnd:
    case FrameType::VariableStored:
    case FrameType::Ack:
    case FrameType::Error:
    case FrameType::Cancel:
    case FrameType::Complete:
    case FrameType::KeyInput:
      return true;
  }
  return false;
}

DecodeStatus encodeFrame(FrameType type, uint16_t sequence,
                         const uint8_t* payload, uint16_t payloadLength,
                         uint8_t* output, size_t outputCapacity,
                         size_t& outputLength) {
  outputLength = 0;
  if (!validFrameType(static_cast<uint8_t>(type))) return DecodeStatus::UnknownType;
  if (payloadLength > MAX_PAYLOAD_BYTES || (payloadLength > 0 && payload == nullptr)) {
    return DecodeStatus::InvalidLength;
  }
  const size_t required = encodedFrameSize(payloadLength);
  if (output == nullptr || outputCapacity < required) return DecodeStatus::OutputTooSmall;

  memcpy(output, MAGIC, sizeof(MAGIC));
  output[4] = static_cast<uint8_t>(type);
  output[5] = FLAGS_V1;
  output[6] = static_cast<uint8_t>(sequence & 0xFF);
  output[7] = static_cast<uint8_t>(sequence >> 8);
  output[8] = static_cast<uint8_t>(payloadLength & 0xFF);
  output[9] = static_cast<uint8_t>(payloadLength >> 8);
  if (payloadLength > 0) memcpy(output + FRAME_HEADER_BYTES, payload, payloadLength);
  const uint16_t crc = schoolcalc_wire::crc16Ccitt(output, required - FRAME_CRC_BYTES);
  output[required - 2] = static_cast<uint8_t>(crc & 0xFF);
  output[required - 1] = static_cast<uint8_t>(crc >> 8);
  outputLength = required;
  return DecodeStatus::Ok;
}

DecodeStatus decodeFrame(const uint8_t* bytes, size_t length, FrameView& output) {
  output = FrameView{};
  if (bytes == nullptr || length < FRAME_HEADER_BYTES + FRAME_CRC_BYTES) {
    return DecodeStatus::Truncated;
  }
  if (memcmp(bytes, MAGIC, sizeof(MAGIC)) != 0) return DecodeStatus::WrongMagic;
  if (!validFrameType(bytes[4])) return DecodeStatus::UnknownType;
  if (bytes[5] != FLAGS_V1) return DecodeStatus::InvalidFlags;
  const uint16_t payloadLength = static_cast<uint16_t>(
    bytes[8] | (static_cast<uint16_t>(bytes[9]) << 8));
  if (payloadLength > MAX_PAYLOAD_BYTES) return DecodeStatus::InvalidLength;
  const size_t expected = encodedFrameSize(payloadLength);
  if (length < expected) return DecodeStatus::Truncated;
  if (length > expected) return DecodeStatus::TrailingBytes;
  const uint16_t expectedCrc = static_cast<uint16_t>(
    bytes[expected - 2] | (static_cast<uint16_t>(bytes[expected - 1]) << 8));
  if (schoolcalc_wire::crc16Ccitt(bytes, expected - FRAME_CRC_BYTES) != expectedCrc) {
    return DecodeStatus::Checksum;
  }
  output.type = static_cast<FrameType>(bytes[4]);
  output.sequence = static_cast<uint16_t>(
    bytes[6] | (static_cast<uint16_t>(bytes[7]) << 8));
  output.payload = bytes + FRAME_HEADER_BYTES;
  output.payloadLength = payloadLength;
  return DecodeStatus::Ok;
}

bool validVariableName(const char* name) {
  if (name == nullptr) return false;
  const size_t length = strlen(name);
  if (length == 0 || length > 8) return false;
  for (size_t index = 0; index < length; ++index) {
    const uint8_t value = static_cast<uint8_t>(name[index]);
    if (!((value >= 'A' && value <= 'Z') || (value >= '0' && value <= '9'))) return false;
  }
  return true;
}

bool validPhaseCode(uint8_t value) {
  return value >= static_cast<uint8_t>(PhaseCode::ReadingIdentity)
    && value <= static_cast<uint8_t>(PhaseCode::StagingInteraction);
}

bool validDirectionCode(uint8_t value) {
  return value <= static_cast<uint8_t>(DirectionCode::RelayToCalculator);
}

bool validErrorCode(uint8_t value) {
  return value >= static_cast<uint8_t>(ErrorCode::InvalidState)
    && value <= static_cast<uint8_t>(ErrorCode::Cancelled);
}

bool validCompleteCode(uint8_t value) {
  return value == static_cast<uint8_t>(CompleteCode::Ready)
    || value == static_cast<uint8_t>(CompleteCode::Blocked);
}

DecodeStatus encodeHelloPayload(const HelloPayload& payload,
                                uint8_t output[HELLO_PAYLOAD_BYTES]) {
  if (output == nullptr) return DecodeStatus::OutputTooSmall;
  if (payload.version != PROTOCOL_VERSION) return DecodeStatus::UnsupportedVersion;
  if (payload.platform != PLATFORM_TI86) return DecodeStatus::UnsupportedPlatform;
  if ((payload.capabilities & REQUIRED_SYNC_CAPABILITIES) != REQUIRED_SYNC_CAPABILITIES
      || (payload.capabilities & ~KNOWN_CAPABILITIES) != 0) {
    return DecodeStatus::UnsupportedCapabilities;
  }
  if (payload.maxChunkBytes == 0 || payload.maxChunkBytes > MAX_CHUNK_DATA_BYTES
      || !nonzeroNonce(payload.nonce)) return DecodeStatus::InvalidValue;
  output[0] = payload.version;
  output[1] = payload.platform;
  writeU16(output + 2, payload.capabilities);
  writeU16(output + 4, payload.maxChunkBytes);
  memcpy(output + 6, payload.nonce, SESSION_NONCE_BYTES);
  return DecodeStatus::Ok;
}

DecodeStatus decodeHelloPayload(const uint8_t* bytes, uint16_t length,
                                HelloPayload& output) {
  output = HelloPayload{};
  if (bytes == nullptr || length != HELLO_PAYLOAD_BYTES) return DecodeStatus::InvalidPayload;
  output.version = bytes[0];
  output.platform = bytes[1];
  output.capabilities = readU16(bytes + 2);
  output.maxChunkBytes = readU16(bytes + 4);
  memcpy(output.nonce, bytes + 6, SESSION_NONCE_BYTES);
  if (output.version != PROTOCOL_VERSION) return DecodeStatus::UnsupportedVersion;
  if (output.platform != PLATFORM_TI86) return DecodeStatus::UnsupportedPlatform;
  if ((output.capabilities & REQUIRED_SYNC_CAPABILITIES) != REQUIRED_SYNC_CAPABILITIES
      || (output.capabilities & ~KNOWN_CAPABILITIES) != 0) {
    return DecodeStatus::UnsupportedCapabilities;
  }
  if (output.maxChunkBytes == 0 || output.maxChunkBytes > MAX_CHUNK_DATA_BYTES
      || !nonzeroNonce(output.nonce)) return DecodeStatus::InvalidValue;
  return DecodeStatus::Ok;
}

DecodeStatus encodeVariableNamePayload(const char* name, uint8_t* output,
                                       size_t outputCapacity, uint16_t& outputLength) {
  outputLength = 0;
  if (!validVariableName(name)) return DecodeStatus::InvalidName;
  const size_t nameLength = strlen(name);
  const size_t required = nameLength + 1;
  if (output == nullptr || outputCapacity < required) return DecodeStatus::OutputTooSmall;
  output[0] = static_cast<uint8_t>(nameLength);
  memcpy(output + 1, name, nameLength);
  outputLength = static_cast<uint16_t>(required);
  return DecodeStatus::Ok;
}

DecodeStatus decodeVariableNamePayload(const uint8_t* bytes, uint16_t length,
                                       VariableName& output) {
  output = VariableName{};
  if (bytes == nullptr || length < 2) return DecodeStatus::InvalidPayload;
  const uint8_t nameLength = bytes[0];
  if (nameLength == 0 || nameLength > 8 || length != static_cast<uint16_t>(nameLength + 1)) {
    return DecodeStatus::InvalidName;
  }
  memcpy(output.value, bytes + 1, nameLength);
  output.value[nameLength] = '\0';
  if (!validVariableName(output.value)) {
    output = VariableName{};
    return DecodeStatus::InvalidName;
  }
  output.length = nameLength;
  return DecodeStatus::Ok;
}

DecodeStatus encodeVariableDescriptorPayload(const char* name, uint16_t totalLength,
                                              uint16_t recordCrc, uint8_t* output,
                                              size_t outputCapacity,
                                              uint16_t& outputLength) {
  DecodeStatus status = encodeVariableNamePayload(
    name, output, outputCapacity, outputLength);
  if (status != DecodeStatus::Ok) return status;
  if (outputCapacity < static_cast<size_t>(outputLength) + 4) {
    outputLength = 0;
    return DecodeStatus::OutputTooSmall;
  }
  writeU16(output + outputLength, totalLength);
  writeU16(output + outputLength + 2, recordCrc);
  outputLength = static_cast<uint16_t>(outputLength + 4);
  return DecodeStatus::Ok;
}

DecodeStatus decodeVariableDescriptorPayload(const uint8_t* bytes, uint16_t length,
                                              VariableDescriptor& output) {
  output = VariableDescriptor{};
  if (bytes == nullptr || length < 6) return DecodeStatus::InvalidPayload;
  const uint8_t nameLength = bytes[0];
  const uint16_t namePayloadLength = static_cast<uint16_t>(nameLength + 1);
  if (nameLength == 0 || nameLength > 8 || length != namePayloadLength + 4) {
    return DecodeStatus::InvalidPayload;
  }
  DecodeStatus status = decodeVariableNamePayload(bytes, namePayloadLength, output.name);
  if (status != DecodeStatus::Ok) return status;
  output.totalLength = readU16(bytes + namePayloadLength);
  output.recordCrc = readU16(bytes + namePayloadLength + 2);
  return DecodeStatus::Ok;
}

DecodeStatus encodeChunkPayload(uint16_t offset, const uint8_t* bytes, uint16_t length,
                                uint8_t* output, size_t outputCapacity,
                                uint16_t& outputLength) {
  outputLength = 0;
  if (bytes == nullptr || length == 0 || length > MAX_CHUNK_DATA_BYTES) {
    return DecodeStatus::InvalidPayload;
  }
  const size_t required = static_cast<size_t>(length) + 2;
  if (output == nullptr || outputCapacity < required) return DecodeStatus::OutputTooSmall;
  writeU16(output, offset);
  memcpy(output + 2, bytes, length);
  outputLength = static_cast<uint16_t>(required);
  return DecodeStatus::Ok;
}

DecodeStatus decodeChunkPayload(const uint8_t* bytes, uint16_t length, ChunkView& output) {
  output = ChunkView{};
  if (bytes == nullptr || length < 3 || length > MAX_PAYLOAD_BYTES) {
    return DecodeStatus::InvalidPayload;
  }
  output.offset = readU16(bytes);
  output.bytes = bytes + 2;
  output.length = static_cast<uint16_t>(length - 2);
  return DecodeStatus::Ok;
}

void encodeTransferEndPayload(const TransferEndPayload& payload,
                              uint8_t output[TRANSFER_END_PAYLOAD_BYTES]) {
  writeU16(output, payload.totalLength);
  writeU16(output + 2, payload.recordCrc);
}

DecodeStatus decodeTransferEndPayload(const uint8_t* bytes, uint16_t length,
                                      TransferEndPayload& output) {
  output = TransferEndPayload{};
  if (bytes == nullptr || length != TRANSFER_END_PAYLOAD_BYTES) {
    return DecodeStatus::InvalidPayload;
  }
  output.totalLength = readU16(bytes);
  output.recordCrc = readU16(bytes + 2);
  return DecodeStatus::Ok;
}

void encodeAckPayload(const AckPayload& payload, uint8_t output[ACK_PAYLOAD_BYTES]) {
  output[0] = static_cast<uint8_t>(payload.acknowledgedType);
  writeU16(output + 1, payload.nextOffset);
}

DecodeStatus decodeAckPayload(const uint8_t* bytes, uint16_t length, AckPayload& output) {
  output = AckPayload{};
  if (bytes == nullptr || length != ACK_PAYLOAD_BYTES || !validFrameType(bytes[0])
      || bytes[0] == static_cast<uint8_t>(FrameType::Ack)
      || bytes[0] == static_cast<uint8_t>(FrameType::Error)) {
    return DecodeStatus::InvalidPayload;
  }
  output.acknowledgedType = static_cast<FrameType>(bytes[0]);
  output.nextOffset = readU16(bytes + 1);
  return DecodeStatus::Ok;
}

void encodePhasePayload(const PhasePayload& payload, uint8_t output[PHASE_PAYLOAD_BYTES]) {
  output[0] = static_cast<uint8_t>(payload.phase);
  output[1] = static_cast<uint8_t>(payload.direction);
  output[2] = payload.itemsCompleted;
  output[3] = payload.itemsTotal;
  output[4] = payload.safeToUnplug ? 1 : 0;
}

DecodeStatus decodePhasePayload(const uint8_t* bytes, uint16_t length, PhasePayload& output) {
  output = PhasePayload{};
  if (bytes == nullptr || length != PHASE_PAYLOAD_BYTES || !validPhaseCode(bytes[0])
      || !validDirectionCode(bytes[1]) || bytes[4] > 1
      || (bytes[3] == 0 ? bytes[2] != 0 : bytes[2] > bytes[3])) {
    return DecodeStatus::InvalidPayload;
  }
  output.phase = static_cast<PhaseCode>(bytes[0]);
  output.direction = static_cast<DirectionCode>(bytes[1]);
  output.itemsCompleted = bytes[2];
  output.itemsTotal = bytes[3];
  output.safeToUnplug = bytes[4] == 1;
  return DecodeStatus::Ok;
}

void encodeErrorPayload(const ErrorPayload& payload, uint8_t output[ERROR_PAYLOAD_BYTES]) {
  output[0] = static_cast<uint8_t>(payload.code);
  output[1] = static_cast<uint8_t>(payload.offendingType);
  writeU16(output + 2, payload.expectedOffset);
}

DecodeStatus decodeErrorPayload(const uint8_t* bytes, uint16_t length, ErrorPayload& output) {
  output = ErrorPayload{};
  if (bytes == nullptr || length != ERROR_PAYLOAD_BYTES || !validErrorCode(bytes[0])
      || !validFrameType(bytes[1])) return DecodeStatus::InvalidPayload;
  output.code = static_cast<ErrorCode>(bytes[0]);
  output.offendingType = static_cast<FrameType>(bytes[1]);
  output.expectedOffset = readU16(bytes + 2);
  return DecodeStatus::Ok;
}

DecodeStatus encodeCompletePayload(CompleteCode code,
                                   uint8_t output[COMPLETE_PAYLOAD_BYTES]) {
  if (output == nullptr) return DecodeStatus::OutputTooSmall;
  if (!validCompleteCode(static_cast<uint8_t>(code))) return DecodeStatus::InvalidValue;
  output[0] = static_cast<uint8_t>(code);
  return DecodeStatus::Ok;
}

DecodeStatus decodeCompletePayload(const uint8_t* bytes, uint16_t length,
                                   CompleteCode& output) {
  if (bytes == nullptr || length != COMPLETE_PAYLOAD_BYTES || !validCompleteCode(bytes[0])) {
    return DecodeStatus::InvalidPayload;
  }
  output = static_cast<CompleteCode>(bytes[0]);
  return DecodeStatus::Ok;
}

static bool validKeyInputPayload(const KeyInputPayload& payload) {
  if (payload.mappingVersion != KEY_INPUT_MAPPING_VERSION
      || payload.eventSequence == 0
      || (payload.flags & ~KEY_INPUT_KNOWN_FLAGS) != 0) return false;
  if (payload.inputType == KEY_INPUT_TYPE_KEY) {
    return payload.value >= 1 && payload.value <= KEY_INPUT_MAX_LOGICAL_KEY;
  }
  return payload.inputType == KEY_INPUT_TYPE_TEXT
    && payload.value >= 0x20 && payload.value <= 0x7E;
}

DecodeStatus encodeKeyInputPayload(const KeyInputPayload& payload,
                                   uint8_t output[KEY_INPUT_PAYLOAD_BYTES]) {
  if (output == nullptr) return DecodeStatus::OutputTooSmall;
  if (!validKeyInputPayload(payload)) return DecodeStatus::InvalidValue;
  output[0] = payload.mappingVersion;
  output[1] = payload.inputType;
  output[2] = payload.value;
  output[3] = payload.flags;
  writeU32(output + 4, payload.eventSequence);
  return DecodeStatus::Ok;
}

DecodeStatus decodeKeyInputPayload(const uint8_t* bytes, uint16_t length,
                                   KeyInputPayload& output) {
  output = KeyInputPayload{};
  if (bytes == nullptr || length != KEY_INPUT_PAYLOAD_BYTES) {
    return DecodeStatus::InvalidPayload;
  }
  output.mappingVersion = bytes[0];
  output.inputType = bytes[1];
  output.value = bytes[2];
  output.flags = bytes[3];
  output.eventSequence = readU32(bytes + 4);
  if (!validKeyInputPayload(output)) {
    output = KeyInputPayload{};
    return DecodeStatus::InvalidValue;
  }
  return DecodeStatus::Ok;
}

DecodeStatus encodeHeartbeatPayload(const HeartbeatPayload& payload,
                                    uint8_t output[HEARTBEAT_PAYLOAD_BYTES]) {
  if (output == nullptr) return DecodeStatus::OutputTooSmall;
  if (payload.token == 0) return DecodeStatus::InvalidValue;
  writeU32(output, payload.token);
  writeU32(output + 4, payload.senderUptimeMs);
  return DecodeStatus::Ok;
}

DecodeStatus decodeHeartbeatPayload(const uint8_t* bytes, uint16_t length,
                                    HeartbeatPayload& output) {
  output = HeartbeatPayload{};
  if (bytes == nullptr || length != HEARTBEAT_PAYLOAD_BYTES) {
    return DecodeStatus::InvalidPayload;
  }
  output.token = readU32(bytes);
  output.senderUptimeMs = readU32(bytes + 4);
  if (output.token == 0) {
    output = HeartbeatPayload{};
    return DecodeStatus::InvalidValue;
  }
  return DecodeStatus::Ok;
}

const char* frameTypeText(FrameType type) {
  switch (type) {
    case FrameType::Hello: return "hello";
    case FrameType::HelloAck: return "hello_ack";
    case FrameType::Phase: return "phase";
    case FrameType::Ping: return "ping";
    case FrameType::Pong: return "pong";
    case FrameType::ReadRequest: return "read_request";
    case FrameType::VariableMissing: return "variable_missing";
    case FrameType::VariableBegin: return "variable_begin";
    case FrameType::VariableChunk: return "variable_chunk";
    case FrameType::VariableEnd: return "variable_end";
    case FrameType::WriteBegin: return "write_begin";
    case FrameType::WriteReady: return "write_ready";
    case FrameType::WriteChunk: return "write_chunk";
    case FrameType::WriteEnd: return "write_end";
    case FrameType::VariableStored: return "variable_stored";
    case FrameType::Ack: return "ack";
    case FrameType::Error: return "error";
    case FrameType::Cancel: return "cancel";
    case FrameType::Complete: return "complete";
    case FrameType::KeyInput: return "key_input";
  }
  return "unknown";
}

const char* decodeStatusText(DecodeStatus status) {
  switch (status) {
    case DecodeStatus::Ok: return "ok";
    case DecodeStatus::Truncated: return "truncated";
    case DecodeStatus::TrailingBytes: return "trailing bytes";
    case DecodeStatus::OutputTooSmall: return "output too small";
    case DecodeStatus::WrongMagic: return "wrong foreground magic";
    case DecodeStatus::UnknownType: return "unknown foreground frame type";
    case DecodeStatus::InvalidFlags: return "unsupported foreground flags";
    case DecodeStatus::InvalidLength: return "invalid foreground payload length";
    case DecodeStatus::Checksum: return "foreground CRC failed";
    case DecodeStatus::InvalidPayload: return "invalid foreground message payload";
    case DecodeStatus::InvalidName: return "invalid foreground variable name";
    case DecodeStatus::UnsupportedVersion: return "unsupported foreground protocol version";
    case DecodeStatus::UnsupportedPlatform: return "unsupported foreground calculator platform";
    case DecodeStatus::UnsupportedCapabilities: return "missing or unknown foreground capability";
    case DecodeStatus::InvalidValue: return "invalid foreground message value";
  }
  return "unknown";
}

}  // namespace schoolcalc_foreground

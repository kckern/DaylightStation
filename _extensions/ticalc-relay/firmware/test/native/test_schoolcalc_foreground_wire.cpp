#include "SchoolCalcForegroundWire.h"

#include <assert.h>
#include <string.h>

using namespace schoolcalc_foreground;

void runSchoolCalcForegroundWireTests() {
  const uint8_t payload[] = { 0x01, 0x02, 0x03 };
  uint8_t encoded[MAX_FRAME_BYTES]{};
  size_t encodedLength = 0;
  assert(encodeFrame(FrameType::Hello, 0x1234, payload, sizeof(payload),
                     encoded, sizeof(encoded), encodedLength) == DecodeStatus::Ok);
  const uint8_t golden[] = {
    'S', 'C', 'F', '1', 0x01, 0x00, 0x34, 0x12, 0x03, 0x00,
    0x01, 0x02, 0x03, 0xA2, 0x69,
  };
  assert(encodedLength == sizeof(golden));
  assert(memcmp(encoded, golden, sizeof(golden)) == 0);

  FrameView decoded{};
  assert(decodeFrame(encoded, encodedLength, decoded) == DecodeStatus::Ok);
  assert(decoded.type == FrameType::Hello);
  assert(decoded.sequence == 0x1234);
  assert(decoded.payloadLength == sizeof(payload));
  assert(memcmp(decoded.payload, payload, sizeof(payload)) == 0);

  encoded[10] ^= 1;
  assert(decodeFrame(encoded, encodedLength, decoded) == DecodeStatus::Checksum);
  encoded[10] ^= 1;
  encoded[5] = 1;
  assert(decodeFrame(encoded, encodedLength, decoded) == DecodeStatus::InvalidFlags);
  encoded[5] = 0;
  encoded[4] = 0xFF;
  assert(decodeFrame(encoded, encodedLength, decoded) == DecodeStatus::UnknownType);
  encoded[4] = static_cast<uint8_t>(FrameType::Hello);
  assert(decodeFrame(encoded, encodedLength - 1, decoded) == DecodeStatus::Truncated);
  assert(decodeFrame(encoded, encodedLength + 1, decoded) == DecodeStatus::TrailingBytes);

  uint8_t tooLarge[MAX_PAYLOAD_BYTES + 1]{};
  assert(encodeFrame(FrameType::VariableChunk, 1, tooLarge, sizeof(tooLarge),
                     encoded, sizeof(encoded), encodedLength) == DecodeStatus::InvalidLength);
  assert(strcmp(frameTypeText(FrameType::VariableStored), "variable_stored") == 0);
  assert(DEFAULT_CHUNK_BYTES <= MAX_PAYLOAD_BYTES);

  HelloPayload hello{};
  hello.version = PROTOCOL_VERSION;
  hello.platform = PLATFORM_TI86;
  hello.capabilities = REQUIRED_SYNC_CAPABILITIES;
  hello.maxChunkBytes = DEFAULT_CHUNK_BYTES;
  for (size_t index = 0; index < SESSION_NONCE_BYTES; ++index) {
    hello.nonce[index] = static_cast<uint8_t>(index + 1);
  }
  uint8_t helloBytes[HELLO_PAYLOAD_BYTES]{};
  assert(encodeHelloPayload(hello, helloBytes) == DecodeStatus::Ok);
  const uint8_t helloGolden[HELLO_PAYLOAD_BYTES] = {
    0x01, 0x86, 0x03, 0x00, 0x80, 0x00,
    0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
  };
  assert(memcmp(helloBytes, helloGolden, sizeof(helloGolden)) == 0);
  HelloPayload decodedHello{};
  assert(decodeHelloPayload(helloBytes, sizeof(helloBytes), decodedHello) == DecodeStatus::Ok);
  assert(decodedHello.platform == PLATFORM_TI86);
  assert(decodedHello.maxChunkBytes == DEFAULT_CHUNK_BYTES);
  helloBytes[2] = 0;
  assert(decodeHelloPayload(helloBytes, sizeof(helloBytes), decodedHello)
         == DecodeStatus::UnsupportedCapabilities);
  helloBytes[2] = static_cast<uint8_t>(REQUIRED_SYNC_CAPABILITIES);

  uint8_t descriptorBytes[16]{};
  uint16_t descriptorLength = 0;
  assert(encodeVariableDescriptorPayload("DSINFO", 0x1234, 0x5678,
                                         descriptorBytes, sizeof(descriptorBytes),
                                         descriptorLength) == DecodeStatus::Ok);
  const uint8_t descriptorGolden[] = {
    0x06, 'D', 'S', 'I', 'N', 'F', 'O', 0x34, 0x12, 0x78, 0x56,
  };
  assert(descriptorLength == sizeof(descriptorGolden));
  assert(memcmp(descriptorBytes, descriptorGolden, sizeof(descriptorGolden)) == 0);
  VariableDescriptor descriptor{};
  assert(decodeVariableDescriptorPayload(descriptorBytes, descriptorLength, descriptor)
         == DecodeStatus::Ok);
  assert(strcmp(descriptor.name.value, "DSINFO") == 0);
  assert(descriptor.totalLength == 0x1234 && descriptor.recordCrc == 0x5678);

  const uint8_t chunkSource[] = { 0xAA, 0xBB, 0xCC };
  uint8_t chunkBytes[8]{};
  uint16_t chunkLength = 0;
  assert(encodeChunkPayload(0x0102, chunkSource, sizeof(chunkSource),
                            chunkBytes, sizeof(chunkBytes), chunkLength) == DecodeStatus::Ok);
  const uint8_t chunkGolden[] = { 0x02, 0x01, 0xAA, 0xBB, 0xCC };
  assert(chunkLength == sizeof(chunkGolden));
  assert(memcmp(chunkBytes, chunkGolden, sizeof(chunkGolden)) == 0);
  ChunkView chunk{};
  assert(decodeChunkPayload(chunkBytes, chunkLength, chunk) == DecodeStatus::Ok);
  assert(chunk.offset == 0x0102 && chunk.length == sizeof(chunkSource));
  assert(memcmp(chunk.bytes, chunkSource, sizeof(chunkSource)) == 0);

  uint8_t ackBytes[ACK_PAYLOAD_BYTES]{};
  encodeAckPayload({ FrameType::VariableChunk, 0x3456 }, ackBytes);
  AckPayload ack{};
  assert(decodeAckPayload(ackBytes, sizeof(ackBytes), ack) == DecodeStatus::Ok);
  assert(ack.acknowledgedType == FrameType::VariableChunk && ack.nextOffset == 0x3456);

  uint8_t phaseBytes[PHASE_PAYLOAD_BYTES]{};
  encodePhasePayload({ PhaseCode::StagingArtifacts, DirectionCode::RelayToCalculator,
                       2, 5, false }, phaseBytes);
  PhasePayload phase{};
  assert(decodePhasePayload(phaseBytes, sizeof(phaseBytes), phase) == DecodeStatus::Ok);
  assert(phase.phase == PhaseCode::StagingArtifacts && phase.itemsCompleted == 2);
  phaseBytes[2] = 6;
  assert(decodePhasePayload(phaseBytes, sizeof(phaseBytes), phase)
         == DecodeStatus::InvalidPayload);

  uint8_t errorBytes[ERROR_PAYLOAD_BYTES]{};
  encodeErrorPayload({ ErrorCode::InvalidOffset, FrameType::VariableChunk, 128 }, errorBytes);
  ErrorPayload error{};
  assert(decodeErrorPayload(errorBytes, sizeof(errorBytes), error) == DecodeStatus::Ok);
  assert(error.code == ErrorCode::InvalidOffset && error.expectedOffset == 128);

  uint8_t completeBytes[COMPLETE_PAYLOAD_BYTES]{};
  assert(encodeCompletePayload(CompleteCode::Ready, completeBytes) == DecodeStatus::Ok);
  CompleteCode complete = CompleteCode::Blocked;
  assert(decodeCompletePayload(completeBytes, sizeof(completeBytes), complete) == DecodeStatus::Ok);
  assert(complete == CompleteCode::Ready);

  KeyInputPayload input{
    KEY_INPUT_MAPPING_VERSION, KEY_INPUT_TYPE_TEXT,
    static_cast<uint8_t>('A'), 0x01, 0x78563412,
  };
  uint8_t inputBytes[KEY_INPUT_PAYLOAD_BYTES]{};
  assert(encodeKeyInputPayload(input, inputBytes) == DecodeStatus::Ok);
  const uint8_t inputGolden[KEY_INPUT_PAYLOAD_BYTES] = {
    0x01, 0x02, 'A', 0x01, 0x12, 0x34, 0x56, 0x78,
  };
  assert(memcmp(inputBytes, inputGolden, sizeof(inputGolden)) == 0);
  KeyInputPayload decodedInput{};
  assert(decodeKeyInputPayload(inputBytes, sizeof(inputBytes), decodedInput)
         == DecodeStatus::Ok);
  assert(decodedInput.eventSequence == 0x78563412
         && decodedInput.value == 'A');
  inputBytes[0] = 2;
  assert(decodeKeyInputPayload(inputBytes, sizeof(inputBytes), decodedInput)
         == DecodeStatus::InvalidValue);
  inputBytes[0] = KEY_INPUT_MAPPING_VERSION;
  inputBytes[3] = 0x80;
  assert(decodeKeyInputPayload(inputBytes, sizeof(inputBytes), decodedInput)
         == DecodeStatus::InvalidValue);
  assert(strcmp(frameTypeText(FrameType::KeyInput), "key_input") == 0);

  HeartbeatPayload heartbeat{ 0x78563412, 0x44332211 };
  uint8_t heartbeatBytes[HEARTBEAT_PAYLOAD_BYTES]{};
  assert(encodeHeartbeatPayload(heartbeat, heartbeatBytes) == DecodeStatus::Ok);
  const uint8_t heartbeatGolden[HEARTBEAT_PAYLOAD_BYTES] = {
    0x12, 0x34, 0x56, 0x78, 0x11, 0x22, 0x33, 0x44,
  };
  assert(memcmp(heartbeatBytes, heartbeatGolden, sizeof(heartbeatGolden)) == 0);
  HeartbeatPayload decodedHeartbeat{};
  assert(decodeHeartbeatPayload(heartbeatBytes, sizeof(heartbeatBytes),
                                decodedHeartbeat) == DecodeStatus::Ok);
  assert(decodedHeartbeat.token == heartbeat.token
         && decodedHeartbeat.senderUptimeMs == heartbeat.senderUptimeMs);
  memset(heartbeatBytes, 0, 4);
  assert(decodeHeartbeatPayload(heartbeatBytes, sizeof(heartbeatBytes),
                                decodedHeartbeat) == DecodeStatus::InvalidValue);
}

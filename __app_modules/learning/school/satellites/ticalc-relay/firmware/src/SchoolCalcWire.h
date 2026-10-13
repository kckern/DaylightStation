#pragma once

#include <stddef.h>
#include <stdint.h>

namespace schoolcalc_wire {

static constexpr uint8_t HOST_ID = 0x06;
static constexpr uint8_t TI86_ID = 0x86;
static constexpr uint8_t TYPE_STRING = 0x0C;
static constexpr uint8_t CMD_VAR = 0x06;
static constexpr uint8_t CMD_CTS = 0x09;
static constexpr uint8_t CMD_DATA = 0x15;
static constexpr uint8_t CMD_EXIT = 0x36;
static constexpr uint8_t CMD_ACK = 0x56;
static constexpr uint8_t CMD_ERR = 0x5A;
static constexpr uint8_t CMD_SCREENSHOT = 0x6D;
static constexpr uint8_t CMD_KEY = 0x87;
static constexpr uint8_t CMD_EOT = 0x92;
static constexpr uint8_t CMD_REQ = 0xA2;
static constexpr uint8_t CMD_RTS = 0xC9;
static constexpr size_t PADDED_VARIABLE_HEADER_BYTES = 12;
static constexpr size_t MAX_VARIABLE_NAME_BYTES = 8;

enum class DecodeStatus : uint8_t {
  Ok,
  Truncated,
  TrailingBytes,
  OutputTooSmall,
  InvalidName,
  InvalidPadding,
  InvalidStringLength,
  WrongMagic,
  UnsupportedVersion,
  InvalidEnvelopeLength,
  Checksum,
};

struct PacketView {
  uint8_t machineId;
  uint8_t command;
  uint16_t declaredLength;
  const uint8_t* data;
  uint16_t dataLength;
};

struct VariableHeader {
  uint16_t dataLength;
  uint8_t type;
  uint8_t nameLength;
  char name[MAX_VARIABLE_NAME_BYTES + 1];
};

bool commandCarriesData(uint8_t command);
uint16_t additiveChecksum(const uint8_t* bytes, size_t length);
uint16_t crc16Ccitt(const uint8_t* bytes, size_t length);

size_t encodedPacketSize(uint8_t command, uint16_t dataLength);
DecodeStatus encodePacket(uint8_t machineId, uint8_t command,
                          uint16_t declaredLength, const uint8_t* data,
                          uint16_t dataLength, uint8_t* output,
                          size_t outputCapacity, size_t& outputLength);
DecodeStatus decodePacket(const uint8_t* bytes, size_t length, PacketView& output);

// TI's direct-key command is the one documented packet exception: the two
// header "length" bytes carry the scan code and there is no body/checksum.
// Keeping its encoder explicit prevents a generic packet implementation from
// accidentally appending scan-code bytes as data.
void encodeDirectKeyCommand(uint16_t scanCode, uint8_t output[4]);

DecodeStatus encodePaddedVariableHeader(uint16_t dataLength, uint8_t type,
                                        const char* name, uint8_t output[12]);
DecodeStatus decodeVariableHeader(const uint8_t* bytes, size_t length,
                                  VariableHeader& output);

DecodeStatus wrapStringPayload(const uint8_t* payload, uint16_t payloadLength,
                               uint8_t* output, size_t outputCapacity,
                               uint16_t& outputLength);
DecodeStatus unwrapStringPayload(const uint8_t* variableData, uint16_t variableDataLength,
                                 const uint8_t*& payload, uint16_t& payloadLength);

DecodeStatus validateSchoolCalcEnvelope(const uint8_t* bytes, size_t length,
                                        const char expectedMagic[4],
                                        uint8_t expectedVersion = 1);

const char* decodeStatusText(DecodeStatus status);

}  // namespace schoolcalc_wire

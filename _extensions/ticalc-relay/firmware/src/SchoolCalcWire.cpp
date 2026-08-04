#include "SchoolCalcWire.h"

#include <string.h>

namespace schoolcalc_wire {

bool commandCarriesData(uint8_t command) {
  switch (command) {
    case CMD_VAR:
    case CMD_DATA:
    case CMD_EXIT:
    case CMD_REQ:
    case CMD_RTS:
      return true;
    default:
      return false;
  }
}

uint16_t additiveChecksum(const uint8_t* bytes, size_t length) {
  uint16_t checksum = 0;
  for (size_t index = 0; index < length; ++index) {
    checksum = static_cast<uint16_t>(checksum + bytes[index]);
  }
  return checksum;
}

uint16_t crc16Ccitt(const uint8_t* bytes, size_t length) {
  uint16_t crc = 0xFFFF;
  for (size_t index = 0; index < length; ++index) {
    crc ^= static_cast<uint16_t>(bytes[index]) << 8;
    for (uint8_t bit = 0; bit < 8; ++bit) {
      crc = (crc & 0x8000) != 0
        ? static_cast<uint16_t>((crc << 1) ^ 0x1021)
        : static_cast<uint16_t>(crc << 1);
    }
  }
  return crc;
}

size_t encodedPacketSize(uint8_t command, uint16_t dataLength) {
  return commandCarriesData(command) && dataLength > 0
    ? static_cast<size_t>(dataLength) + 6
    : 4;
}

DecodeStatus encodePacket(uint8_t machineId, uint8_t command,
                          uint16_t declaredLength, const uint8_t* data,
                          uint16_t dataLength, uint8_t* output,
                          size_t outputCapacity, size_t& outputLength) {
  const bool carriesData = commandCarriesData(command);
  if ((carriesData && declaredLength != dataLength)
      || (!carriesData && dataLength != 0)
      || (dataLength > 0 && data == nullptr)) {
    return DecodeStatus::InvalidEnvelopeLength;
  }
  outputLength = encodedPacketSize(command, dataLength);
  if (output == nullptr || outputCapacity < outputLength) return DecodeStatus::OutputTooSmall;
  output[0] = machineId;
  output[1] = command;
  output[2] = static_cast<uint8_t>(declaredLength & 0xFF);
  output[3] = static_cast<uint8_t>(declaredLength >> 8);
  if (carriesData && dataLength > 0) {
    memcpy(output + 4, data, dataLength);
    const uint16_t checksum = additiveChecksum(data, dataLength);
    output[4 + dataLength] = static_cast<uint8_t>(checksum & 0xFF);
    output[5 + dataLength] = static_cast<uint8_t>(checksum >> 8);
  }
  return DecodeStatus::Ok;
}

DecodeStatus decodePacket(const uint8_t* bytes, size_t length, PacketView& output) {
  if (bytes == nullptr || length < 4) return DecodeStatus::Truncated;
  output.machineId = bytes[0];
  output.command = bytes[1];
  output.declaredLength = static_cast<uint16_t>(bytes[2] | (static_cast<uint16_t>(bytes[3]) << 8));
  output.data = nullptr;
  output.dataLength = 0;
  if (!commandCarriesData(output.command) || output.declaredLength == 0) {
    return length == 4 ? DecodeStatus::Ok : DecodeStatus::TrailingBytes;
  }
  const size_t expected = static_cast<size_t>(output.declaredLength) + 6;
  if (length < expected) return DecodeStatus::Truncated;
  if (length > expected) return DecodeStatus::TrailingBytes;
  const uint16_t expectedChecksum = static_cast<uint16_t>(
    bytes[4 + output.declaredLength]
      | (static_cast<uint16_t>(bytes[5 + output.declaredLength]) << 8));
  if (additiveChecksum(bytes + 4, output.declaredLength) != expectedChecksum) {
    return DecodeStatus::Checksum;
  }
  output.data = bytes + 4;
  output.dataLength = output.declaredLength;
  return DecodeStatus::Ok;
}

void encodeDirectKeyCommand(uint16_t scanCode, uint8_t output[4]) {
  output[0] = HOST_ID;
  output[1] = CMD_KEY;
  output[2] = static_cast<uint8_t>(scanCode & 0xFF);
  output[3] = static_cast<uint8_t>(scanCode >> 8);
}

DecodeStatus encodePaddedVariableHeader(uint16_t dataLength, uint8_t type,
                                        const char* name, uint8_t output[12]) {
  if (name == nullptr || output == nullptr) return DecodeStatus::InvalidName;
  const size_t nameLength = strlen(name);
  if (nameLength == 0 || nameLength > MAX_VARIABLE_NAME_BYTES) return DecodeStatus::InvalidName;
  for (size_t index = 0; index < nameLength; ++index) {
    const uint8_t c = static_cast<uint8_t>(name[index]);
    if (!(c >= 'A' && c <= 'Z') && !(c >= '0' && c <= '9')) return DecodeStatus::InvalidName;
  }
  output[0] = static_cast<uint8_t>(dataLength & 0xFF);
  output[1] = static_cast<uint8_t>(dataLength >> 8);
  output[2] = type;
  output[3] = static_cast<uint8_t>(nameLength);
  memset(output + 4, 0x20, MAX_VARIABLE_NAME_BYTES);
  memcpy(output + 4, name, nameLength);
  return DecodeStatus::Ok;
}

DecodeStatus decodeVariableHeader(const uint8_t* bytes, size_t length,
                                  VariableHeader& output) {
  if (bytes == nullptr || length < 5) return DecodeStatus::Truncated;
  const uint8_t nameLength = bytes[3];
  if (nameLength == 0 || nameLength > MAX_VARIABLE_NAME_BYTES) return DecodeStatus::InvalidName;
  if (length < static_cast<size_t>(4 + nameLength)) return DecodeStatus::Truncated;
  if (length != static_cast<size_t>(4 + nameLength) && length != PADDED_VARIABLE_HEADER_BYTES) {
    return DecodeStatus::TrailingBytes;
  }
  if (length == PADDED_VARIABLE_HEADER_BYTES) {
    for (size_t index = 4 + nameLength; index < PADDED_VARIABLE_HEADER_BYTES; ++index) {
      if (bytes[index] != 0x00 && bytes[index] != 0x20) return DecodeStatus::InvalidPadding;
    }
  }
  for (size_t index = 0; index < nameLength; ++index) {
    const uint8_t c = bytes[4 + index];
    if (!(c >= 'A' && c <= 'Z') && !(c >= '0' && c <= '9')) return DecodeStatus::InvalidName;
    output.name[index] = static_cast<char>(c);
  }
  output.name[nameLength] = '\0';
  output.dataLength = static_cast<uint16_t>(bytes[0] | (static_cast<uint16_t>(bytes[1]) << 8));
  output.type = bytes[2];
  output.nameLength = nameLength;
  return DecodeStatus::Ok;
}

DecodeStatus wrapStringPayload(const uint8_t* payload, uint16_t payloadLength,
                               uint8_t* output, size_t outputCapacity,
                               uint16_t& outputLength) {
  if ((payloadLength > 0 && payload == nullptr) || output == nullptr
      || outputCapacity < static_cast<size_t>(payloadLength) + 2) {
    return DecodeStatus::OutputTooSmall;
  }
  output[0] = static_cast<uint8_t>(payloadLength & 0xFF);
  output[1] = static_cast<uint8_t>(payloadLength >> 8);
  if (payloadLength > 0) memcpy(output + 2, payload, payloadLength);
  outputLength = static_cast<uint16_t>(payloadLength + 2);
  return DecodeStatus::Ok;
}

DecodeStatus unwrapStringPayload(const uint8_t* variableData, uint16_t variableDataLength,
                                 const uint8_t*& payload, uint16_t& payloadLength) {
  if (variableData == nullptr || variableDataLength < 2) return DecodeStatus::Truncated;
  payloadLength = static_cast<uint16_t>(
    variableData[0] | (static_cast<uint16_t>(variableData[1]) << 8));
  if (static_cast<uint32_t>(payloadLength) + 2 != variableDataLength) {
    return DecodeStatus::InvalidStringLength;
  }
  payload = variableData + 2;
  return DecodeStatus::Ok;
}

DecodeStatus validateSchoolCalcEnvelope(const uint8_t* bytes, size_t length,
                                        const char expectedMagic[4],
                                        uint8_t expectedVersion) {
  if (bytes == nullptr || expectedMagic == nullptr || length < 9) return DecodeStatus::Truncated;
  if (memcmp(bytes, expectedMagic, 4) != 0) return DecodeStatus::WrongMagic;
  if (bytes[4] != expectedVersion) return DecodeStatus::UnsupportedVersion;
  const uint16_t bodyLength = static_cast<uint16_t>(bytes[5] | (static_cast<uint16_t>(bytes[6]) << 8));
  if (length != static_cast<size_t>(bodyLength) + 9) return DecodeStatus::InvalidEnvelopeLength;
  const uint16_t expectedCrc = static_cast<uint16_t>(
    bytes[length - 2] | (static_cast<uint16_t>(bytes[length - 1]) << 8));
  return crc16Ccitt(bytes, length - 2) == expectedCrc ? DecodeStatus::Ok : DecodeStatus::Checksum;
}

const char* decodeStatusText(DecodeStatus status) {
  switch (status) {
    case DecodeStatus::Ok: return "ok";
    case DecodeStatus::Truncated: return "truncated";
    case DecodeStatus::TrailingBytes: return "trailing bytes";
    case DecodeStatus::OutputTooSmall: return "output too small";
    case DecodeStatus::InvalidName: return "invalid variable name";
    case DecodeStatus::InvalidPadding: return "invalid variable header padding";
    case DecodeStatus::InvalidStringLength: return "invalid TI string length";
    case DecodeStatus::WrongMagic: return "wrong SchoolCalc magic";
    case DecodeStatus::UnsupportedVersion: return "unsupported SchoolCalc version";
    case DecodeStatus::InvalidEnvelopeLength: return "invalid declared length";
    case DecodeStatus::Checksum: return "checksum failed";
  }
  return "unknown";
}

}  // namespace schoolcalc_wire

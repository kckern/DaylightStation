#include "SchoolCalcBase64.h"
#include "SchoolCalcWire.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

using namespace schoolcalc_wire;

void runSchoolCalcRelaySessionTests();
void runSchoolCalcForegroundWireTests();
void runSchoolCalcForegroundSessionTests();
void runSchoolCalcTransportAwarenessTests();
void runSchoolCalcInputTests();
void runSchoolCalcDiagnosticsTests();

static void packetGolden() {
  uint8_t header[12];
  assert(encodePaddedVariableHeader(10, 0x00, "A", header) == DecodeStatus::Ok);
  uint8_t packet[32];
  size_t packetLength = 0;
  assert(encodePacket(HOST_ID, CMD_RTS, 12, header, 12, packet, sizeof(packet), packetLength)
         == DecodeStatus::Ok);
  const uint8_t expected[] = {
    0x06, 0xC9, 0x0C, 0x00,
    0x0A, 0x00, 0x00, 0x01, 0x41, 0x20, 0x20, 0x20,
    0x20, 0x20, 0x20, 0x20, 0x2C, 0x01,
  };
  assert(packetLength == sizeof(expected));
  assert(memcmp(packet, expected, sizeof(expected)) == 0);

  PacketView decoded{};
  assert(decodePacket(packet, packetLength, decoded) == DecodeStatus::Ok);
  assert(decoded.machineId == HOST_ID && decoded.command == CMD_RTS);
  assert(decoded.dataLength == 12);
}

static void ackEchoLengthHasNoBody() {
  const uint8_t ack[] = { 0x86, 0x56, 0x0C, 0x00 };
  PacketView decoded{};
  assert(decodePacket(ack, sizeof(ack), decoded) == DecodeStatus::Ok);
  assert(decoded.command == CMD_ACK && decoded.declaredLength == 12);
  assert(decoded.data == nullptr && decoded.dataLength == 0);
}

static void directKeyGolden() {
  uint8_t packet[4]{};
  encodeDirectKeyCommand(0x001D, packet);
  const uint8_t one[] = { 0x06, 0x87, 0x1D, 0x00 };
  assert(memcmp(packet, one, sizeof(one)) == 0);

  // The direct-key exception remains a header-only packet even with a nonzero
  // declared field, so the generic decoder must not wait for data/checksum.
  PacketView decoded{};
  assert(decodePacket(packet, sizeof(packet), decoded) == DecodeStatus::Ok);
  assert(decoded.machineId == HOST_ID && decoded.command == CMD_KEY);
  assert(decoded.declaredLength == 0x001D);
  assert(decoded.data == nullptr && decoded.dataLength == 0);
}

static void variableAndStringRoundTrip() {
  uint8_t header[12];
  assert(encodePaddedVariableHeader(7, TYPE_STRING, "DSINFO", header) == DecodeStatus::Ok);
  VariableHeader decoded{};
  assert(decodeVariableHeader(header, sizeof(header), decoded) == DecodeStatus::Ok);
  assert(decoded.dataLength == 7 && decoded.type == TYPE_STRING);
  assert(strcmp(decoded.name, "DSINFO") == 0);

  const uint8_t payload[] = { 'S', 'C', 'I', '1', 0x01 };
  uint8_t stringData[16];
  uint16_t stringLength = 0;
  assert(wrapStringPayload(payload, sizeof(payload), stringData, sizeof(stringData), stringLength)
         == DecodeStatus::Ok);
  assert(stringLength == 7 && stringData[0] == 5 && stringData[1] == 0);
  const uint8_t* unwrapped = nullptr;
  uint16_t unwrappedLength = 0;
  assert(unwrapStringPayload(stringData, stringLength, unwrapped, unwrappedLength)
         == DecodeStatus::Ok);
  assert(unwrappedLength == sizeof(payload));
  assert(memcmp(unwrapped, payload, sizeof(payload)) == 0);
}

static void envelopeIntegrity() {
  uint8_t envelope[] = { 'S', 'C', 'I', '1', 0x01, 0x02, 0x00, 0xAA, 0x55, 0x00, 0x00 };
  const uint16_t crc = crc16Ccitt(envelope, sizeof(envelope) - 2);
  envelope[sizeof(envelope) - 2] = static_cast<uint8_t>(crc & 0xFF);
  envelope[sizeof(envelope) - 1] = static_cast<uint8_t>(crc >> 8);
  assert(validateSchoolCalcEnvelope(envelope, sizeof(envelope), "SCI1") == DecodeStatus::Ok);
  envelope[8] ^= 0x01;
  assert(validateSchoolCalcEnvelope(envelope, sizeof(envelope), "SCI1") == DecodeStatus::Checksum);
  envelope[8] ^= 0x01;
  assert(validateSchoolCalcEnvelope(envelope, sizeof(envelope) - 1, "SCI1")
         == DecodeStatus::InvalidEnvelopeLength);
}

static void malformedInputsFailClosed() {
  uint8_t header[12];
  assert(encodePaddedVariableHeader(3, TYPE_STRING, "TOO-LONG!", header)
         == DecodeStatus::InvalidName);
  assert(encodePaddedVariableHeader(3, TYPE_STRING, "lower", header)
         == DecodeStatus::InvalidName);

  const uint8_t badString[] = { 4, 0, 'A' };
  const uint8_t* payload = nullptr;
  uint16_t payloadLength = 0;
  assert(unwrapStringPayload(badString, sizeof(badString), payload, payloadLength)
         == DecodeStatus::InvalidStringLength);

  uint8_t packet[] = { 0x06, 0x15, 0x01, 0x00, 0xAA, 0xAB, 0x00 };
  PacketView decoded{};
  assert(decodePacket(packet, sizeof(packet), decoded) == DecodeStatus::Checksum);
}

int main() {
  {
    const uint8_t source[] = { 0xFB, 0xFF, 0x00, 0x10 };
    char encoded[16];
    size_t encodedLength = 0;
    assert(schoolcalc_base64::encode(source, sizeof(source), encoded,
                                     sizeof(encoded), encodedLength));
    assert(strcmp(encoded, "-_8AEA") == 0);
    uint8_t decoded[8] = {};
    size_t decodedLength = 0;
    assert(schoolcalc_base64::decode(encoded, encodedLength, decoded,
                                     sizeof(decoded), decodedLength));
    assert(decodedLength == sizeof(source));
    assert(memcmp(decoded, source, sizeof(source)) == 0);
    assert(!schoolcalc_base64::decode("AB", 2, decoded, sizeof(decoded), decodedLength));
    assert(!schoolcalc_base64::decode("abc=", 4, decoded, sizeof(decoded), decodedLength));
  }
  packetGolden();
  ackEchoLengthHasNoBody();
  directKeyGolden();
  variableAndStringRoundTrip();
  envelopeIntegrity();
  malformedInputsFailClosed();
  runSchoolCalcForegroundWireTests();
  runSchoolCalcForegroundSessionTests();
  runSchoolCalcTransportAwarenessTests();
  runSchoolCalcRelaySessionTests();
  runSchoolCalcInputTests();
  runSchoolCalcDiagnosticsTests();
  puts("SchoolCalcWire native tests passed");
  return 0;
}

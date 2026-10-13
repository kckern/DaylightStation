#include "SchoolCalcBase64.h"

namespace schoolcalc_base64 {

static constexpr char ALPHABET[] =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

static int8_t valueOf(char character) {
  if (character >= 'A' && character <= 'Z') return character - 'A';
  if (character >= 'a' && character <= 'z') return character - 'a' + 26;
  if (character >= '0' && character <= '9') return character - '0' + 52;
  if (character == '-') return 62;
  if (character == '_') return 63;
  return -1;
}

size_t encodedLength(size_t inputLength) {
  const size_t fullGroups = inputLength / 3;
  const size_t remainder = inputLength % 3;
  return fullGroups * 4 + (remainder == 0 ? 0 : remainder + 1);
}

bool encode(const uint8_t* input, size_t inputLength,
            char* output, size_t outputCapacity, size_t& outputLength) {
  outputLength = encodedLength(inputLength);
  if ((inputLength > 0 && input == nullptr) || output == nullptr
      || outputCapacity < outputLength + 1) return false;

  size_t source = 0;
  size_t target = 0;
  while (source + 3 <= inputLength) {
    const uint32_t value = (static_cast<uint32_t>(input[source]) << 16)
      | (static_cast<uint32_t>(input[source + 1]) << 8)
      | input[source + 2];
    output[target++] = ALPHABET[(value >> 18) & 0x3F];
    output[target++] = ALPHABET[(value >> 12) & 0x3F];
    output[target++] = ALPHABET[(value >> 6) & 0x3F];
    output[target++] = ALPHABET[value & 0x3F];
    source += 3;
  }
  if (source < inputLength) {
    const uint32_t first = static_cast<uint32_t>(input[source]) << 16;
    const uint32_t second = source + 1 < inputLength
      ? static_cast<uint32_t>(input[source + 1]) << 8 : 0;
    const uint32_t value = first | second;
    output[target++] = ALPHABET[(value >> 18) & 0x3F];
    output[target++] = ALPHABET[(value >> 12) & 0x3F];
    if (source + 1 < inputLength) output[target++] = ALPHABET[(value >> 6) & 0x3F];
  }
  output[target] = '\0';
  return target == outputLength;
}

bool decodedLength(const char* input, size_t inputLength, size_t& outputLength) {
  outputLength = 0;
  if ((inputLength > 0 && input == nullptr) || inputLength % 4 == 1) return false;
  for (size_t index = 0; index < inputLength; ++index) {
    if (valueOf(input[index]) < 0) return false;
  }
  outputLength = (inputLength / 4) * 3;
  if (inputLength % 4 == 2) outputLength += 1;
  if (inputLength % 4 == 3) outputLength += 2;
  return true;
}

bool decode(const char* input, size_t inputLength,
            uint8_t* output, size_t outputCapacity, size_t& outputLength) {
  if (!decodedLength(input, inputLength, outputLength)
      || (outputLength > 0 && output == nullptr)
      || outputCapacity < outputLength) return false;

  size_t source = 0;
  size_t target = 0;
  while (source + 4 <= inputLength) {
    const uint32_t value = (static_cast<uint32_t>(valueOf(input[source])) << 18)
      | (static_cast<uint32_t>(valueOf(input[source + 1])) << 12)
      | (static_cast<uint32_t>(valueOf(input[source + 2])) << 6)
      | static_cast<uint32_t>(valueOf(input[source + 3]));
    output[target++] = static_cast<uint8_t>(value >> 16);
    output[target++] = static_cast<uint8_t>(value >> 8);
    output[target++] = static_cast<uint8_t>(value);
    source += 4;
  }
  const size_t remainder = inputLength - source;
  if (remainder == 2) {
    const uint8_t first = static_cast<uint8_t>(valueOf(input[source]));
    const uint8_t second = static_cast<uint8_t>(valueOf(input[source + 1]));
    // Unused low bits must be zero for one canonical encoding per byte string.
    if ((second & 0x0F) != 0) return false;
    output[target++] = static_cast<uint8_t>((first << 2) | (second >> 4));
  } else if (remainder == 3) {
    const uint8_t first = static_cast<uint8_t>(valueOf(input[source]));
    const uint8_t second = static_cast<uint8_t>(valueOf(input[source + 1]));
    const uint8_t third = static_cast<uint8_t>(valueOf(input[source + 2]));
    if ((third & 0x03) != 0) return false;
    output[target++] = static_cast<uint8_t>((first << 2) | (second >> 4));
    output[target++] = static_cast<uint8_t>((second << 4) | (third >> 2));
  }
  return target == outputLength;
}

}  // namespace schoolcalc_base64

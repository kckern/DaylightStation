#pragma once

#include <stddef.h>
#include <stdint.h>

namespace schoolcalc_base64 {

// RFC 4648 base64url without padding, matching Node's Buffer base64url form.
size_t encodedLength(size_t inputLength);
bool encode(const uint8_t* input, size_t inputLength,
            char* output, size_t outputCapacity, size_t& outputLength);
bool decodedLength(const char* input, size_t inputLength, size_t& outputLength);
bool decode(const char* input, size_t inputLength,
            uint8_t* output, size_t outputCapacity, size_t& outputLength);

}  // namespace schoolcalc_base64

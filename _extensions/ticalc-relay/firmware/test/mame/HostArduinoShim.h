#pragma once

#include <stdint.h>

namespace schoolcalc_mame {

class MameBitSocketBridge;

/** Bind Arduino-compatible GPIO calls to one virtual open-drain TI cable. */
void installHostArduinoShim(MameBitSocketBridge& bridge,
                            uint8_t tipSensePin, uint8_t tipSinkPin,
                            uint8_t ringSensePin, uint8_t ringSinkPin);
void clearHostArduinoShim();

}  // namespace schoolcalc_mame

#pragma once

#include <stdint.h>

namespace schoolcalc_tilem {

class TilemBlackLinkBridge;

/** Bind Arduino-compatible GPIO calls to the TilEm virtual open-drain cable. */
void installHostArduinoShim(TilemBlackLinkBridge& bridge,
                            uint8_t tipSensePin, uint8_t tipSinkPin,
                            uint8_t ringSensePin, uint8_t ringSinkPin);
void clearHostArduinoShim();

}  // namespace schoolcalc_tilem

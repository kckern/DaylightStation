#pragma once

#include <stdint.h>

namespace obdrelay {

void startBleRelay();
void updateBleRelay(bool ecuLinked, uint32_t sampleAgeMs, uint8_t fields, int16_t speedKph, int16_t rpm,
                    int16_t coolantC, uint16_t batteryMv);

} // namespace obdrelay

#pragma once

#include <stdint.h>

using byte = uint8_t;

static constexpr uint8_t INPUT = 0;
static constexpr uint8_t OUTPUT = 1;
static constexpr int LOW = 0;
static constexpr int HIGH = 1;

struct portMUX_TYPE {};
#define portMUX_INITIALIZER_UNLOCKED portMUX_TYPE{}

inline void portENTER_CRITICAL(portMUX_TYPE*) {}
inline void portEXIT_CRITICAL(portMUX_TYPE*) {}

int digitalRead(uint8_t pin);
void digitalWrite(uint8_t pin, uint8_t value);
void pinMode(uint8_t pin, uint8_t mode);
uint32_t millis();
void delay(uint32_t milliseconds);

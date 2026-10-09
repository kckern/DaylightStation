#pragma once

#include <stddef.h>
#include <stdint.h>

namespace schoolcalc_input {

static constexpr uint8_t INPUT_MAPPING_VERSION = 1;
static constexpr size_t BOOT_KEYBOARD_REPORT_BYTES = 8;
static constexpr size_t BOOT_KEYBOARD_KEY_SLOTS = 6;
static constexpr size_t INPUT_QUEUE_CAPACITY = 64;
static constexpr uint32_t REPEAT_DELAY_MS = 400;
static constexpr uint32_t REPEAT_INTERVAL_MS = 50;

enum class InputType : uint8_t {
  Key = 1,
  Text = 2,
};

enum class LogicalKey : uint8_t {
  Right = 1,
  Left = 2,
  Up = 3,
  Down = 4,
  Enter = 5,
  Back = 6,
  Delete = 7,
  Clear = 8,
  Insert = 9,
  Next = 10,
  Home = 11,
  End = 12,
  F1 = 16,
  F2 = 17,
  F3 = 18,
  F4 = 19,
  F5 = 20,
};

enum InputFlag : uint8_t {
  InputFlagNone = 0,
  InputFlagShift = 1 << 0,
  InputFlagRepeat = 1 << 1,
};

struct InputSpec {
  InputType type = InputType::Key;
  uint8_t value = 0;
  uint8_t flags = InputFlagNone;

  InputSpec() = default;
  InputSpec(InputType inputType, uint8_t inputValue, uint8_t inputFlags)
    : type(inputType), value(inputValue), flags(inputFlags) {}
};

struct InputEvent {
  uint32_t sequence = 0;
  InputSpec input{};
  uint32_t enqueuedAtMs = 0;

  InputEvent() = default;
  InputEvent(uint32_t eventSequence, const InputSpec& eventInput,
             uint32_t enqueuedAt)
    : sequence(eventSequence), input(eventInput), enqueuedAtMs(enqueuedAt) {}
};

enum class ReportStatus : uint8_t {
  Ok,
  InvalidLength,
  Rollover,
};

struct TranslationResult {
  ReportStatus status = ReportStatus::Ok;
  size_t count = 0;
  uint32_t unsupported = 0;
};

/**
 * Stateful USB HID boot-keyboard translator. It emits press transitions only;
 * release reports stop repeat but never create calculator events. Shift and
 * Caps Lock are resolved here so calculator-family adapters receive stable
 * ASCII for supported text instead of USB usages.
 */
class BootKeyboardTranslator {
public:
  TranslationResult update(const uint8_t* report, size_t length, uint32_t nowMs,
                           InputSpec* output, size_t outputCapacity);
  size_t tick(uint32_t nowMs, InputSpec* output, size_t outputCapacity);
  void reset();

  bool capsLock() const { return capsLock_; }
  uint32_t unsupportedCount() const { return unsupportedCount_; }

private:
  uint8_t previousModifiers_ = 0;
  uint8_t previousUsages_[BOOT_KEYBOARD_KEY_SLOTS]{};
  bool capsLock_ = false;
  uint8_t repeatUsage_ = 0;
  InputSpec repeatInput_{};
  uint32_t nextRepeatMs_ = 0;
  uint32_t unsupportedCount_ = 0;

  bool wasPressed(uint8_t usage) const;
};

enum class EnqueueStatus : uint8_t {
  Accepted,
  Full,
  SequenceExhausted,
};

enum class AcknowledgeStatus : uint8_t {
  Accepted,
  Duplicate,
  Empty,
  OutOfOrder,
};

/** Fixed FIFO whose head remains authoritative until calculator ACK. */
class InputQueue {
public:
  EnqueueStatus enqueue(const InputSpec& input, uint32_t nowMs,
                        uint32_t* assignedSequence = nullptr);
  const InputEvent* peek() const;
  AcknowledgeStatus acknowledge(uint32_t sequence);
  void clear();

  size_t size() const { return count_; }
  size_t capacity() const { return INPUT_QUEUE_CAPACITY; }
  bool full() const { return count_ == INPUT_QUEUE_CAPACITY; }
  uint32_t acceptedCount() const { return acceptedCount_; }
  uint32_t acknowledgedCount() const { return acknowledgedCount_; }
  uint32_t rejectedFullCount() const { return rejectedFullCount_; }
  uint32_t lastAcknowledgedSequence() const { return lastAcknowledgedSequence_; }

private:
  InputEvent events_[INPUT_QUEUE_CAPACITY]{};
  size_t head_ = 0;
  size_t count_ = 0;
  uint32_t nextSequence_ = 1;
  uint32_t acceptedCount_ = 0;
  uint32_t acknowledgedCount_ = 0;
  uint32_t rejectedFullCount_ = 0;
  uint32_t lastAcknowledgedSequence_ = 0;
};

struct Ti86Input {
  uint8_t scanCode = 0;
};

/** Map one neutral input event onto the published TI-86 direct-key table. */
bool mapTi86Input(const InputSpec& input, Ti86Input& output);

const char* reportStatusText(ReportStatus status);
const char* enqueueStatusText(EnqueueStatus status);
const char* acknowledgeStatusText(AcknowledgeStatus status);

}  // namespace schoolcalc_input

#include "SchoolCalcInput.h"

#include <string.h>

namespace schoolcalc_input {

namespace {

static constexpr uint8_t HID_MOD_LEFT_CTRL = 0x01;
static constexpr uint8_t HID_MOD_LEFT_SHIFT = 0x02;
static constexpr uint8_t HID_MOD_LEFT_ALT = 0x04;
static constexpr uint8_t HID_MOD_LEFT_GUI = 0x08;
static constexpr uint8_t HID_MOD_RIGHT_CTRL = 0x10;
static constexpr uint8_t HID_MOD_RIGHT_SHIFT = 0x20;
static constexpr uint8_t HID_MOD_RIGHT_ALT = 0x40;
static constexpr uint8_t HID_MOD_RIGHT_GUI = 0x80;
static constexpr uint8_t HID_MOD_SHIFT = HID_MOD_LEFT_SHIFT | HID_MOD_RIGHT_SHIFT;
static constexpr uint8_t HID_MOD_UNSUPPORTED = HID_MOD_LEFT_CTRL | HID_MOD_LEFT_ALT
  | HID_MOD_LEFT_GUI | HID_MOD_RIGHT_CTRL | HID_MOD_RIGHT_ALT | HID_MOD_RIGHT_GUI;

static bool usagePresent(const uint8_t usages[BOOT_KEYBOARD_KEY_SLOTS], uint8_t usage) {
  for (size_t index = 0; index < BOOT_KEYBOARD_KEY_SLOTS; ++index) {
    if (usages[index] == usage) return true;
  }
  return false;
}

static bool isRollover(uint8_t usage) {
  return usage >= 0x01 && usage <= 0x03;
}

static InputSpec key(LogicalKey value, bool repeat = false) {
  return {
    InputType::Key,
    static_cast<uint8_t>(value),
    static_cast<uint8_t>(repeat ? InputFlagRepeat : InputFlagNone),
  };
}

static InputSpec text(uint8_t value, bool shift, bool repeat = false) {
  uint8_t flags = shift ? InputFlagShift : InputFlagNone;
  if (repeat) flags |= InputFlagRepeat;
  return { InputType::Text, value, flags };
}

static bool translateUsage(uint8_t usage, uint8_t modifiers, bool capsLock,
                           InputSpec& output, bool& repeatable) {
  const bool shift = (modifiers & HID_MOD_SHIFT) != 0;
  repeatable = true;
  if ((modifiers & HID_MOD_UNSUPPORTED) != 0) return false;

  if (usage >= 0x04 && usage <= 0x1D) {
    const bool upper = shift != capsLock;
    output = text(static_cast<uint8_t>((upper ? 'A' : 'a') + usage - 0x04), shift);
    return true;
  }
  if (usage >= 0x1E && usage <= 0x27) {
    static constexpr char plain[] = "1234567890";
    static constexpr char shifted[] = "!@#$%^&*()";
    const uint8_t value = static_cast<uint8_t>((shift ? shifted : plain)[usage - 0x1E]);
    // The TI-86 direct table has no single-key forms for these four symbols.
    if (value == '!' || value == '@' || value == '#' || value == '$'
        || value == '%' || value == '&') return false;
    output = text(value, shift);
    return true;
  }

  switch (usage) {
    case 0x28: output = key(LogicalKey::Enter); return true;
    case 0x29: output = key(LogicalKey::Back); return true;
    case 0x2A: output = key(LogicalKey::Delete); return true;
    case 0x2B: output = key(LogicalKey::Next); return true;
    case 0x2C: output = text(' ', shift); return true;
    case 0x2D: if (!shift) { output = text('-', false); return true; } return false;
    case 0x2E: output = text(shift ? '+' : '=', shift); return true;
    case 0x2F: if (!shift) { output = text('[', false); return true; } return false;
    case 0x30: if (!shift) { output = text(']', false); return true; } return false;
    case 0x31: return false;
    case 0x33: if (shift) { output = text(':', true); return true; } return false;
    case 0x34:
    case 0x35: return false;
    case 0x36: if (!shift) { output = text(',', false); return true; } return false;
    case 0x37: if (!shift) { output = text('.', false); return true; } return false;
    case 0x38: if (!shift) { output = text('/', false); return true; } return false;
    case 0x39: repeatable = false; return false;  // Caps Lock is host state only.
    case 0x3A: output = key(LogicalKey::F1); return true;
    case 0x3B: output = key(LogicalKey::F2); return true;
    case 0x3C: output = key(LogicalKey::F3); return true;
    case 0x3D: output = key(LogicalKey::F4); return true;
    case 0x3E: output = key(LogicalKey::F5); return true;
    case 0x49: output = key(LogicalKey::Insert); return true;
    case 0x4A: output = key(LogicalKey::Home); return true;
    case 0x4B: output = key(LogicalKey::Next); return true;
    case 0x4C: output = key(LogicalKey::Delete); return true;
    case 0x4D: output = key(LogicalKey::End); return true;
    case 0x4F: output = key(LogicalKey::Right); return true;
    case 0x50: output = key(LogicalKey::Left); return true;
    case 0x51: output = key(LogicalKey::Down); return true;
    case 0x52: output = key(LogicalKey::Up); return true;
    case 0x54: output = text('/', false); return true;
    case 0x55: output = text('*', false); return true;
    case 0x56: output = text('-', false); return true;
    case 0x57: output = text('+', false); return true;
    case 0x58: output = key(LogicalKey::Enter); return true;
    case 0x59: output = text('1', false); return true;
    case 0x5A: output = text('2', false); return true;
    case 0x5B: output = text('3', false); return true;
    case 0x5C: output = text('4', false); return true;
    case 0x5D: output = text('5', false); return true;
    case 0x5E: output = text('6', false); return true;
    case 0x5F: output = text('7', false); return true;
    case 0x60: output = text('8', false); return true;
    case 0x61: output = text('9', false); return true;
    case 0x62: output = text('0', false); return true;
    case 0x63: output = text('.', false); return true;
    case 0x67: output = text('=', false); return true;
    default: return false;
  }
}

static bool timeReached(uint32_t now, uint32_t target) {
  return static_cast<int32_t>(now - target) >= 0;
}

}  // namespace

bool BootKeyboardTranslator::wasPressed(uint8_t usage) const {
  return usagePresent(previousUsages_, usage);
}

TranslationResult BootKeyboardTranslator::update(
  const uint8_t* report, size_t length, uint32_t nowMs,
  InputSpec* output, size_t outputCapacity) {
  TranslationResult result{};
  if (report == nullptr || length != BOOT_KEYBOARD_REPORT_BYTES) {
    result.status = ReportStatus::InvalidLength;
    return result;
  }
  const uint8_t* usages = report + 2;
  for (size_t index = 0; index < BOOT_KEYBOARD_KEY_SLOTS; ++index) {
    if (isRollover(usages[index])) {
      result.status = ReportStatus::Rollover;
      return result;
    }
  }

  const uint8_t modifiers = report[0];
  for (size_t index = 0; index < BOOT_KEYBOARD_KEY_SLOTS; ++index) {
    const uint8_t usage = usages[index];
    if (usage == 0 || wasPressed(usage)) continue;
    if (usage == 0x39) {
      capsLock_ = !capsLock_;
      repeatUsage_ = 0;
      continue;
    }
    InputSpec translated{};
    bool repeatable = false;
    if (!translateUsage(usage, modifiers, capsLock_, translated, repeatable)) {
      unsupportedCount_ += 1;
      result.unsupported += 1;
      continue;
    }
    if (output != nullptr && result.count < outputCapacity) {
      output[result.count] = translated;
      result.count += 1;
    } else {
      // Output capacity is part of the caller's bounded queue contract. Count
      // an unrepresented transition so diagnostics never imply it was kept.
      unsupportedCount_ += 1;
      result.unsupported += 1;
    }
    if (repeatable) {
      repeatUsage_ = usage;
      repeatInput_ = translated;
      nextRepeatMs_ = nowMs + REPEAT_DELAY_MS;
    }
  }

  if (repeatUsage_ != 0 && !usagePresent(usages, repeatUsage_)) {
    repeatUsage_ = 0;
    nextRepeatMs_ = 0;
  }
  previousModifiers_ = modifiers;
  memcpy(previousUsages_, usages, sizeof(previousUsages_));
  return result;
}

size_t BootKeyboardTranslator::tick(uint32_t nowMs, InputSpec* output,
                                    size_t outputCapacity) {
  if (repeatUsage_ == 0 || !timeReached(nowMs, nextRepeatMs_)
      || output == nullptr || outputCapacity == 0) return 0;
  output[0] = repeatInput_;
  output[0].flags |= InputFlagRepeat;
  // Never burst an unbounded backlog after a stalled sync/task. One repeat is
  // emitted per service call and the cadence restarts from this observation.
  nextRepeatMs_ = nowMs + REPEAT_INTERVAL_MS;
  return 1;
}

void BootKeyboardTranslator::reset() {
  previousModifiers_ = 0;
  memset(previousUsages_, 0, sizeof(previousUsages_));
  capsLock_ = false;
  repeatUsage_ = 0;
  repeatInput_ = InputSpec{};
  nextRepeatMs_ = 0;
}

EnqueueStatus InputQueue::enqueue(const InputSpec& input, uint32_t nowMs,
                                  uint32_t* assignedSequence) {
  if (full()) {
    rejectedFullCount_ += 1;
    return EnqueueStatus::Full;
  }
  if (nextSequence_ == 0) return EnqueueStatus::SequenceExhausted;
  const size_t tail = (head_ + count_) % INPUT_QUEUE_CAPACITY;
  events_[tail] = { nextSequence_, input, nowMs };
  if (assignedSequence != nullptr) *assignedSequence = nextSequence_;
  nextSequence_ += 1;
  count_ += 1;
  acceptedCount_ += 1;
  return EnqueueStatus::Accepted;
}

const InputEvent* InputQueue::peek() const {
  return count_ == 0 ? nullptr : &events_[head_];
}

AcknowledgeStatus InputQueue::acknowledge(uint32_t sequence) {
  if (sequence != 0 && sequence == lastAcknowledgedSequence_) {
    return AcknowledgeStatus::Duplicate;
  }
  if (count_ == 0) return AcknowledgeStatus::Empty;
  if (events_[head_].sequence != sequence) return AcknowledgeStatus::OutOfOrder;
  lastAcknowledgedSequence_ = sequence;
  events_[head_] = InputEvent{};
  head_ = (head_ + 1) % INPUT_QUEUE_CAPACITY;
  count_ -= 1;
  acknowledgedCount_ += 1;
  return AcknowledgeStatus::Accepted;
}

void InputQueue::clear() {
  memset(events_, 0, sizeof(events_));
  head_ = 0;
  count_ = 0;
}

bool mapTi86Input(const InputSpec& input, Ti86Input& output) {
  output = Ti86Input{};
  if (input.type == InputType::Key) {
    switch (static_cast<LogicalKey>(input.value)) {
      case LogicalKey::Right: output.scanCode = 0x01; return true;
      case LogicalKey::Left: output.scanCode = 0x02; return true;
      case LogicalKey::Up: output.scanCode = 0x03; return true;
      case LogicalKey::Down: output.scanCode = 0x04; return true;
      case LogicalKey::Enter: output.scanCode = 0x06; return true;
      case LogicalKey::Back: output.scanCode = 0x07; return true;
      case LogicalKey::Clear: output.scanCode = 0x08; return true;
      case LogicalKey::Delete: output.scanCode = 0x09; return true;
      case LogicalKey::Insert: output.scanCode = 0x0A; return true;
      case LogicalKey::Next: output.scanCode = 0x0B; return true;
      case LogicalKey::Home: output.scanCode = 0x87; return true;
      case LogicalKey::End: output.scanCode = 0x88; return true;
      case LogicalKey::F1: output.scanCode = 0xC2; return true;
      case LogicalKey::F2: output.scanCode = 0xC3; return true;
      case LogicalKey::F3: output.scanCode = 0xC4; return true;
      case LogicalKey::F4: output.scanCode = 0xC5; return true;
      case LogicalKey::F5: output.scanCode = 0xC6; return true;
    }
    return false;
  }
  if (input.type != InputType::Text) return false;
  const uint8_t value = input.value;
  if (value >= 'A' && value <= 'Z') {
    output.scanCode = static_cast<uint8_t>(0x28 + value - 'A'); return true;
  }
  if (value >= 'a' && value <= 'z') {
    output.scanCode = static_cast<uint8_t>(0x42 + value - 'a'); return true;
  }
  if (value >= '0' && value <= '9') {
    output.scanCode = static_cast<uint8_t>(0x1C + value - '0'); return true;
  }
  switch (value) {
    case ' ': output.scanCode = 0x27; return true;
    case ':': output.scanCode = 0x05; return true;
    case '+': output.scanCode = 0x0C; return true;
    case '-': output.scanCode = 0x0D; return true;
    case '*': output.scanCode = 0x0E; return true;
    case '/': output.scanCode = 0x0F; return true;
    case '^': output.scanCode = 0x10; return true;
    case '(': output.scanCode = 0x11; return true;
    case ')': output.scanCode = 0x12; return true;
    case '[': output.scanCode = 0x13; return true;
    case ']': output.scanCode = 0x14; return true;
    case '=': output.scanCode = 0x15; return true;
    case ',': output.scanCode = 0x18; return true;
    case '.': output.scanCode = 0x1B; return true;
    default: return false;
  }
}

const char* reportStatusText(ReportStatus status) {
  switch (status) {
    case ReportStatus::Ok: return "ok";
    case ReportStatus::InvalidLength: return "invalid_length";
    case ReportStatus::Rollover: return "rollover";
  }
  return "unknown";
}

const char* enqueueStatusText(EnqueueStatus status) {
  switch (status) {
    case EnqueueStatus::Accepted: return "accepted";
    case EnqueueStatus::Full: return "full";
    case EnqueueStatus::SequenceExhausted: return "sequence_exhausted";
  }
  return "unknown";
}

const char* acknowledgeStatusText(AcknowledgeStatus status) {
  switch (status) {
    case AcknowledgeStatus::Accepted: return "accepted";
    case AcknowledgeStatus::Duplicate: return "duplicate";
    case AcknowledgeStatus::Empty: return "empty";
    case AcknowledgeStatus::OutOfOrder: return "out_of_order";
  }
  return "unknown";
}

}  // namespace schoolcalc_input

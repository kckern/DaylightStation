#include "SchoolCalcInput.h"

#include <assert.h>
#include <string.h>

using namespace schoolcalc_input;

namespace {

static void report(BootKeyboardTranslator& translator, uint8_t modifiers,
                   uint8_t firstUsage, uint32_t now, InputSpec* output,
                   TranslationResult& result) {
  uint8_t bytes[BOOT_KEYBOARD_REPORT_BYTES]{};
  bytes[0] = modifiers;
  bytes[2] = firstUsage;
  result = translator.update(bytes, sizeof(bytes), now, output, 8);
}

static void releasesAndModifiersProduceStableText() {
  BootKeyboardTranslator translator;
  InputSpec output[8]{};
  TranslationResult result{};

  report(translator, 0, 0x04, 10, output, result);  // a
  assert(result.status == ReportStatus::Ok && result.count == 1);
  assert(output[0].type == InputType::Text && output[0].value == 'a');
  report(translator, 0, 0, 20, output, result);
  assert(result.count == 0);
  report(translator, 0x02, 0x04, 30, output, result);  // Shift+A
  assert(result.count == 1 && output[0].value == 'A');
  report(translator, 0, 0, 40, output, result);

  report(translator, 0, 0x39, 50, output, result);  // Caps Lock
  assert(result.count == 0 && translator.capsLock());
  report(translator, 0, 0, 60, output, result);
  report(translator, 0, 0x05, 70, output, result);  // B
  assert(result.count == 1 && output[0].value == 'B');
  report(translator, 0, 0, 80, output, result);
  report(translator, 0x02, 0x05, 90, output, result);  // Shift+b under Caps
  assert(result.count == 1 && output[0].value == 'b');
}

static void navigationFunctionsAndPunctuationMap() {
  BootKeyboardTranslator translator;
  InputSpec output[8]{};
  TranslationResult result{};

  report(translator, 0, 0x52, 0, output, result);
  assert(result.count == 1 && output[0].value == static_cast<uint8_t>(LogicalKey::Up));
  report(translator, 0, 0, 1, output, result);
  report(translator, 0, 0x3E, 2, output, result);
  assert(result.count == 1 && output[0].value == static_cast<uint8_t>(LogicalKey::F5));
  report(translator, 0, 0, 3, output, result);
  report(translator, 0x02, 0x2E, 4, output, result);
  assert(result.count == 1 && output[0].type == InputType::Text && output[0].value == '+');
  report(translator, 0, 0, 5, output, result);
  report(translator, 0x02, 0x21, 6, output, result);  // Shift+4 is unsupported.
  assert(result.count == 0 && result.unsupported == 1);
}

static void malformedReportsAndUnsupportedChordsFailClosed() {
  BootKeyboardTranslator translator;
  InputSpec output[8]{};
  uint8_t shortReport[7]{};
  TranslationResult result = translator.update(shortReport, sizeof(shortReport), 0, output, 8);
  assert(result.status == ReportStatus::InvalidLength);

  uint8_t rollover[8]{};
  rollover[2] = 0x01;
  result = translator.update(rollover, sizeof(rollover), 1, output, 8);
  assert(result.status == ReportStatus::Rollover && result.count == 0);

  uint8_t ctrlA[8]{};
  ctrlA[0] = 0x01;
  ctrlA[2] = 0x04;
  result = translator.update(ctrlA, sizeof(ctrlA), 2, output, 8);
  assert(result.status == ReportStatus::Ok && result.count == 0);
  assert(result.unsupported == 1 && translator.unsupportedCount() == 1);
}

static void repeatIsBoundedAndStopsOnRelease() {
  BootKeyboardTranslator translator;
  InputSpec output[2]{};
  TranslationResult result{};
  report(translator, 0, 0x51, 100, output, result);  // Down
  assert(result.count == 1);
  assert(translator.tick(499, output, 2) == 0);
  assert(translator.tick(500, output, 2) == 1);
  assert((output[0].flags & InputFlagRepeat) != 0);
  assert(translator.tick(500, output, 2) == 0);
  assert(translator.tick(550, output, 2) == 1);
  report(translator, 0, 0, 551, output, result);
  assert(translator.tick(1000, output, 2) == 0);
}

static void queueRetainsHeadUntilExactAcknowledgement() {
  InputQueue queue;
  const InputSpec one = { InputType::Text, '1', InputFlagNone };
  uint32_t first = 0;
  assert(queue.enqueue(one, 10, &first) == EnqueueStatus::Accepted && first == 1);
  assert(queue.enqueue({ InputType::Text, '+', InputFlagNone }, 11)
         == EnqueueStatus::Accepted);
  assert(queue.peek() != nullptr && queue.peek()->sequence == 1);
  assert(queue.acknowledge(2) == AcknowledgeStatus::OutOfOrder);
  assert(queue.size() == 2 && queue.peek()->sequence == 1);
  assert(queue.acknowledge(1) == AcknowledgeStatus::Accepted);
  assert(queue.acknowledge(1) == AcknowledgeStatus::Duplicate);
  assert(queue.peek()->sequence == 2);

  while (!queue.full()) {
    assert(queue.enqueue(one, 12) == EnqueueStatus::Accepted);
  }
  assert(queue.size() == INPUT_QUEUE_CAPACITY);
  assert(queue.enqueue(one, 13) == EnqueueStatus::Full);
  assert(queue.rejectedFullCount() == 1);
  assert(queue.peek()->sequence == 2);
}

static void ti86MappingMatchesThePublishedRemoteKeyTable() {
  Ti86Input mapped{};
  assert(mapTi86Input({ InputType::Text, '1', InputFlagNone }, mapped));
  assert(mapped.scanCode == 0x1D);
  assert(mapTi86Input({ InputType::Text, '+', InputFlagNone }, mapped));
  assert(mapped.scanCode == 0x0C);
  assert(mapTi86Input({ InputType::Key,
                        static_cast<uint8_t>(LogicalKey::Enter), InputFlagNone }, mapped));
  assert(mapped.scanCode == 0x06);
  assert(mapTi86Input({ InputType::Key,
                        static_cast<uint8_t>(LogicalKey::F3), InputFlagNone }, mapped));
  assert(mapped.scanCode == 0xC4);
  assert(mapTi86Input({ InputType::Text, 'Z', InputFlagNone }, mapped));
  assert(mapped.scanCode == 0x41);
  assert(!mapTi86Input({ InputType::Text, '@', InputFlagNone }, mapped));
}

}  // namespace

void runSchoolCalcInputTests() {
  releasesAndModifiersProduceStableText();
  navigationFunctionsAndPunctuationMap();
  malformedReportsAndUnsupportedChordsFailClosed();
  repeatIsBoundedAndStopsOnRelease();
  queueRetainsHeadUntilExactAcknowledgement();
  ti86MappingMatchesThePublishedRemoteKeyTable();
}

#include <unity.h>
#include "telemetry_logic.h"

using namespace obdrelay;

void test_odometer_scale() {
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 72359.1f, (float)odometerKmFromRaw(723591));
  TEST_ASSERT_TRUE(odometerKmFromRaw(-1) < 0);
}
void test_distance_saturation() {
  TEST_ASSERT_TRUE(distanceCounterUsable(0));
  TEST_ASSERT_TRUE(distanceCounterUsable(65534));
  TEST_ASSERT_FALSE(distanceCounterUsable(65535));
}

void test_vin_validation() {
  TEST_ASSERT_TRUE(isValidVin("1C4RC3BG0MR123456"));
  TEST_ASSERT_FALSE(isValidVin("4 \r1: 52 43 33 42"));
  TEST_ASSERT_FALSE(isValidVin("1C4RC3BG0MI123456"));
}

void test_fast_sleep_requires_all_off_votes() {
  TEST_ASSERT_TRUE(shouldFastSleep(13.0f, false, false, 13.2f));
  TEST_ASSERT_FALSE(shouldFastSleep(13.0f, true, false, 13.2f));
  TEST_ASSERT_FALSE(shouldFastSleep(13.0f, false, true, 13.2f));
  TEST_ASSERT_FALSE(shouldFastSleep(13.3f, false, false, 13.2f));
}

void test_link_failure_threshold_and_recovery() {
  LinkFailureTracker tracker;
  TEST_ASSERT_FALSE(tracker.observe(0));
  TEST_ASSERT_FALSE(tracker.observe(0));
  TEST_ASSERT_TRUE(tracker.observe(0));
  TEST_ASSERT_FALSE(tracker.observe(1));
  TEST_ASSERT_EQUAL_UINT8(0, tracker.consecutiveFullFailures);
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_odometer_scale);
  RUN_TEST(test_distance_saturation);
  RUN_TEST(test_vin_validation);
  RUN_TEST(test_fast_sleep_requires_all_off_votes);
  RUN_TEST(test_link_failure_threshold_and_recovery);
  return UNITY_END();
}

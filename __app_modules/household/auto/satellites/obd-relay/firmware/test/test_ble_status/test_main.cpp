#include <unity.h>
#include "ble_status.h"

void setUp() {}
void tearDown() {}

static void emits_version_flags_and_little_endian_fields() {
  uint8_t status[12];
  obdrelay::encodeBleStatus(status, true, 1200, 28, 85, 1800, -3, 12750);
  const uint8_t expected[] = {1, 31, 85, 0, 8, 7, 253, 255, 206, 49, 176, 4};
  TEST_ASSERT_EQUAL_UINT8_ARRAY(expected, status, sizeof(expected));
}

static void hides_old_sensor_values_and_saturates_age() {
  uint8_t status[12];
  obdrelay::encodeBleStatus(status, false, UINT32_MAX, 28, 90, 1600, 70, 0);
  const uint8_t expected[] = {1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255};
  TEST_ASSERT_EQUAL_UINT8_ARRAY(expected, status, sizeof(expected));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(emits_version_flags_and_little_endian_fields);
  RUN_TEST(hides_old_sensor_values_and_saturates_age);
  return UNITY_END();
}

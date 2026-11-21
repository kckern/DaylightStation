package net.kckern.daylight.cap.widgets.shell;

import org.junit.Test;
import static org.junit.Assert.*;

public class FreematicsReadingTest {
    @Test public void decodesVersionOneWithSignedTemperature() {
        FreematicsReading reading = FreematicsReading.decode(new byte[]{
                1, 31, 36, 0, (byte) 0xd0, 7, (byte) 0xf6, (byte) 0xff,
                (byte) 0xcc, 0x31, 26, 0});
        assertNotNull(reading);
        assertEquals(Integer.valueOf(36), reading.speed);
        assertEquals(Integer.valueOf(2000), reading.rpm);
        assertEquals(Integer.valueOf(-10), reading.coolant);
        assertEquals(12748, reading.millivolts);
    }

    @Test public void missingAndStalePidsNeverAppearAsZero() {
        FreematicsReading reading = FreematicsReading.decode(new byte[]{
                1, 31, 0, 0, 0, 0, 0, 0, 10, 0, (byte) 0xff, (byte) 0xff});
        assertNull(reading.speed);
        assertNull(reading.rpm);
        assertNull(reading.coolant);
        assertEquals(10, reading.millivolts);
        assertNull(FreematicsReading.decode(new byte[]{1, 0}));
        assertNull(FreematicsReading.decode(new byte[12]));
    }
}

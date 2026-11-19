package net.kckern.daylight.cap.screenpower;

import static org.junit.Assert.*;

import net.kckern.daylight.cap.screenpower.ScreenOffPath.Kind;

import org.junit.Test;

public class ScreenOffPathTest {
    @Test public void anActiveDeviceAdminIsUsedFirst() {
        // The piano tablet once its admin is activated; the Portal once it is device owner.
        assertEquals(Kind.DEVICE_ADMIN, ScreenOffPath.choose(true, true, 29).kind);
        assertEquals(Kind.DEVICE_ADMIN, ScreenOffPath.choose(true, false, 28).kind);
        assertNull(ScreenOffPath.choose(true, false, 28).reason);
    }

    @Test public void withoutAnAdminTheBoundAccessibilityServiceLocksTheScreen() {
        // The Shield: no device-admin feature, so this is its only way.
        assertEquals(Kind.ACCESSIBILITY, ScreenOffPath.choose(false, true, 30).kind);
        assertEquals(Kind.ACCESSIBILITY, ScreenOffPath.choose(false, true, 28).kind);
    }

    @Test public void theAccessibilityLockNeedsAndroid9() {
        ScreenOffPath.Choice c = ScreenOffPath.choose(false, true, 27);
        assertEquals(Kind.NONE, c.kind);
        assertEquals("device admin required", c.reason);
    }

    @Test public void withNeitherTheDeviceCannotTurnItsScreenOffAndSaysWhy() {
        ScreenOffPath.Choice c = ScreenOffPath.choose(false, false, 30);
        assertEquals(Kind.NONE, c.kind);
        assertEquals("device admin or a bound accessibility service required", c.reason);
    }
}

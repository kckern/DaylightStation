package net.kckern.daylight.cap.lockdown;

import static org.junit.Assert.*;

import org.junit.Test;

public class LockModeTest {
    @Test public void autoFollowsWhetherThisAppIsDeviceOwner() {
        assertEquals("owner", LockMode.resolve("auto", true));
        assertEquals("app", LockMode.resolve("auto", false));
    }

    @Test public void appModeIsKeptEvenForADeviceOwner() {
        assertEquals("app", LockMode.resolve("app", true));
        assertEquals("app", LockMode.resolve("app", false));
    }

    @Test public void ownerModeWithoutOwnershipRunsAsAppAndSaysSo() {
        assertEquals("app", LockMode.resolve("owner", false));
        assertNotNull(LockMode.error("owner", false));
        assertEquals("owner", LockMode.resolve("owner", true));
        assertNull(LockMode.error("owner", true));
        assertNull(LockMode.error("auto", false));
        assertNull(LockMode.error("app", true));
    }

    @Test public void anUnknownSettingValueIsTreatedAsAuto() {
        assertEquals("app", LockMode.resolve("nonsense", false));
        assertEquals("owner", LockMode.resolve(null, true));
    }
}

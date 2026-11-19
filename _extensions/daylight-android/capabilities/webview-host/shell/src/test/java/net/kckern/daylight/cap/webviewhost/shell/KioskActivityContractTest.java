package net.kckern.daylight.cap.webviewhost.shell;

import static org.junit.Assert.*;

import net.kckern.daylight.api.KioskHost;

import org.junit.Test;

public class KioskActivityContractTest {
    @Test public void theClassNameThePayloadAndLockdownUseIsThisClass() {
        assertEquals("net.kckern.daylight.cap.webviewhost.shell.KioskActivity", KioskActivity.class.getName());
    }

    @Test public void itIsAKioskHostPublishedUnderTheContractName() {
        assertTrue(KioskHost.class.isAssignableFrom(KioskActivity.class));
        assertEquals("kiosk-activity", KioskHost.COMPONENT);
    }
}

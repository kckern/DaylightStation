package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.*;

import org.junit.Test;

public class ControllerPolicyTest {
    private static final int ME = 10234;
    private static final String MY_PACKAGE = "net.kckern.daylight.phone";

    private static boolean allows(String pkg, int uid, int sdk) {
        return ControllerPolicy.allows(pkg, uid, ME, MY_PACKAGE, sdk);
    }

    @Test public void thisAppAndTheSystemMayConnect() {
        assertTrue("the play screen and the media notification", allows(MY_PACKAGE, ME, 33));
        assertTrue("the system: media keys, a headset button", allows("android", 1000, 33));
        assertTrue("Bluetooth runs as a system uid", allows("com.android.bluetooth", 1002, 33));
        assertTrue("the lock screen and the notification shade", allows("com.android.systemui", 10045, 33));
    }

    @Test public void aCarAndTheAssistantMayConnect() {
        assertTrue(allows("com.google.android.projection.gearhead", 10150, 33));
        assertTrue(allows("com.google.android.googlequicksearchbox", 10160, 33));
    }

    /** The service is exported, so any app on the phone can try to bind it. */
    @Test public void anyOtherAppIsRefused() {
        assertFalse(allows("com.example.other", 10300, 33));
        assertFalse(allows(null, 10300, 33));
        assertFalse(allows("", 10300, 33));
        assertFalse("this app's name under another uid is not this app", allows(MY_PACKAGE, 10300, 33));
        assertFalse("a name that only starts like an allowed one", allows("com.google.android.projection.gearhead.evil", 10300, 33));
    }

    /** Before Android 9 the platform does not say who a legacy controller is. */
    @Test public void anUnnamedLegacyControllerIsAcceptedOnlyWhereAndroidCannotNameIt() {
        assertTrue(allows(ControllerPolicy.LEGACY_UNKNOWN, -1, 27));
        assertFalse(allows(ControllerPolicy.LEGACY_UNKNOWN, -1, 28));
        assertFalse(allows(ControllerPolicy.LEGACY_UNKNOWN, -1, 33));
    }

    @Test public void theIdOfAPlayRequestIsAMediaIdAndNothingElse() {
        assertEquals("p:plex:11", ControllerPolicy.playRequest("p:plex:11"));
        assertEquals("c:plex:10", ControllerPolicy.playRequest("c:plex:10"));
        for (String bad : new String[] { null, "", "root", "https://evil.example/a.mp3", "x:plex:1", "p:", "p:a\nb" }) {
            assertNull("accepted " + bad, ControllerPolicy.playRequest(bad));
        }
        StringBuilder longId = new StringBuilder("p:plex:");
        for (int i = 0; i < 2000; i++) longId.append('a');
        assertNull(ControllerPolicy.playRequest(longId.toString()));
    }
}

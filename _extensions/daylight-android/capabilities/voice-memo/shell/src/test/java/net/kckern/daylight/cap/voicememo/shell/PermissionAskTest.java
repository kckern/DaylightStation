package net.kckern.daylight.cap.voicememo.shell;

import static org.junit.Assert.*;

import org.junit.Test;

public class PermissionAskTest {
    private static final String MIC = "android.permission.RECORD_AUDIO";
    private static final String NOTIFY = "android.permission.POST_NOTIFICATIONS";

    @Test public void theMicrophoneIsAskedForUntilItIsGranted() {
        assertArrayEquals(new String[] { MIC }, PermissionAsk.toRequest(30, false, true, false));
        assertArrayEquals(new String[] { MIC }, PermissionAsk.toRequest(33, false, true, true));
        assertArrayEquals(new String[0], PermissionAsk.toRequest(33, true, true, false));
    }

    /** Android 13 shows nothing from the app until the owner allows it. Asked here, in the app, the first time a memo is made. */
    @Test public void notificationsAreAskedForOnceAndOnlyWhereAndroidAsks() {
        assertArrayEquals(new String[] { MIC, NOTIFY }, PermissionAsk.toRequest(33, false, false, false));
        assertArrayEquals(new String[] { NOTIFY }, PermissionAsk.toRequest(34, true, false, false));
        assertArrayEquals("asked before: never again", new String[0], PermissionAsk.toRequest(33, true, false, true));
        assertArrayEquals("before Android 13 there is nothing to ask", new String[0], PermissionAsk.toRequest(32, true, false, false));
        assertTrue(PermissionAsk.asksForNotifications(new String[] { MIC, NOTIFY }));
        assertFalse(PermissionAsk.asksForNotifications(new String[] { MIC }));
    }

    @Test public void recordingGoesAheadOnTheMicrophonesAnswerWhateverWasSaidAboutNotifications() {
        assertTrue(PermissionAsk.micGranted(new String[] { MIC, NOTIFY }, new int[] { 0, -1 }, false));
        assertFalse(PermissionAsk.micGranted(new String[] { MIC, NOTIFY }, new int[] { -1, 0 }, false));
        assertTrue("only notifications were asked for; the microphone was already allowed",
                PermissionAsk.micGranted(new String[] { NOTIFY }, new int[] { -1 }, true));
        assertFalse("a dialog that was dismissed answers nothing", PermissionAsk.micGranted(new String[0], new int[0], false));
        assertFalse(PermissionAsk.micGranted(null, null, false));
    }
}

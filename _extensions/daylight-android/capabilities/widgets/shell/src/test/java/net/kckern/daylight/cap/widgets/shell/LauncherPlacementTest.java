package net.kckern.daylight.cap.widgets.shell;

import org.junit.Test;

import static org.junit.Assert.*;

public class LauncherPlacementTest {
    @Test public void timeoutManualAndLateCallbacksKeepEachPlaylistOnItsOwnWidget() {
        LauncherPlacement a = LauncherPlacement.pending("a", "playlist:a", "Morning", true, 1000);
        assertEquals(LauncherPlacement.Status.CONFIRM, a.status(10999));
        assertEquals(LauncherPlacement.Status.UNCONFIRMED, a.status(11000));
        a = a.bindManual(7, false);
        assertNotNull(a);
        LauncherPlacement b = LauncherPlacement.pending("b", "playlist:b", "Evening", true, 12000);

        assertNull(a.bindCallback(42, false, false)); // Android reports a different provider.
        assertNull(a.bindCallback(8, true, true)); // Existing widget belongs to another request.
        assertEquals(LauncherPlacement.Status.CONFIRM, b.status(12000));
        a = a.bindCallback(9, true, false);
        assertNotNull(a);
        assertEquals(LauncherPlacement.Status.EXTRA_WIDGET, a.status(12000));
        assertEquals("playlist:a", a.contentId);
        assertEquals(7, a.manualWidget);
        assertEquals(9, a.callbackWidget);
        assertNull(a.bindCallback(9, true, true));
        assertNull(a.bindCallback(10, true, false));
        b = b.bindCallback(10, true, false);
        assertNotNull(b);
        assertEquals("playlist:b", b.contentId);
        assertEquals(LauncherPlacement.Status.ADDED, b.status(13000));
        assertEquals(10, b.callbackWidget);
    }

    @Test public void aLateCallbackForItsOwnManualWidgetDoesNotCreateADuplicate() {
        LauncherPlacement request = LauncherPlacement.pending("a", "a", "Morning", true, 1000)
                .bindManual(7, false);
        assertNotNull(request);
        request = request.bindCallback(7, true, true);
        assertNotNull(request);
        assertEquals(LauncherPlacement.Status.ADDED, request.status(12000));
        assertNull(request.bindManual(8, false));
        assertNull(request.bindCallback(7, true, true));
    }

    @Test public void shortcutSuccessRequiresTheMatchingCallbackEvenAfterTheDeadline() {
        LauncherPlacement request = LauncherPlacement.pending("a", "home", "Home", false, 1000);
        assertEquals(LauncherPlacement.Status.UNCONFIRMED, request.status(11000));
        assertNull(request.bindCallback(7, true, false));
        request = request.confirmShortcut();
        assertNotNull(request);
        assertEquals(LauncherPlacement.Status.ADDED, request.status(12000));
        assertNull(request.confirmShortcut());
    }
}

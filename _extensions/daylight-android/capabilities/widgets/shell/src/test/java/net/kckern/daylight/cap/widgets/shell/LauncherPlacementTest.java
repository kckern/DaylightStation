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

    @Test public void extraWidgetGuidanceSurvivesNewerOutcomesAndUsesUpdateOrder() {
        LauncherPlacement original = LauncherPlacement.pending("original", "a", "Morning", true, 1000);
        LauncherPlacement extra = original.bindManual(7, false).bindCallback(9, true, false).updatedAt(30000);
        java.util.List<LauncherPlacement> requests = new java.util.ArrayList<>();
        requests.add(extra);
        for (int i = 0; i < 5; i++) {
            requests.add(LauncherPlacement.pending("earlier-new-" + i, "a", "Morning", true, 12000 + i).refuse());
        }
        assertEquals(extra, LauncherPlacement.visible(requests, 30000).get(0));
        for (int i = 0; i < 5; i++) {
            requests.add(LauncherPlacement.pending("later-new-" + i, "a", "Morning", true, 31000 + i).refuse());
        }
        assertTrue(LauncherPlacement.visible(requests, 45000).contains(extra));
    }

    @Test public void aRetriedManualPlacementAndLateOriginalCallbackShowTwoWidgetsInTheSameLineage() {
        LauncherPlacement original = LauncherPlacement.pending("original", "a", "Morning", true, 1000);
        LauncherPlacement retry = original.retry("retry", 12000).bindManual(7, false);
        LauncherPlacement independent = LauncherPlacement.pending("separate", "a", "Morning", true, 23000)
                .bindManual(8, false);
        assertFalse(retry.hasExtraWidget(java.util.Arrays.asList(original, retry, independent)));
        assertNull(original.bindCallback(7, true, true));
        LauncherPlacement confirmed = original.bindCallback(9, true, false).updatedAt(30000);
        java.util.List<LauncherPlacement> requests = java.util.Arrays.asList(confirmed, retry, independent);
        assertTrue(confirmed.hasExtraWidget(requests));
        assertTrue(retry.hasExtraWidget(requests));
        assertFalse(independent.hasExtraWidget(requests));
        assertEquals("a", retry.contentId);
        assertEquals("Morning", retry.title);
        assertEquals(9, confirmed.callbackWidget);
        assertEquals(7, retry.manualWidget);
        assertEquals("original", retry.retry("third", 31000).lineageId);
    }

    /** A failed placement does not sit on the home screen forever: after a day it stops showing. */
    @Test public void aDayOldProblemNoLongerShows() {
        LauncherPlacement refused = LauncherPlacement.pending("old", "meal-barcode", "Meal barcode", false, 1000).refuse();
        java.util.List<LauncherPlacement> requests = new java.util.ArrayList<>();
        requests.add(refused);
        assertEquals(1, LauncherPlacement.visible(requests, 60_000).size());
        assertEquals(0, LauncherPlacement.visible(requests, 1000 + LauncherPlacement.STALE_MS + 1).size());
    }
}

package net.kckern.daylight.api;

import static org.junit.Assert.*;

import net.kckern.daylight.api.DirectPlay.Path;
import net.kckern.daylight.api.DirectPlay.Surface;

import org.junit.Test;

public class DirectPlayTest {
    /** A widget tap is a documented exemption from the background foreground-service rule: no window. */
    @Test public void aWidgetTapOnAMediaActionStartsThePlayServiceOnEveryVersion() {
        for (int sdk : new int[] { 26, 28, 30, 31, 33, 34, 35 }) {
            assertEquals("sdk " + sdk, Path.SERVICE, DirectPlay.path(Surface.WIDGET, sdk, "radio", true));
        }
    }

    /** Before Android 12 a background start is allowed; from 12 a tile is not a documented exemption, so it tries and falls back. */
    @Test public void aTileTriesTheServiceAndFromAndroid12FallsBackToTheLink() {
        assertEquals(Path.SERVICE, DirectPlay.path(Surface.TILE, 26, "radio", true));
        assertEquals(Path.SERVICE, DirectPlay.path(Surface.TILE, 30, "radio", true));
        assertEquals(Path.SERVICE_ELSE_LINK, DirectPlay.path(Surface.TILE, 31, "radio", true));
        assertEquals(Path.SERVICE_ELSE_LINK, DirectPlay.path(Surface.TILE, 34, "radio", true));
    }

    /** A launcher shortcut can only start an activity: it keeps the keyed link and the invisible play screen. */
    @Test public void aLauncherShortcutAlwaysTakesTheLink() {
        for (int sdk : new int[] { 26, 30, 31, 34 }) {
            assertEquals(Path.LINK, DirectPlay.path(Surface.SHORTCUT, sdk, "radio", true));
        }
    }

    @Test public void anActionThatIsNotAMediaActionOrABuildWithoutThePlayServiceTakesTheLink() {
        assertEquals(Path.LINK, DirectPlay.path(Surface.WIDGET, 33, "", true));
        assertEquals(Path.LINK, DirectPlay.path(Surface.WIDGET, 33, null, true));
        assertEquals(Path.LINK, DirectPlay.path(Surface.WIDGET, 33, "Not An Id", true));
        assertEquals(Path.LINK, DirectPlay.path(Surface.WIDGET, 33, "radio", false));
        assertEquals(Path.LINK, DirectPlay.path(Surface.TILE, 33, "radio", false));
        assertEquals(Path.LINK, DirectPlay.path(null, 33, "radio", true));
    }

    /** The service reads one thing from its intent: an action id. Content, a URL or a link is never read as one. */
    @Test public void theServiceTakesAnActionIdAndNothingThatNamesContent() {
        assertEquals("radio", DirectPlay.actionFrom("radio"));
        assertEquals("pin-0123abcd", DirectPlay.actionFrom("pin-0123abcd"));
        for (String bad : new String[] { null, "", "plex:12345", "p:plex:1", "https://kiosk.example/a.mp3",
                "daylight://action/radio#k=0123", "../radio", "Radio", "a23456789012345678901234567890123" }) {
            assertNull(String.valueOf(bad), DirectPlay.actionFrom(bad));
        }
    }

    @Test public void theServiceIsNamedForTheShellHalvesThatCannotReferenceIt() {
        assertEquals("net.kckern.daylight.cap.mediaservice.shell.PlayActionService", DirectPlay.SERVICE);
        assertEquals("action", DirectPlay.EXTRA_ACTION);
    }

    @Test public void theCacheFieldNamesTheActionToPlayDirectly() {
        assertEquals("action.radio.direct", SurfaceKeys.action("radio", SurfaceKeys.DIRECT));
        assertEquals("tile.2.direct", SurfaceKeys.tile(2, SurfaceKeys.DIRECT));
        assertEquals("widget.4.direct", SurfaceKeys.widget(4, SurfaceKeys.DIRECT));
    }
}

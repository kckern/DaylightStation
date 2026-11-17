package net.kckern.daylight.cap.webviewhost;

import static org.junit.Assert.*;

import net.kckern.daylight.cap.webviewhost.KeyRouter.Decision;
import net.kckern.daylight.cap.webviewhost.KeyRouter.Kind;

import org.junit.Test;

import java.util.Collections;
import java.util.Set;

public class KeyRouterTest {
    private static final Set<String> NONE = Collections.emptySet();

    @Test public void backInPageModeBecomesOneEventOnRelease() {
        assertEquals(Kind.CONSUME, KeyRouter.route(KeyRouter.BACK, true, "page", NONE).kind);
        assertEquals(Kind.BACK_EVENT, KeyRouter.route(KeyRouter.BACK, false, "page", NONE).kind);
    }

    @Test public void backInReloadModeReloadsOnRelease() {
        assertEquals(Kind.CONSUME, KeyRouter.route(KeyRouter.BACK, true, "reload", NONE).kind);
        assertEquals(Kind.RELOAD, KeyRouter.route(KeyRouter.BACK, false, "reload", NONE).kind);
    }

    @Test public void backInIgnoreModeIsSwallowed() {
        assertEquals(Kind.CONSUME, KeyRouter.route(KeyRouter.BACK, true, "ignore", NONE).kind);
        assertEquals(Kind.CONSUME, KeyRouter.route(KeyRouter.BACK, false, "ignore", NONE).kind);
    }

    @Test public void anUnknownBackModeBehavesAsPage() {
        assertEquals(Kind.BACK_EVENT, KeyRouter.route(KeyRouter.BACK, false, "sideways", NONE).kind);
        assertFalse(KeyRouter.validBackMode("sideways"));
        assertTrue(KeyRouter.validBackMode("reload"));
    }

    @Test public void interceptedKeysBecomePageEventsWithNameAndAction() {
        Set<String> keys = KeyRouter.parseIntercept(" VolumeUp, VolumeDown ,");
        Decision down = KeyRouter.route(KeyRouter.VOLUME_DOWN, true, "page", keys);
        assertEquals(Kind.PAGE_KEY, down.kind);
        assertEquals("VolumeDown", down.code);
        assertEquals("down", down.action);
        assertEquals("up", KeyRouter.route(KeyRouter.VOLUME_UP, false, "page", keys).action);
    }

    @Test public void everythingElseGoesToTheWebView() {
        assertEquals(Kind.PASS, KeyRouter.route(KeyRouter.VOLUME_UP, true, "page", NONE).kind);
        assertEquals(Kind.PASS, KeyRouter.route(23 /* DPAD_CENTER */, true, "page", NONE).kind);
        assertEquals(Kind.PASS, KeyRouter.route(96 /* BUTTON_A */, true, "page", KeyRouter.parseIntercept("VolumeUp")).kind);
    }

    @Test public void keysHaveStableNames() {
        assertEquals("Back", KeyRouter.name(4));
        assertEquals("VolumeMute", KeyRouter.name(164));
        assertEquals("MediaPlayPause", KeyRouter.name(85));
        assertEquals("Key999", KeyRouter.name(999));
    }
}

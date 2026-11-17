package net.kckern.daylight.cap.volumekeys;

import static org.junit.Assert.*;

import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.spi.InputLock;
import net.kckern.daylight.core.spi.ScreenPower;
import net.kckern.daylight.core.testing.TestCore;

import org.json.JSONObject;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.util.ArrayList;
import java.util.List;

/** The key filter over a display, a clock and a screen switch the test controls. */
public class VolumeKeysBehaviorTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    private static final int UP = android.view.KeyEvent.KEYCODE_VOLUME_UP, DOWN = android.view.KeyEvent.KEYCODE_VOLUME_DOWN;
    private static final int KEY_A = 29, KEY_ENTER = 66;

    private CoreRuntime core;
    private VolumeKeys keys;
    private boolean lit = true;
    private long now = 1_000_000;
    private final List<String> screen = new ArrayList<>();

    @Before public void setUp() throws Exception {
        core = TestCore.create(tmp.newFolder());
        KeysConfig.declare(core.settings());
        core.settings().set("keys.screenToggleEnabled", true);
        core.services().provide(ScreenPower.class, new ScreenPower() {
            @Override public boolean screenOn() { screen.add("on"); return true; }
            @Override public boolean screenOff() { screen.add("off"); return true; }
        });
        keys = new VolumeKeys(core, new KeysConfig(core.settings()), () -> lit, () -> now, Runnable::run);
    }

    private boolean press(int code) { return keys.onKey(code, true, 0); }

    private String log() { return core.log().toJsonArray(); }

    @Test public void aKeyWhileTheDisplayIsOffWakesItAndDoesNothingElse() {
        lit = false;
        assertTrue("consumed: the volume does not move in the dark", press(UP));
        assertEquals(java.util.Collections.singletonList("on"), screen);
        assertTrue(keys.onKey(UP, false, 0));
        assertEquals("the release wakes nothing again", 1, screen.size());
    }

    @Test public void aWakePressIsNotTheFirstHalfOfADoublePress() {
        lit = false;
        press(DOWN);                       // wakes
        lit = true;
        now += 100;
        press(DOWN);                       // first press with the display on
        assertEquals("one wake, no sleep", java.util.Collections.singletonList("on"), screen);
    }

    @Test public void twoVolumeDownPressesInsideTheWindowSleepTheDisplay() {
        press(DOWN);
        now += 400;                        // the window is 450 ms
        press(DOWN);
        assertEquals(java.util.Collections.singletonList("off"), screen);
        now += 100;
        press(DOWN);                       // a third press starts a new pair
        assertEquals(1, screen.size());
    }

    @Test public void pressesFurtherApartAutoRepeatAndVolumeUpDoNotSleepIt() {
        press(DOWN);
        now += 451;
        press(DOWN);
        assertTrue("outside the window", screen.isEmpty());

        now += 10_000;
        press(DOWN);
        now += 50;
        keys.onKey(DOWN, true, 1);         // the key held down: auto-repeat, not a second press
        assertTrue(screen.isEmpty());

        now += 10_000;
        press(UP);
        now += 50;
        press(UP);
        assertTrue("volume up is not the gesture", screen.isEmpty());
    }

    @Test public void withTheToggleOffNothingSwitchesTheScreenAndADarkPanelLetsTheKeyThrough() {
        core.settings().set("keys.screenToggleEnabled", false);
        press(DOWN);
        now += 100;
        press(DOWN);
        lit = false;
        assertFalse("not consumed while dark: Android may wake the panel itself", press(UP));
        assertTrue(screen.isEmpty());
    }

    @Test public void consumeVolumeDecidesWhetherAndroidAlsoGetsTheKey() {
        assertTrue(press(UP));
        core.settings().set("keys.consumeVolume", false);
        assertFalse("the escape hatch hands the keys back", press(UP));
    }

    @Test public void aLockdownSwallowsTheKeyBeforeAnythingElse() {
        core.services().provide(InputLock.class, new InputLock() {
            @Override public boolean active() { return true; }
            @Override public long revision() { return 12; }
        });
        lit = false;
        assertTrue(press(DOWN));
        assertTrue("no wake during a lockdown", screen.isEmpty());
        assertTrue(log().contains("key-suppressed-lockdown KEYCODE_VOLUME_DOWN revision=12"));
    }

    @Test public void theDisplaysOwnStateDecidesAndThePowerManagerOnlyWithoutIt() {
        int on = android.view.Display.STATE_ON, off = android.view.Display.STATE_OFF;
        assertTrue(VolumeKeys.panelLit(on, false));
        assertFalse("the power manager says on for a dark panel on the Portal", VolumeKeys.panelLit(off, true));
        assertFalse(VolumeKeys.panelLit(android.view.Display.STATE_DOZE, true));
        assertTrue(VolumeKeys.panelLit(null, true));
        assertFalse(VolumeKeys.panelLit(null, false));
    }

    @Test public void aKeyboardsKeysPassThroughCountedAndUnrecorded() throws Exception {
        assertFalse(keys.onKey(KEY_A, true, 0));
        assertFalse(keys.onKey(KEY_A, false, 0));
        assertFalse(keys.onKey(KEY_ENTER, true, 0));
        assertEquals(3, keys.otherKeysSeen());
        assertEquals(0, keys.keysSeen());
        assertEquals("nothing about them is in the log GET /log serves", "[]", log());
        assertTrue("and nothing switched the screen", screen.isEmpty());

        press(UP);
        String after = log();
        assertTrue(after, after.contains("key KEYCODE_VOLUME_UP down"));
        assertFalse(after.contains("hid-pass"));
        assertFalse(after.contains("scanCode"));
    }
}

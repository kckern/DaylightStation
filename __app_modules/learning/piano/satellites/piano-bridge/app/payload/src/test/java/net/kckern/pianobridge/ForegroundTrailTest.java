package net.kckern.pianobridge;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Arrays;
import java.util.List;

/**
 * Why this exists: on 2026-10-14 a child reached the Play Store from the kiosk and
 * nothing recorded HOW. The page only said it went hidden; the guard polled FKB every
 * 10 s through a password that had gone stale; logcat had rolled over. Every change of
 * the app in front must leave a log-store event naming what took over, plus the
 * windows that appeared over the kiosk just before it — that trail is the vector.
 */
public class ForegroundTrailTest {

    private static final String FKB = KioskSettingsGuard.FKB_PACKAGE;

    private static ForegroundTrail.Win app(String pkg, String title) {
        return new ForegroundTrail.Win(ForegroundTrail.TYPE_APPLICATION, pkg, title, true);
    }

    private static ForegroundTrail.Win overlay(int type, String pkg, String title) {
        return new ForegroundTrail.Win(type, pkg, title, false);
    }

    private static List<ForegroundTrail.Win> wins(ForegroundTrail.Win... w) { return Arrays.asList(w); }

    @Test
    public void firstSample_setsTheBaseline_withoutAnEscapeEvent() {
        ForegroundTrail t = new ForegroundTrail();
        List<ForegroundTrail.Event> ev = t.sample(1_000L, wins(app(FKB, "Piano")));
        assertTrue(ev.isEmpty());
        assertEquals(FKB, t.front());
    }

    @Test
    public void leavingFkb_isAWarnNamingTheNewApp_andCarriesTheTrail() throws Exception {
        ForegroundTrail t = new ForegroundTrail();
        t.sample(1_000L, wins(app(FKB, "Piano")));
        // Something appears over the kiosk first (an assistant panel, the shade, …).
        List<ForegroundTrail.Event> o = t.sample(2_000L, wins(app(FKB, "Piano"),
                overlay(ForegroundTrail.TYPE_SYSTEM, "com.google.android.googlequicksearchbox", "Assistant")));
        assertEquals(1, o.size());
        assertEquals("kiosk.window.overlay", o.get(0).msg);

        List<ForegroundTrail.Event> ev = t.sample(3_000L, wins(app("com.android.vending", "YouTube Kids")));
        assertEquals(1, ev.size());
        ForegroundTrail.Event e = ev.get(0);
        assertEquals("kiosk.foreground.left", e.msg);
        assertEquals("warn", e.level);
        assertEquals(FKB, e.data.getString("from"));
        assertEquals("com.android.vending", e.data.getString("to"));
        assertEquals("YouTube Kids", e.data.getString("toTitle"));
        String trail = e.data.getJSONArray("trail").toString();
        assertTrue(trail, trail.contains("googlequicksearchbox"));
    }

    @Test
    public void hoppingWhileAway_isAWarn_andReturning_reportsTimeAwayAndPath() throws Exception {
        ForegroundTrail t = new ForegroundTrail();
        t.sample(0L, wins(app(FKB, "Piano")));
        t.sample(1_000L, wins(app(KioskSettingsGuard.SETTINGS_PACKAGE, "Bluetooth")));
        List<ForegroundTrail.Event> hop = t.sample(5_000L, wins(app("com.android.chrome", "Google")));
        assertEquals("kiosk.foreground.changed", hop.get(0).msg);
        assertEquals("warn", hop.get(0).level);
        assertEquals(4_000L, hop.get(0).data.getLong("awayMs"));

        List<ForegroundTrail.Event> back = t.sample(11_000L, wins(app(FKB, "Piano")));
        ForegroundTrail.Event r = back.get(0);
        assertEquals("kiosk.foreground.returned", r.msg);
        assertEquals("info", r.level);
        assertEquals(10_000L, r.data.getLong("awayMs"));
        assertEquals("[\"com.android.settings\",\"com.android.chrome\"]", r.data.getJSONArray("path").toString());
    }

    @Test
    public void noApplicationWindow_isNotAChange() {
        // The keyguard or a screen-off state has no app window; that alone must not
        // invent an escape. The keyguard still lands in the trail as an overlay.
        ForegroundTrail t = new ForegroundTrail();
        t.sample(0L, wins(app(FKB, "Piano")));
        List<ForegroundTrail.Event> ev = t.sample(1_000L,
                wins(overlay(ForegroundTrail.TYPE_SYSTEM, "com.android.systemui", "Keyguard")));
        assertEquals(1, ev.size());
        assertEquals("kiosk.window.overlay", ev.get(0).msg);
        assertEquals(FKB, t.front());
    }

    @Test
    public void steadyState_emitsNothing() {
        ForegroundTrail t = new ForegroundTrail();
        t.sample(0L, wins(app(FKB, "Piano")));
        for (long now = 1_000L; now < 60_000L; now += 1_000L) {
            assertTrue(t.sample(now, wins(app(FKB, "Piano"))).isEmpty());
        }
    }

    @Test
    public void keyboardAndOurOwnOverlays_areIgnored() {
        ForegroundTrail t = new ForegroundTrail();
        t.sample(0L, wins(app(FKB, "Piano")));
        assertTrue(t.sample(1_000L, wins(app(FKB, "Piano"),
                overlay(ForegroundTrail.TYPE_INPUT_METHOD, "com.samsung.android.honeyboard", "Keyboard"),
                overlay(ForegroundTrail.TYPE_ACCESSIBILITY_OVERLAY, "net.kckern.pianobridge", ""))).isEmpty());
    }

    @Test
    public void overlayEvents_areCappedPerMinute() {
        ForegroundTrail t = new ForegroundTrail();
        t.sample(0L, wins(app(FKB, "Piano")));
        int n = 0;
        for (int i = 0; i < 200; i++) {
            n += t.sample(1_000L + i * 100L, wins(app(FKB, "Piano"),
                    overlay(ForegroundTrail.TYPE_SYSTEM, "com.android.systemui", "Panel " + (i % 2)))).size();
        }
        assertEquals(ForegroundTrail.MAX_OVERLAY_EVENTS_PER_MIN, n);
    }

    @Test
    public void unknownFront_beforeAnySample_isNull() {
        assertNull(new ForegroundTrail().front());
    }
}

package net.kckern.pianobridge;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import net.kckern.pianobridge.KioskSettings.Drift;

/**
 * Drift detection against FKB's kiosk-critical settings.
 *
 * Context: on 2026-07-21 the tablet was found with {@code kioskMode=false} — switched
 * off during a debugging session and never restored. Nothing noticed, because nothing
 * was looking. This is the "looking" half; {@link KioskSettingsGuard} is the "acting"
 * half.
 *
 * Two of these tests exist to stop the guard from doing HARM rather than to prove it
 * does good — see absentKey… and emptyLiveMap…. Both encode the same rule: the guard
 * only ever acts on a value it has positively observed to be wrong.
 */
public class KioskSettingsTest {

    /** Live map that matches the desired set exactly. */
    private static Map<String, String> matching() {
        Map<String, String> m = new HashMap<>();
        for (Map.Entry<String, KioskSettings.Desired> e : KioskSettings.DESIRED.entrySet()) {
            m.put(e.getKey(), e.getValue().value);
        }
        m.put("someUnrelatedFkbSetting", "whatever"); // extra keys are none of our business
        return m;
    }

    @Test
    public void desiredSetCoversTheKioskCriticalKeys() {
        // The trigger for the whole feature, plus the wake/recovery sets that
        // cli/fkb.cli.mjs already applies. Host CLI and APK must not disagree.
        for (String k : new String[]{
                "kioskMode", "keepScreenOn", "setWifiWakelock", "preventSleepWhileScreenOff",
                "reloadOnWifiOn", "reloadOnInternet", "waitInternetOnReload", "restartOnCrash",
                "reloadPageFailure", "reloadOnIdle", "reloadEachSeconds"}) {
            assertNotNull("desired set must contain " + k, KioskSettings.DESIRED.get(k));
        }
        assertEquals(11, KioskSettings.DESIRED.size());
    }

    @Test
    public void reloadOnIdleAndReloadEachSecondsAreAssertedOff() {
        // Deliberate: both would interrupt idle video watching (cli/fkb.cli.mjs:248-249).
        assertEquals("0", KioskSettings.DESIRED.get("reloadOnIdle").value);
        assertEquals("0", KioskSettings.DESIRED.get("reloadEachSeconds").value);
        assertEquals(KioskSettings.Type.STRING, KioskSettings.DESIRED.get("reloadOnIdle").type);
        assertEquals(KioskSettings.Type.STRING, KioskSettings.DESIRED.get("reloadEachSeconds").type);
    }

    @Test
    public void matchingSettings_reportNoDrift() {
        assertTrue(KioskSettings.detect(matching()).isEmpty());
    }

    @Test
    public void kioskModeOff_isExactlyOneDrift() {
        Map<String, String> live = matching();
        live.put("kioskMode", "false");

        List<Drift> drifts = KioskSettings.detect(live);
        assertEquals(1, drifts.size());
        Drift d = drifts.get(0);
        assertEquals("kioskMode", d.key);
        assertEquals("false", d.live);
        assertEquals("true", d.desired);
        assertEquals(KioskSettings.Type.BOOL, d.type);
    }

    @Test
    public void multipleDriftedKeys_areAllReported() {
        Map<String, String> live = matching();
        live.put("kioskMode", "false");
        live.put("restartOnCrash", "false");
        live.put("reloadPageFailure", "0");

        List<Drift> drifts = KioskSettings.detect(live);
        assertEquals(3, drifts.size());
        assertTrue(keys(drifts).contains("kioskMode"));
        assertTrue(keys(drifts).contains("restartOnCrash"));
        assertTrue(keys(drifts).contains("reloadPageFailure"));
    }

    @Test
    public void absentKey_isNotDrift() {
        // THE most important case. FKB versions differ in which settings they expose.
        // If an unknown key counted as drift, the guard would write it every tick
        // forever, FKB would keep not reporting it, and the repair log would fill with
        // a fix that never takes. Absent == "this FKB has no such knob" == leave alone.
        Map<String, String> live = matching();
        live.remove("preventSleepWhileScreenOff");

        assertTrue("a key FKB does not report must never be written",
                KioskSettings.detect(live).isEmpty());
    }

    @Test
    public void emptyLiveMap_reportsNoDrift() {
        // The read-failure sentinel from FkbRest.listSettings. An unreachable FKB or a
        // bad password must NOT look like "all 11 settings drifted" and trigger a blind
        // rewrite of everything.
        assertTrue(KioskSettings.detect(java.util.Collections.<String, String>emptyMap()).isEmpty());
        assertTrue(KioskSettings.detect(null).isEmpty());
    }

    @Test
    public void booleanComparisonIsValueBased_notStringIdentity() {
        Map<String, String> live = matching();
        live.put("kioskMode", "TRUE");
        live.put("keepScreenOn", "True");
        live.put("restartOnCrash", "1");
        assertTrue("true/TRUE/True/1 all mean true", KioskSettings.detect(live).isEmpty());

        live.put("kioskMode", "0");
        assertEquals(1, KioskSettings.detect(live).size());
    }

    @Test
    public void stringComparisonToleratesSurroundingWhitespace() {
        Map<String, String> live = matching();
        live.put("reloadPageFailure", " 30 ");
        assertTrue(KioskSettings.detect(live).isEmpty());
    }

    private static java.util.Set<String> keys(List<Drift> drifts) {
        java.util.Set<String> s = new java.util.HashSet<>();
        for (Drift d : drifts) s.add(d.key);
        return s;
    }
}

package net.kckern.pianobridge;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import org.junit.Test;
import org.json.JSONObject;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Map;

import net.kckern.pianobridge.KioskWatchdog.Verdict;

/**
 * Guards the fix for the 2026-07-15 "piano keeps disconnecting" outage.
 *
 * Root cause: the SM-T590's aged WebView throttles rAF to ~6-8fps on a perfectly
 * usable, MIDI-connected kiosk. The watchdog classified that as DECAYED and ran the
 * DISRUPTIVE ladder (reload → restartApp → reboot) every cooldown forever — each
 * remount tore down Web MIDI + the bridge WS, which the user saw as the piano
 * dropping its connection. reload/restart provably don't raise fps on this hardware
 * (the reason useRenderWatchdog set SELF_HEAL_RESTART=false).
 *
 * Fix, asserted here:
 *   1. A slow-but-still-beating page classifies DECAYED, NOT DEAD.
 *   2. Only DEAD (beat-silence = JS loop actually dead) escalates past the invisible
 *      L1 touch-burst into the disruptive rungs.
 */
public class KioskWatchdogTest {

    // Android's JVM clock is zero. Set elapsed fields only after real beat ingestion;
    // all classification and serialization still pass through production methods.
    @SuppressWarnings("unchecked")
    private KioskWatchdog fixture(int fps, String visibility, long ageMs) throws Exception {
        java.lang.reflect.Constructor<DeviceConfig> ctor = DeviceConfig.class.getDeclaredConstructor();
        ctor.setAccessible(true);
        DeviceConfig config = ctor.newInstance();
        Field values = DeviceConfig.class.getDeclaredField("values");
        values.setAccessible(true);
        ((Map<String, String>) values.get(config)).put("watchdogRecoverEnabled", "false");
        KioskWatchdog watchdog = new KioskWatchdog(null, config);
        watchdog.onBeat(new JSONObject("{\"fps\":" + fps + ",\"visibility\":\"" + visibility
                + "\",\"url\":\"https://example.test/piano\",\"sinceLoadMs\":60000,\"ts\":1720033000000,"
                + "\"activity\":{\"type\":\"game\",\"id\":\"chess\"}}"));
        set(watchdog, "startedAtRt", -60_000L);
        set(watchdog, "lastBeatAtRt", -ageMs);
        set(watchdog, "lowMs", 5_000L);
        evaluate(watchdog);
        return watchdog;
    }

    private void set(KioskWatchdog watchdog, String name, Object value) throws Exception {
        Field field = KioskWatchdog.class.getDeclaredField(name);
        field.setAccessible(true);
        field.set(watchdog, value);
    }

    private void evaluate(KioskWatchdog watchdog) throws Exception {
        Method tick = KioskWatchdog.class.getDeclaredMethod("tick", long.class);
        tick.setAccessible(true);
        tick.invoke(watchdog, 2_000L);
    }

    @Test public void freshVisibleThreeFpsIsAliveAndDegraded() throws Exception {
        JSONObject visibleThreeFps = fixture(3, "visible", 1_000L).snapshot();
        assertEquals("alive", visibleThreeFps.optString("liveness", "unknown"));
        assertEquals("degraded", visibleThreeFps.optString("responsiveness", "unknown"));
        assertEquals("DECAYED", visibleThreeFps.getString("verdict"));
    }

    @Test public void oldOutcomeIsNotFreshRecovery() throws Exception {
        KioskWatchdog watchdog = fixture(3, "visible", 1_000L);
        JSONObject previous = watchdog.snapshot();
        String previousDecisionId = previous.optString("decisionId", "");
        String previousDecisionAt = previous.optString("decisionAt", "");
        assertFalse("an evaluated choice has its own identity", previousDecisionId.isEmpty());
        assertFalse("an evaluated choice has a UTC timestamp", previousDecisionAt.isEmpty());
        assertTrue(previousDecisionAt.endsWith("Z"));
        set(watchdog, "lastOutcome", "recovered@L1-touch");
        evaluate(watchdog);
        JSONObject unchangedDecision = watchdog.snapshot();
        assertEquals(previousDecisionId, unchangedDecision.getString("decisionId"));
        assertEquals(previousDecisionAt, unchangedDecision.getString("decisionAt"));
        assertEquals("recovered@L1-touch", unchangedDecision.getString("lastOutcome"));
    }

    @Test public void hiddenPageAndMissingBeatRemainDistinct() throws Exception {
        JSONObject sleeping = fixture(1, "hidden", 1_000L).snapshot();
        JSONObject silent = fixture(60, "visible", 13_000L).snapshot();
        assertEquals("screen-off", sleeping.optString("responsiveness", "unknown"));
        assertEquals("alive", sleeping.optString("liveness", "unknown"));
        assertEquals("dead", silent.optString("liveness", "unknown"));
        assertEquals("unknown", silent.optString("responsiveness", "unknown"));
    }

    @Test public void buildBeatInputSurvivesNativeStatusSerialization() throws Exception {
        JSONObject status = new JSONObject(fixture(3, "visible", 1_000L).snapshot().toString());
        assertEquals(3, status.getInt("pageRafFps"));
        assertEquals(3, status.getInt("lastFps"));
        assertEquals("visible", status.getString("lastVisibility"));
        assertEquals(12, status.getInt("minFps"));
        assertEquals(5, status.getInt("sustainSec"));
        assertEquals(12_000, status.getInt("beatTimeoutMs"));
        assertEquals("chess", status.getString("activeGame"));
        assertEquals("alive", status.optString("liveness", "unknown"));
        assertEquals("degraded", status.optString("responsiveness", "unknown"));
        // Same production allowlist called by ControlServer /status and Heartbeat.buildBody.
        JSONObject projected = new JSONObject();
        KioskWatchdog.appendHealthStatus(status, projected);
        assertEquals(8, projected.length());
        assertEquals("alive", projected.getString("liveness"));
        assertEquals("degraded", projected.getString("responsiveness"));
        assertEquals("chess", projected.getString("activeGame"));
        assertTrue(projected.isNull("screenOn"));
        assertEquals(status.getBoolean("quiet"), projected.getBoolean("quiet"));
        assertEquals(status.getString("decisionId"), projected.getString("decisionId"));
        assertEquals(status.getString("decisionAt"), projected.getString("decisionAt"));
        assertEquals(status.getString("recoveryStage"), projected.getString("recoveryStage"));
        JSONObject logLine = new JSONObject(Heartbeat.toLogStoreLine(projected));
        assertEquals("alive", logLine.getString("data.liveness"));
        assertEquals("degraded", logLine.getString("data.responsiveness"));
        assertEquals(status.getString("decisionId"), logLine.getString("data.decisionId"));
    }

    @Test public void newHealthyDecisionDoesNotRewriteHistoricalOutcome() throws Exception {
        KioskWatchdog watchdog = fixture(3, "visible", 1_000L);
        String oldId = watchdog.snapshot().getString("decisionId");
        set(watchdog, "lastOutcome", "old recovered@L1-touch");
        watchdog.onBeat(new JSONObject().put("fps", 60).put("visibility", "visible"));
        set(watchdog, "lastBeatAtRt", -1_000L);
        evaluate(watchdog);
        JSONObject status = watchdog.snapshot();
        assertFalse(oldId.equals(status.getString("decisionId")));
        assertEquals("healthy", status.getString("responsiveness"));
        assertEquals("observing", status.getString("recoveryStage"));
        assertEquals("old recovered@L1-touch", status.getString("lastOutcome"));
    }

    @Test public void independentHealthDoesNotWaitForRecoverySustainOrGrace() throws Exception {
        KioskWatchdog watchdog = fixture(60, "visible", 1_000L);
        set(watchdog, "startedAtRt", 0L); // native startup grace applies to the policy
        watchdog.onBeat(new JSONObject().put("fps", 3).put("visibility", "visible"));
        set(watchdog, "lastBeatAtRt", -1_000L);
        // Before another tick the legacy verdict can still say HEALTHY. Raw status must not.
        JSONObject status = watchdog.snapshot();
        assertEquals("HEALTHY", status.getString("verdict"));
        assertEquals("alive", status.getString("liveness"));
        assertEquals("degraded", status.getString("responsiveness"));
        evaluate(watchdog);
        assertEquals("GRACE", watchdog.snapshot().getString("verdict"));
        assertEquals("degraded", watchdog.snapshot().getString("responsiveness"));
    }

    @Test public void unknownMeasurementsAndFreshScreenReadbackAreExplicit() throws Exception {
        KioskWatchdog watchdog = fixture(-1, "visible", 1_000L);
        assertEquals("unknown", watchdog.snapshot().getString("responsiveness"));
        set(watchdog, "lastBeatAtRt", 0L);
        assertEquals("unknown", watchdog.snapshot().getString("liveness"));
        set(watchdog, "lastBeatAtRt", -1_000L);
        set(watchdog, "lastFps", 60);
        set(watchdog, "screenOn", Boolean.FALSE);
        set(watchdog, "screenReadAtRt", 0L);
        assertEquals("screen-off", watchdog.snapshot().getString("responsiveness"));
        set(watchdog, "screenReadAtRt", -13_000L);
        assertTrue(watchdog.snapshot().isNull("screenOn"));
        assertEquals("healthy", watchdog.snapshot().getString("responsiveness"));
    }

    @Test public void nativeUnknownOrParentStopNeverStartsRecoveryActions() throws Exception {
        for (net.kckern.pianobridge.api.ShellServices.SafetyState state :
                new net.kckern.pianobridge.api.ShellServices.SafetyState[]{
                net.kckern.pianobridge.api.ShellServices.SafetyState.UNKNOWN,
                new net.kckern.pianobridge.api.ShellServices.SafetyState(true, true, 6, 100)}) {
            KioskWatchdog watchdog = fixture(60, "visible", 13_000L);
            net.kckern.pianobridge.api.ShellServices shell =
                    (net.kckern.pianobridge.api.ShellServices) java.lang.reflect.Proxy.newProxyInstance(
                    getClass().getClassLoader(), new Class[]{net.kckern.pianobridge.api.ShellServices.class},
                    (proxy, method, args) -> method.getName().equals("nativeSafety") ? state : null);
            set(watchdog, "service", new BridgeCore(shell));
            Method ladder = KioskWatchdog.class.getDeclaredMethod("runLadder", Verdict.class);
            ladder.setAccessible(true);
            ladder.invoke(watchdog, Verdict.DEAD);
            JSONObject status = watchdog.snapshot();
            JSONObject counts = status.getJSONObject("recoveryCounts");
            for (String key : new String[]{"touchBurst", "reload", "restartApp", "reboot"})
                assertEquals(key, 0, counts.getInt(key));
            assertEquals("native safety or maintenance suppressed recovery", status.getString("lastOutcome"));
            assertEquals("finished", status.getString("recoveryStage"));
        }
    }

    private int healthEvents() {
        int count = 0;
        org.json.JSONArray events = Diag.recent();
        for (int i = 0; i < events.length(); i++)
            if (events.optString(i).contains("WATCHDOG: health-edge")) count++;
        return count;
    }

    @Test public void healthEdgesAreLoggedOnceEvenInsideStartupGrace() throws Exception {
        KioskWatchdog watchdog = fixture(60, "visible", 1_000L);
        set(watchdog, "startedAtRt", 0L);
        int before = healthEvents();
        set(watchdog, "lastFps", 3);
        evaluate(watchdog);
        assertEquals(before + 1, healthEvents());
        evaluate(watchdog);
        assertEquals("no per-tick edge log", before + 1, healthEvents());
        set(watchdog, "lastFps", 60);
        evaluate(watchdog);
        assertEquals(before + 2, healthEvents());
        String events = Diag.recent().toString();
        assertTrue(events.contains("responsiveness=degraded"));
        assertTrue(events.contains("fps=3"));
        assertTrue(events.contains("beatAgeMs=1000"));
        assertTrue(events.contains("nativeRecoveryAllowed=false"));
        assertTrue(events.contains("payload=p38-managed-candidate"));
    }

    // classify(enabled, sinceStartMs, sawAnyBeat, beatAgeMs, fps, visibility,
    //          lowMsAccum, minFps, sustainSec, beatTimeoutMs, graceMs)

    @Test
    public void slowButBeatingPage_isDecayed_notDead() {
        // fps 6 < minFps 12, visible, beats fresh (age 1s < 12s timeout), low sustained 5s.
        Verdict v = KioskWatchdog.classify(
                true, 60_000, true, 1_000, 6, "visible",
                5_000, 12, 4, 12_000, 8_000);
        assertEquals("a throttled-but-beating page is DECAYED, never DEAD", Verdict.DECAYED, v);
    }

    @Test
    public void beatSilence_isDead_evenWithHighLastFps() {
        // Last fps was healthy (47), but no beat for 20s (> 12s timeout): the loop died.
        Verdict v = KioskWatchdog.classify(
                true, 60_000, true, 20_000, 47, "visible",
                0, 12, 4, 12_000, 8_000);
        assertEquals("beat-silence is DEAD regardless of the last fps sample", Verdict.DEAD, v);
    }

    @Test
    public void screenOff_lowFps_isNotAFault() {
        // Backlight off → rAF ~1fps is expected, must not read as jank.
        Verdict v = KioskWatchdog.classify(
                true, 60_000, true, 1_000, 1, "hidden",
                5_000, 12, 4, 12_000, 8_000);
        assertEquals(Verdict.SCREEN_OFF, v);
    }

    @Test
    public void onlyDeadEscalatesPastL1() {
        // The core guard: a merely-slow page never reaches the disruptive rungs.
        assertTrue("DEAD (loop actually dead) may reload/restart/reboot",
                KioskWatchdog.escalatesPastL1(Verdict.DEAD));
        assertFalse("DECAYED (slow but alive) gets ONLY the invisible touch-burst",
                KioskWatchdog.escalatesPastL1(Verdict.DECAYED));
        assertFalse(KioskWatchdog.escalatesPastL1(Verdict.HEALTHY));
        assertFalse(KioskWatchdog.escalatesPastL1(Verdict.BUILDING));
        assertFalse(KioskWatchdog.escalatesPastL1(Verdict.SCREEN_OFF));
    }

    @Test
    public void activeGame_neverEscalatesIntoDisruptiveRecovery() {
        assertFalse("a child mid-game must not have their SPA reloaded",
                KioskWatchdog.escalatesPastL1(Verdict.DEAD, true));
        assertTrue("the same genuine dead-page condition can recover outside a game",
                KioskWatchdog.escalatesPastL1(Verdict.DEAD, false));
    }
}

package net.kckern.pianobridge;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import org.junit.Test;

public class AudioRouteGuardTest {

    /** Fake of the Android surface: records what the guard did. */
    static class FakeOps implements AudioRouteGuard.Ops {
        boolean a2dpConnected, a2dpOut, wired;
        int speakerIndex = 15;
        Boolean lastGate = null;
        int clampCalls = 0;
        int raiseCalls = 0;
        boolean dropDuringRaise = false;

        public boolean a2dpProfileConnected() { return a2dpConnected; }
        public boolean a2dpOutputPresent()    { return a2dpOut; }
        public boolean wiredOutputPresent()   { return wired; }
        public int  speakerMusicIndex()       { return speakerIndex; }
        public int  musicMaxIndex()           { return 15; }
        public void clampSpeakerMusicVolume() { clampCalls++; speakerIndex = 0; }
        public boolean raiseA2dpMusicVolume() {
            raiseCalls++;
            if (dropDuringRaise) { a2dpOut = false; speakerIndex = 0; return false; }
            speakerIndex = 15;
            return true;
        }
        public void setSynthGate(boolean open) { lastGate = open; }
    }

    @Test public void disconnected_clampsOnceThenIsIdempotent() {
        FakeOps ops = new FakeOps();
        AudioRouteGuard g = new AudioRouteGuard(ops);

        g.reconcile();
        assertEquals(1, ops.clampCalls);
        assertEquals(Boolean.FALSE, ops.lastGate);
        assertFalse(g.routeOk());
        assertEquals("no_a2dp_output", g.reason());

        g.reconcile(); // speakerIndex is now 0 — must not write again
        assertEquals(1, ops.clampCalls);
    }

    @Test public void connected_opensGateAndNeverRestoresVolume() {
        FakeOps ops = new FakeOps();
        ops.speakerIndex = 0; // already clamped by a previous drop
        AudioRouteGuard g = new AudioRouteGuard(ops);
        ops.a2dpConnected = true; ops.a2dpOut = true;

        g.reconcile();
        assertTrue(g.routeOk());
        assertEquals(Boolean.TRUE, ops.lastGate);
        assertEquals(0, ops.clampCalls);
        assertEquals(0, ops.speakerIndex); // NEVER restored
    }

    @Test public void strayVolumeRaise_isStompedBackToZero() {
        FakeOps ops = new FakeOps();
        AudioRouteGuard g = new AudioRouteGuard(ops);
        g.reconcile();
        assertEquals(1, ops.clampCalls);

        ops.speakerIndex = 9;   // someone pressed volume-up
        g.reconcile();
        assertEquals(2, ops.clampCalls);
        assertEquals(0, ops.speakerIndex);
    }

    @Test public void gateStartsClosedBeforeAnyReconcile() {
        assertFalse(new AudioRouteGuard(new FakeOps()).routeOk());
    }

    @Test public void override_opensGateWithoutRestoringVolume() {
        FakeOps ops = new FakeOps();
        AudioRouteGuard g = new AudioRouteGuard(ops);
        g.reconcile();
        assertEquals(Boolean.FALSE, ops.lastGate);

        g.setOverrideUntil(Long.MAX_VALUE);
        g.reconcile();
        assertEquals(Boolean.TRUE, ops.lastGate);
        assertEquals("override", g.reason());
        assertEquals(1, ops.clampCalls); // volume floor still enforced
    }

    /** FKB re-raises the index after every clamp — the 2026-10-23 storm. */
    static class FightingOps extends FakeOps {
        @Override public void clampSpeakerMusicVolume() { clampCalls++; /* FKB puts it right back */ }
    }

    @Test public void storm_everyClampStillHappens_butLogsOncePerMinute() {
        FightingOps ops = new FightingOps();
        long[] now = { 1_000_000L };
        AudioRouteGuard g = new AudioRouteGuard(ops, () -> now[0]);
        for (int i = 0; i < 100; i++) { g.reconcile(); now[0] += 40; } // 4 s of storm
        assertEquals("fail-closed: never skip a clamp", 100, ops.clampCalls);
        assertEquals(1, g.clampLogs());
        now[0] += 60_000;
        g.reconcile();
        assertEquals(2, g.clampLogs());
    }

    @Test public void status_reportsClampsInTheLastMinute() throws Exception {
        FightingOps ops = new FightingOps();
        long[] now = { 1_000_000L };
        AudioRouteGuard g = new AudioRouteGuard(ops, () -> now[0]);
        for (int i = 0; i < 30; i++) { g.reconcile(); now[0] += 100; }
        assertEquals(30, g.status().getInt("clampsPerMin"));
        now[0] += 61_000;
        g.reconcile();
        assertEquals(1, g.status().getInt("clampsPerMin"));
    }

    // ---- A2DP volume floor ----

    @Test public void a2dpAtZero_raisedOnlyAfterSettle() throws Exception {
        FakeOps ops = new FakeOps();
        ops.a2dpConnected = true; ops.a2dpOut = true; ops.speakerIndex = 0;
        long[] now = { 1_000_000L };
        AudioRouteGuard g = new AudioRouteGuard(ops, () -> now[0]);

        g.reconcile();                                   // just connected
        assertEquals(0, ops.raiseCalls);
        assertEquals(AudioGuardPolicy.A2DP_SETTLE_MS, g.recheckInMs());
        assertTrue(g.routeOk());

        now[0] += AudioGuardPolicy.A2DP_SETTLE_MS;       // the scheduled recheck
        g.reconcile();
        assertEquals(1, ops.raiseCalls);
        assertEquals(15, ops.speakerIndex);
        assertEquals(0, g.recheckInMs());
        assertEquals(1, g.status().getInt("a2dpRaises"));
        assertEquals(0, g.status().getInt("lastA2dpRaiseFrom"));
        assertEquals(15, g.status().getInt("musicIndex"));

        g.reconcile();                                   // idempotent at max
        assertEquals(1, ops.raiseCalls);
    }

    @Test public void volumeDownWhileOnA2dp_isRaisedBack() {
        FakeOps ops = new FakeOps();
        ops.a2dpConnected = true; ops.a2dpOut = true; ops.speakerIndex = 15;
        long[] now = { 1_000_000L };
        AudioRouteGuard g = new AudioRouteGuard(ops, () -> now[0]);
        g.reconcile();
        now[0] += 60_000;
        ops.speakerIndex = 0;                            // someone pressed volume-down
        g.reconcile();                                   // VOLUME_CHANGED edge
        assertEquals(1, ops.raiseCalls);
        assertEquals(15, ops.speakerIndex);
    }

    @Test public void flapResetsTheSettleWindow() {
        FakeOps ops = new FakeOps();
        ops.a2dpConnected = true; ops.a2dpOut = true; ops.speakerIndex = 0;
        long[] now = { 1_000_000L };
        AudioRouteGuard g = new AudioRouteGuard(ops, () -> now[0]);
        g.reconcile();
        now[0] += 2_000;
        ops.a2dpOut = false; g.reconcile();              // drop
        ops.a2dpOut = true;  now[0] += 1_500; g.reconcile(); // back: window restarts
        assertEquals(0, ops.raiseCalls);
        now[0] += AudioGuardPolicy.A2DP_SETTLE_MS; g.reconcile();
        assertEquals(1, ops.raiseCalls);
    }

    @Test public void raiseThatLosesTheRoute_isNotCounted() throws Exception {
        FakeOps ops = new FakeOps();
        ops.a2dpConnected = true; ops.a2dpOut = true; ops.speakerIndex = 0;
        ops.dropDuringRaise = true;
        long[] now = { 1_000_000L };
        AudioRouteGuard g = new AudioRouteGuard(ops, () -> now[0]);
        g.reconcile();
        now[0] += AudioGuardPolicy.A2DP_SETTLE_MS; g.reconcile();
        assertEquals(1, ops.raiseCalls);
        assertEquals(0, g.status().getInt("a2dpRaises"));
        assertEquals(0, ops.speakerIndex);
    }

    @Test public void speakerRoute_neverRaised() {
        FakeOps ops = new FakeOps();
        long[] now = { 1_000_000L };
        AudioRouteGuard g = new AudioRouteGuard(ops, () -> now[0]);
        for (int i = 0; i < 5; i++) { g.reconcile(); now[0] += 10_000; }
        assertEquals(0, ops.raiseCalls);
        assertEquals(0, ops.speakerIndex);
    }
}

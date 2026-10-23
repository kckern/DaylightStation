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

        public boolean a2dpProfileConnected() { return a2dpConnected; }
        public boolean a2dpOutputPresent()    { return a2dpOut; }
        public boolean wiredOutputPresent()   { return wired; }
        public int  speakerMusicIndex()       { return speakerIndex; }
        public void clampSpeakerMusicVolume() { clampCalls++; speakerIndex = 0; }
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
}

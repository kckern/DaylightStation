package net.kckern.pianobridge;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import org.junit.Test;

import net.kckern.pianobridge.AudioGuardPolicy.Decision;
import net.kckern.pianobridge.AudioGuardPolicy.World;

public class AudioGuardPolicyTest {

    private static World world(boolean a2dpConnected, boolean a2dpOutputPresent,
                               boolean wiredPresent, int speakerIndex) {
        return new World(a2dpConnected, a2dpOutputPresent, wiredPresent, speakerIndex);
    }

    @Test public void speakerRouted_gatesAndClamps() {
        Decision d = AudioGuardPolicy.decide(world(false, false, false, 15));
        assertFalse(d.routeOk);
        assertTrue(d.gateSynth);
        assertTrue(d.clampSpeakerVolume);
        assertEquals("no_a2dp_output", d.reason);
    }

    @Test public void speakerAlreadyClamped_noRedundantWrite() {
        Decision d = AudioGuardPolicy.decide(world(false, false, false, 0));
        assertTrue(d.gateSynth);
        assertFalse(d.clampSpeakerVolume); // idempotent: already 0
    }

    @Test public void a2dpConnectedAndPresent_opensGate() {
        Decision d = AudioGuardPolicy.decide(world(true, true, false, 0));
        assertTrue(d.routeOk);
        assertFalse(d.gateSynth);
        assertFalse(d.clampSpeakerVolume);
        assertEquals("ok", d.reason);
    }

    @Test public void a2dpConnectedButNoOutputDevice_failsClosed() {
        Decision d = AudioGuardPolicy.decide(world(true, false, false, 15));
        assertFalse(d.routeOk);
        assertTrue(d.gateSynth);
        assertTrue(d.clampSpeakerVolume);
        assertEquals("no_a2dp_output", d.reason);
    }

    @Test public void a2dpOutputWithoutProfileConnection_failsClosed() {
        Decision d = AudioGuardPolicy.decide(world(false, true, false, 15));
        assertFalse(d.routeOk);
        assertTrue(d.gateSynth);
        assertEquals("not_connected", d.reason);
    }

    @Test public void wiredRoute_gatesButDoesNotClamp() {
        Decision d = AudioGuardPolicy.decide(world(false, false, true, 15));
        assertTrue(d.gateSynth);
        assertFalse(d.clampSpeakerVolume);
        assertEquals("wired_route", d.reason);
    }

    // ---- A2DP volume floor (2026-11-13: "connected" at 0/15 was silent) ----

    private static World a2dp(int index, long settledMs) {
        return new World(true, true, false, index, 15, settledMs);
    }

    @Test public void a2dpAtZero_settled_raises() {
        Decision d = AudioGuardPolicy.decide(a2dp(0, AudioGuardPolicy.A2DP_SETTLE_MS));
        assertTrue(d.routeOk);
        assertTrue(d.raiseA2dpVolume);
        assertFalse(d.clampSpeakerVolume);
    }

    @Test public void a2dpAtZero_notSettled_waitsAndAsksForRecheck() {
        Decision d = AudioGuardPolicy.decide(a2dp(0, 1_000));
        assertTrue(d.routeOk);
        assertFalse(d.raiseA2dpVolume);
        assertEquals(AudioGuardPolicy.A2DP_SETTLE_MS - 1_000, d.recheckInMs);
    }

    @Test public void a2dpPartlyLowered_isRaisedToMax() {
        assertTrue(AudioGuardPolicy.decide(a2dp(7, 10_000)).raiseA2dpVolume);
    }

    @Test public void a2dpAtMax_noWriteNoRecheck() {
        Decision d = AudioGuardPolicy.decide(a2dp(15, 0));
        assertFalse(d.raiseA2dpVolume);
        assertEquals(0, d.recheckInMs);
    }

    @Test public void a2dpWithWiredPresent_neverRaises() {
        Decision d = AudioGuardPolicy.decide(new World(true, true, true, 0, 15, 60_000));
        assertTrue(d.routeOk);
        assertFalse("active device ambiguous: don't write", d.raiseA2dpVolume);
    }

    @Test public void speakerRoute_neverRaises() {
        Decision d = AudioGuardPolicy.decide(new World(false, false, false, 0, 15, 60_000));
        assertFalse(d.raiseA2dpVolume);
        assertFalse(d.routeOk);
    }

    @Test public void floorDisabledWhenMaxUnknown() {
        assertFalse(AudioGuardPolicy.decide(new World(true, true, false, 0, 0, 60_000)).raiseA2dpVolume);
    }
}

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
}

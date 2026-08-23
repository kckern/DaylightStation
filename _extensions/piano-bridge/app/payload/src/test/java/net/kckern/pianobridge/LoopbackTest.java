package net.kckern.pianobridge;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

/**
 * The loopback is the one assertion that uses the piano as the witness, so its
 * matching logic must be exact: the probe must be recognised ONLY by its
 * channel+note, must be swallowed (never shown on the kiosk), and a missed window
 * must count as a miss rather than hang as pending forever.
 *
 * BridgeCore needs a ShellServices; these tests exercise the pure matching paths
 * with a null core where sendMidi is not reached.
 */
public class LoopbackTest {

    @Test public void recognisesOnlyTheProbeChannelAndNote() {
        Loopback lb = new Loopback(null);
        // Real playing on channel 1, note 60: not ours.
        assertFalse(lb.onInboundNote(0x90, 60, 100));
        // Same note number on the probe channel: ours (swallowed) even with no probe pending.
        assertTrue(lb.onInboundNote(0x90 | Loopback.PROBE_CHANNEL, Loopback.PROBE_NOTE, 1));
        // Probe channel but a different note: not ours.
        assertFalse(lb.onInboundNote(0x90 | Loopback.PROBE_CHANNEL, 60, 1));
    }

    @Test public void freshInstanceIsNotVerified() {
        JSONObject s = new Loopback(null).snapshot();
        assertFalse("no echo ever seen -> must not claim verified", s.optBoolean("outVerified"));
        assertEquals(0, s.optInt("probes"));
        assertEquals(-1, s.optLong("lastEchoAgoMs"));
    }

    @Test public void probeNoteIsOutsideAnythingTheKioskUses() {
        // Channel 16, note 1 (C#-1), velocity 1: below the keyboard, on an unused
        // channel, inaudible. If someone ever changes these, the kiosk could start
        // swallowing a real note — pin them.
        assertEquals(15, Loopback.PROBE_CHANNEL);
        assertEquals(1, Loopback.PROBE_NOTE);
        assertEquals(1, Loopback.PROBE_VELOCITY);
        assertTrue(Loopback.WINDOW_MS >= 1000 && Loopback.WINDOW_MS <= 3000);
    }
}

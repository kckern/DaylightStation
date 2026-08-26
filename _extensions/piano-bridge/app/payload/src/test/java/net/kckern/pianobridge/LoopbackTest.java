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
        // The probe note on the SEND channel: ours.
        assertTrue(lb.onInboundNote(0x90 | Loopback.PROBE_CHANNEL, Loopback.PROBE_NOTE, 1));
        // The probe note echoed on CHANNEL 1 — what the MDG-400 actually does: ours.
        assertTrue(lb.onInboundNote(0x90, Loopback.PROBE_NOTE, 1));
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

    // ── The 2026-08-26 latch bug ──────────────────────────────────────────────
    // The escalation rung used to be a one-shot boolean cleared ONLY by an echo.
    // With no echo it fired once per process lifetime and the ladder degraded
    // permanently to connectNow() every 10 min — 104 kicks over 19 hours. These
    // pin the property that matters: escalation must RE-ARM on continued failure,
    // with a backoff that grows so a switched-off piano can't churn the radio.

    @Test public void escalationIsImmediatelyEligibleBeforeAnyHasFired() {
        Loopback lb = new Loopback(null);
        assertEquals(0, lb.episodeEscalations());
        assertEquals("first escalation must not be delayed", 0L, lb.escalationBackoffMs());
    }

    @Test public void escalationBackoffGrowsAndCaps() {
        Loopback lb = new Loopback(null);
        // Walk the backoff ladder by hand: 30m, 1h, 2h, 4h, then 4h forever.
        long[] expected = {
            0L,
            30L * 60_000L,
            60L * 60_000L,
            120L * 60_000L,
            240L * 60_000L,
            240L * 60_000L,
            240L * 60_000L,
        };
        for (int n = 0; n < expected.length; n++) {
            lb.setEscalationsForTest(n);
            assertEquals("backoff after " + n + " escalations", expected[n], lb.escalationBackoffMs());
        }
    }

    @Test public void backoffNeverExceedsTheCap() {
        Loopback lb = new Loopback(null);
        for (int n = 0; n < 64; n++) {
            lb.setEscalationsForTest(n);
            long b = lb.escalationBackoffMs();
            assertTrue("backoff must stay non-negative (no shift overflow) at n=" + n, b >= 0);
            assertTrue("backoff must never exceed the 4h cap at n=" + n,
                    b <= Loopback.ESCALATION_MAX_BACKOFF_MS);
        }
    }

    @Test public void anEchoEndsTheEpisodeAndReArmsTheLadder() {
        Loopback lb = new Loopback(null);
        lb.setEscalationsForTest(3);
        assertTrue(lb.escalationBackoffMs() > 0);
        // The piano answers a probe we have outstanding: episode over, ladder back
        // to rung 1 with no delay.
        lb.addPendingProbeForTest();
        lb.onInboundNote(0x90, Loopback.PROBE_NOTE, 1);
        assertEquals(0, lb.episodeEscalations());
        assertEquals(0L, lb.escalationBackoffMs());
    }
}

package net.kckern.pianobridge;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import org.junit.Test;

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
}

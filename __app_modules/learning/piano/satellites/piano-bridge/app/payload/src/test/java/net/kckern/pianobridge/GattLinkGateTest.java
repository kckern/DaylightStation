package net.kckern.pianobridge;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import org.junit.Test;

public class GattLinkGateTest {

    @Test public void anOpenedDeviceIsNotALink_untilGattSaysConnected() {
        // 2026-11-18: openBluetoothDevice returned in ~10 ms with no link behind it, and the
        // JamCorder listed no client. A returned MidiDevice proves nothing by itself.
        assertEquals(GattLinkGate.Opening.WAIT, GattLinkGate.opening(false, 10));
    }

    @Test public void unavailableGattCannotConfirmAnOpenOrSustainAConnection() {
        assertEquals(GattLinkGate.Opening.WAIT, GattLinkGate.opening(null, 0));
        assertEquals(GattLinkGate.Opening.NO_LINK, GattLinkGate.opening(null, GattLinkGate.CONFIRM_TIMEOUT_MS));
        assertTrue(GattLinkGate.linkLost(GattLinkGate.nextMisses(null, 1)));
    }

    @Test public void gattConnected_confirmsTheLink() {
        assertEquals(GattLinkGate.Opening.CONFIRMED, GattLinkGate.opening(true, 10));
    }

    @Test public void gattConnectedAtTheDeadline_stillConfirms() {
        assertEquals(GattLinkGate.Opening.CONFIRMED,
                GattLinkGate.opening(true, GattLinkGate.CONFIRM_TIMEOUT_MS + 1));
    }

    @Test public void noGattByTheDeadline_isNoLink() {
        assertEquals(GattLinkGate.Opening.WAIT,
                GattLinkGate.opening(false, GattLinkGate.CONFIRM_TIMEOUT_MS - 1));
        assertEquals(GattLinkGate.Opening.NO_LINK,
                GattLinkGate.opening(false, GattLinkGate.CONFIRM_TIMEOUT_MS));
    }

    @Test public void oneMissedReading_doesNotDropAWorkingLink() {
        assertEquals(1, GattLinkGate.nextMisses(false, 0));
        assertFalse(GattLinkGate.linkLost(1));
    }

    @Test public void consecutiveMisses_dropTheLink() {
        assertEquals(2, GattLinkGate.nextMisses(false, 1));
        assertTrue(GattLinkGate.linkLost(2));
    }

    @Test public void aGoodReading_clearsTheMisses() {
        assertEquals(0, GattLinkGate.nextMisses(true, 1));
    }

    @Test public void aFirstRetryUsesTheConfiguredDelay() {
        assertEquals(3_000L, GattLinkGate.retryDelayMs(3_000L, 0));
    }

    @Test public void repeatedOpensWithNoLink_backOffToAMinute() {
        // The JamCorder is unpowered whenever the piano plug is off; do not hammer the radio.
        assertEquals(6_000L, GattLinkGate.retryDelayMs(3_000L, 1));
        assertEquals(12_000L, GattLinkGate.retryDelayMs(3_000L, 2));
        assertEquals(60_000L, GattLinkGate.retryDelayMs(3_000L, 5));
        assertEquals(60_000L, GattLinkGate.retryDelayMs(3_000L, 500));
    }
}

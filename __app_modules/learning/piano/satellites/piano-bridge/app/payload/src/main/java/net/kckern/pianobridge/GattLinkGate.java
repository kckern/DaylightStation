package net.kckern.pianobridge;

/**
 * GattLinkGate — when a BLE-MIDI open counts as a connection.
 *
 * {@code MidiManager.openBluetoothDevice} hands back a device object whether or not a
 * Bluetooth link exists. On 2026-11-18 that made the bridge report CONNECTED while the
 * JamCorder had no power, and stay there for 44 minutes after power returned with no
 * client on the JamCorder. Only the GATT connection state says the link is real.
 */
final class GattLinkGate {

    /** Android gives up on a direct LE connection at about this point. */
    static final long CONFIRM_TIMEOUT_MS = 30_000L;
    static final long CONFIRM_POLL_MS = 250L;
    static final long WATCH_INTERVAL_MS = 5_000L;
    private static final int MISSES_TO_DROP = 2;

    enum Opening { WAIT, CONFIRMED, NO_LINK }

    private GattLinkGate() { }

    static Opening opening(boolean gattConnected, long elapsedMs) {
        if (gattConnected) return Opening.CONFIRMED;
        return elapsedMs >= CONFIRM_TIMEOUT_MS ? Opening.NO_LINK : Opening.WAIT;
    }

    static int nextMisses(boolean gattConnected, int misses) {
        return gattConnected ? 0 : misses + 1;
    }

    static boolean linkLost(int misses) {
        return misses >= MISSES_TO_DROP;
    }
}

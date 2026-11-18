package net.kckern.pianobridge;

/**
 * GattLinkGate — when a BLE-MIDI open counts as a connection.
 *
 * {@code MidiManager.openBluetoothDevice} hands back a device object whether or not a
 * Bluetooth link exists. On 2026-11-18 that left the bridge reporting CONNECTED for 44
 * minutes with the piano on while the JamCorder listed no client. Only the GATT
 * connection state says the link is real.
 */
final class GattLinkGate {

    /** Android gives up on a direct LE connection at about this point. */
    static final long CONFIRM_TIMEOUT_MS = 30_000L;
    static final long CONFIRM_POLL_MS = 250L;
    static final long WATCH_INTERVAL_MS = 5_000L;
    private static final int MISSES_TO_DROP = 2;
    private static final long MAX_RETRY_DELAY_MS = 60_000L;

    enum Opening { WAIT, CONFIRMED, NO_LINK }

    private GattLinkGate() { }

    static Opening opening(boolean gattConnected, long elapsedMs) {
        if (gattConnected) return Opening.CONFIRMED;
        return elapsedMs >= CONFIRM_TIMEOUT_MS ? Opening.NO_LINK : Opening.WAIT;
    }

    /** Back off while opens keep finding no link, so a powered-off hub is not hammered. */
    static long retryDelayMs(long baseMs, int noLinkStreak) {
        long delay = baseMs;
        for (int i = 0; i < noLinkStreak && delay < MAX_RETRY_DELAY_MS; i++) delay *= 2;
        return Math.min(delay, MAX_RETRY_DELAY_MS);
    }

    static int nextMisses(boolean gattConnected, int misses) {
        return gattConnected ? 0 : misses + 1;
    }

    static boolean linkLost(int misses) {
        return misses >= MISSES_TO_DROP;
    }
}

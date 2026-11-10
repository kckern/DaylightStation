package net.kckern.pianobridge;

import android.bluetooth.BluetoothAdapter;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * AdapterCycler — tablet Bluetooth off → settle → on, for the backend speaker
 * ladder (POST /speaker/bt-cycle). On 2026-10-23 this exact sequence, done by hand
 * from the kiosk BT panel, revived an A2DP sink that 29 connect() retries could not.
 *
 * Runs entirely on the tablet so a dropped HTTP connection mid-toggle can never
 * strand Bluetooth off: once disabled, it keeps asking for enable() for up to
 * {@link #WATCHDOG_MS}, then keeps retrying every {@link #SLOW_RETRY_MS} for
 * {@link #SLOW_WINDOW_MS} before reporting "stuck-off" — a Bluetooth left off would
 * take BLE-MIDI (the piano's keys) down with the speaker. BLE-MIDI drops for the
 * duration; BleMidiConnector reconnects it on its own.
 */
public final class AdapterCycler {

    public interface Ops { boolean isEnabled(); boolean enable(); boolean disable(); }
    public interface Clock { long now(); void sleep(long ms) throws InterruptedException; }

    static final long MAX_SETTLE_MS = 30_000L;
    static final long STATE_WAIT_MS = 10_000L;
    static final long WATCHDOG_MS = 30_000L;
    static final long POLL_MS = 200L;
    static final long ENABLE_RETRY_MS = 2_000L;
    static final long SLOW_RETRY_MS = 10_000L;
    static final long SLOW_WINDOW_MS = 5 * 60_000L;

    public static final class Result {
        public final boolean ok; public final String error; public final long tookMs;
        Result(boolean ok, String error, long tookMs) { this.ok = ok; this.error = error; this.tookMs = tookMs; }
    }

    private final Ops ops;
    private final Clock clock;
    private final AtomicBoolean running = new AtomicBoolean(false);

    public AdapterCycler(Ops ops, Clock clock) { this.ops = ops; this.clock = clock; }

    /** Android-backed instance; null when the device has no Bluetooth. */
    public static AdapterCycler forDevice() {
        final BluetoothAdapter a = BluetoothAdapter.getDefaultAdapter();
        if (a == null) return null;
        return new AdapterCycler(new Ops() {
            public boolean isEnabled() { return a.isEnabled(); }
            public boolean enable() { return a.enable(); }
            public boolean disable() { return a.disable(); }
        }, new Clock() {
            public long now() { return System.currentTimeMillis(); }
            public void sleep(long ms) throws InterruptedException { Thread.sleep(ms); }
        });
    }

    boolean tryBegin() { return running.compareAndSet(false, true); }
    void end() { running.set(false); }
    public boolean isRunning() { return running.get(); }

    /** Blocking. Call off the HTTP thread. */
    public Result run(long settleMs) {
        if (!tryBegin()) return new Result(false, "busy", 0);
        long start = clock.now();
        try {
            long settle = Math.max(0, Math.min(MAX_SETTLE_MS, settleMs));
            if (ops.isEnabled()) {
                ops.disable();
                waitFor(false, STATE_WAIT_MS);
            }
            clock.sleep(settle);
            long fastUntil = clock.now() + WATCHDOG_MS;
            long slowUntil = fastUntil + SLOW_WINDOW_MS;
            while (true) {
                tryEnable();
                if (waitFor(true, ENABLE_RETRY_MS)) return new Result(true, null, clock.now() - start);
                if (clock.now() >= slowUntil) return new Result(false, "stuck-off", clock.now() - start);
                if (clock.now() >= fastUntil) clock.sleep(SLOW_RETRY_MS);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            tryEnable(); // never leave it off on the way out
            return new Result(false, "interrupted", clock.now() - start);
        } catch (RuntimeException e) {
            tryEnable();
            return new Result(false, "error: " + e.getClass().getSimpleName(), clock.now() - start);
        } finally {
            end();
        }
    }

    /** enable() can throw (a revoked permission, a dying stack); a throw is just a failed try. */
    private void tryEnable() {
        try { ops.enable(); } catch (RuntimeException ignored) { }
    }

    private boolean waitFor(boolean wantEnabled, long withinMs) throws InterruptedException {
        long until = clock.now() + withinMs;
        while (clock.now() < until) {
            if (ops.isEnabled() == wantEnabled) return true;
            clock.sleep(POLL_MS);
        }
        return ops.isEnabled() == wantEnabled;
    }
}

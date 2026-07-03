package net.kckern.pianobridge;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import java.util.concurrent.atomic.AtomicLong;

/**
 * TouchPulser — while the piano is played, emits a cadence-limited synthetic
 * touch (via {@link PianoTouchService}) so the SM-T590's OS input-recency frame
 * throttle stays lifted during MIDI play. Mirrors {@link ScreenWaker}: poke() is
 * called on the MIDI thread per note-on and is cheap (a time gate + one main-
 * thread post).
 *
 * All knobs are live-tunable via `pbctl config set` (POST /config rebuilds this):
 *   tapWakeEnabled  bool  master on/off (A/B against perf.diagnostics)
 *   tapCadenceMs    int   min gap between synthetic touches while playing
 *   tapX / tapY     int   corner origin of the micro-swipe (a dead zone)
 *   tapLen          int   swipe length px (must exceed touch-slop so it's not a click)
 *   tapDurationMs   int   swipe duration
 */
public final class TouchPulser {

    private static final String TAG = "PianoBridge-Touch";

    private final boolean enabled;
    private final long cadenceMs;
    private final int x, y, len, durationMs;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AtomicLong lastAt = new AtomicLong(0);

    public TouchPulser(DeviceConfig cfg) {
        this.enabled = cfg.tapWakeEnabled();
        this.cadenceMs = cfg.tapCadenceMs();
        this.x = cfg.tapX();
        this.y = cfg.tapY();
        this.len = cfg.tapLen();
        this.durationMs = cfg.tapDurationMs();
        Log.i(TAG, "TouchPulser enabled=" + enabled + " cadenceMs=" + cadenceMs
                + " origin=(" + x + "," + y + ") len=" + len + " durationMs=" + durationMs);
    }

    /** Per note-on (MIDI thread). Cadence-limited; dispatches on the main thread. */
    public void poke() {
        if (!enabled) return;
        long now = System.currentTimeMillis();
        long last = lastAt.get();
        if (now - last < cadenceMs) return;
        if (!lastAt.compareAndSet(last, now)) return;
        main.post(() -> {
            if (!PianoTouchService.swipe(x, y, len, durationMs)) {
                // Not fatal — the a11y service may not be bound yet (just enabled),
                // or accessibility injection may not un-throttle (the open question).
                Log.w(TAG, "synthetic touch not dispatched (a11y service not connected)");
            }
        });
    }
}

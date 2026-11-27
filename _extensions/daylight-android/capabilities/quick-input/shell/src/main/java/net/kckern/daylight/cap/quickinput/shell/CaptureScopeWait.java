package net.kckern.daylight.cap.quickinput.shell;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.widget.TextView;

import net.kckern.daylight.api.PayloadPort;
import net.kckern.daylight.api.PayloadStart;
import net.kckern.daylight.shellkit.PayloadReady;
import net.kckern.daylight.shellkit.ShellStart;

/**
 * A recreated screen (after Android stopped the app, a camera's return) waits for the
 * payload to verify its account before showing a draft. While Daylight itself starts it
 * says "Starting up…" and waits as long as the loader gives a payload to start; once
 * the payload is up, the account has a few seconds to be confirmed. Only then, or when the
 * loader gave up, is the capture called unavailable, with words that say which.
 */
final class CaptureScopeWait {
    static final String CHECKING = "Checking capture setup…";
    static final String UNAVAILABLE = "Could not verify this capture’s account. Reopen the shortcut in a moment.";

    /** Once the payload runs, how long its account binding may take to appear. */
    static final long BINDING_MS = 5_000;

    enum Step { READY, UNAVAILABLE, FAILED, WAIT_STARTING, WAIT_CHECKING }

    private final Handler main = new Handler(Looper.getMainLooper());
    private String why = UNAVAILABLE;

    /**
     * The next step. {@code current}: the account the payload binds now (null for none);
     * {@code payloadUp} the payload's port is attached; {@code failure} the loader's; times
     * on the uptime clock, {@code upAt} when the payload was first seen up (0: not yet).
     */
    static Step step(String owner, String current, boolean payloadUp, String failure, long now, long began, long upAt) {
        if (owner != null && owner.equals(current)) return Step.READY;
        if (current != null) return Step.UNAVAILABLE;          // bound to another account
        if (!payloadUp) {
            if (failure != null) return Step.FAILED;
            return now - began < PayloadStart.WAIT_MS ? Step.WAIT_STARTING : Step.UNAVAILABLE;
        }
        return now - Math.max(began, upAt) < BINDING_MS ? Step.WAIT_CHECKING : Step.UNAVAILABLE;
    }

    /** The words for the last unavailable answer. */
    String why() { return why; }

    void await(Activity screen, String owner, Runnable ready, Runnable unavailable) {
        await(screen, owner, ready, unavailable, null);
    }

    /** @param status a line that shows "Starting up…" or "Checking capture setup…" while it waits */
    void await(Activity screen, String owner, Runnable ready, Runnable unavailable, TextView status) {
        cancel();
        long began = SystemClock.elapsedRealtime();
        main.post(new Runnable() {
            private boolean startAttempted;
            private long upAt;

            @Override public void run() {
                if (screen.isFinishing() || screen.isDestroyed()) return;
                long now = SystemClock.elapsedRealtime();
                boolean up = PayloadPort.named(MemoFiles.PORT).ready();
                if (up && upAt == 0) upAt = now;
                Step s = step(owner, CaptureScope.current(), up, PayloadStart.failure(), now, began, upAt);
                switch (s) {
                    case READY: ready.run(); return;
                    case FAILED: why = PayloadReady.FAILED_WORDS; unavailable.run(); return;
                    case UNAVAILABLE: why = UNAVAILABLE; unavailable.run(); return;
                    default:
                        if (status != null) status.setText(s == Step.WAIT_STARTING ? PayloadReady.STARTING : CHECKING);
                        if (!startAttempted && screen.hasWindowFocus()) {
                            startAttempted = true;
                            ShellStart.ensure(screen);
                        }
                        main.postDelayed(this, 100);
                }
            }
        });
    }

    void cancel() { main.removeCallbacksAndMessages(null); }

    /** The line a held draft shows: what is kept, then why it cannot open yet. */
    static String heldWords(String what, String why) {
        return what + " is saved on this phone. " + (why == null || why.isEmpty() ? UNAVAILABLE : why);
    }

    /**
     * The wait ran out with a restored draft or a camera result pending (audit: the screen
     * gave up, or sat on "Checking capture setup…"): the screen says the draft is kept and
     * why it cannot open yet, with Try again (the wait once more) and Close. Nothing is lost:
     * the draft stays on disk for its account.
     */
    void hold(Activity screen, String what, Runnable retry) {
        android.widget.LinearLayout page = new android.widget.LinearLayout(screen);
        page.setOrientation(android.widget.LinearLayout.VERTICAL);
        int pad = CaptureUi.dp(screen, 20);
        page.setPadding(pad, pad, pad, pad);
        net.kckern.daylight.shellkit.DaylightTheme t = net.kckern.daylight.shellkit.DaylightTheme.of(screen);
        page.setBackgroundColor(t.background);
        page.addView(CaptureUi.text(screen, heldWords(what, why), net.kckern.daylight.shellkit.DaylightTheme.Type.BODY, t.ink, false));
        page.addView(new android.view.View(screen), new android.widget.LinearLayout.LayoutParams(0, 0, 1));
        TextView again = CaptureUi.primary(screen, "Try again");
        again.setOnClickListener(v -> retry.run());
        android.widget.LinearLayout.LayoutParams lp = new android.widget.LinearLayout.LayoutParams(-1, -2);
        lp.topMargin = CaptureUi.dp(screen, 20);
        page.addView(again, lp);
        TextView close = CaptureUi.textButton(screen, "Close");
        close.setOnClickListener(v -> screen.finish());
        page.addView(close, new android.widget.LinearLayout.LayoutParams(-1, -2));
        screen.setContentView(page);
        net.kckern.daylight.shellkit.UiTelemetry.event("Capture", "capture.restore_held", new org.json.JSONObject());
    }
}

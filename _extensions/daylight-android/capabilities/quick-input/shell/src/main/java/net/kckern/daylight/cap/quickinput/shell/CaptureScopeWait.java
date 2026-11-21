package net.kckern.daylight.cap.quickinput.shell;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

import net.kckern.daylight.shellkit.ShellStart;

/** A recreated screen can wait for the payload to verify its account before showing a draft. */
final class CaptureScopeWait {
    static final String CHECKING = "Checking capture setup…";
    static final String UNAVAILABLE = "Could not verify this capture’s account. Reopen the shortcut after Daylight starts.";

    private static final long WAIT_MS = 5_000;
    private final Handler main = new Handler(Looper.getMainLooper());

    void await(Activity screen, String owner, Runnable ready, Runnable unavailable) {
        cancel();
        long deadline = SystemClock.elapsedRealtime() + WAIT_MS;
        main.post(new Runnable() {
            private boolean startAttempted;

            @Override public void run() {
                if (screen.isFinishing() || screen.isDestroyed()) return;
                String current = CaptureScope.current();
                if (owner.equals(current)) {
                    ready.run();
                } else if (current != null || SystemClock.elapsedRealtime() >= deadline) {
                    unavailable.run();
                } else {
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
}

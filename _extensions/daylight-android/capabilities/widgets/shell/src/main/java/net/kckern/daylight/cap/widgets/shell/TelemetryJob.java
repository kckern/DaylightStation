package net.kckern.daylight.cap.widgets.shell;

import android.app.job.JobParameters;
import android.app.job.JobService;

import net.kckern.daylight.shellkit.ShellStart;
import net.kckern.daylight.shellkit.UiTelemetry;

/**
 * Sends the phone's held telemetry with the app closed. UiTelemetry schedules this
 * one-shot job (network required) whenever batches stay on the phone; the job holds the
 * shell up by binding it (a job may not start a service on Android 12+, which is why
 * batches used to wait for the next open screen), sends what waits, and asks to run
 * again while something is still held. The media service's 15-minute inbox job sends
 * them too (KeepJob).
 * Not exported: only the system's job scheduler binds it.
 */
public final class TelemetryJob extends JobService {
    private final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
    private Object held;

    @Override public boolean onStartJob(JobParameters params) {
        held = ShellStart.hold(this);
        android.util.Log.i("Daylight-Telemetry", "telemetry job started (shell " + (held != null ? "held" : "bind refused") + ")");
        UiTelemetry.flushInBackground(this, left -> {
            android.util.Log.i("Daylight-Telemetry", "telemetry job finished (" + (left ? "batches still held" : "nothing left") + ")");
            letGo();
            // Asks the system to try again (its own backoff is the safety net), then, once the
            // job has ended, replaces that with the wait the failed-run count calls for.
            jobFinished(params, left);
            if (left) main.postDelayed(() -> UiTelemetry.rescheduleAfterJob(this), 1000);
        });
        return true;
    }

    @Override public boolean onStopJob(JobParameters params) {
        // Stopped by the system (the network went): the batches stay on disk.
        android.util.Log.i("Daylight-Telemetry", "telemetry job stopped by the system");
        letGo();
        return true;
    }

    private void letGo() {
        Object h = held;
        held = null;
        if (h != null) main.post(() -> ShellStart.release(this, h));
    }
}

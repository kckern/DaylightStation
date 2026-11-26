package net.kckern.daylight.cap.widgets.shell;

import android.app.job.JobParameters;
import android.app.job.JobService;

import net.kckern.daylight.shellkit.UiTelemetry;

/**
 * Sends the phone's held telemetry with the app closed. UiTelemetry schedules this
 * one-shot job (network required) whenever batches stay on the phone; the job starts
 * the payload, sends what waits, and asks to run again while something is still held.
 * Not exported: only the system's job scheduler binds it.
 */
public final class TelemetryJob extends JobService {
    @Override public boolean onStartJob(JobParameters params) {
        UiTelemetry.flushInBackground(this, left -> jobFinished(params, left));
        return true;
    }

    @Override public boolean onStopJob(JobParameters params) {
        // Stopped by the system (the network went): the batches stay on disk.
        return true;
    }
}

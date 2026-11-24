package net.kckern.daylight.cap.quickinput.shell;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import net.kckern.daylight.shellkit.ShellStart;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/**
 * Sends a queued capture after the app has been stopped. On the phone the shell service is not
 * kept running, so Android may stop the app a few minutes after a capture. Each queued capture
 * schedules this one-shot job; if something is still waiting when it runs, it starts the shell
 * service (which loads the payload and its upload pump) and lets it run for a while.
 */
public final class UploadJob extends JobService {
    private static final int ID = 7101;
    private static final long AFTER_MS = 45_000L;
    private static final long RUN_MS = 90_000L;

    private final Handler main = new Handler(Looper.getMainLooper());
    private Runnable finish;

    /** Call after a capture is queued. Replaces a job already waiting. */
    static void schedule(Context context) {
        try {
            JobScheduler scheduler = context.getSystemService(JobScheduler.class);
            if (scheduler == null) return;
            scheduler.schedule(new JobInfo.Builder(ID, new ComponentName(context, UploadJob.class))
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setMinimumLatency(AFTER_MS)
                    .setOverrideDeadline(10 * 60_000L)
                    .build());
        } catch (RuntimeException refused) {
            // The upload also happens the next time the app is opened.
        }
    }

    @Override public boolean onStartJob(JobParameters params) {
        if (!somethingWaiting(this)) return false;
        ShellStart.ensure(this);
        finish = () -> jobFinished(params, false);
        main.postDelayed(finish, RUN_MS);
        return true;
    }

    @Override public boolean onStopJob(JobParameters params) {
        if (finish != null) main.removeCallbacks(finish);
        return false;
    }

    /** Whether the payload's queue file holds an input that is not parked. Unreadable: assume yes. */
    static boolean somethingWaiting(Context context) {
        File file = new File(context.getFilesDir(), "payloads/state/input-queue.json");
        if (!file.isFile()) return false;
        try {
            JSONArray inputs = new JSONObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8))
                    .optJSONArray("inputs");
            if (inputs == null) return false;
            for (int i = 0; i < inputs.length(); i++) {
                JSONObject input = inputs.optJSONObject(i);
                if (input != null && !"PARKED".equals(input.optString("state"))) return true;
            }
            return false;
        } catch (Exception unreadable) {
            return true;
        }
    }
}

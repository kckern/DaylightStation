package net.kckern.daylight.cap.mediaservice.shell;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.util.Log;

/**
 * Keeps the phone's downloads in line with what is kept, with the app closed:
 * <ul>
 * <li>{@link #SYNC_ID}: now (the web kept or removed something through the inbox: the
 *   payload schedules it);</li>
 * <li>{@link #RETRY_ID}: once a network is there (a failed track is due again, or a keep
 *   waits for home);</li>
 * <li>{@link #DAILY_ID}: once a day on Wi-Fi, re-syncing every kept list so new tracks on a
 *   playlist arrive and removed ones go.</li>
 * </ul>
 * Not exported: only the system's job scheduler binds it.
 */
public final class KeepJob extends JobService {
    private static final String TAG = "Daylight-Media";
    /** Scheduled by the payload (MediaServiceCapability.KEEP_JOB_SYNC_ID); keep in step. */
    static final int SYNC_ID = 7_204;
    static final int DAILY_ID = 7_205;
    static final int RETRY_ID = 7_207;
    /** A screen asked to retry or remove one kept collection (extras: action, contentId). */
    static final int ACTION_ID = 7_208;
    /** Media3's PlatformScheduler job for downloads waiting on their requirements. */
    static final int SCHEDULER_ID = 7_206;

    @Override public boolean onStartJob(JobParameters params) {
        if (params.getJobId() == ACTION_ID) {
            String action = params.getExtras().getString("action", "");
            String cid = params.getExtras().getString("contentId", "");
            KeepStore store = KeepStore.get(this);
            java.util.function.Consumer<String> done = line -> jobFinished(params, false);
            if ("retry".equals(action) && !cid.isEmpty()) store.retry(cid, done);
            else if ("remove".equals(action) && !cid.isEmpty()) store.remove(cid, done);
            else return false;
            return true;
        }
        boolean resync = params.getJobId() == DAILY_ID;
        Log.i(TAG, "keep job " + params.getJobId());
        KeepStore.get(this).sync(resync, () -> jobFinished(params, false));
        return true;
    }

    @Override public boolean onStopJob(JobParameters params) { return true; }

    private static ComponentName me(Context c) { return new ComponentName(c, KeepJob.class); }

    /** Once a day, on Wi-Fi: every kept list resolved again. Kept across reboots. */
    // setPersisted needs RECEIVE_BOOT_COMPLETED, which the base shell holds (pinned in
    // tools/phone-list.test.mjs); this library is linted without it.
    @android.annotation.SuppressLint("MissingPermission")
    static void scheduleDaily(Context c) {
        try {
            JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (js.getPendingJob(DAILY_ID) != null) return;
            js.schedule(new JobInfo.Builder(DAILY_ID, me(c))
                    .setPeriodic(24 * 60 * 60 * 1000L)
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_UNMETERED)
                    .setPersisted(true)
                    .build());
        } catch (RuntimeException notScheduled) {
            Log.w(TAG, "keep: daily job not scheduled: " + notScheduled.getClass().getSimpleName());
        }
    }

    /** When any network is there (the sync itself holds Wi-Fi-only to its rule), at least a minute from now. */
    // setPersisted needs RECEIVE_BOOT_COMPLETED, which the base shell holds (pinned in
    // tools/phone-list.test.mjs); this library is linted without it.
    @android.annotation.SuppressLint("MissingPermission")
    static void scheduleRetry(Context c) {
        try {
            JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            js.schedule(new JobInfo.Builder(RETRY_ID, me(c))
                    .setMinimumLatency(60_000)
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setBackoffCriteria(60_000, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
                    .setPersisted(true)
                    .build());
        } catch (RuntimeException notScheduled) {
            Log.w(TAG, "keep: retry job not scheduled: " + notScheduled.getClass().getSimpleName());
        }
    }
}

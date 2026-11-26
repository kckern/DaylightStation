package net.kckern.daylight.cap.mediaservice.shell;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.os.PersistableBundle;
import android.util.Log;

import net.kckern.daylight.api.PayloadPort;
import net.kckern.daylight.shellkit.ShellStart;

/**
 * Keeps the phone's downloads in line with what is kept, with the app closed:
 * <ul>
 * <li>{@link #SYNC_ID}: now (the web kept or removed something: the payload schedules it);</li>
 * <li>{@link #RETRY_ID}: once a network is there (a failed track is due, a keep waits for home);</li>
 * <li>{@link #DAILY_ID}: once a day on Wi-Fi, every kept list re-synced, finished books checked;</li>
 * <li>{@link #VERIFY_ID}: once a week, every kept file checked against its length;</li>
 * <li>{@link #RESUME_ID}: Media3's downloads, run here while their network and storage hold
 *   ({@link KeepScheduler}); never a foreground-service start from the background;</li>
 * <li>{@link #ACTION_BASE}+n: one screen's action (keep, retry, remove, pause, resume, cancel),
 *   a job id per action and item, so two quick taps are two jobs.</li>
 * </ul>
 * A cold process starts the shell first and waits for the payload; when it does not come,
 * the job is rescheduled rather than dropped. Not exported: only the job scheduler binds it.
 */
public final class KeepJob extends JobService {
    private static final String TAG = "Daylight-Media";
    /** Scheduled by the payload (MediaServiceCapability.KEEP_JOB_SYNC_ID); keep in step. */
    static final int SYNC_ID = 7_204;
    static final int DAILY_ID = 7_205;
    static final int RESUME_ID = 7_206;
    static final int RETRY_ID = 7_207;
    static final int VERIFY_ID = 7_209;
    /** Screen actions: 7300..7399 (PhoneHomeActivity schedules these by number). */
    static final int ACTION_BASE = 7_300, ACTION_SLOTS = 100;
    private static final long PAYLOAD_WAIT_MS = 20_000;
    /** A job runs downloads at most this long, then is rescheduled to go on. */
    private static final long RUN_MS = 9 * 60_000L;

    private final Handler main = new Handler(Looper.getMainLooper());

    @Override public boolean onStartJob(JobParameters params) {
        Log.i(TAG, "keep job " + params.getJobId());
        // A cold process: the shell (and its payload) are not up until something starts them.
        ShellStart.ensure(this);
        new Thread(() -> run(params), "Daylight-keep-job").start();
        return true;
    }

    private void run(JobParameters params) {
        if (!PayloadPort.named(PayloadMedia.PORT).awaitReady(PAYLOAD_WAIT_MS)) {
            Log.w(TAG, "keep job: the payload did not come up; trying again later");
            jobFinished(params, true);
            return;
        }
        KeepStore store;
        try { store = KeepStore.get(this); }
        catch (RuntimeException broken) {
            Log.w(TAG, "keep job: the store could not open: " + broken.getClass().getSimpleName());
            jobFinished(params, true);
            return;
        }
        int id = params.getJobId();
        // Whatever woke it, the job then runs the downloads while they last (the process stays
        // up for them), then is rescheduled if they are not done.
        Runnable thenRun = () -> store.runDownloads(RUN_MS, more -> jobFinished(params, more));
        if (id == RESUME_ID) {
            thenRun.run();
        } else if (id == VERIFY_ID) {
            store.verifyAll(thenRun);
        } else if (id >= ACTION_BASE && id < ACTION_BASE + ACTION_SLOTS) {
            PersistableBundle x = params.getExtras();
            store.action(x.getString("action", ""), x.getString("contentId", ""), x.getString("mediaId", ""), thenRun);
        } else {
            store.sync(id == DAILY_ID, thenRun);
        }
    }

    @Override public boolean onStopJob(JobParameters params) { return true; }

    private static ComponentName me(Context c) { return new ComponentName(c, KeepJob.class); }

    /** The job id for one action on one item: stable for the pair, different across pairs. */
    static int actionId(String action, String contentId) {
        return ACTION_BASE + Math.floorMod((action + "|" + contentId).hashCode(), ACTION_SLOTS);
    }

    /** Runs a screen's action on an item through this job (it runs whether or not the player is up). */
    static boolean action(Context c, String action, String contentId, String mediaId) {
        try {
            PersistableBundle extras = new PersistableBundle();
            extras.putString("action", action);
            extras.putString("contentId", contentId == null ? "" : contentId);
            extras.putString("mediaId", mediaId == null ? "" : mediaId);
            JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            return js.schedule(new JobInfo.Builder(actionId(action, contentId == null ? mediaId : contentId), me(c))
                    .setOverrideDeadline(0).setExtras(extras).build()) == JobScheduler.RESULT_SUCCESS;
        } catch (RuntimeException notScheduled) {
            return false;
        }
    }

    // setPersisted needs RECEIVE_BOOT_COMPLETED, which the base shell holds (pinned in
    // tools/phone-list.test.mjs); this library is linted without it.
    @android.annotation.SuppressLint("MissingPermission")
    static void scheduleDaily(Context c) {
        try {
            JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (js.getPendingJob(DAILY_ID) == null) {
                js.schedule(new JobInfo.Builder(DAILY_ID, me(c)).setPeriodic(24 * 60 * 60 * 1000L)
                        .setRequiredNetworkType(JobInfo.NETWORK_TYPE_UNMETERED).setPersisted(true).build());
            }
            if (js.getPendingJob(VERIFY_ID) == null) {
                js.schedule(new JobInfo.Builder(VERIFY_ID, me(c)).setPeriodic(7 * 24 * 60 * 60 * 1000L)
                        .setRequiresDeviceIdle(false).setPersisted(true).build());
            }
        } catch (RuntimeException notScheduled) {
            Log.w(TAG, "keep: daily job not scheduled: " + notScheduled.getClass().getSimpleName());
        }
    }

    @android.annotation.SuppressLint("MissingPermission")
    static void scheduleRetry(Context c) {
        try {
            JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            js.schedule(new JobInfo.Builder(RETRY_ID, me(c)).setMinimumLatency(60_000)
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setBackoffCriteria(60_000, JobInfo.BACKOFF_POLICY_EXPONENTIAL).setPersisted(true).build());
        } catch (RuntimeException notScheduled) {
            Log.w(TAG, "keep: retry job not scheduled: " + notScheduled.getClass().getSimpleName());
        }
    }

    /** A sync now (the Play tab opened online, a setting changed). */
    static void syncNow(Context c) {
        try {
            JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            js.schedule(new JobInfo.Builder(SYNC_ID, me(c)).setOverrideDeadline(0).build());
        } catch (RuntimeException ignored) { }
    }
}

package net.kckern.daylight.cap.mediaservice.shell;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.util.Log;

import androidx.media3.exoplayer.scheduler.Requirements;
import androidx.media3.exoplayer.scheduler.Scheduler;

/**
 * Media3's download scheduler, done with this app's own job instead of Media3's
 * PlatformScheduler. PlatformScheduler's job calls startForegroundService from the
 * background, which Android 12 and later refuse (ForegroundServiceStartNotAllowedException:
 * a crash, then a payload rollback). Here the job ({@link KeepJob#RESUME_ID}) runs the
 * downloads itself in the app's process while its constraints hold, and starts the
 * foreground service only where Android allows it.
 */
final class KeepScheduler implements Scheduler {
    private static final String TAG = "Daylight-Media";
    private static final int SUPPORTED = Requirements.NETWORK | Requirements.NETWORK_UNMETERED
            | Requirements.DEVICE_STORAGE_NOT_LOW;
    private final Context context;

    KeepScheduler(Context context) { this.context = context.getApplicationContext(); }

    // setPersisted needs RECEIVE_BOOT_COMPLETED, which the base shell holds (pinned in
    // tools/phone-list.test.mjs); this library is linted without it.
    @android.annotation.SuppressLint("MissingPermission")
    @Override public boolean schedule(Requirements requirements, String servicePackage, String serviceAction) {
        try {
            JobInfo.Builder b = new JobInfo.Builder(KeepJob.RESUME_ID, new ComponentName(context, KeepJob.class))
                    .setPersisted(true);
            if (requirements.isUnmeteredNetworkRequired()) b.setRequiredNetworkType(JobInfo.NETWORK_TYPE_UNMETERED);
            else if (requirements.isNetworkRequired()) b.setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY);
            if (requirements.isStorageNotLowRequired()) b.setRequiresStorageNotLow(true);
            JobScheduler js = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            return js.schedule(b.build()) == JobScheduler.RESULT_SUCCESS;
        } catch (RuntimeException refused) {
            Log.w(TAG, "keep: downloads not scheduled: " + refused.getClass().getSimpleName());
            return false;
        }
    }

    @Override public boolean cancel() {
        try {
            ((JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE)).cancel(KeepJob.RESUME_ID);
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }

    @Override public Requirements getSupportedRequirements(Requirements requirements) {
        return requirements.filterRequirements(SUPPORTED);
    }
}

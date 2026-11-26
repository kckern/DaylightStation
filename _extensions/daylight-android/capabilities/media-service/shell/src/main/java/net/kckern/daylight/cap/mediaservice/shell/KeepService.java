package net.kckern.daylight.cap.mediaservice.shell;

import android.app.Notification;

import androidx.media3.exoplayer.offline.Download;
import androidx.media3.exoplayer.offline.DownloadManager;
import androidx.media3.exoplayer.offline.DownloadNotificationHelper;
import androidx.media3.exoplayer.offline.DownloadService;
import androidx.media3.exoplayer.scheduler.PlatformScheduler;
import androidx.media3.exoplayer.scheduler.Scheduler;

import java.util.List;

/**
 * Runs the downloads kept on this phone (KeepStore), with Media3's progress notification
 * while it works. Not exported: only this app starts it. Media3's PlatformScheduler starts
 * it again when downloads waiting on Wi-Fi or storage can go on, with the app closed (its
 * job service is in the manifest, bound only by the system).
 */
public final class KeepService extends DownloadService {
    private static final String CHANNEL = "daylight_downloads";
    private static final int NOTIFICATION_ID = 7203;

    public KeepService() {
        super(NOTIFICATION_ID, DEFAULT_FOREGROUND_NOTIFICATION_UPDATE_INTERVAL, CHANNEL, R.string.daylight_downloads_channel, 0);
    }

    @Override protected DownloadManager getDownloadManager() { return KeepStore.get(this).manager; }

    // PlatformScheduler persists its job: RECEIVE_BOOT_COMPLETED, held by the base shell
    // (pinned in tools/phone-list.test.mjs); this library is linted without it.
    @android.annotation.SuppressLint("MissingPermission")
    @Override protected Scheduler getScheduler() { return new PlatformScheduler(this, KeepJob.SCHEDULER_ID); }

    @Override protected Notification getForegroundNotification(List<Download> downloads, int notMetRequirements) {
        return new DownloadNotificationHelper(this, CHANNEL).buildProgressNotification(this,
                android.R.drawable.stat_sys_download, null, "Keeping on this phone", downloads, notMetRequirements);
    }
}

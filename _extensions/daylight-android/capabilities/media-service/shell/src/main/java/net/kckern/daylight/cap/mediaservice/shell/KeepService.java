package net.kckern.daylight.cap.mediaservice.shell;

import android.app.Notification;
import android.app.PendingIntent;
import android.content.Intent;

import androidx.media3.exoplayer.offline.Download;
import androidx.media3.exoplayer.offline.DownloadManager;
import androidx.media3.exoplayer.offline.DownloadService;
import androidx.media3.exoplayer.scheduler.Scheduler;

import java.util.List;

/**
 * Runs the downloads kept on this phone (KeepStore) with one grouped notification while it
 * works: "Keeping 2 items · 3 of 26", Pause and Cancel, a tap opens On this phone. Its
 * scheduler is {@link KeepScheduler} (this app's own job), never Media3's PlatformScheduler,
 * whose job starts a foreground service from the background (refused on Android 12+).
 * Not exported: only this app starts it (the notification's actions included).
 */
public final class KeepService extends DownloadService {
    private static final String CHANNEL = "daylight_downloads";
    private static final int NOTIFICATION_ID = 7203;

    private static final String ACTION_TRY_AGAIN = "net.kckern.daylight.keep.TRY_AGAIN";
    /** True from the first foreground notification until the service ends: only then is it updated by the live tick. */
    private volatile boolean foreground;
    private final Runnable liveChanged = this::updateNotification;

    public KeepService() {
        super(NOTIFICATION_ID, DEFAULT_FOREGROUND_NOTIFICATION_UPDATE_INTERVAL, CHANNEL, R.string.daylight_downloads_channel, 0);
    }

    @Override public void onCreate() {
        super.onCreate();
        net.kckern.daylight.shellkit.LiveDownloads.listen(liveChanged);
    }

    @Override public void onDestroy() {
        net.kckern.daylight.shellkit.LiveDownloads.unlisten(liveChanged);
        foreground = false;
        super.onDestroy();
    }

    /** Each second the keep store publishes live bytes (main thread): the notification shows them. Only while it is the foreground one. */
    private void updateNotification() {
        // Nothing downloading: the foreground notification is going away. It is posted again only by Media3 (which sets the flag).
        if (!net.kckern.daylight.shellkit.LiveDownloads.any()) { foreground = false; return; }
        if (!foreground) return;
        try {
            DownloadManager m = KeepStore.get(this).manager;
            ((android.app.NotificationManager) getSystemService(NOTIFICATION_SERVICE))
                    .notify(NOTIFICATION_ID, getForegroundNotification(m.getCurrentDownloads(), m.getNotMetRequirements()));
        } catch (RuntimeException ignored) { }
    }

    @Override protected DownloadManager getDownloadManager() { return KeepStore.get(this).manager; }

    @Override protected Scheduler getScheduler() { return new KeepScheduler(this); }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (KeepStore.ACTION_UNDO.equals(action)) {
            String cid = intent.getStringExtra("contentId");
            if (cid != null) KeepStore.get(this).action("undo", cid, "", null);
            cancelUndo(cid);
        } else if (ACTION_TRY_AGAIN.equals(action)) {
            KeepStore.get(this).restartStalled();
        } else if (KeepStore.ACTION_CANCEL.equals(action)) {
            KeepStore.get(this).cancelUnfinished(null);
        } else if (KeepStore.ACTION_RESUME_ALL.equals(action)) {
            KeepStore.get(this).resumeAll();
        } else if (KeepStore.ACTION_KEEP.equals(action)) {
            // A keep confirmed from its notification (asked while no screen was open).
            String mediaId = intent.getStringExtra("mediaId");
            if (mediaId != null) {
                KeepStore store = KeepStore.get(this);
                ((android.app.NotificationManager) getSystemService(NOTIFICATION_SERVICE))
                        .cancel(KeepStore.OUTCOME_NOTIFICATION + Math.floorMod(mediaId.hashCode(), 50));
                store.begin(mediaId, intent.getStringExtra("title"));
                store.keep(mediaId, null);
            }
        }
        return super.onStartCommand(intent, flags, startId);
    }

    private void cancelUndo(String cid) {
        try {
            ((android.app.NotificationManager) getSystemService(NOTIFICATION_SERVICE))
                    .cancel(KeepStore.UNDO_NOTIFICATION + Math.floorMod(cid == null ? 0 : cid.hashCode(), 50));
        } catch (RuntimeException ignored) { }
    }

    /** The item moving and its live bytes, else {@code otherwise}. */
    private String live(String otherwise) {
        String line = KeepStore.get(this).liveLine();
        return line.isEmpty() ? otherwise : line;
    }

    @Override protected Notification getForegroundNotification(List<Download> downloads, int notMetRequirements) {
        foreground = true;
        int[] p = KeepStore.get(this).progressCached();
        // Android requires this notification while bytes move; for automatic keeps alone it says
        // "Keeping The Book for offline" (spec §3.10: no notification of their own).
        String title = KeepStore.get(this).titleCached();
        int flags = PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT;
        PendingIntent open = PendingIntent.getActivity(this, 0,
                new Intent(this, DownloadsActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), flags);
        PendingIntent pause = PendingIntent.getService(this, 1, buildPauseDownloadsIntent(this, KeepService.class, true), flags);
        PendingIntent cancel = PendingIntent.getService(this, 2,
                new Intent(this, KeepService.class).setAction(KeepStore.ACTION_CANCEL), flags);
        Notification.Builder b = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentTitle(title)
                .setContentText(notMetRequirements != 0 ? KeepRules.waitingWords(notMetRequirements) : live("Tap to see what is kept"))
                .setProgress(Math.max(1, p[2]), p[1], p[2] == 0)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(open)
                .addAction(new Notification.Action.Builder(null, "Pause", pause).build())
                .addAction(new Notification.Action.Builder(null, "Cancel", cancel).build());
        // Only while an item's bytes have stopped: restarts the transfer (the same as Retry on its row).
        if (net.kckern.daylight.shellkit.LiveDownloads.anyStalled()) {
            PendingIntent again = PendingIntent.getService(this, 3, new Intent(this, KeepService.class).setAction(ACTION_TRY_AGAIN), flags);
            b.addAction(new Notification.Action.Builder(null, "Try again", again).build());
        }
        return b.build();
    }
}

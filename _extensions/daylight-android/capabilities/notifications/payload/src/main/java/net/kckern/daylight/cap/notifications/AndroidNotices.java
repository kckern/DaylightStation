package net.kckern.daylight.cap.notifications;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;

import net.kckern.daylight.core.spi.LocalNotices;

/**
 * The Android side of local notifications. A tap opens a daylight:// link as a VIEW
 * intent limited to this app's own package, so it can only reach the link activity,
 * where the link is checked like any other.
 */
final class AndroidNotices implements NotificationsCapability.NoticeSink {
    /** The mark in the status bar: a drawable of the notifications shell half, found by name. */
    private static final String ICON = "ic_daylight_notice";

    private final Context context;

    AndroidNotices(Context context) { this.context = context; }

    /** Null on a device (or in a test) with no notification service: every call then does nothing. */
    private NotificationManager manager() {
        Object m = context.getSystemService(Context.NOTIFICATION_SERVICE);
        return m instanceof NotificationManager ? (NotificationManager) m : null;
    }

    /** Creating a channel that exists changes nothing, so this is safe on every start. */
    @Override public void ensureChannels() {
        NotificationManager m = manager();
        if (m == null) return;
        m.createNotificationChannel(new NotificationChannel("daylight_" + LocalNotices.UPLOADS, "Uploads", NotificationManager.IMPORTANCE_LOW));
        m.createNotificationChannel(new NotificationChannel("daylight_" + LocalNotices.GENERAL, "Daylight", NotificationManager.IMPORTANCE_DEFAULT));
    }

    @Override public void post(Notice notice) {
        NotificationManager m = manager();
        if (m == null) return;
        Intent tap = notice.uri.isEmpty()
                ? context.getPackageManager().getLaunchIntentForPackage(context.getPackageName())
                : new Intent(Intent.ACTION_VIEW, Uri.parse(notice.uri)).setPackage(context.getPackageName());
        int icon = context.getResources().getIdentifier(ICON, "drawable", context.getPackageName());
        Notification.Builder builder = new Notification.Builder(context, notice.androidChannel())
                .setSmallIcon(icon != 0 ? icon : android.R.drawable.ic_dialog_info)
                .setContentTitle(notice.title)
                .setContentText(notice.text)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true);
        if (tap != null) {
            builder.setContentIntent(PendingIntent.getActivity(context, notice.androidId(), tap,
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        }
        if (!notice.actionUri.isEmpty()) {
            // The button opens one of this app's own links, like the tap; a different request code keeps the two apart.
            Intent action = new Intent(Intent.ACTION_VIEW, Uri.parse(notice.actionUri)).setPackage(context.getPackageName());
            builder.addAction(new Notification.Action.Builder(null, notice.actionLabel,
                    PendingIntent.getActivity(context, notice.androidId() + 1_000_000, action,
                            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT)).build());
        }
        m.notify(notice.androidId(), builder.build());
    }

    @Override public void cancel(int androidId) {
        NotificationManager m = manager();
        if (m != null) m.cancel(androidId);
    }

    @Override public String permission() {
        NotificationManager m = manager();
        if (m == null) return "unavailable";
        if (Build.VERSION.SDK_INT >= 33
                && context.checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
            return "denied";
        }
        return m.areNotificationsEnabled() ? "granted" : "denied";
    }
}

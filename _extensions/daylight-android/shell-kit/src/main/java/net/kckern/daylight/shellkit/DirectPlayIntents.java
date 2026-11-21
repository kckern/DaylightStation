package net.kckern.daylight.shellkit;

import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.util.Log;

import net.kckern.daylight.api.DirectPlay;

/**
 * The Android half of DirectPlay (shell-api): the intent that starts the media-service
 * shell half's play service with one action id. The widgets and the tiles live in
 * other capabilities' shell halves, so the service is named by class, and a build
 * without media-service has no such service (installed() is then false and every
 * surface keeps its keyed link).
 *
 * The intent names this app's own component, and that component is not exported, so
 * nothing outside the app can send it. The one extra is an action id.
 */
public final class DirectPlayIntents {
    static final String INTENT_ACTION_PREFIX = "net.kckern.daylight.PLAY_ACTION.";

    public static final String EXTRA_PLAYLIST = "net.kckern.daylight.EXTRA_PLAYLIST";

    public static final String EXTRA_PLAYLIST_SHUFFLE = "net.kckern.daylight.EXTRA_PLAYLIST_SHUFFLE";
    public static final String EXTRA_PLAYLIST_REVISION = "net.kckern.daylight.EXTRA_PLAYLIST_REVISION";

    public static PendingIntent forPlaylistWidget(Context context, int widgetId, String mediaId, String revision, boolean shuffle) {
        Intent play = new Intent(INTENT_ACTION_PREFIX + "playlist." + revision).setClassName(context, DirectPlay.SERVICE)
                .putExtra(EXTRA_PLAYLIST, mediaId).putExtra(EXTRA_PLAYLIST_REVISION, revision)
                .putExtra(EXTRA_PLAYLIST_SHUFFLE, shuffle);
        return PendingIntent.getForegroundService(context, widgetId, play,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private DirectPlayIntents() { }

    /** Whether this build has the play service. */
    public static boolean installed(Context context) {
        try {
            context.getPackageManager().getServiceInfo(new ComponentName(context, DirectPlay.SERVICE), 0);
            return true;
        } catch (PackageManager.NameNotFoundException | RuntimeException absent) {
            return false;
        }
    }

    static Intent intent(Context context, String actionId) {
        // The intent's action names the action id too: extras are not part of a
        // PendingIntent's identity, so two buttons of different actions must differ here
        // or the later one would overwrite the earlier one's extra.
        return new Intent(INTENT_ACTION_PREFIX + actionId).setClassName(context, DirectPlay.SERVICE)
                .putExtra(DirectPlay.EXTRA_ACTION, actionId);
    }

    /**
     * For a widget button: a foreground-service start on tap. Immutable. Buttons of the
     * same action share one PendingIntent, which is the same tap.
     */
    public static PendingIntent forWidget(Context context, int requestCode, String actionId) {
        return PendingIntent.getForegroundService(context, requestCode, intent(context, actionId),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /**
     * For a tile: start the service now. False when Android refused the start (from
     * Android 12 a ForegroundServiceStartNotAllowedException, an IllegalStateException);
     * the caller then launches the keyed link.
     */
    public static boolean start(Context context, String actionId) {
        try {
            return context.startForegroundService(intent(context, actionId)) != null;
        } catch (RuntimeException refused) {
            Log.w("Daylight", "play service start refused: " + refused.getClass().getSimpleName());
            return false;
        }
    }
}

package net.kckern.daylight.cap.widgets.shell;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.content.res.Configuration;
import android.util.TypedValue;
import android.graphics.Bitmap;
import android.provider.Settings;
import android.view.View;
import android.util.Log;
import android.widget.RemoteViews;

import net.kckern.daylight.api.DirectPlay;
import net.kckern.daylight.api.SurfaceKeys;
import net.kckern.daylight.shellkit.DirectPlayIntents;
import net.kckern.daylight.shellkit.SurfaceCache;
import net.kckern.daylight.shellkit.PlaylistWidgetState;
import net.kckern.daylight.shellkit.PlaylistWidgetState.Phase;

/**
 * A 1x1 home-screen button bound to one action. Which action is chosen when the
 * widget is placed (ButtonWidgetConfigActivity) and kept here, per widget id, in a
 * private preferences file of this module.
 *
 * Like the four-button widget it runs in a broadcast, often in a cold process: it
 * reads the surface cache and its own choice, and nothing else. It never calls the
 * payload and never starts a service while drawing. A tap launches the action's keyed
 * link through the link activity, or, for a media action, starts the play service
 * with the action's id (DirectPlay), which plays it with no window; the payload writes that link again, under the key in force, at
 * each start and each time the actions are published, and asks for a redraw.
 */
public class ButtonWidgetProvider extends AppWidgetProvider {
    static final String PIN_ACTION = "net.kckern.daylight.WIDGET_PIN_CONFIRMED";
    static final String SHORTCUT_PIN_ACTION = "net.kckern.daylight.SETUP_SHORTCUT_PIN_CONFIRMED";

    @Override public void onReceive(Context context, Intent intent) {
        boolean progressOnly = PlaylistWidgetState.PROGRESS_CHANGED.equals(intent.getAction());
        if (progressOnly || PlaylistWidgetState.CHANGED.equals(intent.getAction())) {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            android.content.ComponentName provider = new android.content.ComponentName(context, ButtonWidgetProvider.class);
            for (int id : manager.getAppWidgetIds(provider)) {
                String choice = chosen(context, id);
                if (!choice.startsWith("c:")) continue;
                if (progressOnly) {
                    PlaylistWidgetState.Progress progress = PlaylistWidgetState.progress(choice);
                    if (progress == null) continue;
                    RemoteViews update = new RemoteViews(context.getPackageName(), R.layout.widget_playlist);
                    drawProgress(context, update, coverSide(context, id), progress);
                    manager.partiallyUpdateAppWidget(id, update);
                } else {
                    manager.updateAppWidget(id, render(context, id));
                }
            }
            return;
        }
        boolean shortcut = SHORTCUT_PIN_ACTION.equals(intent.getAction());
        if (!shortcut && !PIN_ACTION.equals(intent.getAction())) {
            super.onReceive(context, intent);
            return;
        }
        android.net.Uri data = intent.getData();
        if (data == null || !"daylight-widget".equals(data.getScheme())
                || !(shortcut ? "shortcut" : "pin").equals(data.getHost())
                || data.getPathSegments().size() != 1) return;
        PlacementStore store = new PlacementStore(context);
        LauncherPlacement request = store.get(data.getLastPathSegment());
        if (request == null) return;
        if (shortcut) {
            store.write(request.confirmShortcut(), 0);
            return;
        }

        int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        boolean ours = owns(context, manager, id);
        LauncherPlacement bound = request.bindCallback(id, ours, ours && !chosen(context, id).isEmpty());
        if (bound == null) return;
        boolean newAssignment = bound.manualWidget != id;
        if (store.write(bound, newAssignment ? id : 0) && newAssignment) {
            try {
                manager.updateAppWidget(id, render(context, id));
            } catch (RuntimeException unavailable) {
                Log.w("Daylight-Widget", "could not draw the confirmed playlist widget: "
                        + unavailable.getClass().getSimpleName());
            }
        }
    }

    static boolean owns(Context context, AppWidgetManager manager, int widgetId) {
        android.appwidget.AppWidgetProviderInfo info = manager == null ? null : manager.getAppWidgetInfo(widgetId);
        return info != null && info.provider != null && ButtonFace.ours(widgetId, info.provider.getPackageName(),
                info.provider.getClassName(), context.getPackageName(), ButtonWidgetProvider.class.getName());
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
        for (int id : widgetIds) manager.updateAppWidget(id, render(context, id));
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        manager.updateAppWidget(id, render(context, id));
    }

    private static int coverSide(Context context, int id) {
        if (Build.VERSION.SDK_INT < 31) return 50;
        Bundle options = AppWidgetManager.getInstance(context).getAppWidgetOptions(id);
        boolean landscape = context.getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE;
        int width = options.getInt(landscape ? AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH
                : AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH);
        int height = options.getInt(landscape ? AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT
                : AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT);
        return ButtonFace.coverSide(width, height);
    }

    private static void sizePlaylistCover(RemoteViews views, int side) {
        if (Build.VERSION.SDK_INT < 31) return;
        views.setViewLayoutWidth(R.id.playlist_cover_frame, side, TypedValue.COMPLEX_UNIT_DIP);
        views.setViewLayoutHeight(R.id.playlist_cover_frame, side, TypedValue.COMPLEX_UNIT_DIP);
    }

    @Override
    public void onDeleted(Context context, int[] widgetIds) {
        SharedPreferences prefs = context.getSharedPreferences(PlacementStore.PREFS, Context.MODE_PRIVATE);
        if (prefs == null) return;
        SharedPreferences.Editor edit = prefs.edit();
        for (int id : widgetIds) edit.remove(ButtonFace.storeKey(id)).remove(ButtonFace.storeKey(id) + ".label");
        edit.apply();
    }

    static String chosen(Context context, int widgetId) {
        SharedPreferences prefs = context.getSharedPreferences(PlacementStore.PREFS, Context.MODE_PRIVATE);
        String id = prefs == null ? null : prefs.getString(ButtonFace.storeKey(widgetId), "");
        return id == null ? "" : id;
    }

    private static String actionDescription(Phase phase) {
        switch (phase) {
            case PLAYING: return "playing. Pause playback";
            case PAUSED: return "paused. Resume playback";
            case STARTING: return "starting playback";
            case FAILED: return "playback failed. Retry";
            default: return "Play playlist";
        }
    }

    private static void drawProgress(Context context, RemoteViews views, int side, PlaylistWidgetState.Progress progress) {
        boolean hasDuration = progress != null && progress.durationMs > 0;
        views.setViewVisibility(R.id.playlist_progress, hasDuration && side >= 24 ? View.VISIBLE : View.GONE);
        if (hasDuration) {
            int permille = (int) Math.min(1000, Math.max(0, progress.positionMs * 1000.0 / progress.durationMs));
            views.setProgressBar(R.id.playlist_progress, 1000, permille, false);
        }

        float fontScale = context.getResources().getConfiguration().fontScale;
        String time = hasDuration ? formatTime(progress.positionMs) + "/" + formatTime(progress.durationMs) : "";
        String track = progress == null ? "" : progress.trackNumber + "/" + progress.trackCount;
        setReadout(views, R.id.playlist_time, time, side, fontScale, 48);
        setReadout(views, R.id.playlist_track_number, track, side, fontScale, 36);
    }

    private static void setReadout(RemoteViews views, int id, String value, int side, float fontScale, int minSide) {
        boolean fits = !value.isEmpty() && side >= Math.max(minSide, (value.length() * 5 + 8) * fontScale);
        views.setViewVisibility(id, fits ? View.VISIBLE : View.GONE);
        if (fits) views.setTextViewText(id, value);
    }

    private static String formatTime(long milliseconds) {
        long seconds = Math.max(0, milliseconds) / 1000;
        return android.text.format.DateUtils.formatElapsedTime(seconds);
    }

    static RemoteViews render(Context context, int widgetId) {
        String actionId = chosen(context, widgetId);
        if (actionId.startsWith("c:")) {
            String label = context.getSharedPreferences(PlacementStore.PREFS, Context.MODE_PRIVATE)
                    .getString(ButtonFace.storeKey(widgetId) + ".label", "Playlist");
            PlaylistWidgetState state = PlaylistWidgetState.get(actionId);
            RemoteViews playlist = new RemoteViews(context.getPackageName(), R.layout.widget_playlist);
            int side = coverSide(context, widgetId);
            sizePlaylistCover(playlist, side);
            drawProgress(context, playlist, side, state.phase == Phase.PLAYING || state.phase == Phase.PAUSED
                    ? PlaylistWidgetState.progress(actionId) : null);
            Bitmap cover = state.phase == Phase.PLAYING || state.phase == Phase.PAUSED
                    ? PlaylistWidgetState.trackArtwork(actionId) : null;
            if (cover == null) cover = PlaylistWidgetArtwork.read(context, actionId);
            if (cover != null) playlist.setImageViewBitmap(R.id.playlist_cover, cover);
            boolean playing = state.phase == Phase.PLAYING;
            boolean starting = state.phase == Phase.STARTING;
            boolean animate = playing && Settings.Global.getFloat(context.getContentResolver(),
                    Settings.Global.ANIMATOR_DURATION_SCALE, 1f) != 0f;
            playlist.setViewVisibility(R.id.playlist_motion, animate ? View.VISIBLE : View.GONE);
            playlist.setViewVisibility(R.id.playlist_loading, starting ? View.VISIBLE : View.GONE);
            playlist.setViewVisibility(R.id.playlist_action, starting || animate ? View.GONE : View.VISIBLE);
            playlist.setImageViewResource(R.id.playlist_action, playing ? android.R.drawable.ic_media_pause
                    : state.phase == Phase.FAILED ? android.R.drawable.ic_popup_sync : android.R.drawable.ic_media_play);
            String description = label + ", " + actionDescription(state.phase);
            playlist.setContentDescription(R.id.playlist_widget, description);
            playlist.setOnClickPendingIntent(R.id.playlist_widget,
                    DirectPlayIntents.forPlaylistWidget(context, widgetId, actionId, state.revision,
                            new PlacementStore(context).shuffle(actionId.substring(2))));
            return playlist;
        }
        boolean known = SurfaceKeys.actionId(actionId);
        ButtonFace face = ButtonFace.of(actionId,
                known ? SurfaceCache.get(context, SurfaceKeys.action(actionId, SurfaceKeys.LABEL)) : "",
                known ? SurfaceCache.get(context, SurfaceKeys.action(actionId, SurfaceKeys.ICON)) : "",
                known ? SurfaceCache.link(context, SurfaceKeys.action(actionId, SurfaceKeys.URI)) : "");

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_button);
        views.setTextViewText(R.id.button_label, face.label);
        int icon = context.getResources().getIdentifier(face.iconName, "drawable", context.getPackageName());
        views.setImageViewResource(R.id.button_icon, icon != 0 ? icon : R.drawable.ic_widget_button_unset);

        // Immutable, and one per widget: the request code is the widget's id.
        PendingIntent onTap;
        String direct = face.set ? SurfaceCache.get(context, SurfaceKeys.action(actionId, SurfaceKeys.DIRECT)) : "";
        if (face.set && actionId.equals(direct) && DirectPlay.path(DirectPlay.Surface.WIDGET, Build.VERSION.SDK_INT, direct,
                DirectPlayIntents.installed(context)) == DirectPlay.Path.SERVICE) {
            // A media action: the play service, with this action's id and nothing else,
            // plays it with no window. A widget tap may start a foreground service.
            onTap = DirectPlayIntents.forWidget(context, widgetId, actionId);
        } else {
            Intent tap = face.set
                    ? SurfaceCache.viewIntent(context, face.link)
                    // Not set: this app's own chooser, for this widget. Nothing else is in the intent.
                    : new Intent(context, ButtonWidgetConfigActivity.class)
                            .setAction(AppWidgetManager.ACTION_APPWIDGET_CONFIGURE)
                            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            onTap = PendingIntent.getActivity(context, widgetId, tap,
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        }
        views.setOnClickPendingIntent(R.id.button_root, onTap);
        return views;
    }
}

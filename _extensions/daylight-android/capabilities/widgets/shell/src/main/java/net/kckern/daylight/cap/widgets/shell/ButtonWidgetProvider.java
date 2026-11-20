package net.kckern.daylight.cap.widgets.shell;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;
import android.widget.RemoteViews;

import net.kckern.daylight.api.DirectPlay;
import net.kckern.daylight.api.SurfaceKeys;
import net.kckern.daylight.shellkit.DirectPlayIntents;
import net.kckern.daylight.shellkit.SurfaceCache;

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

    static RemoteViews render(Context context, int widgetId) {
        String actionId = chosen(context, widgetId);
        if (actionId.startsWith("c:")) {
            String label = context.getSharedPreferences(PlacementStore.PREFS, Context.MODE_PRIVATE)
                    .getString(ButtonFace.storeKey(widgetId) + ".label", "Playlist");
            RemoteViews playlist = new RemoteViews(context.getPackageName(), R.layout.widget_button);
            playlist.setTextViewText(R.id.button_label, label);
            int icon = context.getResources().getIdentifier("ic_action_play", "drawable", context.getPackageName());
            playlist.setImageViewResource(R.id.button_icon, icon == 0 ? android.R.drawable.ic_media_play : icon);
            playlist.setOnClickPendingIntent(R.id.button_root,
                    DirectPlayIntents.forPlaylistWidget(context, widgetId, actionId));
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

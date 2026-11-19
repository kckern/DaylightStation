package net.kckern.daylight.cap.widgets.shell;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.view.View;
import android.widget.RemoteViews;

import net.kckern.daylight.api.DirectPlay;
import net.kckern.daylight.api.SurfaceKeys;
import net.kckern.daylight.shellkit.DirectPlayIntents;
import net.kckern.daylight.shellkit.SurfaceCache;

/**
 * Draws the widget from the surface cache. Runs in a broadcast, often in a cold
 * process and always in the background: it reads the cache and nothing else. It never
 * starts a service while drawing (Android 12 refuses that from the background) and
 * never calls the payload. A tap launches the slot's daylight:// link through the link
 * activity; a tap on a media action starts the play service with the action's id
 * (DirectPlay), which a widget tap is allowed to do.
 */
public class ActionWidgetProvider extends AppWidgetProvider {
    private static final int[] VIEWS = { R.id.slot1, R.id.slot2, R.id.slot3, R.id.slot4 };

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
        RemoteViews views = render(context);
        for (int id : widgetIds) manager.updateAppWidget(id, views);
    }

    private static RemoteViews render(Context context) {
        String[] labels = new String[VIEWS.length];
        String[] links = new String[VIEWS.length];
        String[] direct = new String[VIEWS.length];
        boolean player = DirectPlayIntents.installed(context);
        for (int slot = 1; slot <= VIEWS.length; slot++) {
            direct[slot - 1] = SurfaceCache.get(context, SurfaceKeys.widget(slot, SurfaceKeys.DIRECT));
            labels[slot - 1] = SurfaceCache.get(context, SurfaceKeys.widget(slot, SurfaceKeys.LABEL));
            links[slot - 1] = SurfaceCache.link(context, SurfaceKeys.widget(slot, SurfaceKeys.URI));
        }
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_actions);
        for (int view : VIEWS) views.setViewVisibility(view, View.GONE);
        for (WidgetButtons.Button button : WidgetButtons.of(labels, links)) {
            int view = VIEWS[button.slot - 1];
            views.setViewVisibility(view, View.VISIBLE);
            views.setTextViewText(view, button.label);
            if (!button.link.isEmpty() && DirectPlay.path(DirectPlay.Surface.WIDGET, Build.VERSION.SDK_INT,
                    direct[button.slot - 1], player) == DirectPlay.Path.SERVICE) {
                // A media action plays with no window: the play service gets its action id.
                views.setOnClickPendingIntent(view, DirectPlayIntents.forWidget(context, 100 + button.slot, direct[button.slot - 1]));
                continue;
            }
            // With no link (nothing cached yet): this app's own launcher activity.
            Intent tap = button.link.isEmpty()
                    ? context.getPackageManager().getLaunchIntentForPackage(context.getPackageName())
                    : SurfaceCache.viewIntent(context, button.link);
            if (tap != null) {
                views.setOnClickPendingIntent(view, PendingIntent.getActivity(context, button.slot, tap,
                        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
            }
        }
        return views;
    }
}

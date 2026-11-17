package net.kckern.daylight.cap.widgets;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import net.kckern.daylight.api.SurfaceKeys;

import java.util.Map;

/** Writes the widget's slots into the surface cache and asks the installed provider to redraw. */
final class AndroidWidgetSink implements WidgetsCapability.WidgetSink {
    /** The installed provider, by name: the payload does not link against shell classes. */
    private static final String PROVIDER = "net.kckern.daylight.cap.widgets.shell.ActionWidgetProvider";
    private final Context context;

    AndroidWidgetSink(Context context) { this.context = context; }

    @Override public void apply(Map<String, String> cache) {
        SharedPreferences prefs = context.getSharedPreferences(SurfaceKeys.PREFS, Context.MODE_PRIVATE);
        if (prefs == null) return;
        SharedPreferences.Editor edit = prefs.edit();
        for (Map.Entry<String, String> e : cache.entrySet()) edit.putString(e.getKey(), e.getValue());
        edit.commit();      // synchronous: the provider reads it as soon as the broadcast lands

        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        if (manager == null) return;
        ComponentName provider = new ComponentName(context, PROVIDER);
        int[] ids = manager.getAppWidgetIds(provider);
        if (ids == null || ids.length == 0) return;
        // To this app's own provider only: the component is named, so nothing else receives it.
        context.sendBroadcast(new Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
                .setComponent(provider)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids));
    }
}

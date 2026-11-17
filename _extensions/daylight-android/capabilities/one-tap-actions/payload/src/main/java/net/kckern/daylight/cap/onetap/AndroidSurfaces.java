package net.kckern.daylight.cap.onetap;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.drawable.Icon;
import android.net.Uri;

import net.kckern.daylight.api.SurfaceKeys;
import net.kckern.daylight.cap.onetap.ActionCatalog.Action;
import net.kckern.daylight.core.UnsupportedException;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Publishes actions to the launcher and writes the tile cache. Thin: every decision is
 * in SurfacePlan. A device with no shortcut service or no preferences is left alone.
 */
final class AndroidSurfaces implements SurfaceSink {
    private final Context context;

    AndroidSurfaces(Context context) { this.context = context; }

    private ShortcutManager manager() { return context.getSystemService(ShortcutManager.class); }

    @Override public int maxShortcuts() {
        ShortcutManager m = manager();
        return m == null ? 0 : Math.min(4, m.getMaxShortcutCountPerActivity());
    }

    @Override public void publish(List<Action> shortcuts, SurfacePlan.Linker linker, Map<String, String> tileCache) {
        SharedPreferences prefs = context.getSharedPreferences(SurfaceKeys.PREFS, Context.MODE_PRIVATE);
        if (prefs != null) {
            SharedPreferences.Editor edit = prefs.edit();
            for (Map.Entry<String, String> e : tileCache.entrySet()) edit.putString(e.getKey(), e.getValue());
            edit.apply();
        }
        ShortcutManager m = manager();
        if (m == null) return;
        List<ShortcutInfo> infos = new ArrayList<>();
        for (Action a : shortcuts) infos.add(info(a, linker.uri(a)));
        m.setDynamicShortcuts(infos);
    }

    @Override public void pin(Action action, String uri) {
        ShortcutManager m = manager();
        if (m == null || !m.isRequestPinShortcutSupported()) throw new UnsupportedException("this launcher does not pin shortcuts");
        if (!m.requestPinShortcut(info(action, uri), null)) throw new UnsupportedException("the launcher refused the pin request");
    }

    private ShortcutInfo info(Action a, String uri) {
        // A VIEW of a daylight:// link, limited to this package: it resolves to the link activity.
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(uri)).setPackage(context.getPackageName());
        return new ShortcutInfo.Builder(context, a.id)
                .setShortLabel(a.label)
                .setLongLabel(a.label)
                .setIcon(Icon.createWithResource(context, iconResource(a.icon)))
                .setIntent(intent)
                .build();
    }

    /** Drawables ship in this capability's shell half as ic_action_<name>. */
    private int iconResource(String name) {
        int id = context.getResources().getIdentifier("ic_action_" + name, "drawable", context.getPackageName());
        if (id == 0) id = context.getResources().getIdentifier("ic_action_open", "drawable", context.getPackageName());
        return id == 0 ? android.R.drawable.ic_menu_view : id;
    }
}

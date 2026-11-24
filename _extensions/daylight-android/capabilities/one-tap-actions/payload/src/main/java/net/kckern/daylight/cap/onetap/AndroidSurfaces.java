package net.kckern.daylight.cap.onetap;

import android.content.Context;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.IntentSender;
import android.content.SharedPreferences;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
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

    @Override public boolean canPin() {
        ShortcutManager m = manager();
        return m != null && m.isRequestPinShortcutSupported();
    }

    /** The shell half's receiver of a pin confirmation (not exported). By name: the payload cannot reference it. */
    static final String PIN_RESULT_RECEIVER = "net.kckern.daylight.cap.onetap.shell.PinResultReceiver";
    /** The extra that carries the request's token (PinResultReceiver.EXTRA_TOKEN). */
    static final String EXTRA_TOKEN = "token";

    @Override public void pin(Action action, String uri, String confirmToken) {
        IntentSender confirm = null;
        if (confirmToken != null) {
            // Sent by the system once the owner has pinned the shortcut. Immutable: nothing
            // can be added to it; the receiver is not exported; the token is single-use.
            Intent result = new Intent().setClassName(context, PIN_RESULT_RECEIVER).putExtra(EXTRA_TOKEN, confirmToken);
            confirm = PendingIntent.getBroadcast(context, confirmToken.hashCode(), result,
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_ONE_SHOT).getIntentSender();
        }
        pinWithCallback(action, uri, confirm);
    }

    @Override public void pinFromSetup(Action action, String uri, String requestId) {
        // The phone setup's private receiver lives in the widgets shell.
        Intent result = new Intent("net.kckern.daylight.SETUP_SHORTCUT_PIN_CONFIRMED")
                .setClassName(context, "net.kckern.daylight.cap.widgets.shell.ButtonWidgetProvider")
                .setData(Uri.parse("daylight-widget://shortcut/" + requestId));
        IntentSender confirm = PendingIntent.getBroadcast(context, 0, result,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_ONE_SHOT).getIntentSender();
        pinWithCallback(action, uri, confirm);
    }

    private void pinWithCallback(Action action, String uri, IntentSender confirm) {
        ShortcutManager m = manager();
        if (m == null || !m.isRequestPinShortcutSupported()) {
            throw new UnsupportedException("this launcher does not pin shortcuts");
        }
        if (!m.requestPinShortcut(info(action, uri, SurfacePlan.pinId(action)), confirm)) {
            throw new UnsupportedException("the launcher refused the pin request");
        }
    }

    @Override public List<String> pinnedIds() {
        List<String> out = new ArrayList<>();
        ShortcutManager m = manager();
        if (m == null) return out;
        for (ShortcutInfo s : m.getPinnedShortcuts()) out.add(s.getId());
        return out;
    }

    @Override public void refreshPinned(SurfacePlan.Pins pins, SurfacePlan.Linker linker) {
        ShortcutManager m = manager();
        if (m == null) return;
        List<ShortcutInfo> infos = new ArrayList<>();
        for (Map.Entry<String, Action> e : pins.update.entrySet()) infos.add(info(e.getValue(), linker.uri(e.getValue()), e.getKey()));
        if (!pins.unrecorded.isEmpty()) {
            // A pinned media shortcut the app did not record keeps the label the launcher
            // shows and is rewritten under the current key, so a tap reaches the app and is
            // told the shortcut was not saved, instead of being refused as a stale link.
            for (ShortcutInfo held : m.getPinnedShortcuts()) {
                String actionId = pins.unrecorded.get(held.getId());
                if (actionId == null) continue;
                CharSequence shown = held.getShortLabel();
                String label = shown == null || shown.length() == 0 ? "Media" : shown.toString();
                Action placeholder = new Action(actionId, label, "play", ActionCatalog.Kind.MEDIA, "");
                infos.add(info(placeholder, linker.uri(placeholder), held.getId()));
            }
        }
        if (!infos.isEmpty()) m.updateShortcuts(infos);
        if (!pins.disable.isEmpty()) m.disableShortcuts(pins.disable, "This action is no longer set up");
    }

    private ShortcutInfo info(Action a, String uri) { return info(a, uri, a.id); }

    private ShortcutInfo info(Action a, String uri, String shortcutId) {
        // A VIEW of a daylight:// link, limited to this package: it resolves to the link activity.
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(uri)).setPackage(context.getPackageName());
        return new ShortcutInfo.Builder(context, shortcutId)
                .setShortLabel(a.label)
                .setLongLabel(a.label)
                .setIcon(shortcutIcon(a))
                .setIntent(intent)
                .build();
    }

    private Icon shortcutIcon(Action action) {
        // Leave room for launcher masks. Tiles use the original monochrome drawable.
        int size = Math.max(108, manager().getIconMaxWidth());
        Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        // A colour per kind of action (journal, meal, health), all deepened to sit beside the app's green.
        canvas.drawColor(ActionTint.of(action.icon));
        Drawable glyph = context.getDrawable(iconResource(action.icon));
        int inset = size / 4;
        glyph.setBounds(inset, inset, size - inset, size - inset);
        glyph.draw(canvas);
        return Icon.createWithAdaptiveBitmap(bitmap);
    }

    /** Drawables ship in this capability's shell half as ic_action_<name>. */
    private int iconResource(String name) {
        int id = context.getResources().getIdentifier("ic_action_" + name, "drawable", context.getPackageName());
        if (id == 0) id = context.getResources().getIdentifier("ic_action_open", "drawable", context.getPackageName());
        return id == 0 ? android.R.drawable.ic_menu_view : id;
    }
}

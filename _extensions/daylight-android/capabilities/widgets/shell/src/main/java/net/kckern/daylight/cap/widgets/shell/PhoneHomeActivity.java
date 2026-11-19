package net.kckern.daylight.cap.widgets.shell;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.*;

import net.kckern.daylight.api.PayloadPort;
import net.kckern.daylight.api.SurfaceKeys;
import net.kckern.daylight.shellkit.ShellStart;
import net.kckern.daylight.shellkit.SurfaceCache;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** The phone launcher. Incoming intents never select or run an action. */
public class PhoneHomeActivity extends Activity {
    private static final int INK = 0xff14382f, GREEN = 0xff125b47, PAPER = 0xfff4f7f4;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private JSONArray pages = new JSONArray();
    private LinearLayout column;
    private boolean loading = true;
    private String loadError;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(PAPER);
        getWindow().setNavigationBarColor(PAPER);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        ShellStart.ensure(this);
        draw();
        refresh();
    }

    @Override protected void onDestroy() {
        worker.shutdownNow();
        super.onDestroy();
    }

    private interface Reply { void accept(JSONObject reply); }

    private void call(String port, String body, Reply success) {
        worker.execute(() -> {
            try {
                JSONObject result = new JSONObject(PayloadPort.named(port).call(body, 12000));
                runOnUiThread(() -> { if (!isDestroyed() && !isFinishing()) success.accept(result); });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    if (isDestroyed() || isFinishing()) return;
                    String message = e instanceof PayloadPort.NotReadyException ? "Daylight is still starting." : e.getMessage();
                    if (loading) { loading = false; loadError = message; draw(); }
                    else toast(message == null ? "Could not complete the action." : message);
                });
            }
        });
    }

    private JSONObject request(String op, String... fields) {
        JSONObject result = new JSONObject();
        try {
            result.put("op", op);
            for (int i = 0; i < fields.length; i += 2) result.put(fields[i], fields[i + 1]);
        } catch (org.json.JSONException invalid) { throw new IllegalArgumentException(invalid); }
        return result;
    }

    private void refresh() {
        loading = true;
        loadError = null;
        call("phone-bookmarks", request("list").toString(), result -> {
            pages = result.optJSONArray("items");
            if (pages == null) pages = new JSONArray();
            loading = false;
            draw();
        });
    }

    private void draw() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(PAPER);
        column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setPadding(dp(20), dp(28), dp(20), dp(24));
        scroll.addView(column);
        setContentView(scroll);
        TextView title = label("Daylight", 32, INK);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        column.addView(title);
        column.addView(label("Add to your Android home screen", 16, INK));
        if (loading) { column.addView(label("Loading services…", 16, INK)); return; }
        if (loadError != null) { row("Try again", loadError, "open", this::refresh); return; }
        column.addView(label("Services", 20, INK));
        for (int i = 0; i < pages.length(); i++) {
            JSONObject page = pages.optJSONObject(i);
            if (page == null) continue;
            row(page.optString("label"), "Add to home screen", page.optString("icon"), () -> pinPage(page));
        }
        column.addView(label("Quick capture", 20, INK));
        for (ButtonFace.Choice choice : ButtonFace.choices(SurfaceCache.get(this, SurfaceKeys.ACTION_IDS),
                key -> SurfaceCache.get(this, key))) {
            if (!choice.id.startsWith("journal") && !choice.id.startsWith("meal")) continue;
            String icon = SurfaceCache.get(this, SurfaceKeys.action(choice.id, SurfaceKeys.ICON));
            row(choice.label, "Add to home screen", icon, () -> call("phone-pin-action", choice.id, result -> {}));
        }
        column.addView(label("Play on demand", 20, INK));
        row("Play a playlist", "Choose a playlist for a one-tap widget", "play",
                () -> showMediaChoices(0));
    }

    private void pinPage(JSONObject page) {
        String id = page.optString("id");
        ShortcutManager sm = getSystemService(ShortcutManager.class);
        if (sm == null || !sm.isRequestPinShortcutSupported()) { toast("This launcher cannot pin bookmarks."); return; }
        if (!SurfaceCache.link(this, SurfaceKeys.action(id, SurfaceKeys.URI)).isEmpty()) {
            call("phone-pin-action", id, result -> {});
            return;
        }
        ShortcutInfo shortcut = new ShortcutInfo.Builder(this, "bookmark-" + id)
                .setShortLabel(page.optString("label")).setIcon(Icon.createWithResource(this, drawable("star")))
                .setIntent(SurfaceCache.viewIntent(this, "daylight://bookmark/" + id)).build();
        if (!sm.requestPinShortcut(shortcut, null)) toast("The launcher could not add this bookmark.");
    }

    private void showMediaChoices(int cursor) {
        call("media", request("playlists", "cursor", String.valueOf(cursor)).toString(), result -> {
            JSONArray items = result.optJSONArray("items");
            if (!result.optBoolean("ok") || items == null) {
                toast("Could not load playlists. Tap Play a playlist to retry.");
                return;
            }
            int next = result.optInt("nextCursor", -1);
            if (items.length() == 0 && next < 0) {
                toast("No playlists are available.");
                return;
            }
            String[] names = new String[items.length() + (next >= 0 ? 1 : 0)];
            for (int i = 0; i < items.length(); i++) names[i] = items.optJSONObject(i).optString("title");
            if (next >= 0) names[items.length()] = "More playlists";
            new AlertDialog.Builder(this).setTitle("Choose a playlist")
                    .setItems(names, (dialog, index) -> {
                        if (index == items.length()) { showMediaChoices(next); return; }
                        JSONObject item = items.optJSONObject(index);
                        String title = item.optString("title");
                        new AlertDialog.Builder(this).setTitle(title).setNegativeButton("Cancel", null)
                                .setPositiveButton("Add widget", (d, w) ->
                                        pinWidget("c:" + item.optString("contentId"), title)).show();
                    }).setNegativeButton("Cancel", null).show();
        });
    }

    private void pinWidget(String action, String label) {
        AppWidgetManager manager = AppWidgetManager.getInstance(this);
        if (manager == null) { toast("Android widgets are unavailable on this launcher."); return; }
        if (!manager.isRequestPinAppWidgetSupported()) {
            toast("Long-press your home screen, choose Widgets, then Daylight button."); return;
        }
        ComponentName provider = new ComponentName(this, ButtonWidgetProvider.class);
        Intent callback = new Intent(this, ButtonWidgetProvider.class).setAction(ButtonWidgetProvider.PIN_ACTION)
                .setData(Uri.parse("daylight-widget://pin/" + java.util.UUID.randomUUID()))
                .putExtra(ButtonWidgetProvider.EXTRA_ACTION_ID, action)
                .putExtra(ButtonWidgetProvider.EXTRA_PLAYLIST_LABEL, label);
        int flags = PendingIntent.FLAG_ONE_SHOT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
        PendingIntent confirmed = PendingIntent.getBroadcast(this, 0, callback, flags);
        boolean requested;
        try { requested = manager.requestPinAppWidget(provider, null, confirmed); }
        catch (RuntimeException unavailable) { requested = false; }
        if (!requested) toast("The launcher could not add this widget. Long-press the home screen and add Daylight button from Widgets.");
    }

    private int drawable(String name) {
        int found = getResources().getIdentifier("ic_action_" + name, "drawable", getPackageName());
        return found == 0 ? android.R.drawable.ic_menu_view : found;
    }

    private View row(String name, String detail, String glyph, Runnable click) {
        LinearLayout line = new LinearLayout(this);
        line.setGravity(Gravity.CENTER_VERTICAL);
        line.setPadding(dp(16), dp(12), dp(14), dp(12));
        line.setBackground(round(Color.WHITE, 16));
        ImageView icon = new ImageView(this);
        icon.setBackground(round(GREEN, 14)); icon.setPadding(dp(9), dp(9), dp(9), dp(9));
        icon.setImageResource(drawable(glyph));
        line.addView(icon, dp(40), dp(40));
        LinearLayout words = new LinearLayout(this);
        words.setOrientation(LinearLayout.VERTICAL);
        words.setPadding(dp(14), 0, 0, 0);
        TextView heading = label(name, 18, INK);
        heading.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        words.addView(heading); words.addView(label(detail, 14, 0xff486258));
        line.addView(words);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.topMargin = dp(8);
        column.addView(line, lp);
        line.setOnClickListener(v -> click.run());
        return line;
    }

    private TextView label(String text, int size, int color) {
        TextView view = new TextView(this);
        view.setText(text); view.setTextSize(size); view.setTextColor(color);
        return view;
    }

    private GradientDrawable round(int color, int radius) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(color); shape.setCornerRadius(dp(radius));
        return shape;
    }

    private void toast(String message) { Toast.makeText(this, message, Toast.LENGTH_LONG).show(); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}

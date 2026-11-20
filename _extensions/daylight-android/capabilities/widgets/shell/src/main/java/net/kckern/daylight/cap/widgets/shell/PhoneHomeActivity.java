package net.kckern.daylight.cap.widgets.shell;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.view.Gravity;
import android.view.View;
import android.widget.*;

import net.kckern.daylight.api.PayloadPort;
import net.kckern.daylight.shellkit.ShellStart;
import net.kckern.daylight.shellkit.SurfaceCache;
import net.kckern.daylight.shellkit.LauncherCaptureShortcut;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** The phone launcher. Incoming intents never select or run an action. */
public class PhoneHomeActivity extends Activity {
    private static final int INK = 0xff14382f, GREEN = 0xff125b47, PAPER = 0xfff4f7f4;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private JSONArray pages = new JSONArray();
    private JSONArray configuredActions = new JSONArray();
    private LinearLayout column;
    private LinearLayout placementPanel;
    private PlacementStore placements;
    private final List<Button> setupButtons = new ArrayList<>();
    private final List<Button> retryButtons = new ArrayList<>();
    private final Handler timer = new Handler(android.os.Looper.getMainLooper());
    private final Runnable placementTimeout = this::drawPlacement;
    private final SharedPreferences.OnSharedPreferenceChangeListener placementChanged =
            (prefs, key) -> drawPlacement();
    private boolean openingPlaylist;
    private boolean observingPlacement;
    private boolean loading = true;
    private boolean launcherPicker;
    private String loadError;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        launcherPicker = Intent.ACTION_CREATE_SHORTCUT.equals(getIntent().getAction());
        if (launcherPicker) setResult(RESULT_CANCELED);
        placements = new PlacementStore(this);
        getWindow().setStatusBarColor(PAPER);
        getWindow().setNavigationBarColor(PAPER);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        ShellStart.ensure(this);
        draw();
        refresh();
    }

    @Override protected void onStart() {
        super.onStart();
        if (!launcherPicker) {
            observingPlacement = true;
            placements.prefs.registerOnSharedPreferenceChangeListener(placementChanged);
            drawPlacement();
        }
    }

    @Override protected void onStop() {
        observingPlacement = false;
        placements.prefs.unregisterOnSharedPreferenceChangeListener(placementChanged);
        timer.removeCallbacks(placementTimeout);
        super.onStop();
    }

    @Override protected void onDestroy() {
        worker.shutdownNow();
        super.onDestroy();
    }

    private interface Reply { void accept(JSONObject reply); }

    private void call(String port, String body, Reply success) {
        call(port, body, success, message -> {
            if (loading) { loading = false; loadError = message; draw(); }
            else toast(message);
        });
    }

    private void call(String port, String body, Reply success, java.util.function.Consumer<String> failure) {
        worker.execute(() -> {
            try {
                JSONObject result = new JSONObject(PayloadPort.named(port).call(body, 12000));
                runOnUiThread(() -> { if (!isDestroyed() && !isFinishing()) success.accept(result); });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    if (isDestroyed() || isFinishing()) return;
                    String message = e instanceof PayloadPort.NotReadyException ? "Daylight is still starting." : e.getMessage();
                    failure.accept(message == null ? "Could not complete the action." : message);
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
            call("phone-pin-action", "", actions -> {
                configuredActions = actions.optJSONArray("items");
                if (configuredActions == null) configuredActions = new JSONArray();
                loading = false;
                draw();
            });
        });
    }

    private void draw() {
        setupButtons.clear();
        placementPanel = null;
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
        column.addView(label(launcherPicker ? "Choose a shortcut" : "Add to your Android home screen", 16, INK));
        if (loading) { column.addView(label("Loading services…", 16, INK)); return; }
        if (loadError != null) { row("Try again", loadError, "open", this::refresh); return; }
        if (!launcherPicker) {
            placementPanel = new LinearLayout(this);
            placementPanel.setOrientation(LinearLayout.VERTICAL);
            placementPanel.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
            column.addView(placementPanel);
        }
        column.addView(label("Services", 20, INK));
        for (int i = 0; i < pages.length(); i++) {
            JSONObject page = pages.optJSONObject(i);
            if (page == null) continue;
            if (launcherPicker) {
                // This result goes to the caller. Only stable, unkeyed page bookmarks may leave the app.
                String id = page.optString("id");
                if (java.util.Arrays.asList("health", "home", "lifelog", "media").contains(id)) {
                    row(page.optString("label"), "Choose shortcut", page.optString("icon"),
                            () -> returnLauncherShortcut(page));
                }
            } else {
                row(page.optString("label"), "Add to home screen", page.optString("icon"), () -> pinPage(page));
            }
        }
        column.addView(label("Quick capture", 20, INK));
        for (int i = 0; i < configuredActions.length(); i++) {
            JSONObject action = configuredActions.optJSONObject(i);
            if (action == null || !("INPUT".equals(action.optString("kind")) || "meal-barcode".equals(action.optString("id")))) continue;
            String id = action.optString("id");
            if (launcherPicker) {
                if (!LauncherCaptureShortcut.supports(id)) continue;
                row(action.optString("label"), "Choose shortcut", action.optString("icon"),
                        () -> returnCaptureShortcut(action));
            } else {
                row(action.optString("label"), "Add to home screen", action.optString("icon"),
                        () -> confirmShortcut(id, action.optString("label")));
            }
        }
        if (launcherPicker) return;
        column.addView(label("Play on demand", 20, INK));
        row("Play a playlist", "Choose playlist", "play", () -> showMediaChoices(0));
        drawPlacement();
    }

    private void returnCaptureShortcut(JSONObject action) {
        try {
            returnShortcut(action, LauncherCaptureShortcut.issue(this, action.optString("id")));
        } catch (RuntimeException unavailable) {
            toast("Could not save the capture shortcut. Try again.");
        }
    }

    private void returnLauncherShortcut(JSONObject page) {
        returnShortcut(page, "daylight://bookmark/" + page.optString("id"));
    }

    private void returnShortcut(JSONObject page, String link) {
        Intent open = SurfaceCache.viewIntent(this, link)
                .setClassName(this, "net.kckern.daylight.cap.notifications.shell.LinkActivity");
        Intent result = new Intent().putExtra(Intent.EXTRA_SHORTCUT_NAME, page.optString("label"))
                .putExtra(Intent.EXTRA_SHORTCUT_INTENT, open)
                .putExtra(Intent.EXTRA_SHORTCUT_ICON_RESOURCE,
                        Intent.ShortcutIconResource.fromContext(this, drawable(page.optString("icon"))));
        setResult(RESULT_OK, result);
        finish();
    }

    private void pinPage(JSONObject page) {
        String id = page.optString("id");
        String title = page.optString("label");
        if (!id.startsWith("saved-")) {
            confirmShortcut(id, title);
            return;
        }
        confirmShortcut(title, () -> {
            LauncherPlacement placement = beginPlacement(id, title, false);
            if (placement == null) return;
            ShortcutManager manager = getSystemService(ShortcutManager.class);
            try {
                ShortcutInfo shortcut = new ShortcutInfo.Builder(this, "bookmark-" + id)
                        .setShortLabel(title).setIcon(Icon.createWithResource(this, drawable("star")))
                        .setIntent(SurfaceCache.viewIntent(this, "daylight://bookmark/" + id)).build();
                if (manager != null && manager.isRequestPinShortcutSupported()
                        && manager.requestPinShortcut(shortcut, callback(placement).getIntentSender())) return;
            } catch (RuntimeException unavailable) {
                // Report a refused handoff below.
            }
            refused(placement);
        });
    }

    private void confirmShortcut(String id, String title) {
        confirmShortcut(title, () -> {
            LauncherPlacement placement = beginPlacement(id, title, false);
            if (placement == null) return;
            String request = request("pin", "id", id, "requestId", placement.requestId).toString();
            call("phone-pin-action", request, result -> {}, message -> refused(placement));
        });
    }

    private void confirmShortcut(String title, Runnable pin) {
        if (placementActive()) return;
        new AlertDialog.Builder(this).setTitle("Add " + title + " to home screen?")
                .setMessage("Android will ask you to confirm placement.")
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Continue", (dialog, which) -> pin.run())
                .show();
    }

    private void showMediaChoices(int cursor) {
        if (openingPlaylist || placementActive()) return;
        openingPlaylist = true;
        updateSetupButtons(true);
        call("media", request("playlists", "cursor", String.valueOf(cursor)).toString(), result -> {
            openingPlaylist = false;
            drawPlacement();
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
                        String contentId = item.optString("contentId");
                        new AlertDialog.Builder(this).setTitle(title).setNegativeButton("Cancel", null)
                                .setMessage("Add a one-tap playlist widget to Android Home.")
                                .setPositiveButton("Add widget", (d, w) -> pinWidget(contentId, title)).show();
                    }).setNegativeButton("Cancel", null).show();
        }, message -> {
            openingPlaylist = false;
            drawPlacement();
            toast("Could not load playlists. Tap Choose playlist to retry.");
        });
    }

    private void pinWidget(String contentId, String title) {
        requestPinWidget(beginPlacement(contentId, title, true));
    }

    private void retryWidget(LauncherPlacement previous) {
        if (placementActive()) return;
        LauncherPlacement retry = placements.retry(previous);
        if (retry == null) {
            toast("Could not prepare placement. Try again.");
            return;
        }
        requestPinWidget(retry);
    }

    private void requestPinWidget(LauncherPlacement placement) {
        if (placement == null) return;
        AppWidgetManager manager = AppWidgetManager.getInstance(this);
        try {
            if (manager != null && manager.isRequestPinAppWidgetSupported()
                    && manager.requestPinAppWidget(new ComponentName(this, ButtonWidgetProvider.class), null,
                        callback(placement))) return;
        } catch (RuntimeException unavailable) {
            // Report a refused handoff below.
        }
        refused(placement);
    }

    private PendingIntent callback(LauncherPlacement placement) {
        Intent callback = new Intent(this, ButtonWidgetProvider.class)
                .setAction(placement.playlist ? ButtonWidgetProvider.PIN_ACTION : ButtonWidgetProvider.SHORTCUT_PIN_ACTION)
                .setData(Uri.parse("daylight-widget://" + (placement.playlist ? "pin/" : "shortcut/") + placement.requestId));
        int flags = PendingIntent.FLAG_ONE_SHOT;
        if (!placement.playlist) flags |= PendingIntent.FLAG_IMMUTABLE;
        else if (Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_MUTABLE;
        return PendingIntent.getBroadcast(this, 0, callback, flags);
    }

    private LauncherPlacement beginPlacement(String contentId, String title, boolean playlist) {
        if (placementActive()) return null;
        if (contentId.isEmpty() || title.isEmpty()) {
            toast("This item could not be prepared for placement.");
            return null;
        }
        LauncherPlacement placement = placements.begin(contentId, title, playlist);
        if (placement == null) toast("Could not prepare placement. Try again.");
        return placement;
    }

    private void refused(LauncherPlacement placement) {
        LauncherPlacement current = placements.get(placement.requestId);
        if (current != null && current.status(System.currentTimeMillis()) != LauncherPlacement.Status.ADDED) {
            placements.write(current.refuse(), 0);
        }
    }

    private boolean placementActive() {
        long now = System.currentTimeMillis();
        return placements.requests().stream().anyMatch(request -> request.status(now) == LauncherPlacement.Status.CONFIRM);
    }

    private void showManualPlacement(LauncherPlacement placement) {
        placements.prepareManual(placement);
        new AlertDialog.Builder(this).setTitle("Place " + placement.title + " on Android Home")
                .setMessage("Open Widgets on Android Home, add Daylight playlist, then choose Play " + placement.title + ".")
                .setPositiveButton("OK", null).show();
    }

    private void drawPlacement() {
        if (!observingPlacement || placementPanel == null) return;
        timer.removeCallbacks(placementTimeout);
        placementPanel.removeAllViews();
        retryButtons.clear();
        long now = System.currentTimeMillis();
        boolean active = false;
        List<LauncherPlacement> requests = placements.requests();
        Set<String> guided = new HashSet<>();
        for (LauncherPlacement request : LauncherPlacement.visible(requests, now)) {
            LauncherPlacement.Status status = request.status(now);
            if (status == LauncherPlacement.Status.CONFIRM) {
                active = true;
                timer.postDelayed(placementTimeout, Math.max(1, request.startedAt + LauncherPlacement.TIMEOUT_MS - now));
            }
            if (request.hasExtraWidget(requests)) {
                status = guided.add(request.lineageId) ? LauncherPlacement.Status.EXTRA_WIDGET : LauncherPlacement.Status.ADDED;
            }
            addPlacementStatus(request, status);
        }
        updateSetupButtons(active || openingPlaylist);
    }

    private void addPlacementStatus(LauncherPlacement request, LauncherPlacement.Status status) {
        String message;
        switch (status) {
            case CONFIRM: message = "Confirm in Android"; break;
            case UNCONFIRMED: message = "Placement unconfirmed. Check Android Home before trying again."; break;
            case REFUSED: message = "Android placement is unavailable."; break;
            case EXTRA_WIDGET:
                message = "Two widgets were added for this placement. If both are still on Android Home, touch and hold the extra widget, then choose Remove.";
                break;
            default: message = "Added";
        }
        placementPanel.addView(label(request.title + " — " + message, 16, INK));
        if (status != LauncherPlacement.Status.UNCONFIRMED && status != LauncherPlacement.Status.REFUSED) return;
        if (request.playlist && request.manualWidget == 0) {
            placementPanel.addView(actionButton("Place manually", request.title, () -> showManualPlacement(request)));
            Button retry = actionButton("Retry widget placement", request.title,
                    () -> retryWidget(request));
            retryButtons.add(retry);
            placementPanel.addView(retry);
        }
        if (!request.playlist) {
            placementPanel.addView(label("You can retry with Add to home screen or check your launcher's shortcuts.", 14, INK));
        }
    }

    private void updateSetupButtons(boolean busy) {
        for (Button button : setupButtons) button.setEnabled(!busy);
        for (Button button : retryButtons) button.setEnabled(!busy);
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
        words.addView(heading);
        Button action = actionButton(detail, name, click);
        words.addView(action);
        if (!launcherPicker && placementPanel != null) setupButtons.add(action);
        line.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.topMargin = dp(8);
        column.addView(line, lp);
        icon.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        return line;
    }

    private Button actionButton(String text, String item, Runnable click) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        button.setContentDescription(text + ", " + item);
        button.setOnClickListener(v -> click.run());
        return button;
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

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
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import net.kckern.daylight.shellkit.PlaylistArtwork;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.Icon;
import android.graphics.drawable.RippleDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.view.Gravity;
import android.view.View;
import android.view.animation.DecelerateInterpolator;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.*;

import net.kckern.daylight.api.PayloadPort;
import net.kckern.daylight.shellkit.ShellStart;
import net.kckern.daylight.shellkit.PlaylistWidgetState;
import net.kckern.daylight.shellkit.SurfaceCache;
import net.kckern.daylight.shellkit.DrivingRadioSettings;
import net.kckern.daylight.shellkit.LauncherCaptureShortcut;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** The phone launcher. Incoming intents never select or run an action. */
public class PhoneHomeActivity extends Activity {
    private static final int INK = 0xff14382f, GREEN = 0xff125b47, PAPER = 0xfff4f7f4;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private JSONArray pages = new JSONArray();
    private JSONArray configuredActions = new JSONArray();
    private LinearLayout column;
    private LinearLayout buttonRow;
    private LinearLayout placementPanel;
    private PlacementStore placements;
    private final List<View> setupRows = new ArrayList<>();
    private final Handler timer = new Handler(android.os.Looper.getMainLooper());
    private final Runnable placementTimeout = this::drawPlacement;
    private String addedSeen = "";
    private final SharedPreferences.OnSharedPreferenceChangeListener placementChanged =
            (prefs, key) -> onPlacementChanged();
    private final ExecutorService artworkWorker = Executors.newFixedThreadPool(3);
    private LinearLayout playlistScreen;
    private LinearLayout playlistGrid;
    private LinearLayout playlistRow;
    private TextView playlistStatus;
    private boolean observingPlacement;
    private boolean loading = true;
    private boolean launcherPicker;
    private String loadError;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        launcherPicker = Intent.ACTION_CREATE_SHORTCUT.equals(getIntent().getAction());
        if (launcherPicker) setResult(RESULT_CANCELED);
        placements = new PlacementStore(this);
        swipe = makeSwipe();
        addedSeen = placements.addedSignature();
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
        artworkWorker.shutdownNow();
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

    private static final String[] TABS = {"Services", "Capture", "Play", "Connect"};
    private int tab;
    /** Made in onCreate: a detector needs the activity's context, which does not exist yet at construction. */
    private android.view.GestureDetector swipe;

    private android.view.GestureDetector makeSwipe() {
        return new android.view.GestureDetector(this,
                new android.view.GestureDetector.SimpleOnGestureListener() {
                    @Override public boolean onFling(android.view.MotionEvent down, android.view.MotionEvent up, float vx, float vy) {
                        // A clear sideways flick on the tabs' page moves to the next or previous tab.
                        if (!tabsShown() || Math.abs(vx) < 900 || Math.abs(vx) < Math.abs(vy) * 1.8f) return false;
                        selectTab(tab + (vx < 0 ? 1 : -1), vx < 0 ? 1 : -1);
                        return false;
                    }
                });
    }

    private boolean tabsShown() {
        return !launcherPicker && !loading && loadError == null && playlistScreen == null;
    }

    @Override public boolean dispatchTouchEvent(android.view.MotionEvent event) {
        if (swipe != null) swipe.onTouchEvent(event);
        return super.dispatchTouchEvent(event);
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        state.putInt("tab", tab);
    }

    @Override protected void onRestoreInstanceState(Bundle state) {
        super.onRestoreInstanceState(state);
        tab = Math.max(0, Math.min(TABS.length - 1, state.getInt("tab", 0)));
        if (tabsShown()) draw();
    }

    private LinearLayout tabs;
    private android.widget.FrameLayout pageHost;
    private ScrollView page;

    private void selectTab(int index, int direction) {
        int next = Math.max(0, Math.min(TABS.length - 1, index));
        if (next == tab || pageHost == null) return;
        tab = next;
        fillTabs();
        // A quick second swipe: drop whatever is still sliding out before starting the next.
        for (int i = pageHost.getChildCount() - 1; i >= 0; i--) {
            View child = pageHost.getChildAt(i);
            if (child != page) {
                child.animate().cancel();
                pageHost.removeViewAt(i);
            }
        }
        ScrollView leaving = page;
        page = buildPage();
        pageHost.addView(page);
        if (leaving == null || direction == 0) {
            if (leaving != null) pageHost.removeView(leaving);
            return;
        }
        // Both pages move: the old one out the way the finger went, the new one in behind it.
        int width = pageHost.getWidth() > 0 ? pageHost.getWidth() : getResources().getDisplayMetrics().widthPixels;
        android.view.animation.Interpolator ease = new DecelerateInterpolator(1.6f);
        page.setTranslationX(direction * width);
        page.animate().translationX(0).setDuration(240).setInterpolator(ease).start();
        leaving.animate().translationX(-direction * width).setDuration(240).setInterpolator(ease)
                .withEndAction(() -> pageHost.removeView(leaving)).start();
    }

    /** The four tabs as chips of equal width: one is always the page. */
    private void fillTabs() {
        tabs.removeAllViews();
        for (int i = 0; i < TABS.length; i++) {
            int index = i;
            boolean selected = i == tab;
            TextView chip = PlaylistPicker.text(this, TABS[i], 14, selected ? android.graphics.Color.WHITE : GREEN, true);
            chip.setGravity(Gravity.CENTER);
            chip.setBackground(PlaylistPicker.round(selected ? GREEN : PlaylistPicker.COLOR_CHIP, 20, this));
            chip.setContentDescription(TABS[i] + (selected ? ", selected" : ""));
            chip.setOnClickListener(v -> selectTab(index, index > tab ? 1 : -1));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, dp(40), 1);
            if (i > 0) lp.leftMargin = dp(8);
            tabs.addView(chip, lp);
        }
    }

    private void draw() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(PAPER);
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.VERTICAL);
        header.setPadding(dp(16), dp(16), dp(16), dp(8));
        TextView title = label("Daylight", 28, INK);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        header.addView(title);
        header.addView(label(launcherPicker ? "Choose a shortcut" : "Add to your Android home screen", 16, INK));
        root.addView(header);
        tabs = null;
        if (tabsShown()) {
            tabs = new LinearLayout(this);
            tabs.setPadding(dp(16), dp(4), dp(16), dp(8));
            fillTabs();
            root.addView(tabs);
        }
        pageHost = new android.widget.FrameLayout(this);
        pageHost.setBackgroundColor(PAPER);
        root.addView(pageHost, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        page = buildPage();
        pageHost.addView(page);
    }

    /** One page: the section the selected tab names, in its own scrolling view. */
    private ScrollView buildPage() {
        setupRows.clear();
        buttonRow = null;
        placementPanel = null;
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(PAPER);
        column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setPadding(dp(16), dp(8), dp(16), dp(16));
        scroll.addView(column);
        if (loading) { column.addView(label("Loading services…", 16, INK)); return scroll; }
        if (loadError != null) {
            column.addView(label(loadError, 16, INK));
            row("Try again", "Try again", "open", "›", this::refresh);
            return scroll;
        }
        if (!launcherPicker) {
            placementPanel = new LinearLayout(this);
            placementPanel.setOrientation(LinearLayout.VERTICAL);
            placementPanel.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
            column.addView(placementPanel);
        }
        if (launcherPicker) {
            // The launcher's shortcut chooser is short: two sections on one page, no tabs.
            section("Services");
            addServices();
            section("Quick capture");
            addCapture();
            return scroll;
        }
        if (tab == 0) addServices();
        else if (tab == 1) addCapture();
        else if (tab == 2) addPlay();
        else addConnections();
        drawPlacement();
        return scroll;
    }

    /** Rows for items, with the ones already on the home screen grouped first when there are any. */
    private void addGrouped(List<JSONObject> items, java.util.function.Function<JSONObject, Runnable> addAction) {
        List<JSONObject> added = new ArrayList<>(), rest = new ArrayList<>();
        for (JSONObject item : items) (placements.isAdded(item.optString("id")) ? added : rest).add(item);
        if (!added.isEmpty()) {
            section("On your home screen");
            for (JSONObject item : added) {
                row(item.optString("label"), "On your home screen", item.optString("icon"), "✓",
                        () -> showAddedSheet(item.optString("id"), item.optString("label")));
            }
            if (!rest.isEmpty()) section("Available");
        }
        for (JSONObject item : rest) {
            row(item.optString("label"), "Add to home screen", item.optString("icon"), "+", addAction.apply(item));
        }
    }

    /** What to do with something already on the home screen. */
    private void showAddedSheet(String id, String label) {
        new Sheet(this).heading(label, "On your home screen")
                .note("To take it off, touch and hold its icon on Home and choose Remove.")
                .button("Go to Home", Sheet.Style.PRIMARY, () -> startActivity(
                        new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)))
                .button("Already removed? Move back to Available", Sheet.Style.TONAL, () -> {
                    placements.clearAdded(id);
                    onPlacementChanged();
                }).show();
    }

    private void addServices() {
        if (launcherPicker) {
            for (int i = 0; i < pages.length(); i++) {
                JSONObject page = pages.optJSONObject(i);
                if (page == null) continue;
                // This result goes to the caller. Only stable, unkeyed page bookmarks may leave the app.
                String id = page.optString("id");
                if (java.util.Arrays.asList("health", "home", "lifelog", "media").contains(id)) {
                    row(page.optString("label"), "Choose shortcut", page.optString("icon"), "›",
                            () -> returnLauncherShortcut(page));
                }
            }
            return;
        }
        List<JSONObject> items = new ArrayList<>();
        for (int i = 0; i < pages.length(); i++) {
            JSONObject page = pages.optJSONObject(i);
            if (page != null) items.add(page);
        }
        addGrouped(items, page -> () -> pinPage(page));
    }

    private void addCapture() {
        List<JSONObject> items = new ArrayList<>();
        for (int i = 0; i < configuredActions.length(); i++) {
            JSONObject action = configuredActions.optJSONObject(i);
            if (action == null || !("INPUT".equals(action.optString("kind")) || "meal-barcode".equals(action.optString("id")))) continue;
            if (launcherPicker) {
                if (!LauncherCaptureShortcut.supports(action.optString("id"))) continue;
                row(action.optString("label"), "Choose shortcut", action.optString("icon"), "›",
                        () -> returnCaptureShortcut(action));
            } else {
                items.add(action);
            }
        }
        if (!launcherPicker) addGrouped(items, action -> () -> confirmShortcut(action.optString("id"), action.optString("label")));
    }

    private void addPlay() {
        row("Drive playlists", "The playlists on the car's Drive tab", "play", "›", this::showMediaChoices);
        row("Driving Radio", "Set the default and day rules", "play", "›", this::showDrivingRadio);
        if (!canPinWidgets()) {
            row("Widget on Home", "How to put a playlist on your home screen", "open", "›",
                    () -> showManualWidgetPlacement(null));
        }
    }

    private void addConnections() {
        row("Freematics", "Manage Bluetooth connection", "open", "›",
                () -> startActivity(new Intent(this, FreematicsActivity.class)));
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

    private void pickPlaylistToAdd() {
        PlaylistPicker.show(this, "Add to Drive", entry -> showPlaylistSheet(entry.id, entry.title, entry.art,
                this::drawStagedPlaylists));
    }

    private void showDrivingRadio() {
        DrivingRadioScreen.show(this);
    }

    /** The Drive list: the playlists on the car's Drive tab, and a button to add more. */
    private void showMediaChoices() {
        if (playlistScreen != null) return;
        playlistRow = null;
        playlistScreen = new LinearLayout(this);
        playlistScreen.setOrientation(LinearLayout.VERTICAL);
        playlistScreen.setBackgroundColor(PAPER);
        playlistScreen.setPadding(dp(16), dp(8), dp(16), 0);

        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        Button back = actionButton("‹", "back to setup", this::closeMediaChoices);
        back.setContentDescription("Back to setup");
        header.addView(back, dp(48), dp(48));
        TextView heading = label("Drive playlists", 24, INK);
        heading.setAccessibilityHeading(true);
        header.addView(heading, new LinearLayout.LayoutParams(0, -2, 1));
        TextView add = PlaylistPicker.text(this, "+ Add", 15, android.graphics.Color.WHITE, true);
        add.setGravity(Gravity.CENTER);
        add.setBackground(PlaylistPicker.round(GREEN, 20, this));
        add.setOnClickListener(v -> pickPlaylistToAdd());
        header.addView(add, new LinearLayout.LayoutParams(dp(88), dp(40)));
        playlistScreen.addView(header);

        ScrollView scroll = new ScrollView(this);
        playlistScreen.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        scroll.addView(content);
        playlistGrid = new LinearLayout(this);
        playlistGrid.setOrientation(LinearLayout.VERTICAL);
        content.addView(playlistGrid);
        playlistStatus = label("", 16, INK);
        playlistStatus.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        content.addView(playlistStatus);
        setContentView(playlistScreen);
        slideIn(playlistScreen, 1);
        drawStagedPlaylists();
    }

    private void drawStagedPlaylists() {
        if (playlistGrid == null) return;
        playlistGrid.removeAllViews();
        playlistRow = null;
        DrivingRadioSettings radio = new DrivingRadioSettings(this);
        String[] weekdays = new java.text.DateFormatSymbols().getWeekdays();
        int shown = 0;
        for (DrivingRadioSettings.Staple playlist : radio.staged()) {
            if (!radio.isStaple(playlist.id)) continue;
            shown++;
            String where = net.kckern.daylight.shellkit.PlaylistUse.describe(radio.snapshot(), playlist.id, weekdays);
            addPlaylist(playlist.id, playlist.title, where);
        }
        playlistStatus.setVisibility(shown == 0 ? View.VISIBLE : View.GONE);
        playlistStatus.setText("Nothing on Drive yet. Tap + Add to choose playlists for the car's Drive tab.");
    }

    private void managePlaylist(String contentId, String title) {
        showPlaylistSheet(contentId, title, "", this::drawStagedPlaylists);
    }

    /**
     * One sheet for a playlist. The Drive list is the one curated list: the playlist is on it
     * or not, and the button says so. Shuffle is a setting of the playlist wherever it plays.
     * A playlist only a widget or a day of Driving Radio uses is remembered quietly (its title
     * and cover, for the car) but is not on Drive until it is added here.
     */
    private void showPlaylistSheet(String contentId, String title, String art, Runnable changed) {
        DrivingRadioSettings radio = new DrivingRadioSettings(this);
        boolean remembered = placements.isStaged(contentId);
        boolean onDrive = remembered && radio.isStaple(contentId);
        String cover = art == null || art.isEmpty() ? radio.art(contentId) : art;
        boolean[] shuffle = {placements.shuffle(contentId)};
        String uses = remembered ? net.kckern.daylight.shellkit.PlaylistUse.describe(
                radio.snapshot(), contentId, new java.text.DateFormatSymbols().getWeekdays()) : "";
        Sheet sheet = new Sheet(this).header(contentId, cover, title, uses.isEmpty() ? "Not on Drive" : uses);
        sheet.toggle("Shuffle", "Play in random order", shuffle[0], on -> {
            shuffle[0] = on;
            if (remembered) {
                placements.stage(contentId, title, on);
                PlaylistWidgetState.redraw(this);
            }
        });
        if (!onDrive) {
            sheet.button("Add to Drive", Sheet.Style.PRIMARY, () -> {
                radio.remember(contentId, title, cover);
                placements.stage(contentId, title, shuffle[0]);
                radio.setStaple(contentId, true);
                PlaylistPicker.cacheCover(this, contentId, cover);
                PlaylistWidgetState.redraw(this);
                changed.run();
            });
        }
        if (canPinWidgets()) sheet.button("Add widget to Home", onDrive ? Sheet.Style.PRIMARY : Sheet.Style.TONAL,
                () -> pinWidget(contentId, title));
        else sheet.button("How to add it to Home", Sheet.Style.TONAL, () -> showManualWidgetPlacement(title));
        if (onDrive) {
            sheet.button("Remove from Drive", Sheet.Style.DANGER, () -> {
                radio.setStaple(contentId, false);
                radio.forgetIfUnused(contentId);
                PlaylistWidgetState.redraw(this);
                changed.run();
            });
        }
        sheet.onDismiss(changed);
        sheet.show();
    }

    private void slideIn(View screen, int direction) {
        screen.setTranslationX(direction * getResources().getDisplayMetrics().widthPixels);
        screen.animate().translationX(0).setDuration(220)
                .setInterpolator(new DecelerateInterpolator()).start();
    }

    @Override public void onBackPressed() {
        if (playlistScreen == null) super.onBackPressed();
        else closeMediaChoices();
    }

    private void closeMediaChoices() {
        playlistScreen = null;
        playlistGrid = null;
        playlistRow = null;
        playlistStatus = null;
        draw();
        slideIn(column, -1);
    }

    private void addPlaylist(String contentId, String title, String where) {
        if (contentId.isEmpty() || title.isEmpty()) return;
        if (playlistRow == null || playlistRow.getChildCount() == 3) {
            playlistRow = new LinearLayout(this);
            playlistRow.setWeightSum(3);
            playlistGrid.addView(playlistRow, new LinearLayout.LayoutParams(-1, -2));
        }
        LinearLayout tile = new LinearLayout(this);
        tile.setOrientation(LinearLayout.VERTICAL);
        tile.setPadding(dp(4), dp(4), dp(4), dp(12));
        tile.setFocusable(true);
        tile.setContentDescription("Manage " + title + ". " + where);
        ImageView cover = new ImageView(this) {
            @Override protected void onMeasure(int width, int height) {
                int side = View.MeasureSpec.getSize(width);
                setMeasuredDimension(side, side);
            }
        };
        cover.setBackgroundColor(0xffdcebe4);
        cover.setImageResource(drawable("play"));
        cover.setScaleType(ImageView.ScaleType.CENTER);
        cover.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        tile.addView(cover, new LinearLayout.LayoutParams(-1, -2));
        TextView name = label(title, 14, INK);
        tile.setOnClickListener(view -> managePlaylist(contentId, title));
        name.setPadding(0, dp(6), 0, 0);
        name.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        tile.addView(name);
        TextView note = label(where, 12, INK);
        note.setAlpha(0.7f);
        note.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        tile.addView(note);
        playlistRow.addView(tile, new LinearLayout.LayoutParams(0, -2, 1));

        Bitmap cached = PlaylistWidgetArtwork.read(this, "c:" + contentId);
        if (cached != null) {
            cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
            cover.setImageBitmap(cached);
        }
    }

    /**
     * Whether this phone's launcher will take a pin request for a widget. Apex does not: it
     * ignores the request, so there the owner places the widget from Android Home and picks the
     * playlist in the widget's own chooser.
     */
    private boolean canPinWidgets() {
        Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
        android.content.pm.ResolveInfo launcher = getPackageManager().resolveActivity(home,
                android.content.pm.PackageManager.MATCH_DEFAULT_ONLY);
        String launcherPackage = launcher == null || launcher.activityInfo == null
                ? "" : launcher.activityInfo.packageName;
        AppWidgetManager manager = AppWidgetManager.getInstance(this);
        return !"com.anddoes.launcher".equals(launcherPackage) && manager != null
                && manager.isRequestPinAppWidgetSupported();
    }

    private void pinWidget(String contentId, String title) {
        AppWidgetManager manager = AppWidgetManager.getInstance(this);
        if (!canPinWidgets()) {
            showManualWidgetPlacement(title);
            return;
        }

        LauncherPlacement placement = beginPlacement(contentId, title, true);
        if (placement == null) {
            if (placementActive()) showManualWidgetPlacement(title);
            return;
        }
        try {
            if (manager.requestPinAppWidget(new ComponentName(this, ButtonWidgetProvider.class), null,
                    callback(placement))) {
                showWidgetHandoff(placement);
                return;
            }
        } catch (RuntimeException unavailable) {
            // A launcher can become unavailable between checking and requesting.
        }
        refused(placement);
        showManualWidgetPlacement(title);
    }

    private void showWidgetHandoff(LauncherPlacement request) {
        AlertDialog progress = new AlertDialog.Builder(this).setTitle(request.title)
                .setMessage("Confirm placement in Android.")
                .setNegativeButton("Close", null)
                .setNeutralButton("Place manually", (dialog, which) -> showManualWidgetPlacement(request.title))
                .show();
        Runnable check = new Runnable() {
            @Override public void run() {
                if (!progress.isShowing() || isFinishing() || isDestroyed()) return;
                LauncherPlacement current = placements.get(request.requestId);
                LauncherPlacement.Status status = current == null ? LauncherPlacement.Status.REFUSED
                        : current.status(System.currentTimeMillis());
                switch (status) {
                    case ADDED:
                    case EXTRA_WIDGET:
                        progress.setMessage("Widget added to Android Home.");
                        progress.getButton(AlertDialog.BUTTON_NEUTRAL).setVisibility(View.GONE);
                        break;
                    case CONFIRM:
                        timer.postDelayed(this, 300);
                        break;
                    default:
                        progress.setMessage("Android did not confirm placement. Check Home before trying again, or choose Place manually.");
                }
            }
        };
        progress.setOnDismissListener(dialog -> timer.removeCallbacks(check));
        timer.post(check);
    }

    /** The real steps, for a launcher that cannot be asked to add the widget. */
    private void showManualWidgetPlacement(String title) {
        Sheet sheet = new Sheet(this).heading("Put a playlist on Home",
                "Your launcher adds widgets itself, so it takes three steps there.");
        sheet.step(1, "Touch and hold an empty spot on your home screen.")
                .step(2, "Open Widgets and drag Daylight playlist onto the page.")
                .step(3, title == null || title.isEmpty()
                        ? "Choose a playlist. You can search the whole list."
                        : "Choose " + title + ". You can search the whole list.")
                .button("Go to Home", Sheet.Style.PRIMARY, () -> startActivity(
                        new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)))
                .button("Not now", Sheet.Style.TONAL, () -> { })
                .show();
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

    /** A placement finished or was cleared: the item moves between "On your home screen" and "Available". */
    private void onPlacementChanged() {
        String now = placements.addedSignature();
        if (!now.equals(addedSeen) && tabsShown() && pageHost != null) {
            addedSeen = now;
            rebuildPage();
        }
        drawPlacement();
    }

    /** Redraw the current tab in place, with no slide. */
    private void rebuildPage() {
        if (pageHost == null) return;
        for (int i = pageHost.getChildCount() - 1; i >= 0; i--) pageHost.getChildAt(i).animate().cancel();
        pageHost.removeAllViews();
        page = buildPage();
        pageHost.addView(page);
    }

    private void drawPlacement() {
        if (!observingPlacement || placementPanel == null) return;
        timer.removeCallbacks(placementTimeout);
        placementPanel.removeAllViews();
        long now = System.currentTimeMillis();
        boolean active = false;
        List<LauncherPlacement> requests = placements.requests();
        requests.removeIf(request -> request.playlist);
        for (LauncherPlacement request : LauncherPlacement.visible(requests, now)) {
            LauncherPlacement.Status status = request.status(now);
            // A finished placement is shown by where the item sits (On your home screen), not a banner.
            if (status == LauncherPlacement.Status.ADDED) continue;
            if (status == LauncherPlacement.Status.CONFIRM) {
                active = true;
                timer.postDelayed(placementTimeout, Math.max(1, request.startedAt + LauncherPlacement.TIMEOUT_MS - now));
            }
            addPlacementStatus(request, status);
        }
        updateSetupAvailability(active);
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
            default: message = "Added to your home screen";
        }
        boolean problem = status == LauncherPlacement.Status.UNCONFIRMED || status == LauncherPlacement.Status.REFUSED
                || status == LauncherPlacement.Status.EXTRA_WIDGET;
        // A banner, not a loose line: a check on good news, an amber card for anything to act on.
        LinearLayout banner = new LinearLayout(this);
        banner.setOrientation(LinearLayout.VERTICAL);
        banner.setPadding(dp(16), dp(12), dp(16), dp(12));
        banner.setBackground(PlaylistPicker.round(problem ? 0xfffff1d6 : PlaylistPicker.COLOR_CHIP, 16, this));
        TextView headline = PlaylistPicker.text(this, (problem ? "" : "✓  ") + request.title, 15, INK, true);
        banner.addView(headline);
        TextView detail = PlaylistPicker.text(this, message, 14, INK, false);
        detail.setAlpha(0.85f);
        banner.addView(detail);
        if (status == LauncherPlacement.Status.UNCONFIRMED || status == LauncherPlacement.Status.REFUSED) {
            TextView retry = PlaylistPicker.text(this, "Tap the item below to retry, or check your launcher's shortcuts.", 13, INK, false);
            retry.setAlpha(0.7f);
            banner.addView(retry);
        }
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.bottomMargin = dp(10);
        placementPanel.addView(banner, params);
    }

    private void updateSetupAvailability(boolean busy) {
        for (View row : setupRows) {
            row.setEnabled(!busy);
            row.setAlpha(busy ? 0.5f : 1f);
        }
    }

    private int drawable(String name) {
        int found = getResources().getIdentifier("ic_action_" + name, "drawable", getPackageName());
        return found == 0 ? android.R.drawable.ic_menu_view : found;
    }

    private void section(String name) {
        buttonRow = null;
        TextView heading = label(name, 18, INK);
        heading.setPadding(0, dp(10), 0, dp(2));
        column.addView(heading);
    }

    private void row(String name, String action, String glyph, String indicator, Runnable click) {
        LinearLayout line = new LinearLayout(this);
        line.setGravity(Gravity.CENTER_VERTICAL);
        line.setMinimumHeight(dp(48));
        line.setPaddingRelative(dp(8), dp(4), dp(8), dp(4));
        line.setBackground(new RippleDrawable(ColorStateList.valueOf(0x30125b47),
                round(Color.WHITE, 10), null));
        line.setOnClickListener(v -> click.run());
        line.setFocusable(true);
        line.setContentDescription(action.equals(name) ? name : action + ", " + name);
        line.setAccessibilityDelegate(new View.AccessibilityDelegate() {
            @Override public void onInitializeAccessibilityNodeInfo(View host, AccessibilityNodeInfo info) {
                super.onInitializeAccessibilityNodeInfo(host, info);
                info.setClassName(Button.class.getName());
            }
        });

        ImageView icon = new ImageView(this);
        icon.setBackground(round(GREEN, 8));
        icon.setPadding(dp(6), dp(6), dp(6), dp(6));
        icon.setImageResource(drawable(glyph));
        icon.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        line.addView(icon, dp(24), dp(24));

        TextView heading = label(name, 14, INK);
        heading.setPaddingRelative(dp(6), 0, dp(4), 0);
        heading.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        line.addView(heading, new LinearLayout.LayoutParams(0, -2, 1));

        TextView cue = label(indicator, 20, GREEN);
        cue.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        line.addView(cue);

        if (buttonRow == null || buttonRow.getChildCount() == 2) {
            buttonRow = new LinearLayout(this);
            buttonRow.setWeightSum(2);
            LinearLayout.LayoutParams rowParams = new LinearLayout.LayoutParams(-1, -2);
            rowParams.topMargin = dp(4);
            column.addView(buttonRow, rowParams);
        }
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(0, -1, 1);
        if (buttonRow.getChildCount() == 0) buttonParams.setMarginEnd(dp(6));
        buttonRow.addView(line, buttonParams);
        if (placementPanel != null) setupRows.add(line);
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

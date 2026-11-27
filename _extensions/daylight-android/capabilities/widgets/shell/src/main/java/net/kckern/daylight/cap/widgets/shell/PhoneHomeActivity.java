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
import android.graphics.Bitmap;
import net.kckern.daylight.shellkit.ThemeColors;
import net.kckern.daylight.shellkit.UiTelemetry;
import net.kckern.daylight.shellkit.NowPlayingNote;
import net.kckern.daylight.shellkit.PlaylistArtwork;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.DecelerateInterpolator;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.*;

import net.kckern.daylight.api.PayloadPort;
import net.kckern.daylight.shellkit.DaylightTheme;
import net.kckern.daylight.shellkit.DaylightTheme.Radius;
import net.kckern.daylight.shellkit.DaylightTheme.Type;
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
    private static final String NOW_PLAYING = "net.kckern.daylight.cap.mediaservice.shell.NowPlayingActivity";
    private final net.kckern.daylight.shellkit.TapGuard playGuard = new net.kckern.daylight.shellkit.TapGuard();
    // Bookmarks, actions, Continue and the screens list are asked at once, not one behind another.
    private final ExecutorService worker = Executors.newFixedThreadPool(4);
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
    /** The Services (bookmarks) and Capture (actions) answers: until each comes only its tab says it is loading. */
    private boolean pagesLoaded, actionsLoaded;
    private String pagesError, actionsError;
    /** A wait for the payload to attach, after which the failed loads run again on their own. */
    private boolean retryArmed;
    private boolean launcherPicker;
    private DaylightTheme t;

    @Override protected void attachBaseContext(android.content.Context base) {
        super.attachBaseContext(DaylightTheme.wrap(base));
    }

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        // Covers of collections kept on this phone show offline (media-service saves them).
        net.kckern.daylight.shellkit.PlaylistArtwork.useKept(new java.io.File(getFilesDir(), "kept-art"));
        net.kckern.daylight.shellkit.UiTelemetry.install(this);
        t = DaylightTheme.of(this);
        launcherPicker = Intent.ACTION_CREATE_SHORTCUT.equals(getIntent().getAction());
        if (launcherPicker) setResult(RESULT_CANCELED);
        placements = new PlacementStore(this);
        swipe = makeSwipe();
        addedSeen = placements.addedSignature();
        getWindow().setStatusBarColor(t.background);
        getWindow().setNavigationBarColor(t.background);
        // Dark bar icons on the light page; the system's light icons on the dark one.
        getWindow().getDecorView().setSystemUiVisibility(t.dark ? 0 : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        ShellStart.ensure(this);
        draw();
        refresh();
    }

    @Override protected void onStart() {
        super.onStart();
        // Opened: kept downloads catch up (after an update, a reboot), kept lists re-sync online.
        keepJob("resync-open", "");
        if (mini != null) mini.start();
        if (keptBox != null) fillKept();   // a collection kept from Now playing shows on return (in place)
        if (continueBox != null && continueBox.getParent() != null) {
            // Redrawn from the last answer (the offline marks follow the network now), then asked
            // again: a book marked finished or hidden elsewhere leaves at once, not minutes later.
            loadContinue(continueBox);
        }
        if (!launcherPicker) {
            observingPlacement = true;
            placements.prefs.registerOnSharedPreferenceChangeListener(placementChanged);
            drawPlacement();
        }
    }

    @Override protected void onStop() {
        if (mini != null) mini.stop();
        observingPlacement = false;
        placements.prefs.unregisterOnSharedPreferenceChangeListener(placementChanged);
        timer.removeCallbacks(placementTimeout);
        timer.removeCallbacks(keptTick);
        super.onStop();
    }

    @Override protected void onDestroy() {
        if (mini != null) mini.release();
        worker.shutdownNow();
        artworkWorker.shutdownNow();
        super.onDestroy();
    }

    private interface Reply { void accept(JSONObject reply); }

    private void call(String port, String body, Reply success) {
        call(port, body, success, this::toast);
    }

    /**
     * Asks the payload on {@code port}. A cold start is waited for as long as the loader
     * gives a payload to start (PayloadReady), never dropped after a shorter timer; the
     * failure words are "Starting Daylight…" while it still starts, or the loader's own.
     */
    private void call(String port, String body, Reply success, java.util.function.Consumer<String> failure) {
        // The service is on demand: Android stops it after a while in the background, so a screen
        // left open can come back to no payload. Start it again before asking.
        ShellStart.ensure(this);
        worker.execute(() -> {
            try {
                net.kckern.daylight.shellkit.PayloadReady.Answer ready = net.kckern.daylight.shellkit.PayloadReady.await(port);
                if (!ready.ready()) {
                    runOnUiThread(() -> { if (!isDestroyed() && !isFinishing()) failure.accept(ready.words()); });
                    return;
                }
                JSONObject result = new JSONObject(PayloadPort.named(port).call(body, 1000));
                runOnUiThread(() -> { if (!isDestroyed() && !isFinishing()) success.accept(result); });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    if (isDestroyed() || isFinishing()) return;
                    String message = e instanceof PayloadPort.NotReadyException ? net.kckern.daylight.shellkit.PayloadReady.STARTING : e.getMessage();
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

    /**
     * Asks for the bookmarks (Services) and the actions (Capture), both at once. The tabs, Play
     * and Connect are drawn before either answers; only the tab whose answer it is redraws.
     * A load that could not run (Daylight still starting) runs again on its own the moment
     * the payload attaches: there is no Try again to press.
     */
    private void refresh() {
        if (!pagesLoaded) pagesError = null;
        if (!actionsLoaded) actionsError = null;
        call("phone-bookmarks", request("list").toString(), result -> {
            pages = result.optJSONArray("items");
            if (pages == null) pages = new JSONArray();
            pagesLoaded = true;
            pagesError = null;
            answered(0);
        }, message -> { pagesError = message; answered(0); retryWhenAttached("phone-bookmarks"); });
        call("phone-pin-action", "", actions -> {
            configuredActions = actions.optJSONArray("items");
            if (configuredActions == null) configuredActions = new JSONArray();
            actionsLoaded = true;
            actionsError = null;
            answered(1);
        }, message -> { actionsError = message; answered(1); retryWhenAttached("phone-pin-action"); });
    }

    /** An answer for tab {@code which} came: that tab is redrawn when it is the one showing. */
    private void answered(int which) {
        if (launcherPicker) { rebuildPage(); return; }
        if (playlistScreen == null && tab == which) rebuildPage();
    }

    /** Waits (off the main thread) for the payload's port, then loads again. One wait at a time. */
    private void retryWhenAttached(String port) {
        if (retryArmed) return;
        retryArmed = true;
        new Thread(() -> {
            boolean attached = PayloadPort.named(port).awaitReady(10 * 60_000L);
            runOnUiThread(() -> {
                retryArmed = false;
                if (attached && !isDestroyed() && !isFinishing() && (!pagesLoaded || !actionsLoaded)) refresh();
            });
        }, "Daylight-home-retry").start();
    }

    private static final String[] TABS = HomeSections.NAMES;
    /** The section shown (HomeSections: 0 Services, 1 Capture, 2 Play, 3 Connect); a cold start opens on Play. */
    private int tab = HomeSections.first();
    /** Made in onCreate: a detector needs the activity's context, which does not exist yet at construction. */
    private android.view.GestureDetector swipe;

    private android.view.GestureDetector makeSwipe() {
        return new android.view.GestureDetector(this,
                new android.view.GestureDetector.SimpleOnGestureListener() {
                    @Override public boolean onFling(android.view.MotionEvent down, android.view.MotionEvent up, float vx, float vy) {
                        // A clear sideways flick on the tabs' page moves to the next or previous tab.
                        if (!tabsShown() || Math.abs(vx) < 900 || Math.abs(vx) < Math.abs(vy) * 1.8f) return false;
                        // The neighbour in the bar's order (Play, Capture, Connect, Services).
                        selectTab(HomeSections.step(tab, vx < 0 ? 1 : -1), vx < 0 ? 1 : -1);
                        return false;
                    }
                });
    }

    private boolean tabsShown() {
        return !launcherPicker && playlistScreen == null;
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
        tab = HomeSections.restored(state.getInt("tab", HomeSections.first()));
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
        fillTopBar();
        if (tabs != null) tabs.announceForAccessibility(TABS[tab]);
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

    /**
     * The bottom navigation bar (design sweep D2, Material 3's NavigationBar built from plain
     * views): Play, Capture, Connect, Services, each an icon and its name. The selected one is
     * ink with a soft indicator behind its icon; the others are muted. No fills, no accent.
     */
    private void fillTabs() {
        tabs.removeAllViews();
        for (int section : HomeSections.ORDER) {
            boolean selected = section == tab;
            LinearLayout item = new LinearLayout(this);
            item.setOrientation(LinearLayout.VERTICAL);
            item.setGravity(Gravity.CENTER);
            item.setPadding(0, dp(12), 0, dp(16));
            android.widget.FrameLayout pill = new android.widget.FrameLayout(this);
            if (selected) pill.setBackground(DaylightTheme.round(t.surfaceVariant, dp(16)));
            ImageView icon = new ImageView(this);
            icon.setImageResource(navIcon(section));
            icon.setImageTintList(android.content.res.ColorStateList.valueOf(selected ? t.ink : t.inkMuted));
            android.widget.FrameLayout.LayoutParams ilp = new android.widget.FrameLayout.LayoutParams(dp(24), dp(24), Gravity.CENTER);
            pill.addView(icon, ilp);
            item.addView(pill, new LinearLayout.LayoutParams(dp(64), dp(32)));
            TextView name = t.text(this, TABS[section], Type.LABEL, selected ? t.ink : t.inkMuted, selected);
            name.setGravity(Gravity.CENTER);
            name.setPadding(0, dp(4), 0, 0);
            item.addView(name);
            item.setBackground(t.pressable(null));
            item.setContentDescription(HomeSections.spoken(section, selected));
            item.setSelected(selected);
            item.setOnClickListener(v -> selectTab(section, HomeSections.position(section) > HomeSections.position(tab) ? 1 : -1));
            net.kckern.daylight.shellkit.UiTelemetry.tag(item, "home.nav." + TABS[section].toLowerCase(java.util.Locale.ROOT));
            tabs.addView(item, new LinearLayout.LayoutParams(0, -2, 1));
        }
    }

    private static int navIcon(int section) {
        switch (section) {
            case HomeSections.PLAY: return R.drawable.daylight_nav_play;
            case HomeSections.CAPTURE: return R.drawable.daylight_nav_capture;
            case HomeSections.CONNECT: return R.drawable.daylight_nav_connect;
            default: return R.drawable.daylight_nav_services;
        }
    }

    private LinearLayout topBar;

    /** The top bar: the section's name on the left, its actions on the right (Play: Search). */
    private void fillTopBar() {
        if (topBar == null) return;
        topBar.removeAllViews();
        TextView name = t.text(this, launcherPicker ? "Choose a shortcut" : TABS[tab], Type.TITLE, t.ink, true);
        name.setAccessibilityHeading(true);
        if (!launcherPicker) {
            // The section's icon before its name (spec §13): the bottom bar's, 24 dp, muted.
            ImageView icon = new ImageView(this);
            icon.setImageResource(navIcon(tab));
            icon.setImageTintList(android.content.res.ColorStateList.valueOf(t.inkMuted));
            icon.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
            LinearLayout.LayoutParams ip = new LinearLayout.LayoutParams(dp(24), dp(24));
            ip.setMarginEnd(dp(12));
            topBar.addView(icon, ip);
        }
        topBar.addView(name, new LinearLayout.LayoutParams(0, -2, 1));
        if (!launcherPicker && tab == HomeSections.PLAY && getPackageManager().resolveActivity(new Intent().setClassName(this, BROWSE), 0) != null) {
            android.widget.ImageButton search = new android.widget.ImageButton(this);
            search.setImageResource(R.drawable.daylight_nav_search);
            search.setImageTintList(android.content.res.ColorStateList.valueOf(t.ink));
            search.setBackground(t.pressable(DaylightTheme.round(0x00000000, dp(24))));
            search.setContentDescription("Search");
            search.setTooltipText("Search");
            search.setOnClickListener(v -> openBrowse("search"));
            net.kckern.daylight.shellkit.UiTelemetry.tag(search, "play.search");
            topBar.addView(search, new LinearLayout.LayoutParams(dp(48), dp(48)));
        }
    }

    private void draw() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(t.background);
        // No "Daylight" header (design sweep D3): the top bar names the section and holds its actions.
        topBar = new LinearLayout(this);
        topBar.setGravity(Gravity.CENTER_VERTICAL);
        topBar.setPadding(dp(16), dp(8), dp(4), dp(4));
        topBar.setMinimumHeight(dp(56));
        root.addView(topBar, new LinearLayout.LayoutParams(-1, -2));
        fillTopBar();
        tabs = null;
        pageHost = new android.widget.FrameLayout(this);
        pageHost.setBackgroundColor(t.background);
        root.addView(pageHost, new LinearLayout.LayoutParams(-1, 0, 1));
        if (!launcherPicker) {
            // The one mini player (shell-kit MiniPlayer), the same on every browse screen.
            if (mini == null) mini = net.kckern.daylight.shellkit.MiniPlayer.attach(this, "Home");
            View bar = mini.view();
            if (bar.getParent() instanceof ViewGroup) ((ViewGroup) bar.getParent()).removeView(bar);
            root.addView(bar, new LinearLayout.LayoutParams(-1, -2));
        }
        if (tabsShown()) {
            // The bottom navigation bar, under the mini player; it stays when the mini player slides away.
            tabs = new LinearLayout(this);
            tabs.setBackgroundColor(t.surface);
            fillTabs();
            root.addView(tabs, new LinearLayout.LayoutParams(-1, -2));
        }
        setContentView(root);
        page = buildPage();
        pageHost.addView(page);
    }

    private net.kckern.daylight.shellkit.MiniPlayer mini;

    /** One page: the section the selected tab names, in its own scrolling view. */
    private ScrollView buildPage() {
        setupRows.clear();
        buttonRow = null;
        placementPanel = null;
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(t.background);
        column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setPadding(dp(16), dp(8), dp(16), dp(16));
        scroll.addView(column);
        // Services and Capture wait for their own answer; Play and Connect draw from this phone at once.
        boolean needsPages = launcherPicker || tab == 0, needsActions = launcherPicker || tab == 1;
        if ((needsPages && !pagesLoaded) || (needsActions && !actionsLoaded)) {
            String error = needsPages && !pagesLoaded ? pagesError : actionsError;
            String what = launcherPicker ? "shortcuts" : tab == 0 ? "services" : "capture shortcuts";
            column.addView(label(error != null ? error : "Loading " + what + "…", Type.BODY, t.ink));
            if (error != null && !error.equals(net.kckern.daylight.shellkit.PayloadReady.STARTING)) {
                row("Try again", "Try again", "open", "›", this::refresh);
            } else if (error != null) {
                column.addView(label("They show here once started up.", Type.LABEL, t.inkMuted));
            }
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
        // The one line of explanation the header used to give every tab: true of Services only.
        TextView why = label("Pages of the household site. Tap + to add one to your Android home screen.", Type.BODY, t.inkMuted);
        why.setPadding(0, dp(4), 0, dp(8));
        column.addView(why);
        List<JSONObject> items = new ArrayList<>();
        for (int i = 0; i < pages.length(); i++) {
            JSONObject page = pages.optJSONObject(i);
            if (page != null) items.add(page);
        }
        addGrouped(items, page -> () -> pinPage(page));
    }

    private static final String CAPTURE_STATUS = "net.kckern.daylight.cap.quickinput.shell.CaptureStatusActivity";

    /**
     * Capture status, reachable from the Capture tab (audit H16: the confirmation pointed to
     * a screen nothing opened), with its counts: "1 needs attention · 2 waiting to send · 3
     * sent". The counts are the payload's capture rows for the bound account (quick-input's
     * CaptureScope, by name: widgets does not link quick-input).
     */
    private void addCaptureStatus() {
        if (getPackageManager().resolveActivity(new Intent().setClassName(this, CAPTURE_STATUS), 0) == null) return;
        TextView counts = flatRow("Capture status", "Checking your captures…", "open", "›", () -> {
            Intent open = new Intent().setClassName(this, CAPTURE_STATUS);
            String owner = captureOwner();
            if (owner != null) open.putExtra("capture-owner", owner);
            try { startActivity(open); } catch (RuntimeException absent) { toast("Capture status is not in this build"); }
        });
        if (counts == null) return;
        worker.execute(() -> {
            String line;
            String owner = captureOwner();
            if (owner == null) {
                line = "Quick inputs aren't set up on this phone yet";
            } else {
                try {
                    JSONObject reply = new JSONObject(net.kckern.daylight.api.PayloadPort.named("inputs")
                            .call(new JSONObject().put("op", "status").put("owner", owner).toString(), 4_000));
                    line = reply.optBoolean("ok") ? CaptureCounts.line(reply.optJSONArray("inputs")) : "Open to see your captures";
                } catch (Exception notNow) {
                    line = net.kckern.daylight.shellkit.PayloadReady.now("inputs").ready()
                            ? "Open to see your captures" : net.kckern.daylight.shellkit.PayloadReady.STARTING;
                }
            }
            String shown = line;
            runOnUiThread(() -> counts.setText(shown));
        });
    }

    /** The bound capture account (quick-input's CaptureScope.current()), or null. */
    private static String captureOwner() {
        try {
            Object k = Class.forName("net.kckern.daylight.cap.quickinput.shell.CaptureScope").getMethod("current").invoke(null);
            return k instanceof String ? (String) k : null;
        } catch (ReflectiveOperationException | RuntimeException absent) { return null; }
    }

    private void addCapture() {
        if (!launcherPicker) addCaptureStatus();
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


    private static final String BROWSE = "net.kckern.daylight.cap.mediaservice.shell.BrowseActivity";

    /** The search field at the top of the Play tab: a fixed-height box that opens the search. */
    private void openBrowse(String mode) {
        try { startActivity(new Intent().setClassName(this, BROWSE).putExtra("mode", mode)); }
        catch (RuntimeException absent) { toast("Not available in this build"); }
    }

    private void addPlay() {
        // The player screen is media-service's (installed code in another capability), so
        // it is named, and offered only in a build that has it.
        Intent nowPlaying = new Intent().setClassName(this, NOW_PLAYING);
        boolean player = getPackageManager().resolveActivity(nowPlaying, 0) != null;
        // Not a library to browse: what this phone is in the middle of, and the playlists
        // already chosen (Drive, widgets, Driving Radio), each one tap from playing here.
        if (player) {
            LinearLayout continuing = new LinearLayout(this);
            continuing.setOrientation(LinearLayout.VERTICAL);
            column.addView(continuing);
            continueBox = continuing;
            loadContinue(continuing);
            addKept();
            java.util.List<DrivingRadioSettings.Staple> mine = new DrivingRadioSettings(this).staged();
            if (!mine.isEmpty()) {
                section("Your playlists");
                playlistTiles(mine);
            }
            flatRow("Browse library", "Audiobooks, music, playlists, talks", "play", "›", () -> openBrowse("library"));
            section("Player");
            flatRow("Now playing", "Control this phone or a screen", "play", "›", () -> {
                // What plays now, where: Now playing opens on it (and draws it at once) rather than the last target.
                Intent open = new Intent(nowPlaying).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                NowPlayingNote.Entry e = NowPlayingNote.current();
                if (e != null) open.putExtra("target", e.target).putExtra("targetName", e.targetName);
                startActivity(open);
            });
        }
        flatRow("Drive playlists", "The playlists on the car's Drive tab", "play", "›", this::showMediaChoices);
        flatRow("Driving Radio", "Set the default and day rules", "play", "›", this::showDrivingRadio);
        if (!canPinWidgets()) {
            flatRow("Widget on Home", "How to put a playlist on your home screen", "open", "›",
                    () -> showManualWidgetPlacement(null));
        }
    }

    /**
     * "On this phone": the collections kept for listening without a network (media-service's
     * downloads, read from shell-kit's KeptIndex), with how far each download is and the room
     * they take against the cap. A tap plays a collection here. Redrawn every few seconds
     * while something is still downloading.
     */
    private LinearLayout keptBox, continueBox;
    private final Runnable keptTick = this::fillKept;

    private void addKept() {
        keptBox = new LinearLayout(this);
        keptBox.setOrientation(LinearLayout.VERTICAL);
        column.addView(keptBox);
        keptHead = null;
        keptShown = null;
        fillKept();
    }

    /** The parts of "On this phone" a refresh updates in place. */
    private LinearLayout keptHead, keptCards;
    private TextView keptRoom, keptOver;
    private net.kckern.daylight.shellkit.KeyedRows<JSONObject> keptRows;
    /** What the section shows now (the index and the room line): the same again redraws nothing. */
    private String keptShown;

    /**
     * Refreshes "On this phone" in place: the heading and room line keep their views, cards
     * are kept by content id and only their words, progress and Retry change, and an index
     * equal to the one shown touches nothing. A press on a card survives the refresh.
     */
    private void fillKept() {
        timer.removeCallbacks(keptTick);
        if (keptBox == null || keptBox.getParent() == null || isFinishing()) return;
        java.util.List<JSONObject> index = net.kckern.daylight.shellkit.KeptIndex.read(getFilesDir());
        long cap = net.kckern.daylight.shellkit.KeptIndex.capMb(getFilesDir());
        long used = net.kckern.daylight.shellkit.KeptIndex.usedBytes(index);
        long free = freeOnPhone();
        // "1.2 GB kept · 4 GB limit · 15 GB free on phone": room visible before it is a problem.
        String room = net.kckern.daylight.shellkit.KeptIndex.roomLine(used, cap, free);
        String over = net.kckern.daylight.shellkit.KeptIndex.overLine(
                net.kckern.daylight.shellkit.KeptIndex.effectiveLimitBytes(cap, free, used), used);
        net.kckern.daylight.shellkit.KeptIndex.largestFirst(index);
        boolean busy = false;
        for (JSONObject k : index) if (net.kckern.daylight.shellkit.KeptIndex.changing(k.optString("state"))) busy = true;
        // The first three blocks (a kept artist or author is one block, its first units under
        // it; spec §3.11); the rest on On this phone.
        java.util.List<JSONObject> first = net.kckern.daylight.shellkit.KeptGroups.firstBlocks(
                net.kckern.daylight.shellkit.KeptGroups.rows(index), 3, 3);
        // Moving, checking, queued or removing: refreshed every 3 s; waiting: every 30 s (a network or room may come).
        if (busy) timer.postDelayed(keptTick, 3000);
        else if (!index.isEmpty()) timer.postDelayed(keptTick, 30_000);
        String shown = first + "|" + room + "|" + over + "|" + index.isEmpty();
        if (shown.equals(keptShown)) return;
        keptShown = shown;
        if (index.isEmpty()) {
            keptBox.removeAllViews();
            keptHead = null;
            return;
        }
        if (keptHead == null) {
            keptBox.removeAllViews();
            keptHead = new LinearLayout(this);
            keptHead.setOrientation(LinearLayout.VERTICAL);
            TextView heading = label("On this phone", Type.TITLE, t.ink);
            heading.setPadding(0, dp(10), 0, dp(2));
            keptHead.addView(heading);
            keptRoom = label("", Type.LABEL, t.inkMuted);
            keptHead.addView(keptRoom);
            keptOver = label("", Type.LABEL, t.attention);
            keptHead.addView(keptOver);
            keptBox.addView(keptHead);
            keptCards = new LinearLayout(this);
            keptCards.setOrientation(LinearLayout.VERTICAL);
            keptBox.addView(keptCards);
            keptRows = new net.kckern.daylight.shellkit.KeyedRows<>(keptCards, new net.kckern.daylight.shellkit.KeyedRows.Rows<JSONObject>() {
                @Override public String key(JSONObject k) { return net.kckern.daylight.shellkit.KeptGroups.key(k); }
                @Override public String signature(JSONObject k) { return k.toString(); }
                @Override public View create(JSONObject k) { return keptCard(k); }
                @Override public View update(View card, JSONObject k) { bindKeptCard(card, k); return card; }
            });
            TextView manage = label("Manage downloads ›", Type.LABEL, t.inkMuted);
            manage.setPadding(dp(4), dp(10), dp(4), dp(6));
            manage.setContentDescription("Manage downloads: everything kept on this phone");
            net.kckern.daylight.shellkit.UiTelemetry.tag(manage, "play.kept.manage");
            manage.setOnClickListener(v -> openDownloads(null));
            keptBox.addView(manage);
        }
        keptRoom.setText(room);
        keptOver.setText(over);
        keptOver.setVisibility(over.isEmpty() ? View.GONE : View.VISIBLE);
        keptRows.show(first);
    }

    /** A kept card's views, so a refresh changes its words and buttons without a new view. */
    private static final class KeptCard {
        ImageView cover;
        TextView name, sub, retry, side;
    }

    private static boolean keptGroupRow(JSONObject k) {
        return net.kckern.daylight.shellkit.KeptGroups.GROUP.equals(k.optString(net.kckern.daylight.shellkit.KeptGroups.ROW));
    }

    private static boolean keptUnitRow(JSONObject k) {
        return net.kckern.daylight.shellkit.KeptGroups.UNIT.equals(k.optString(net.kckern.daylight.shellkit.KeptGroups.ROW));
    }

    /** A kept group's ⋮: Choose… (its sheet, on On this phone) and Remove all of <name> (confirmed). */
    private void keptGroupMenu(View anchor, JSONObject g) {
        JSONObject grp = g.optJSONObject("group");
        String gid = grp == null ? "" : grp.optString("id"), title = g.optString("title");
        net.kckern.daylight.shellkit.ItemSheet.of(this, "Home")
                .heading(title, net.kckern.daylight.shellkit.KeptGroups.line(g))
                .row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_tune, "Choose…", () -> {
                    Intent i = new Intent().setClassName(this, DOWNLOADS).putExtra("choose", gid)
                            .putExtra("chooseKind", g.optString("kind")).putExtra("chooseTitle", title);
                    try { startActivity(i); } catch (RuntimeException absent) { toast("Downloads are not in this build"); }
                })
                .destructive(net.kckern.daylight.shellkit.R.drawable.daylight_ic_delete, "Remove all of " + title, () ->
                    new AlertDialog.Builder(this, DaylightTheme.alert()).setTitle("Remove all of " + title + "?")
                            .setMessage(net.kckern.daylight.shellkit.KeptGroups.line(g) + ". Anything also kept on its own stays.")
                            .setPositiveButton("Remove", (dlg, w) -> { keepJob("group-remove", gid); toast("Removing " + title); })
                            .setNegativeButton("Cancel", null).show())
                .show();
    }

    private View keptCard(JSONObject k) {
        KeptCard h = new KeptCard();
        LinearLayout card = new LinearLayout(this);
        card.setGravity(Gravity.CENTER_VERTICAL);
        card.setMinimumHeight(dp(72));
        card.setPadding(0, dp(8), 0, dp(8));
        card.setBackground(t.pressable(null));
        h.cover = new ImageView(this);
        h.cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
        net.kckern.daylight.shellkit.CoverGlyph.behind(h.cover, t, net.kckern.daylight.shellkit.CoverGlyph.Kind.ALBUM, dp(56), t.radius(Radius.SMALL));
        card.addView(h.cover, new LinearLayout.LayoutParams(dp(56), dp(56)));
        LinearLayout words = new LinearLayout(this);
        words.setOrientation(LinearLayout.VERTICAL);
        words.setPadding(dp(12), 0, 0, 0);
        h.name = t.text(this, "", Type.BODY, t.ink, true);
        h.name.setMaxLines(2);
        h.name.setEllipsize(android.text.TextUtils.TruncateAt.END);
        words.addView(h.name);
        h.sub = label("", Type.LABEL, t.inkMuted);
        h.sub.setMaxLines(1);
        h.sub.setEllipsize(android.text.TextUtils.TruncateAt.END);
        words.addView(h.sub);
        card.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
        // A group's ⋮, or a unit's Remove (an icon button); none on a lone item.
        h.side = label("", Type.TITLE, t.inkMuted);
        h.side.setGravity(Gravity.CENTER);
        h.side.setMinWidth(dp(48));
        h.side.setMinHeight(dp(48));
        h.side.setBackground(t.pressable(null));
        h.retry = label("Retry", Type.LABEL, t.ink);
        h.retry.setPadding(dp(12), dp(10), dp(4), dp(10));
        net.kckern.daylight.shellkit.UiTelemetry.tag(h.retry, "play.kept.retry");
        card.addView(h.retry);
        card.addView(h.side);
        net.kckern.daylight.shellkit.UiTelemetry.tag(card, "play.kept");
        // Long-press: the item sheet (Open on this phone, Remove).
        card.setOnLongClickListener(v -> {
            JSONObject k2 = (JSONObject) card.getTag(R.id.daylight_home_kept);
            if (k2 == null) { openDownloads(null); return true; }
            return keepMenu(card, "c:" + k2.optString("contentId"), k2.optString("contentId"), k2.optString("kind", "album"), k2.optString("title"), k2.optString("art"));
        });
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.topMargin = dp(6);
        card.setLayoutParams(lp);
        card.setTag(h);
        bindKeptCard(card, k);
        return card;
    }

    /** Puts one kept collection's words, cover, Retry and tap on its card (new or refreshed). */
    private void bindKeptCard(View card, JSONObject k) {
        KeptCard h = (KeptCard) card.getTag();
        card.setTag(R.id.daylight_home_kept, k);
        String title = k.optString("title");
        boolean group = keptGroupRow(k), unit = keptUnitRow(k);
        String line = group ? net.kckern.daylight.shellkit.KeptGroups.line(k) : net.kckern.daylight.shellkit.KeptIndex.describe(k);
        String cid = k.optString("contentId");
        card.setPadding(unit ? dp(28) : dp(8), dp(8), dp(4), dp(8));
        h.side.setVisibility(group || unit ? View.VISIBLE : View.GONE);
        if (group) {
            h.side.setText("⋮");
            h.side.setContentDescription("More for " + title);
            h.side.setOnClickListener(v -> keptGroupMenu(v, k));
        } else if (unit) {
            h.side.setText("✕");
            h.side.setContentDescription("Remove " + title);
            h.side.setOnClickListener(v -> new AlertDialog.Builder(this, DaylightTheme.alert()).setTitle("Remove " + title + "?")
                    .setMessage("The rest of the group stays, and it is not kept again by itself.")
                    .setPositiveButton("Remove", (d, w) -> { keepJob("unit-remove", cid); toast("Removing " + title); })
                    .setNegativeButton("Cancel", null).show());
        }
        h.name.setText(title);
        h.sub.setText(line);
        loadCover(h.cover, k.optString("art"));
        boolean retryable = net.kckern.daylight.shellkit.KeptIndex.retryable(k);
        h.retry.setVisibility(retryable ? View.VISIBLE : View.GONE);
        h.retry.setContentDescription("Retry " + title);
        h.retry.setOnClickListener(v -> { keepJob("retry", cid); toast("Trying again"); });
        card.setContentDescription(title + ". " + line);
        String id = "c:" + cid;
        // A group opens On this phone, where its units are; a part-kept collection plays too:
        // online it streams the rest; offline, what is here.
        if (group) card.setOnClickListener(v -> openDownloads(null));
        else if (k.optInt("total") > 0) card.setOnClickListener(v -> playHere(id, title, "", k.optString("art"), false));
        else card.setOnClickListener(v -> toast(line));
    }

    /**
     * Whether this phone has a network that reaches the internet now. ACCESS_NETWORK_STATE
     * comes from the base shell; without it this answers true (nothing is dimmed).
     */
    @android.annotation.SuppressLint("MissingPermission")
    private boolean online() {
        try {
            android.net.ConnectivityManager cm = getSystemService(android.net.ConnectivityManager.class);
            android.net.NetworkCapabilities c = cm == null ? null : cm.getNetworkCapabilities(cm.getActiveNetwork());
            return c != null && c.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } catch (RuntimeException unknown) {
            return true;
        }
    }

    /**
     * Asks media-service's keeper (its KeepJob, so it runs whether or not the player is up)
     * to act on one kept collection. The job id is KeepJob.actionId's: one per action and
     * item, so two quick taps on two items are two jobs.
     */
    private void keepJob(String what, String contentId) {
        try {
            android.app.job.JobScheduler js = getSystemService(android.app.job.JobScheduler.class);
            android.os.PersistableBundle extras = new android.os.PersistableBundle();
            extras.putString("action", what);
            extras.putString("contentId", contentId);
            extras.putString("mediaId", "");
            int id = KEEP_ACTION_BASE + Math.floorMod((what + "|" + contentId).hashCode(), KEEP_ACTION_SLOTS);
            js.schedule(new android.app.job.JobInfo.Builder(id,
                    new android.content.ComponentName(getPackageName(), KEEP_JOB)).setOverrideDeadline(0).setExtras(extras).build());
            timer.postDelayed(keptTick, 1500);
        } catch (RuntimeException notScheduled) {
            toast("Could not do that now");
        }
    }

    /** On this phone (media-service's screen; widgets does not link media-service). {@code keepMediaId}: Keep this first. */
    private void openDownloads(String keepMediaId) {
        Intent i = new Intent().setClassName(this, DOWNLOADS);
        if (keepMediaId != null) i.putExtra("keep", keepMediaId);
        try { startActivity(i); } catch (RuntimeException absent) { toast("Downloads are not in this build"); }
    }

    /**
     * Keep, here: media-service's keep flow by name (widgets does not link it), with its inline
     * "Checking size of <title>… · Cancel"; On this phone opens only when the build lacks it.
     */
    private void keepHere(String mediaId, String title) {
        try {
            Class.forName("net.kckern.daylight.cap.mediaservice.shell.KeepEntry")
                    .getMethod("keep", android.app.Activity.class, String.class, String.class)
                    .invoke(null, this, mediaId, title == null ? "" : title);
        } catch (ReflectiveOperationException | RuntimeException older) {
            Intent i = new Intent().setClassName(this, DOWNLOADS).putExtra("keep", mediaId).putExtra("keepTitle", title);
            try { startActivity(i); } catch (RuntimeException absent) { toast("Downloads are not in this build"); }
        }
    }

    /** Long-press on something playable: Keep it on this phone, or see it there when it is kept. */
    private boolean keepMenu(View anchor, String mediaId, String contentId) {
        return keepMenu(anchor, mediaId, contentId, null, null, null);
    }

    /** Keep, or its state; and Open (the collection's page) when {@code openKind} is given: the item sheet (D17). */
    private boolean keepMenu(View anchor, String mediaId, String contentId, String openKind, String title, String art) {
        JSONObject kept = keptFor(contentId);
        net.kckern.daylight.shellkit.ItemSheet sheet = net.kckern.daylight.shellkit.ItemSheet.of(this, "Home")
                .item(art, net.kckern.daylight.shellkit.CoverGlyph.of(openKind), title == null ? "" : title, "",
                        kept == null ? "" : net.kckern.daylight.shellkit.KeptIndex.describe(kept));
        if (openKind != null && mediaId.startsWith("c:")) sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_open, "Open", () -> {
            net.kckern.daylight.shellkit.UiTelemetry.event("Browse", "browse.open_from_tile", new JSONObject());
            try {
                startActivity(new Intent().setClassName(this, BROWSE).putExtra("mode", "level").putExtra("parent", mediaId)
                        .putExtra("kind", openKind).putExtra("title", title == null ? "" : title).putExtra("art", art == null ? "" : art));
            } catch (RuntimeException absent) { toast("Not available in this build"); }
        });
        sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_play, "Play on this phone", () -> playHere(mediaId, title, "", art, false));
        if (kept == null) sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_download, "Keep on this phone",
                () -> keepHere(mediaId, title));
        else {
            sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_on_phone, "On this phone", net.kckern.daylight.shellkit.KeptIndex.describe(kept), () -> {
                net.kckern.daylight.shellkit.UiTelemetry.event("Downloads", "keep.screen", new JSONObject());
                openDownloads(null);
            });
            sheet.destructive(net.kckern.daylight.shellkit.R.drawable.daylight_ic_delete, "Remove from this phone", () -> keepJob("remove", contentId));
        }
        sheet.show();
        return true;
    }

    /** The kept collection holding {@code contentId} (itself or one of its tracks), or null. */
    private JSONObject keptFor(String contentId) {
        JSONObject kept = null;
        for (JSONObject k : net.kckern.daylight.shellkit.KeptIndex.read(getFilesDir())) {
            if (contentId.equals(k.optString("contentId"))) kept = k;
            org.json.JSONArray ids = k.optJSONArray("trackIds");
            for (int i = 0; ids != null && i < ids.length(); i++) if (contentId.equals(ids.optString(i))) kept = k;
        }
        return kept;
    }

    private long freeOnPhone() {
        try { return new android.os.StatFs(getFilesDir().getPath()).getAvailableBytes(); }
        catch (RuntimeException unknown) { return 0; }
    }

    /** media-service's KeepJob and its action ids (KeepJob.ACTION_BASE, ACTION_SLOTS). */
    private static final String KEEP_JOB = "net.kckern.daylight.cap.mediaservice.shell.KeepJob";
    private static final String DOWNLOADS = "net.kckern.daylight.cap.mediaservice.shell.DownloadsActivity";
    private static final int KEEP_ACTION_BASE = 7_300, KEEP_ACTION_SLOTS = 100;

    /**
     * Opens Now playing on this phone and starts {@code mediaId} there (p: resumes a track, c:
     * plays a list). Now playing shows the tapped item from its first frame and starts it on
     * its own controller (media-service's Starting extras, set by name: that class is another
     * capability's). Nothing sits over it: Back works at once.
     *
     * @param longItem a book or a talk: Now playing keeps its chapter line's place from the first frame
     */
    private void playHere(String mediaId, String title, String subtitle, String art, boolean longItem) {
        // A quick double tap on a card starts it once, with one Now playing.
        if (!playGuard.admit(mediaId, android.os.SystemClock.elapsedRealtime())) return;
        playGuard.done();   // Now playing takes it from here; only the window holds a repeat
        Intent now = new Intent().setClassName(this, NOW_PLAYING).putExtra("target", "local")
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra("starting.id", mediaId).putExtra("starting.title", title == null ? "" : title)
                .putExtra("starting.subtitle", subtitle == null ? "" : subtitle).putExtra("starting.art", art == null ? "" : art)
                .putExtra("starting.play", true).putExtra("starting.long", longItem);
        try { startActivity(now); }
        catch (RuntimeException absent) { toast("Not available in this build"); }
    }

    /**
     * "Continue listening": long audio this household started and did not finish (books,
     * courses, talks), newest first, from the payload's continue op. A tap resumes it here.
     * Nothing shows when there is nothing, or the payload cannot answer.
     */
    private void loadContinue(LinearLayout into) {
        // Drawn at once from the last answer, so the tab does not jump when the payload
        // answers; redrawn only when the answer is different (a book finished, a new one).
        android.content.SharedPreferences cache = getSharedPreferences("daylight.home", MODE_PRIVATE);
        String last = cache.getString("continue", "");
        fillContinue(into, last);
        String body;
        try { body = new JSONObject().put("op", "continue").put("limit", 6).toString(); }
        catch (Exception impossible) { return; }
        call("media", body, reply -> {
            org.json.JSONArray items = reply.optJSONArray("items");
            String now = items == null ? "[]" : items.toString();
            int review = Math.max(0, reply.optInt("reviewCount", 0));
            boolean reviewChanged = review != cache.getInt("continueReview", 0);
            if ((now.equals(last) && !reviewChanged) || into.getParent() == null) return;
            cache.edit().putString("continue", now).putInt("continueReview", review).apply();
            fillContinue(into, now);
        }, failure -> { /* nothing to continue is not an error; the last answer stays */ });
    }

    private void fillContinue(LinearLayout into, String json) {
        into.removeAllViews();
        org.json.JSONArray items;
        try { items = json == null || json.isEmpty() ? new org.json.JSONArray() : new org.json.JSONArray(json); }
        catch (Exception unreadable) { return; }
        if (items.length() == 0) return;
        TextView heading = label("Continue listening", Type.TITLE, t.ink);
        heading.setPadding(0, dp(10), 0, dp(4));
        into.addView(heading);
        // Older entries (from before listened time was counted) are not guessed: a one-time
        // row offers to review them; once opened it does not come back (§13).
        android.content.SharedPreferences cache = getSharedPreferences("daylight.home", MODE_PRIVATE);
        int review = cache.getInt("continueReview", 0);
        if (review > 0 && !cache.getBoolean("continueReviewOpened", false)) into.addView(reviewRow(review));
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item != null) into.addView(continueCard(item));
        }
    }

    private View continueCard(JSONObject item) {
        long played = item.optLong("playhead"), duration = item.optLong("duration");
        String title = item.optString("title"), sub = item.optString("subtitle");
        // A flat row (design sweep D4): cover, title, by-line, progress line; no box around it.
        LinearLayout card = new LinearLayout(this);
        card.setGravity(Gravity.CENTER_VERTICAL);
        card.setMinimumHeight(dp(72));
        card.setPadding(0, dp(8), 0, dp(8));
        card.setBackground(t.pressable(null));
        ImageView cover = new ImageView(this);
        cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
        net.kckern.daylight.shellkit.CoverGlyph.behind(cover, t, net.kckern.daylight.shellkit.CoverGlyph.Kind.BOOK, dp(56), t.radius(Radius.SMALL));
        card.addView(cover, new LinearLayout.LayoutParams(dp(56), dp(56)));
        loadCover(cover, item.optString("art"));
        LinearLayout words = new LinearLayout(this);
        words.setOrientation(LinearLayout.VERTICAL);
        words.setPadding(dp(12), 0, 0, 0);
        TextView name = t.text(this, title, Type.BODY, t.ink, true);
        name.setMaxLines(2);
        name.setEllipsize(android.text.TextUtils.TruncateAt.END);
        words.addView(name);
        String left = ContinueRow.progress(item);
        // Kept on this phone: marked, and the only cards that play with no network.
        boolean here = net.kckern.daylight.shellkit.KeptIndex.onPhone(
                net.kckern.daylight.shellkit.KeptIndex.read(getFilesDir()), item.optString("contentId"));
        boolean reachable = here || online();
        String said = !reachable ? "Needs a connection" : (here ? "On this phone · " : "") + ContinueRow.line(item);
        // "On this phone" is a fact, not an action: muted, with the offline glyph (accent is for primary, selected, progress).
        TextView line = label(said, Type.LABEL, t.inkMuted);
        if (here) {
            android.graphics.drawable.Drawable glyph = getDrawable(net.kckern.daylight.shellkit.R.drawable.daylight_ic_on_phone).mutate();
            int g = dp(14);
            glyph.setBounds(0, 0, g, g);
            glyph.setTint(t.inkMuted);
            line.setCompoundDrawablesRelative(glyph, null, null, null);
            line.setCompoundDrawablePadding(dp(4));
        }
        line.setMaxLines(1);
        line.setEllipsize(android.text.TextUtils.TruncateAt.END);
        words.addView(line);
        // How far in: a thin bar, as every audiobook player shows it.
        android.widget.FrameLayout bar = new android.widget.FrameLayout(this);
        bar.setBackground(DaylightTheme.round(t.outline, dp(2)));
        View fill = new View(this);
        fill.setBackground(DaylightTheme.round(t.primary, dp(2)));
        fill.setPivotX(0);
        fill.setScaleX(duration > 0 ? Math.min(1f, played / (float) duration) : 0f);
        bar.addView(fill, new android.widget.FrameLayout.LayoutParams(-1, -1));
        LinearLayout.LayoutParams barLp = new LinearLayout.LayoutParams(-1, dp(3));
        barLp.topMargin = dp(6);
        words.addView(bar, barLp);
        card.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
        card.setContentDescription("Continue " + title + ", " + (reachable ? left : "needs a connection"));
        net.kckern.daylight.shellkit.UiTelemetry.tag(card, "play.continue");
        String id = item.optString("id");
        if (!reachable) card.setAlpha(0.45f);
        card.setOnClickListener(v -> {
            if (!here && !online()) { toast("Needs a connection: this is not kept on the phone"); return; }
            playHere(id, title, sub, item.optString("art"), true);
        });
        // Press and hold: Open · Keep on this phone (or its state) · Mark finished · Remove from Continue listening.
        card.setOnLongClickListener(v -> continueMenu(card, item));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.topMargin = dp(6);
        card.setLayoutParams(lp);
        return card;
    }

    /**
     * A Continue card's long-press (ops:docs/superpowers/specs/2026-11-26-phone-lookup-and-browse.md
     * §10): Open (the book's page), Keep on this phone or its state, Mark finished (every
     * part, by the book's id), Remove from Continue listening. Remove and Mark finished take
     * the card away at once, with Undo for 6 s; the hide is home's (every device and the web)
     * and is queued on the phone while home is away.
     */
    private boolean continueMenu(View anchor, JSONObject item) {
        String id = item.optString("id"), cid = item.optString("contentId"), title = item.optString("title");
        JSONObject kept = keptFor(cid);
        long played = item.optLong("playhead"), duration = item.optLong("duration");
        String state = ContinueRow.progress(item);
        if (kept != null) state = net.kckern.daylight.shellkit.KeptIndex.describe(kept) + " · " + state;
        net.kckern.daylight.shellkit.ItemSheet sheet = net.kckern.daylight.shellkit.ItemSheet.of(this, "Home")
                .item(item.optString("art"), net.kckern.daylight.shellkit.CoverGlyph.Kind.BOOK, title, item.optString("subtitle"), state)
                .row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_open, "Open", () -> {
                    if (ContinueRow.grouped(item)) openPage(cid, "book", title, item.optString("art"));
                    else openBookOf(cid, title, item.optString("art"));
                });
        if (kept == null) sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_download, "Keep on this phone",
                () -> keepHere(id, title));
        else sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_on_phone, "On this phone", net.kckern.daylight.shellkit.KeptIndex.describe(kept), () -> {
            net.kckern.daylight.shellkit.UiTelemetry.event("Downloads", "keep.screen", new JSONObject());
            openDownloads(null);
        });
        sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_check, "Mark finished", () -> finishFromContinue(item, true))
                .destructive(net.kckern.daylight.shellkit.R.drawable.daylight_ic_remove_circle, "Remove from Continue listening", () -> hideFromContinue(item, true))
                .show();
        return true;
    }

    /** A book's page by its own id (a Continue row is the book, §13). */
    private void openPage(String contentId, String kind, String title, String art) {
        try {
            startActivity(new Intent().setClassName(this, BROWSE).putExtra("mode", "level").putExtra("parent", "c:" + contentId)
                    .putExtra("kind", kind).putExtra("title", title).putExtra("art", art == null ? "" : art));
        } catch (RuntimeException absent) { toast("Not available in this build"); }
    }

    /** Open: the page of the book a Continue card's part belongs to (its info's album). */
    private void openBookOf(String contentId, String title, String art) {
        call("media", request("parents", "id", contentId).toString(), reply -> {
            JSONObject parents = reply.optJSONObject("parents");
            JSONObject album = parents == null ? null : parents.optJSONObject("album");
            if (album == null || album.optString("id").isEmpty()) { toast("Can't find its book now"); return; }
            try {
                startActivity(new Intent().setClassName(this, BROWSE).putExtra("mode", "level").putExtra("parent", album.optString("id"))
                        .putExtra("kind", album.optString("kind", "book")).putExtra("title", album.optString("title", title))
                        .putExtra("art", art == null ? "" : art));
            } catch (RuntimeException absent) { toast("Not available in this build"); }
        }, failure -> toast("Can't reach home: " + failure));
    }

    /** The cards drawn and cached without (or, Undo, with again) {@code item}. */
    private void withoutCard(JSONObject item, boolean gone) {
        android.content.SharedPreferences cache = getSharedPreferences("daylight.home", MODE_PRIVATE);
        org.json.JSONArray now = new org.json.JSONArray();
        try {
            org.json.JSONArray all = new org.json.JSONArray(cache.getString("continue", "[]"));
            boolean present = false;
            for (int i = 0; i < all.length(); i++) {
                JSONObject o = all.optJSONObject(i);
                if (o == null) continue;
                if (item.optString("contentId").equals(o.optString("contentId"))) { present = true; if (gone) continue; }
                now.put(o);
            }
            if (!gone && !present) {
                org.json.JSONArray back = new org.json.JSONArray().put(item);
                for (int i = 0; i < now.length(); i++) back.put(now.get(i));
                now = back;
            }
        } catch (Exception unreadable) { return; }
        cache.edit().putString("continue", now.toString()).apply();
        if (continueBox != null) fillContinue(continueBox, now.toString());
    }

    private void snack(String text, Runnable undo) {
        if (pageHost != null) net.kckern.daylight.shellkit.Snack.show(pageHost, t, text, "Undo", undo, 6000);
    }

    /** Remove from Continue listening (or Undo): gone here at once, home told now or when it answers. */
    private void hideFromContinue(JSONObject item, boolean hidden) {
        String cid = item.optString("contentId");
        withoutCard(item, hidden);
        net.kckern.daylight.shellkit.UiTelemetry.event("Home", hidden ? "continue.hide" : "continue.unhide", new JSONObject());
        JSONObject body;
        try { body = new JSONObject().put("op", "continue-hide").put("contentId", cid).put("hidden", hidden); }
        catch (Exception impossible) { return; }
        call("media", body.toString(), reply -> { }, failure -> { /* the payload keeps it and sends it later */ });
        if (hidden) snack("Removed from Continue listening", () -> hideFromContinue(item, false));
    }

    /** Mark finished (or Undo): every part of the book, and the card leaves Continue. */
    private void finishFromContinue(JSONObject item, boolean finished) {
        String cid = item.optString("contentId");
        withoutCard(item, finished);
        net.kckern.daylight.shellkit.UiTelemetry.event("Home", "continue.finished", new JSONObject(java.util.Map.of("undo", !finished)));
        JSONObject body;
        try {
            body = new JSONObject().put("op", "book-finished").put("contentId", cid).put("finished", finished);
            // Undo puts the card's place back (home's "not finished" would start the part over).
            if (!finished) body.put("restoreSeconds", item.optLong("playhead")).put("durationSeconds", item.optLong("duration"))
                    .put("title", item.optString("title")).put("playContentId", item.optString("playContentId", cid));
        }
        catch (Exception impossible) { return; }
        call("media", body.toString(), reply -> {
            // A book kept automatically: its day before removal starts now.
            if (finished) keepJob("finished-check", "");
        }, failure -> {
            toast("Can't mark it finished now: " + failure);
            if (finished) withoutCard(item, false);
        });
        if (finished) snack("Marked finished", () -> finishFromContinue(item, false));
    }

    /** "Review 3 older items": the one-time row at the top of Continue (§13). */
    private View reviewRow(int count) {
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setMinimumHeight(dp(56));
        row.setPadding(0, dp(4), 0, dp(4));
        row.setBackground(t.pressable(null));
        ImageView icon = new ImageView(this);
        icon.setImageResource(net.kckern.daylight.shellkit.R.drawable.daylight_ic_tune);
        icon.setImageTintList(android.content.res.ColorStateList.valueOf(t.inkMuted));
        row.addView(icon, new LinearLayout.LayoutParams(dp(24), dp(24)));
        LinearLayout words = new LinearLayout(this);
        words.setOrientation(LinearLayout.VERTICAL);
        words.setPadding(dp(16), 0, 0, 0);
        words.addView(t.text(this, ContinueRow.reviewLabel(count), Type.BODY, t.ink, true));
        words.addView(label("From before listening time was counted: keep or clear them", Type.LABEL, t.inkMuted));
        row.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
        row.addView(PlaylistPicker.glyph(this, "›", 20, t.inkMuted));
        row.setContentDescription(ContinueRow.reviewLabel(count) + ". Keep or clear each");
        net.kckern.daylight.shellkit.UiTelemetry.tag(row, "continue.review");
        row.setOnClickListener(v -> openReview());
        return row;
    }

    /**
     * The review sheet: each older entry with Keep and Clear, and Clear all. Opening it is the
     * one time the row is offered; undecided entries stay in Continue as they are.
     */
    private void openReview() {
        getSharedPreferences("daylight.home", MODE_PRIVATE).edit().putBoolean("continueReviewOpened", true).apply();
        net.kckern.daylight.shellkit.UiTelemetry.event("Home", "continue.review_open", new JSONObject());
        net.kckern.daylight.shellkit.BottomSheet sheet = new net.kckern.daylight.shellkit.BottomSheet(this);
        LinearLayout body = sheet.body();
        TextView heading = t.text(this, "Older items in Continue listening", Type.TITLE, t.ink, true);
        body.addView(heading);
        TextView why = label("These were listed before listening time was counted. Keep the ones you are listening to.", Type.LABEL, t.inkMuted);
        why.setPadding(0, dp(4), 0, dp(8));
        body.addView(why);
        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        body.addView(list);
        list.addView(label("Loading…", Type.LABEL, t.inkMuted));
        sheet.onDismiss(() -> { if (continueBox != null) loadContinue(continueBox); });
        sheet.show();
        call("media", request("continue-review").toString(), reply -> {
            list.removeAllViews();
            org.json.JSONArray items = reply.optJSONArray("items");
            if (items == null || items.length() == 0) { list.addView(label("Nothing to review.", Type.LABEL, t.inkMuted)); return; }
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.optJSONObject(i);
                if (item != null) list.addView(reviewItem(item, list));
            }
            TextView all = t.text(this, "Clear all", Type.LABEL, t.danger, true);
            all.setGravity(Gravity.CENTER_VERTICAL);
            all.setMinHeight(dp(48));
            all.setBackground(t.pressable(null));
            all.setOnClickListener(v -> decide(null, "clear", () -> { list.removeAllViews(); list.addView(label("Cleared.", Type.LABEL, t.inkMuted)); }));
            net.kckern.daylight.shellkit.UiTelemetry.tag(all, "continue.review_clear_all");
            body.addView(all);
        }, failure -> { list.removeAllViews(); list.addView(label("Can't reach home: " + failure, Type.LABEL, t.inkMuted)); });
    }

    private View reviewItem(JSONObject item, LinearLayout list) {
        String cid = item.optString("contentId"), title = item.optString("title");
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setMinimumHeight(dp(64));
        ImageView cover = new ImageView(this);
        cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
        net.kckern.daylight.shellkit.CoverGlyph.behind(cover, t, net.kckern.daylight.shellkit.CoverGlyph.Kind.BOOK, dp(44), t.radius(Radius.SMALL));
        row.addView(cover, new LinearLayout.LayoutParams(dp(44), dp(44)));
        loadCover(cover, item.optString("art"));
        LinearLayout words = new LinearLayout(this);
        words.setOrientation(LinearLayout.VERTICAL);
        words.setPadding(dp(12), 0, dp(4), 0);
        TextView name = t.text(this, title, Type.BODY, t.ink, true);
        name.setMaxLines(1);
        name.setEllipsize(android.text.TextUtils.TruncateAt.END);
        words.addView(name);
        TextView line = label(ContinueRow.line(item), Type.LABEL, t.inkMuted);
        line.setMaxLines(1);
        line.setEllipsize(android.text.TextUtils.TruncateAt.END);
        words.addView(line);
        row.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
        TextView keep = t.text(this, "Keep", Type.LABEL, t.ink, true);
        TextView clear = t.text(this, "Clear", Type.LABEL, t.ink, true);
        for (TextView b : new TextView[] { keep, clear }) {
            b.setGravity(Gravity.CENTER);
            b.setMinHeight(dp(48));
            b.setMinWidth(dp(56));
            b.setBackground(t.pressable(null));
            row.addView(b);
        }
        keep.setContentDescription("Keep " + title + " in Continue listening");
        clear.setContentDescription("Clear " + title + " from Continue listening");
        keep.setOnClickListener(v -> decide(cid, "keep", () -> list.removeView(row)));
        clear.setOnClickListener(v -> decide(cid, "clear", () -> { list.removeView(row); withoutCard(item, true); }));
        return row;
    }

    /** One decision (or Clear all, contentId null) sent home; {@code done} runs when home took it. */
    private void decide(String contentId, String decision, Runnable done) {
        JSONObject body;
        try {
            body = new JSONObject().put("op", "continue-decide").put("decision", decision);
            if (contentId == null) body.put("all", true); else body.put("contentId", contentId);
            net.kckern.daylight.shellkit.UiTelemetry.event("Home", "continue.review_decide",
                    new JSONObject().put("decision", decision).put("all", contentId == null));
        } catch (Exception impossible) { return; }
        call("media", body.toString(), reply -> done.run(), failure -> toast("Can't reach home: " + failure));
    }

    /** "2 h 31 min left", "18 min left", "Under a minute left". */
    static String timeLeft(long seconds) {
        long minutes = seconds / 60, hours = minutes / 60;
        if (hours > 0) return hours + " h " + (minutes % 60) + " min left";
        return minutes > 0 ? minutes + " min left" : "Under a minute left";
    }

    /** The playlists already chosen, as cover tiles three to a row; a tap plays one here. */
    private void playlistTiles(java.util.List<DrivingRadioSettings.Staple> playlists) {
        LinearLayout pair = null;
        for (DrivingRadioSettings.Staple p : playlists) {
            if (pair == null || pair.getChildCount() == 3) {
                pair = new LinearLayout(this);
                pair.setWeightSum(3);
                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
                lp.topMargin = dp(6);
                column.addView(pair, lp);
            }
            LinearLayout tile = new LinearLayout(this);
            tile.setOrientation(LinearLayout.VERTICAL);
            // Just the cover and the name under it (design sweep D4): no box around the box.
            tile.setPadding(0, 0, 0, dp(8));
            tile.setBackground(t.pressable(null));
            AspectCover cover = new AspectCover(this);
            cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
            net.kckern.daylight.shellkit.CoverGlyph.behind(cover, t, net.kckern.daylight.shellkit.CoverGlyph.Kind.PLAYLIST, dp(108), t.radius(Radius.SMALL));
            tile.addView(cover, new LinearLayout.LayoutParams(-1, -2));
            loadCover(cover, p.art);
            TextView name = t.text(this, p.title, Type.LABEL, t.ink, true);
            name.setMaxLines(2);
            name.setEllipsize(android.text.TextUtils.TruncateAt.END);
            name.setPadding(0, dp(6), 0, 0);
            tile.addView(name);
            tile.setContentDescription("Play " + p.title);
            net.kckern.daylight.shellkit.UiTelemetry.tag(tile, "play.playlist");
            String id = p.id;
            tile.setOnClickListener(v -> playHere("c:" + id, p.title, "", p.art, false));
            tile.setOnLongClickListener(v -> keepMenu(tile, "c:" + id, id, "playlist", p.title, p.art));
            LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(0, -2, 1);
            if (pair.getChildCount() < 2) tp.setMarginEnd(dp(6));
            pair.addView(tile, tp);
        }
        // A short last row keeps tile widths: empty weight fills it.
        while (pair != null && pair.getChildCount() < 3) {
            View spacer = new View(this);
            LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(0, 1, 1);
            if (pair.getChildCount() < 2) sp.setMarginEnd(dp(6));
            pair.addView(spacer, sp);
        }
        buttonRow = null;
    }

    /** A cover seen before (here or on another screen) draws in this frame; others load off the main thread. */
    private void loadCover(ImageView into, String url) {
        if (url == null) url = "";
        if (url.equals(into.getTag())) return;
        into.setTag(url);
        into.setImageDrawable(null);
        if (url.isEmpty()) return;
        android.graphics.Bitmap hit = net.kckern.daylight.shellkit.PlaylistArtwork.cached(url, 360);
        if (hit != null) { into.setImageBitmap(hit); return; }
        final String wanted = url;
        artworkWorker.execute(() -> {
            android.graphics.Bitmap b = net.kckern.daylight.shellkit.PlaylistArtwork.load(wanted, 360);
            if (b != null) runOnUiThread(() -> { if (!isDestroyed() && wanted.equals(into.getTag())) into.setImageBitmap(b); });
        });
    }

    /** A square cover as wide as its tile. */
    private static final class AspectCover extends ImageView {
        AspectCover(android.content.Context c) { super(c); }
        @Override protected void onMeasure(int w, int h) { super.onMeasure(w, w); }
    }

    private void addConnections() {
        // The phone as a TV remote: one row per screen, straight to its D-pad (up, down,
        // left, right, OK, Back) for the FHE menu, Charades or any menu, when no remote is
        // in reach. The list is drawn from the last answer at once, then refreshed.
        Intent remote = new Intent().setClassName(this, NOW_PLAYING);
        if (getPackageManager().resolveActivity(remote, 0) != null) {
            section("Remote control");
            LinearLayout screensBox = new LinearLayout(this);
            screensBox.setOrientation(LinearLayout.VERTICAL);
            column.addView(screensBox);
            loadRemotes(screensBox, remote);
            section("Devices");
        }
        flatRow("Freematics", "Manage Bluetooth connection", "open", "›",
                () -> startActivity(new Intent(this, FreematicsActivity.class)));
    }

    private void loadRemotes(LinearLayout into, Intent remote) {
        android.content.SharedPreferences cache = getSharedPreferences("daylight.home", MODE_PRIVATE);
        String last = cache.getString("screens", "");
        fillRemotes(into, remote, last);
        call("media", "{\"op\":\"screens\"}", reply -> {
            org.json.JSONArray items = reply.optJSONArray("items");
            String now = items == null ? "[]" : items.toString();
            if (now.equals(last) || into.getParent() == null) return;
            cache.edit().putString("screens", now).apply();
            fillRemotes(into, remote, now);
        }, failure -> {
            if (last.isEmpty() && into.getParent() != null) {
                into.removeAllViews();
                into.addView(label("Screens are listed when home can be reached.", Type.LABEL, t.inkMuted));
            }
        });
    }

    private void fillRemotes(LinearLayout into, Intent remote, String json) {
        into.removeAllViews();
        org.json.JSONArray items;
        try { items = json == null || json.isEmpty() ? new org.json.JSONArray() : new org.json.JSONArray(json); }
        catch (Exception unreadable) { return; }
        LinearLayout saved = column;
        LinearLayout savedRow = buttonRow;
        column = into;
        buttonRow = null;
        try {
            for (int i = 0; i < items.length(); i++) {
                JSONObject sc = items.optJSONObject(i);
                if (sc == null) continue;
                String id = sc.optString("id"), name = sc.optString("name", id);
                // A speaker or headset has no screen to move around: no remote for it.
                if (id.isEmpty() || "speaker".equals(sc.optString("type"))) continue;
                flatRow(name, "Arrows, OK and Back", "remote", "›", () -> startActivity(new Intent(remote)
                        .putExtra("target", id).putExtra("targetName", name).putExtra("pad", true)
                        .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)));
            }
        } finally {
            column = saved;
            buttonRow = savedRow;
        }
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

    /** A launcher icon in the app's green with the glyph inset: white-on-transparent vanishes on most launchers. */
    private android.graphics.Bitmap greenIcon(int glyphResource, boolean adaptive) {
        int size = 192;
        android.graphics.Bitmap bitmap = android.graphics.Bitmap.createBitmap(size, size, android.graphics.Bitmap.Config.ARGB_8888);
        android.graphics.Canvas canvas = new android.graphics.Canvas(bitmap);
        android.graphics.Paint paint = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
        // A launcher icon is not themed by dark mode: always the light theme's primary.
        android.content.res.Configuration light = new android.content.res.Configuration(getResources().getConfiguration());
        light.uiMode = (light.uiMode & ~android.content.res.Configuration.UI_MODE_NIGHT_MASK)
                | android.content.res.Configuration.UI_MODE_NIGHT_NO;
        int brand = DaylightTheme.of(createConfigurationContext(light)).primary;
        paint.setColor(brand);
        if (adaptive) canvas.drawColor(brand);
        else canvas.drawRoundRect(new android.graphics.RectF(0, 0, size, size), size * 0.22f, size * 0.22f, paint);
        android.graphics.drawable.Drawable glyph = getDrawable(glyphResource);
        if (glyph != null) {
            int inset = size / 4;
            glyph.setBounds(inset, inset, size - inset, size - inset);
            glyph.draw(canvas);
        }
        return bitmap;
    }

    private void returnShortcut(JSONObject page, String link) {
        Intent open = SurfaceCache.viewIntent(this, link)
                .setClassName(this, "net.kckern.daylight.cap.notifications.shell.LinkActivity");
        Intent result = new Intent().putExtra(Intent.EXTRA_SHORTCUT_NAME, page.optString("label"))
                .putExtra(Intent.EXTRA_SHORTCUT_INTENT, open)
                .putExtra(Intent.EXTRA_SHORTCUT_ICON, greenIcon(drawable(page.optString("icon")), false));
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
                        .setShortLabel(title).setIcon(Icon.createWithAdaptiveBitmap(greenIcon(drawable("star"), true)))
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

    /** Asks Android to place it at once: Android's own prompt is the confirmation, and a second dialog first is friction. */
    private void confirmShortcut(String title, Runnable pin) {
        if (placementActive()) return;
        pin.run();
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
        playlistScreen.setBackgroundColor(t.background);
        playlistScreen.setPadding(dp(16), dp(8), dp(16), 0);

        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        Button back = actionButton("‹", "back to setup", this::closeMediaChoices);
        back.setContentDescription("Back to setup");
        header.addView(back, dp(48), dp(48));
        TextView heading = label("Drive playlists", Type.HEADLINE, t.ink);
        if (android.os.Build.VERSION.SDK_INT >= 28) heading.setAccessibilityHeading(true); // API 28; the phone floor is 26
        header.addView(heading, new LinearLayout.LayoutParams(0, -2, 1));
        TextView add = PlaylistPicker.text(this, "+ Add", Type.BODY, t.onPrimary, true);
        add.setGravity(Gravity.CENTER);
        add.setBackground(t.round(t.primary, Radius.LARGE));
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
        playlistStatus = label("", Type.BODY, t.ink);
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
        cover.setBackgroundColor(t.tile);
        cover.setImageResource(drawable("play"));
        cover.setScaleType(ImageView.ScaleType.CENTER);
        cover.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        tile.addView(cover, new LinearLayout.LayoutParams(-1, -2));
        TextView name = label(title, Type.LABEL, t.ink);
        tile.setOnClickListener(view -> managePlaylist(contentId, title));
        name.setPadding(0, dp(6), 0, 0);
        name.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        tile.addView(name);
        TextView note = label(where, Type.CAPTION, t.inkMuted);
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
        AlertDialog progress = new AlertDialog.Builder(this, DaylightTheme.alert()).setTitle(request.title)
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
                .step(2, "Open Widgets, find " + getApplicationInfo().loadLabel(getPackageManager()) + " and drag Playlist onto the page.")
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
        boolean newlyAdded = !now.equals(addedSeen);
        if (newlyAdded && tabsShown() && pageHost != null) {
            addedSeen = now;
            rebuildPage();
        }
        // Like any app that pins a shortcut: step aside so the new icon is seen landing on Home.
        if (newlyAdded && observingPlacement && placements.requests().stream()
                .anyMatch(r -> !r.playlist && r.status(System.currentTimeMillis()) == LauncherPlacement.Status.ADDED)) {
            toast("Added to your home screen");
            timer.postDelayed(() -> { if (!isFinishing() && !isDestroyed()) moveTaskToBack(true); }, 700);
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
            case REFUSED: message = "Android was not asked to place it. Tap the item to try again."; break;
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
        banner.setPadding(dp(16), dp(12), dp(8), dp(12));
        banner.setBackground(t.round(problem ? t.attentionContainer : t.surfaceVariant, Radius.MEDIUM));
        // Every banner can be put away: ✕ forgets this attempt (the item is not changed).
        LinearLayout top = new LinearLayout(this);
        top.setGravity(Gravity.CENTER_VERTICAL);
        TextView headline = PlaylistPicker.text(this, (problem ? "" : "✓  ") + request.title, Type.BODY, t.ink, true);
        top.addView(headline, new LinearLayout.LayoutParams(0, -2, 1));
        TextView close = PlaylistPicker.glyph(this, "✕", 18, t.inkMuted);
        close.setPadding(dp(12), dp(4), dp(12), dp(4));
        close.setContentDescription("Dismiss");
        close.setBackground(t.pressable(null));
        net.kckern.daylight.shellkit.UiTelemetry.tag(close, "placement.dismiss");
        close.setOnClickListener(v -> { placements.dismiss(request.requestId); drawPlacement(); });
        top.addView(close);
        banner.addView(top);
        TextView detail = PlaylistPicker.text(this, message, Type.LABEL, t.ink, false);
        banner.addView(detail);
        if (status == LauncherPlacement.Status.UNCONFIRMED || status == LauncherPlacement.Status.REFUSED) {
            TextView retry = PlaylistPicker.text(this, "Tap the item below to retry, or check your launcher's shortcuts.", Type.LABEL, t.inkMuted, false);
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
        TextView heading = label(name, Type.TITLE, t.ink);
        heading.setPadding(0, dp(10), 0, dp(2));
        column.addView(heading);
    }

    private void row(String name, String action, String glyph, String indicator, Runnable click) {
        LinearLayout line = new LinearLayout(this);
        line.setGravity(Gravity.CENTER_VERTICAL);
        line.setMinimumHeight(dp(48));
        line.setPaddingRelative(dp(8), dp(4), dp(8), dp(4));
        line.setBackground(t.pressable(t.round(t.surface, Radius.SMALL)));
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
        // The accent is for primary, selected and progress (D9): an ordinary row's glyph is muted ink, unfilled.
        icon.setPadding(dp(2), dp(2), dp(2), dp(2));
        icon.setImageResource(drawable(glyph));
        icon.setImageTintList(android.content.res.ColorStateList.valueOf(t.inkMuted));
        icon.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        line.addView(icon, dp(24), dp(24));

        TextView heading = label(name, Type.LABEL, t.ink);
        heading.setPaddingRelative(dp(6), 0, dp(4), 0);
        heading.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        line.addView(heading, new LinearLayout.LayoutParams(0, -2, 1));

        TextView cue = PlaylistPicker.glyph(this, indicator, 20, t.inkMuted);
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

    /**
     * A flat row (rule 3, D4): full width, no box, 64 dp; a muted 24 dp glyph, the name as a
     * title, what it does as a muted second line, and a chevron. For lists of places to go
     * (Browse library, the Player rows, the screens to remote-control, devices).
     */
    /** A flat 64 dp row; returns its second line (null when it has none), for a caller that updates it. */
    private TextView flatRow(String name, String line, String glyph, String indicator, Runnable click) {
        buttonRow = null;
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setMinimumHeight(dp(64));
        row.setPaddingRelative(dp(4), dp(8), dp(4), dp(8));
        row.setBackground(t.pressable(null));
        row.setOnClickListener(v -> click.run());
        row.setFocusable(true);
        row.setContentDescription(line.equals(name) ? name : name + ", " + line);
        row.setAccessibilityDelegate(new View.AccessibilityDelegate() {
            @Override public void onInitializeAccessibilityNodeInfo(View host, AccessibilityNodeInfo info) {
                super.onInitializeAccessibilityNodeInfo(host, info);
                info.setClassName(Button.class.getName());
            }
        });
        ImageView icon = new ImageView(this);
        icon.setImageResource(drawable(glyph));
        icon.setImageTintList(android.content.res.ColorStateList.valueOf(t.inkMuted));
        icon.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        row.addView(icon, dp(24), dp(24));
        LinearLayout words = new LinearLayout(this);
        words.setOrientation(LinearLayout.VERTICAL);
        words.setPaddingRelative(dp(16), 0, dp(8), 0);
        words.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        TextView title = t.text(this, name, Type.BODY, t.ink, true);
        title.setMaxLines(1);
        title.setEllipsize(android.text.TextUtils.TruncateAt.END);
        words.addView(title);
        if (!line.equals(name)) {
            TextView sub = label(line, Type.LABEL, t.inkMuted);
            sub.setMaxLines(1);
            sub.setEllipsize(android.text.TextUtils.TruncateAt.END);
            words.addView(sub);
        }
        row.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
        TextView cue = PlaylistPicker.glyph(this, indicator, 20, t.inkMuted);
        cue.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        row.addView(cue);
        column.addView(row, new LinearLayout.LayoutParams(-1, -2));
        if (placementPanel != null) setupRows.add(row);
        return words.getChildCount() > 1 ? (TextView) words.getChildAt(1) : null;
    }

    private Button actionButton(String text, String item, Runnable click) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        button.setContentDescription(text + ", " + item);
        button.setOnClickListener(v -> click.run());
        return button;
    }

    private TextView label(String text, Type type, int color) {
        return t.text(this, text, type, color, false);
    }

    private void toast(String message) { Toast.makeText(this, message, Toast.LENGTH_LONG).show(); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}

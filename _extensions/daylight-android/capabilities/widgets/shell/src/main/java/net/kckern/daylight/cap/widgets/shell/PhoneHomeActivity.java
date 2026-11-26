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
        NowPlayingNote.listen(nowChanged);
        observingNow = true;
        drawNowStrip();
        if (keptBox != null) fillKept();   // a collection kept from Now playing shows on return
        if (continueBox != null && continueBox.getParent() != null) {
            // Redrawn from the last answer: the offline marks follow the network now.
            fillContinue(continueBox, getSharedPreferences("daylight.home", MODE_PRIVATE).getString("continue", ""));
        }
        if (!launcherPicker) {
            observingPlacement = true;
            placements.prefs.registerOnSharedPreferenceChangeListener(placementChanged);
            drawPlacement();
        }
    }

    @Override protected void onStop() {
        NowPlayingNote.unlisten(nowChanged);
        observingNow = false;
        timer.removeCallbacks(nowTick);
        observingPlacement = false;
        placements.prefs.unregisterOnSharedPreferenceChangeListener(placementChanged);
        timer.removeCallbacks(placementTimeout);
        timer.removeCallbacks(keptTick);
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
        // The service is on demand: Android stops it after a while in the background, so a screen
        // left open can come back to no payload. Start it again before asking.
        ShellStart.ensure(this);
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
            TextView chip = PlaylistPicker.text(this, TABS[i], Type.LABEL, selected ? t.onPrimary : t.primary, true);
            chip.setGravity(Gravity.CENTER);
            chip.setBackground(t.round(selected ? t.primary : t.surfaceVariant, Radius.LARGE));
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
        root.setBackgroundColor(t.background);
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.VERTICAL);
        header.setPadding(dp(16), dp(16), dp(16), dp(8));
        TextView title = t.text(this, "Daylight", Type.DISPLAY, t.ink, true);
        header.addView(title);
        header.addView(label(launcherPicker ? "Choose a shortcut" : "Add to your Android home screen", Type.BODY, t.inkMuted));
        root.addView(header);
        tabs = null;
        if (tabsShown()) {
            tabs = new LinearLayout(this);
            tabs.setPadding(dp(16), dp(4), dp(16), dp(8));
            fillTabs();
            root.addView(tabs);
        }
        pageHost = new android.widget.FrameLayout(this);
        pageHost.setBackgroundColor(t.background);
        root.addView(pageHost, new LinearLayout.LayoutParams(-1, 0, 1));
        nowStrip = null;
        if (!launcherPicker) {
            nowStrip = new LinearLayout(this);
            nowCover = null; // a new strip: build its views again
            nowArtUrl = "";
            root.addView(nowStrip, new LinearLayout.LayoutParams(-1, -2));
            drawNowStrip();
        }
        setContentView(root);
        page = buildPage();
        pageHost.addView(page);
    }

    private boolean observingNow;
    private LinearLayout nowStrip;
    private final NowPlayingNote.Listener nowChanged = () -> runOnUiThread(this::drawNowStrip);
    private View nowProgress;
    private android.widget.ImageView nowCover, nowPlay;
    private TextView nowTitle, nowWhere;
    private android.widget.ImageButton nowNext;
    private String nowArtUrl = "";
    private int nowAccent = net.kckern.daylight.shellkit.CoverColor.NONE;
    private final Runnable nowTick = this::tickNowStrip;

    /**
     * The mini player along the bottom while something plays here or on a screen this
     * phone drives (Plexamp's and JellyBox's): a progress line on its top edge, the cover,
     * title, artist and where, play/pause and next, on a tint of the cover's color. A tap
     * opens Now playing on that target. Gone when nothing plays.
     */
    private void drawNowStrip() {
        if (nowStrip == null || isDestroyed()) return;
        NowPlayingNote.Entry now = NowPlayingNote.current();
        Intent open = new Intent().setClassName(this, NOW_PLAYING);
        boolean can = getPackageManager().resolveActivity(open, 0) != null;
        if (now == null || !can) {
            nowStrip.setVisibility(View.GONE);
            timer.removeCallbacks(nowTick);
            return;
        }
        if (nowCover == null) buildNowStrip(open);
        nowStrip.setVisibility(View.VISIBLE);
        nowTitle.setText(now.title);
        String where = "local".equals(now.target) ? "" : "On " + now.targetName;
        String line = now.artist.isEmpty() ? where : where.isEmpty() ? now.artist : now.artist + " · " + where;
        nowWhere.setText(line);
        // Its line is kept even when empty: the strip is one height from its first draw.
        nowWhere.setVisibility(line.isEmpty() ? View.INVISIBLE : View.VISIBLE);
        nowPlay.setImageResource(now.playing ? R.drawable.daylight_mini_pause : R.drawable.daylight_mini_play);
        nowPlay.setContentDescription(now.playing ? "Pause" : "Play");
        nowPlay.setEnabled(now.transport != null);
        nowNext.setVisibility(now.canNext && now.transport != null ? View.VISIBLE : View.GONE);
        nowStrip.setContentDescription((now.playing ? "" : "Paused: ") + now.title + (where.isEmpty() ? "" : ", " + where) + ". Open Now playing");
        final String target = now.target;
        nowStrip.setOnClickListener(v -> startActivity(new Intent(open).putExtra("target", target)));
        if (!now.artworkUrl.equals(nowArtUrl)) loadNowArt(now.artworkUrl);
        tickNowStrip();
    }

    private void buildNowStrip(Intent open) {
        nowStrip.setOrientation(LinearLayout.VERTICAL);
        nowProgress = new View(this);
        nowProgress.setPivotX(0);
        nowStrip.addView(nowProgress, new LinearLayout.LayoutParams(-1, dp(2)));
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(12), dp(8), dp(4), dp(8));
        nowCover = new android.widget.ImageView(this);
        nowCover.setScaleType(android.widget.ImageView.ScaleType.CENTER_CROP);
        nowCover.setClipToOutline(true);
        nowCover.setBackground(t.round(t.tile, DaylightTheme.Radius.SMALL));
        row.addView(nowCover, new LinearLayout.LayoutParams(dp(44), dp(44)));
        LinearLayout words = new LinearLayout(this);
        words.setOrientation(LinearLayout.VERTICAL);
        words.setPadding(dp(12), 0, dp(8), 0);
        nowTitle = t.text(this, "", Type.BODY, t.ink, true);
        nowTitle.setMaxLines(1);
        nowTitle.setEllipsize(android.text.TextUtils.TruncateAt.END);
        words.addView(nowTitle);
        nowWhere = t.text(this, "", Type.LABEL, t.inkMuted, false);
        nowWhere.setMaxLines(1);
        nowWhere.setEllipsize(android.text.TextUtils.TruncateAt.END);
        words.addView(nowWhere);
        row.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
        nowPlay = new android.widget.ImageButton(this);
        nowPlay.setBackground(t.pressable(DaylightTheme.round(0x00000000, dp(22))));
        nowPlay.setScaleType(android.widget.ImageView.ScaleType.FIT_CENTER);
        nowPlay.setPadding(dp(8), dp(8), dp(8), dp(8));
        nowPlay.setOnClickListener(v -> {
            NowPlayingNote.Entry e = NowPlayingNote.current();
            if (e != null && e.transport != null) { v.performHapticFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY); e.transport.playPause(); }
        });
        UiTelemetry.tag(nowPlay, "mini.play-pause");
        row.addView(nowPlay, new LinearLayout.LayoutParams(dp(48), dp(48)));
        nowNext = new android.widget.ImageButton(this);
        nowNext.setImageResource(R.drawable.daylight_mini_next);
        nowNext.setBackground(t.pressable(DaylightTheme.round(0x00000000, dp(22))));
        nowNext.setScaleType(android.widget.ImageView.ScaleType.FIT_CENTER);
        nowNext.setPadding(dp(8), dp(8), dp(8), dp(8));
        nowNext.setContentDescription("Next");
        nowNext.setOnClickListener(v -> {
            NowPlayingNote.Entry e = NowPlayingNote.current();
            if (e != null && e.transport != null) { v.performHapticFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY); e.transport.next(); }
        });
        UiTelemetry.tag(nowNext, "mini.next");
        row.addView(nowNext, new LinearLayout.LayoutParams(dp(48), dp(48)));
        nowStrip.addView(row, new LinearLayout.LayoutParams(-1, -2));
        UiTelemetry.tag(nowStrip, "mini.open");
        paintNowStrip();
    }

    /** The strip's colors: the surface, tinted by the cover's color when there is one. */
    private void paintNowStrip() {
        DaylightTheme c = t.withAccent(nowAccent);
        int fill = ThemeColors.mix(t.surfaceVariant, c.primary, nowAccent == net.kckern.daylight.shellkit.CoverColor.NONE ? 0 : 0.22);
        nowStrip.setBackground(t.pressable(new android.graphics.drawable.ColorDrawable(fill)));
        nowProgress.setBackgroundColor(c.primary);
        int glyph = ThemeColors.readableOn(fill);
        nowPlay.setImageTintList(android.content.res.ColorStateList.valueOf(glyph));
        nowNext.setImageTintList(android.content.res.ColorStateList.valueOf(glyph));
        nowTitle.setTextColor(glyph);
        nowWhere.setTextColor(ThemeColors.mix(fill, glyph, 0.7));
    }

    private void loadNowArt(String url) {
        nowArtUrl = url;
        nowCover.setImageDrawable(null);
        nowAccent = net.kckern.daylight.shellkit.CoverColor.NONE;
        paintNowStrip();
        if (url.isEmpty()) return;
        artworkWorker.execute(() -> {
            android.graphics.Bitmap b = net.kckern.daylight.shellkit.PlaylistArtwork.load(url, 160);
            int accent = net.kckern.daylight.shellkit.CoverColor.NONE;
            if (b != null) {
                android.graphics.Bitmap small = android.graphics.Bitmap.createScaledBitmap(b, 32, 32, true);
                int[] px = new int[32 * 32];
                small.getPixels(px, 0, 32, 0, 0, 32, 32);
                accent = net.kckern.daylight.shellkit.CoverColor.of(px);
            }
            int a = accent;
            runOnUiThread(() -> {
                if (isDestroyed() || !url.equals(nowArtUrl) || nowCover == null) return;
                nowCover.setImageBitmap(b);
                nowAccent = a;
                paintNowStrip();
            });
        });
    }

    /** The progress line, carried forward between the player's reports. */
    private void tickNowStrip() {
        timer.removeCallbacks(nowTick);
        NowPlayingNote.Entry e = NowPlayingNote.current();
        if (e == null || nowProgress == null || nowStrip.getVisibility() != View.VISIBLE) return;
        float f = e.fractionAt(android.os.SystemClock.elapsedRealtime());
        nowProgress.setVisibility(f < 0 ? View.INVISIBLE : View.VISIBLE);
        nowProgress.setScaleX(Math.max(0f, Math.min(1f, f)));
        if (e.playing && observingNow) timer.postDelayed(nowTick, 500);
    }

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
        if (loading) { column.addView(label("Loading services…", Type.BODY, t.ink)); return scroll; }
        if (loadError != null) {
            column.addView(label(loadError, Type.BODY, t.ink));
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

    private static final String PLAY = "net.kckern.daylight.cap.mediaservice.shell.PlayActivity";

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
            section("Player");
            row("Now playing", "Control this phone or a screen", "play", "›", () -> startActivity(nowPlaying));
        }
        row("Drive playlists", "The playlists on the car's Drive tab", "play", "›", this::showMediaChoices);
        row("Driving Radio", "Set the default and day rules", "play", "›", this::showDrivingRadio);
        if (!canPinWidgets()) {
            row("Widget on Home", "How to put a playlist on your home screen", "open", "›",
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
        fillKept();
    }

    private void fillKept() {
        timer.removeCallbacks(keptTick);
        if (keptBox == null || keptBox.getParent() == null || isFinishing()) return;
        java.util.List<JSONObject> index = net.kckern.daylight.shellkit.KeptIndex.read(getFilesDir());
        keptBox.removeAllViews();
        if (index.isEmpty()) return;
        TextView heading = label("On this phone", Type.TITLE, t.ink);
        heading.setPadding(0, dp(10), 0, dp(2));
        keptBox.addView(heading);
        long cap = net.kckern.daylight.shellkit.KeptIndex.capMb(getFilesDir());
        long used = net.kckern.daylight.shellkit.KeptIndex.usedBytes(index);
        keptBox.addView(label(net.kckern.daylight.shellkit.KeptIndex.size(used)
                + (cap > 0 ? " of " + net.kckern.daylight.shellkit.KeptIndex.size(cap * 1_000_000L) : "") + " used for downloads",
                Type.LABEL, t.inkMuted));
        boolean busy = false;
        for (JSONObject k : index) {
            boolean whole = k.optInt("total") > 0 && k.optInt("done") >= k.optInt("total");
            if (!whole && k.optInt("failed") == 0) busy = true;
            keptBox.addView(keptCard(k, whole));
        }
        if (busy) timer.postDelayed(keptTick, 3000);
    }

    private View keptCard(JSONObject k, boolean whole) {
        String title = k.optString("title"), line = net.kckern.daylight.shellkit.KeptIndex.describe(k);
        LinearLayout card = new LinearLayout(this);
        card.setGravity(Gravity.CENTER_VERTICAL);
        card.setPadding(dp(8), dp(8), dp(12), dp(8));
        card.setBackground(t.pressable(t.round(t.surface, Radius.SMALL)));
        ImageView cover = new ImageView(this);
        cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
        cover.setClipToOutline(true);
        cover.setBackground(t.round(t.tile, Radius.SMALL));
        card.addView(cover, new LinearLayout.LayoutParams(dp(56), dp(56)));
        loadCover(cover, k.optString("art"));
        LinearLayout words = new LinearLayout(this);
        words.setOrientation(LinearLayout.VERTICAL);
        words.setPadding(dp(12), 0, 0, 0);
        TextView name = t.text(this, title, Type.BODY, t.ink, true);
        name.setMaxLines(2);
        name.setEllipsize(android.text.TextUtils.TruncateAt.END);
        words.addView(name);
        TextView sub = label(line, Type.LABEL, t.inkMuted);
        sub.setMaxLines(1);
        sub.setEllipsize(android.text.TextUtils.TruncateAt.END);
        words.addView(sub);
        card.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
        card.setContentDescription(title + ", on this phone. " + line);
        net.kckern.daylight.shellkit.UiTelemetry.tag(card, "play.kept");
        String id = "c:" + k.optString("contentId");
        // A part-kept collection plays too: online it streams the rest; offline, what is here.
        card.setOnClickListener(v -> playHere(id));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.topMargin = dp(6);
        card.setLayoutParams(lp);
        return card;
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

    /** Opens Now playing on this phone and starts {@code mediaId} there (p: resumes a track, c: plays a list). */
    private void playHere(String mediaId) {
        Intent now = new Intent().setClassName(this, NOW_PLAYING).putExtra("target", "local");
        Intent play = new Intent().setClassName(this, PLAY).putExtra("id", mediaId);
        try { startActivities(new Intent[] { now, play }); }
        catch (RuntimeException absent) { toast("Could not start playback"); }
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
            if (now.equals(last) || into.getParent() == null) return;
            cache.edit().putString("continue", now).apply();
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
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item != null) into.addView(continueCard(item));
        }
    }

    private View continueCard(JSONObject item) {
        long played = item.optLong("playhead"), duration = item.optLong("duration");
        String title = item.optString("title"), sub = item.optString("subtitle");
        LinearLayout card = new LinearLayout(this);
        card.setGravity(Gravity.CENTER_VERTICAL);
        card.setPadding(dp(8), dp(8), dp(12), dp(8));
        card.setBackground(t.pressable(t.round(t.surface, Radius.SMALL)));
        ImageView cover = new ImageView(this);
        cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
        cover.setClipToOutline(true);
        cover.setBackground(t.round(t.tile, Radius.SMALL));
        card.addView(cover, new LinearLayout.LayoutParams(dp(56), dp(56)));
        loadCover(cover, item.optString("art"));
        LinearLayout words = new LinearLayout(this);
        words.setOrientation(LinearLayout.VERTICAL);
        words.setPadding(dp(12), 0, 0, 0);
        TextView name = t.text(this, title, Type.BODY, t.ink, true);
        name.setMaxLines(2);
        name.setEllipsize(android.text.TextUtils.TruncateAt.END);
        words.addView(name);
        String left = timeLeft(Math.max(0, duration - played));
        // Kept on this phone: marked, and the only cards that play with no network.
        boolean here = net.kckern.daylight.shellkit.KeptIndex.onPhone(
                net.kckern.daylight.shellkit.KeptIndex.read(getFilesDir()), item.optString("contentId"));
        boolean reachable = here || online();
        String said = !reachable ? "Needs a connection" : (here ? "On this phone · " : "") + (sub.isEmpty() || sub.equals(title) ? left : sub + " · " + left);
        TextView line = label(said, Type.LABEL, here ? t.primary : t.inkMuted);
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
            playHere(id);
        });
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.topMargin = dp(6);
        card.setLayoutParams(lp);
        return card;
    }

    /** "2 h 31 min left", "18 min left", "Under a minute left". */
    static String timeLeft(long seconds) {
        long minutes = seconds / 60, hours = minutes / 60;
        if (hours > 0) return hours + " h " + (minutes % 60) + " min left";
        return minutes > 0 ? minutes + " min left" : "Under a minute left";
    }

    /** The playlists already chosen, as cover tiles two to a row; a tap plays one here. */
    private void playlistTiles(java.util.List<DrivingRadioSettings.Staple> playlists) {
        LinearLayout pair = null;
        for (DrivingRadioSettings.Staple p : playlists) {
            if (pair == null || pair.getChildCount() == 2) {
                pair = new LinearLayout(this);
                pair.setWeightSum(2);
                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
                lp.topMargin = dp(6);
                column.addView(pair, lp);
            }
            LinearLayout tile = new LinearLayout(this);
            tile.setOrientation(LinearLayout.VERTICAL);
            tile.setPadding(dp(6), dp(6), dp(6), dp(8));
            tile.setBackground(t.pressable(t.round(t.surface, Radius.SMALL)));
            AspectCover cover = new AspectCover(this);
            cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
            cover.setClipToOutline(true);
            cover.setBackground(t.round(t.tile, Radius.SMALL));
            tile.addView(cover, new LinearLayout.LayoutParams(-1, -2));
            loadCover(cover, p.art);
            TextView name = t.text(this, p.title, Type.LABEL, t.ink, true);
            name.setMaxLines(2);
            name.setEllipsize(android.text.TextUtils.TruncateAt.END);
            name.setPadding(dp(2), dp(6), dp(2), 0);
            tile.addView(name);
            tile.setContentDescription("Play " + p.title);
            net.kckern.daylight.shellkit.UiTelemetry.tag(tile, "play.playlist");
            String id = p.id;
            tile.setOnClickListener(v -> playHere("c:" + id));
            LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(0, -2, 1);
            if (pair.getChildCount() == 0) tp.setMarginEnd(dp(6));
            pair.addView(tile, tp);
        }
        buttonRow = null;
    }

    private void loadCover(ImageView into, String url) {
        if (url == null || url.isEmpty()) return;
        artworkWorker.execute(() -> {
            android.graphics.Bitmap b = net.kckern.daylight.shellkit.PlaylistArtwork.load(url, 360);
            if (b != null) runOnUiThread(() -> { if (!isDestroyed()) into.setImageBitmap(b); });
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
        row("Freematics", "Manage Bluetooth connection", "open", "›",
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
                row(name, "Remote control for " + name, "remote", "›", () -> startActivity(new Intent(remote)
                        .putExtra("target", id).putExtra("pad", true)
                        .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)));
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
            case REFUSED: message = "Daylight could not ask Android to place it. Tap the item to try again."; break;
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
        banner.setBackground(t.round(problem ? t.attentionContainer : t.surfaceVariant, Radius.MEDIUM));
        TextView headline = PlaylistPicker.text(this, (problem ? "" : "✓  ") + request.title, Type.BODY, t.ink, true);
        banner.addView(headline);
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
        icon.setBackground(DaylightTheme.round(t.primary, dp(8)));
        icon.setPadding(dp(6), dp(6), dp(6), dp(6));
        icon.setImageResource(drawable(glyph));
        icon.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        line.addView(icon, dp(24), dp(24));

        TextView heading = label(name, Type.LABEL, t.ink);
        heading.setPaddingRelative(dp(6), 0, dp(4), 0);
        heading.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        line.addView(heading, new LinearLayout.LayoutParams(0, -2, 1));

        TextView cue = PlaylistPicker.glyph(this, indicator, 20, t.primary);
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

    private TextView label(String text, Type type, int color) {
        return t.text(this, text, type, color, false);
    }

    private void toast(String message) { Toast.makeText(this, message, Toast.LENGTH_LONG).show(); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}

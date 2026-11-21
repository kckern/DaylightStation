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
    private final SharedPreferences.OnSharedPreferenceChangeListener placementChanged =
            (prefs, key) -> drawPlacement();
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

    private void draw() {
        setupRows.clear();
        buttonRow = null;
        placementPanel = null;
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(PAPER);
        column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setPadding(dp(16), dp(16), dp(16), dp(16));
        scroll.addView(column);
        setContentView(scroll);
        TextView title = label("Daylight", 28, INK);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        column.addView(title);
        column.addView(label(launcherPicker ? "Choose a shortcut" : "Add to your Android home screen", 16, INK));
        if (loading) { column.addView(label("Loading services…", 16, INK)); return; }
        if (loadError != null) {
            column.addView(label(loadError, 16, INK));
            row("Try again", "Try again", "open", "›", this::refresh);
            return;
        }
        if (!launcherPicker) {
            placementPanel = new LinearLayout(this);
            placementPanel.setOrientation(LinearLayout.VERTICAL);
            placementPanel.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
            column.addView(placementPanel);
        }
        section("Services");
        for (int i = 0; i < pages.length(); i++) {
            JSONObject page = pages.optJSONObject(i);
            if (page == null) continue;
            if (launcherPicker) {
                // This result goes to the caller. Only stable, unkeyed page bookmarks may leave the app.
                String id = page.optString("id");
                if (java.util.Arrays.asList("health", "home", "lifelog", "media").contains(id)) {
                    row(page.optString("label"), "Choose shortcut", page.optString("icon"), "›",
                            () -> returnLauncherShortcut(page));
                }
            } else {
                row(page.optString("label"), "Add to home screen", page.optString("icon"), "+",
                        () -> pinPage(page));
            }
        }
        section("Quick capture");
        for (int i = 0; i < configuredActions.length(); i++) {
            JSONObject action = configuredActions.optJSONObject(i);
            if (action == null || !("INPUT".equals(action.optString("kind")) || "meal-barcode".equals(action.optString("id")))) continue;
            String id = action.optString("id");
            if (launcherPicker) {
                if (!LauncherCaptureShortcut.supports(id)) continue;
                row(action.optString("label"), "Choose shortcut", action.optString("icon"), "›",
                        () -> returnCaptureShortcut(action));
            } else {
                row(action.optString("label"), "Add to home screen", action.optString("icon"), "+",
                        () -> confirmShortcut(id, action.optString("label")));
            }
        }
        if (launcherPicker) return;
        section("Play on demand");
        row("Playlists", "Stage playlists and Daylight lists", "play", "›", () -> showMediaChoices(false));
        row("Staged", "Manage staged playlists", "play", "›", () -> showMediaChoices(true));
        row("Driving Radio", "Set the default and day rules", "play", "›", this::showDrivingRadio);
        section("Connections");
        row("Freematics", "Manage Bluetooth connection", "open", "›",
                () -> startActivity(new Intent(this, FreematicsActivity.class)));
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

    private void showDrivingRadio() {
        List<PlacementStore.StagedPlaylist> staged = placements.staged();
        if (staged.isEmpty()) {
            new AlertDialog.Builder(this).setTitle("Driving Radio")
                    .setMessage("Stage a playlist to use it as your driving default.")
                    .setNegativeButton("Close", null)
                    .setPositiveButton("Playlists", (dialog, which) -> showMediaChoices(false)).show();
            return;
        }
        DrivingRadioSettings radio = new DrivingRadioSettings(this);
        String[] days = new java.text.DateFormatSymbols().getWeekdays();
        days[0] = "Default";
        String[] rows = days.clone();
        for (int day = 0; day < rows.length; day++) {
            String id = radio.get(day);
            String title = day == 0 ? "Off" : "Use default";
            for (PlacementStore.StagedPlaylist entry : staged) {
                if (entry.contentId.equals(id)) title = entry.title;
            }
            rows[day] += " · " + title;
        }
        new AlertDialog.Builder(this).setTitle("Driving Radio").setItems(rows, (dialog, day) -> {
            String[] choices = new String[staged.size() + 1];
            choices[0] = day == 0 ? "Off" : "Use default";
            for (int i = 0; i < staged.size(); i++) choices[i + 1] = staged.get(i).title;
            new AlertDialog.Builder(this).setTitle(days[day]).setItems(choices, (picker, selected) -> {
                radio.set(day, selected == 0 ? "" : staged.get(selected - 1).contentId);
                showDrivingRadio();
            }).setNegativeButton("Cancel", null).show();
        }).setNegativeButton("Done", null).show();
    }

    private void showMediaChoices(boolean staged) {
        if (playlistScreen != null) return;
        showMediaChoices(staged, null, null);
    }

    private void showMediaChoices(boolean staged, String source, JSONArray choices) {
        boolean entering = playlistScreen == null;
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
        TextView heading = label(staged ? "Staged playlists" : "Play on demand", 24, INK);
        heading.setAccessibilityHeading(true);
        header.addView(heading);
        playlistScreen.addView(header);
        if (!staged && choices != null) {
            HorizontalScrollView sourceScroll = new HorizontalScrollView(this);
            sourceScroll.setHorizontalScrollBarEnabled(false);
            LinearLayout sources = new LinearLayout(this);
            for (int i = 0; i < choices.length(); i++) {
                JSONObject choice = choices.optJSONObject(i);
                if (choice == null) continue;
                String key = choice.optString("id");
                String title = choice.optString("title");
                if (key.isEmpty() || title.isEmpty()) continue;
                Button tab = actionButton(title, title, () -> showMediaChoices(false, key, choices));
                tab.setSelected(key.equals(source));
                tab.setEnabled(!key.equals(source));
                sources.addView(tab, new LinearLayout.LayoutParams(-2, dp(48)));
            }
            sourceScroll.addView(sources);
            playlistScreen.addView(sourceScroll);
        }

        ScrollView scroll = new ScrollView(this);
        playlistScreen.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        scroll.addView(content);
        playlistGrid = new LinearLayout(this);
        playlistGrid.setOrientation(LinearLayout.VERTICAL);
        content.addView(playlistGrid);
        playlistStatus = label("Loading playlists…", 16, INK);
        playlistStatus.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        content.addView(playlistStatus);
        setContentView(playlistScreen);
        if (entering) slideIn(playlistScreen, 1);
        if (staged) drawStagedPlaylists();
        else if (source == null) loadPlaylistSources(playlistScreen);
        else loadPlaylistPage(playlistScreen, source, 0);
    }

    private void loadPlaylistSources(LinearLayout screen) {
        playlistStatus.setText("Loading playlist sources…");
        playlistStatus.setOnClickListener(null);
        call("media", request("playlistSources").toString(), result -> {
            if (playlistScreen != screen) return;
            JSONArray items = result.optJSONArray("items");
            if (!result.optBoolean("ok") || items == null) {
                showPlaylistSourcesRetry();
            } else if (items.length() == 0) {
                playlistStatus.setText("No audio list sources configured.");
            } else {
                showMediaChoices(false, items.optJSONObject(0).optString("id"), items);
            }
        }, message -> {
            if (playlistScreen == screen) showPlaylistSourcesRetry();
        });
    }

    private void showPlaylistSourcesRetry() {
        playlistStatus.setText("Could not load playlist sources. Tap to retry.");
        playlistStatus.setOnClickListener(view -> loadPlaylistSources(playlistScreen));
    }

    private void drawStagedPlaylists() {
        playlistGrid.removeAllViews();
        playlistRow = null;
        List<PlacementStore.StagedPlaylist> staged = placements.staged();
        for (PlacementStore.StagedPlaylist playlist : staged) {
            addPlaylist(playlistScreen, playlist.contentId, playlist.title, "", true);
        }
        playlistStatus.setVisibility(staged.isEmpty() ? View.VISIBLE : View.GONE);
        playlistStatus.setText("No staged playlists. Choose a playlist from the library to stage it.");
    }

    private void chooseShuffle(String contentId, String title, Runnable saved) {
        DrivingRadioSettings radio = new DrivingRadioSettings(this);
        boolean[] options = {placements.shuffle(contentId), radio.isStaple(contentId)};
        new AlertDialog.Builder(this).setTitle(title)
                .setMultiChoiceItems(new String[]{"Shuffle", "Show on Drive"}, options, (dialog, which, checked) -> options[which] = checked)
                .setNegativeButton("Cancel", null)
                .setPositiveButton(placements.isStaged(contentId) ? "Save" : "Stage playlist", (dialog, which) -> {
                    placements.stage(contentId, title, options[0]);
                    radio.setStaple(contentId, options[1]);
                    PlaylistWidgetState.redraw(this);
                    saved.run();
                }).show();
    }

    private void managePlaylist(String contentId, String title) {
        String instructions = (placements.shuffle(contentId) ? "Shuffle on. " : "Playlist order. ")
                + "Available in Android Home → Widgets → Daylight playlist.";
        LauncherPlacement recent = placements.requests().stream()
                .filter(request -> request.playlist && request.contentId.equals(contentId))
                .max(java.util.Comparator.comparingLong(request -> request.updatedAt)).orElse(null);
        if (recent != null) {
            LauncherPlacement.Status status = recent.status(System.currentTimeMillis());
            if (status == LauncherPlacement.Status.CONFIRM) instructions = "Confirm placement in Android. " + instructions;
            if (status == LauncherPlacement.Status.UNCONFIRMED) instructions = "Placement unconfirmed. Check Android Home before adding it again. " + instructions;
        }
        new AlertDialog.Builder(this).setTitle(title)
                .setMessage(instructions)
                .setPositiveButton("Add widget", (dialog, which) -> pinWidget(contentId, title))
                .setNeutralButton("Unstage", (dialog, which) -> {
                    placements.unstage(contentId);
                    drawStagedPlaylists();
                })
                .setNegativeButton("Playback options", (dialog, which) -> chooseShuffle(contentId, title, this::drawStagedPlaylists))
                .show();
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

    private void loadPlaylistPage(LinearLayout screen, String source, int cursor) {
        playlistStatus.setVisibility(View.VISIBLE);
        playlistStatus.setText("Loading playlists…");
        playlistStatus.setOnClickListener(null);
        playlistStatus.setClickable(false);
        call("media", request("playlists", "cursor", String.valueOf(cursor), "source", source).toString(), result -> {
            if (playlistScreen != screen) return;
            JSONArray items = result.optJSONArray("items");
            if (!result.optBoolean("ok") || items == null) {
                showPlaylistRetry(screen, source, cursor);
                return;
            }
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.optJSONObject(i);
                if (item != null) addPlaylist(screen, item.optString("contentId"), item.optString("title"),
                        item.optString("thumbnail"), false);
            }
            int next = result.optInt("nextCursor", -1);
            if (next > cursor) loadPlaylistPage(screen, source, next);
            else if (playlistGrid.getChildCount() == 0) playlistStatus.setText("No lists with playable audio found.");
            else playlistStatus.setVisibility(View.GONE);
        }, message -> {
            if (playlistScreen == screen) showPlaylistRetry(screen, source, cursor);
        });
    }

    private void showPlaylistRetry(LinearLayout screen, String source, int cursor) {
        playlistStatus.setText("Could not load playlists. Tap to retry.");
        playlistStatus.setMinHeight(dp(48));
        playlistStatus.setOnClickListener(v -> loadPlaylistPage(screen, source, cursor));
    }

    private void addPlaylist(LinearLayout screen, String contentId, String title, String thumbnail, boolean staged) {
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
        boolean alreadyStaged = staged || placements.isStaged(contentId);
        tile.setContentDescription((staged ? "Manage " : alreadyStaged ? "Staged: " : "Stage ") + title);
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
        TextView name = label(!staged && alreadyStaged ? "✓ " + title : title, 14, INK);
        tile.setOnClickListener(view -> {
            if (staged) managePlaylist(contentId, title);
            else chooseShuffle(contentId, title, () -> {
                name.setText("✓ " + title);
                tile.setContentDescription("Staged: " + title);
            });
        });
        name.setPadding(0, dp(6), 0, 0);
        name.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        tile.addView(name);
        playlistRow.addView(tile, new LinearLayout.LayoutParams(0, -2, 1));

        Bitmap cached = PlaylistWidgetArtwork.read(this, "c:" + contentId);
        if (cached != null) {
            cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
            cover.setImageBitmap(cached);
        }
        if (!staged && thumbnail.startsWith("https://")) artworkWorker.execute(() -> {
            Bitmap art = PlaylistArtwork.load(thumbnail, 600);
            if (art == null) return;
            PlaylistWidgetArtwork.save(getApplicationContext(), "c:" + contentId, art);
            runOnUiThread(() -> {
                PlaylistWidgetState.redraw(getApplicationContext());
                if (playlistScreen != screen) return;
                cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
                cover.setImageBitmap(art);
            });
        });
    }

    private void pinWidget(String contentId, String title) {
        Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
        android.content.pm.ResolveInfo launcher = getPackageManager().resolveActivity(home,
                android.content.pm.PackageManager.MATCH_DEFAULT_ONLY);
        String launcherPackage = launcher == null || launcher.activityInfo == null
                ? "" : launcher.activityInfo.packageName;
        AppWidgetManager manager = AppWidgetManager.getInstance(this);
        if ("com.anddoes.launcher".equals(launcherPackage) || manager == null
                || !manager.isRequestPinAppWidgetSupported()) {
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

    private void showManualWidgetPlacement(String title) {
        new AlertDialog.Builder(this).setTitle("Add " + title)
                .setMessage("Touch and hold an empty spot on Android Home. Open Widgets, add Daylight playlist, then choose " + title + ".")
                .setNegativeButton("Stay here", null)
                .setPositiveButton("Go to Home", (dialog, which) -> startActivity(
                        new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)))
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
            default: message = "Added";
        }
        placementPanel.addView(label(request.title + " — " + message, 16, INK));
        if (status != LauncherPlacement.Status.UNCONFIRMED && status != LauncherPlacement.Status.REFUSED) return;
        placementPanel.addView(label("Tap the item below to retry, or check your launcher's shortcuts.", 14, INK));
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

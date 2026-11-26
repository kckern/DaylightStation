package net.kckern.daylight.cap.mediaservice.shell;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.TextView;

import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.common.Timeline;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionCommand;
import androidx.media3.session.SessionToken;

import com.google.common.util.concurrent.ListenableFuture;

import net.kckern.daylight.shellkit.PlaylistArtwork;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Now playing: one player screen for this phone's own playback and for a screen's
 * session. The target strip at the top picks which; the rest is the same screen either
 * way, because both are Media3 sessions behind one MediaController (DaylightMediaService
 * for the phone, RemoteControlService for a screen). A control is enabled only when the
 * target's player makes its command available: what a target can do is declared there,
 * never guessed here.
 *
 * Not exported. Opened by this app only: the setup screen, a "player:" one-tap action
 * (through the payload's media/now-playing link) and both media notifications.
 */
public class NowPlayingActivity extends Activity {
    private static final String TAG = "Daylight-Media";
    static final String EXTRA_TARGET = "target";
    static final String LOCAL = "local";
    private static final String PREFS = "daylight.nowplaying";
    private static final int INK = 0xff14382f, GREEN = 0xff125b47, PAPER = 0xfff4f7f4, MUTED = 0xff5d7169;
    private static final int QUEUE_ROWS = 100;

    private static final class Screen {
        final String id, name;
        Screen(String id, String name) { this.id = id; this.name = name; }
    }

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable ticker = this::tickPosition;
    private ExecutorService io;
    private final PayloadMedia media = new PayloadMedia();
    private final List<Screen> screens = new ArrayList<>();
    private String screensProblem = "";
    private String target = LOCAL;
    private String targetName = "This phone";
    private ListenableFuture<MediaController> pending;
    private MediaController controller;
    private String remoteStatus = "";
    private boolean dragging;
    private String shownArtwork;
    private String queueSignature;

    private LinearLayout targets, queueList;
    private TextView title, subtitle, status, elapsed, remaining, queueHeading;
    private ImageView art;
    private SeekBar seek;
    private Button prev, back, playPause, forward, next, stop, shuffle, repeat, volDown, volUp, clear;

    @Override protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        io = Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "Daylight-nowplaying");
            t.setDaemon(true);
            return t;
        });
        buildViews();
        chooseInitialTarget(getIntent());
        loadScreens();
        Log.i(TAG, "now playing opened, target " + target);
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String asked = intent == null ? "" : intent.getStringExtra(EXTRA_TARGET);
        if (asked != null && !asked.isEmpty() && !asked.equals(target)) switchTo(asked, nameOf(asked));
    }

    @Override protected void onStart() {
        super.onStart();
        connect();
        main.post(ticker);
    }

    @Override protected void onStop() {
        main.removeCallbacks(ticker);
        disconnect();
        super.onStop();
    }

    @Override protected void onDestroy() {
        if (io != null) io.shutdownNow();
        super.onDestroy();
    }

    // ── targets ──────────────────────────────────────────────────────────────

    private SharedPreferences prefs() { return getSharedPreferences(PREFS, MODE_PRIVATE); }

    private void chooseInitialTarget(Intent intent) {
        String asked = intent == null ? null : intent.getStringExtra(EXTRA_TARGET);
        if (asked == null || asked.isEmpty()) asked = prefs().getString(EXTRA_TARGET, LOCAL);
        target = asked;
        targetName = LOCAL.equals(asked) ? "This phone" : prefs().getString("name:" + asked, asked);
    }

    private String nameOf(String id) {
        if (LOCAL.equals(id)) return "This phone";
        for (Screen s : screens) if (s.id.equals(id)) return s.name;
        return prefs().getString("name:" + id, id);
    }

    private void switchTo(String id, String name) {
        Log.i(TAG, "now playing target " + id);
        disconnect();
        target = id;
        targetName = name;
        prefs().edit().putString(EXTRA_TARGET, id).putString("name:" + id, name).apply();
        remoteStatus = "";
        shownArtwork = null;
        queueSignature = null;
        renderTargets();
        render();
        connect();
    }

    private void loadScreens() {
        io.execute(() -> {
            List<Screen> found = new ArrayList<>();
            String problem = "";
            try {
                JSONObject reply = new JSONObject(media.screens(6000));
                JSONArray items = reply.optJSONArray("items");
                for (int i = 0; items != null && i < items.length(); i++) {
                    JSONObject s = items.getJSONObject(i);
                    found.add(new Screen(s.getString("id"), s.optString("name", s.getString("id"))));
                }
                if (!reply.optBoolean("ok", false)) problem = "Screens unavailable";
            } catch (Exception unavailable) {
                problem = "Can't reach home";
            }
            String p = problem;
            main.post(() -> {
                screens.clear();
                screens.addAll(found);
                screensProblem = p;
                if (!LOCAL.equals(target)) targetName = nameOf(target);
                renderTargets();
                render();
            });
        });
    }

    // ── the controller ───────────────────────────────────────────────────────

    private boolean remote() { return !LOCAL.equals(target); }

    private void connect() {
        if (pending != null || controller != null) return;
        Class<?> service = remote() ? RemoteControlService.class : DaylightMediaService.class;
        final String forTarget = target;
        try {
            SessionToken token = new SessionToken(this, new ComponentName(this, service));
            pending = new MediaController.Builder(this, token)
                    .setListener(new MediaController.Listener() {
                        @Override public void onExtrasChanged(MediaController c, Bundle extras) {
                            if (c != controller) return;
                            remoteStatus = extras.getString(RemoteControlService.EXTRA_STATUS, "");
                            render();
                        }
                        @Override public void onDisconnected(MediaController c) {
                            if (c == controller) { controller = null; render(); }
                        }
                    })
                    .buildAsync();
            final ListenableFuture<MediaController> mine = pending;
            mine.addListener(() -> {
                if (mine != pending) return;
                pending = null;
                try {
                    MediaController c = mine.get();
                    if (!forTarget.equals(target) || isFinishing()) { c.release(); return; }
                    controller = c;
                    c.addListener(new Player.Listener() {
                        @Override public void onEvents(Player player, Player.Events events) { render(); }
                    });
                    if (remote()) {
                        Bundle args = new Bundle();
                        args.putString(RemoteControlService.EXTRA_DEVICE, target);
                        args.putString(RemoteControlService.EXTRA_NAME, targetName);
                        c.sendCustomCommand(new SessionCommand(RemoteControlService.TARGET, Bundle.EMPTY), args);
                        watch(c, true);
                    }
                    render();
                } catch (Exception failed) {
                    Log.w(TAG, "now playing: no media controller: " + failed.getClass().getSimpleName());
                    status.setText("Could not reach the player");
                }
            }, main::post);
        } catch (RuntimeException failed) {
            Log.w(TAG, "now playing: could not reach the media service: " + failed.getClass().getSimpleName());
            status.setText("Could not reach the player");
        }
    }

    private void watch(MediaController c, boolean on) {
        Bundle args = new Bundle();
        args.putBoolean(RemoteControlService.EXTRA_ON, on);
        c.sendCustomCommand(new SessionCommand(RemoteControlService.WATCH, Bundle.EMPTY), args);
    }

    private void disconnect() {
        if (pending != null) { MediaController.releaseFuture(pending); pending = null; }
        MediaController c = controller;
        controller = null;
        if (c == null) return;
        // Releasing the controller does not stop anything: the session keeps its player.
        if (remote() && c.isConnected()) watch(c, false);
        c.release();
    }

    private boolean can(int command) {
        return controller != null && controller.isConnected() && controller.isCommandAvailable(command);
    }

    // ── what it shows ────────────────────────────────────────────────────────

    private void render() {
        MediaController c = controller;
        MediaMetadata meta = c == null ? MediaMetadata.EMPTY : c.getMediaMetadata();
        boolean hasItem = c != null && c.getMediaItemCount() > 0;
        CharSequence name = meta.title != null ? meta.title : meta.displayTitle;
        title.setText(hasItem && !TextUtils.isEmpty(name) ? name : "Nothing playing");
        subtitle.setText(remote() ? targetName : (meta.artist != null && hasItem ? meta.artist : "This phone"));

        String line;
        if (c == null) line = pending != null ? "Connecting…" : "";
        else if (remote()) line = remoteStatus;
        else if (c.getPlayerError() != null) line = "Could not play this";
        else line = hasItem ? "" : "Nothing playing on this phone";
        status.setText(line);
        status.setVisibility(line.isEmpty() ? View.GONE : View.VISIBLE);

        playPause.setText(c != null && c.getPlayWhenReady() ? "❚❚" : "▶");
        playPause.setContentDescription(c != null && c.getPlayWhenReady() ? "Pause" : "Play");
        enable(playPause, can(Player.COMMAND_PLAY_PAUSE));
        enable(prev, can(Player.COMMAND_SEEK_TO_PREVIOUS));
        enable(next, can(Player.COMMAND_SEEK_TO_NEXT));
        enable(back, can(Player.COMMAND_SEEK_BACK));
        enable(forward, can(Player.COMMAND_SEEK_FORWARD));
        enable(stop, can(Player.COMMAND_STOP));
        enable(shuffle, can(Player.COMMAND_SET_SHUFFLE_MODE));
        enable(repeat, can(Player.COMMAND_SET_REPEAT_MODE));
        shuffle.setText(c != null && c.getShuffleModeEnabled() ? "Shuffle on" : "Shuffle off");
        int mode = c == null ? Player.REPEAT_MODE_OFF : c.getRepeatMode();
        repeat.setText(mode == Player.REPEAT_MODE_ONE ? "Repeat one" : mode == Player.REPEAT_MODE_ALL ? "Repeat all" : "Repeat off");

        boolean volume = can(Player.COMMAND_ADJUST_DEVICE_VOLUME);
        volDown.setVisibility(volume ? View.VISIBLE : View.GONE);
        volUp.setVisibility(volume ? View.VISIBLE : View.GONE);
        if (volume) volUp.setText("Vol + (" + c.getDeviceVolume() + ")");

        renderArtwork(hasItem ? meta.artworkUri : null);
        renderQueue();
        tickPosition();
    }

    private void tickPosition() {
        main.removeCallbacks(ticker);
        MediaController c = controller;
        long duration = c == null ? C.TIME_UNSET : c.getDuration();
        long position = c == null ? 0 : Math.max(0, c.getCurrentPosition());
        boolean seekable = duration != C.TIME_UNSET && duration > 0 && can(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM);
        seek.setEnabled(seekable);
        if (!dragging) {
            seek.setMax(duration != C.TIME_UNSET && duration > 0 ? (int) Math.min(Integer.MAX_VALUE, duration) : 1);
            seek.setProgress(duration != C.TIME_UNSET && duration > 0 ? (int) Math.min(position, duration) : 0);
        }
        elapsed.setText(clock(dragging ? seek.getProgress() : position));
        remaining.setText(duration != C.TIME_UNSET && duration > 0 ? clock(duration) : "");
        if (c != null && c.isPlaying()) main.postDelayed(ticker, 500);
        else if (c != null) main.postDelayed(ticker, 1500);
    }

    private void renderArtwork(Uri uri) {
        String key = uri == null ? "" : uri.toString();
        if (key.equals(shownArtwork)) return;
        shownArtwork = key;
        art.setImageBitmap(null);
        if (key.isEmpty()) return;
        io.execute(() -> {
            Bitmap bitmap = PlaylistArtwork.load(key, 720);
            main.post(() -> { if (key.equals(shownArtwork) && bitmap != null) art.setImageBitmap(bitmap); });
        });
    }

    private void renderQueue() {
        MediaController c = controller;
        Timeline timeline = c == null ? Timeline.EMPTY : c.getCurrentTimeline();
        int count = timeline.getWindowCount();
        int current = c == null ? -1 : c.getCurrentMediaItemIndex();
        StringBuilder sig = new StringBuilder().append(current).append('|').append(can(Player.COMMAND_SEEK_TO_MEDIA_ITEM))
                .append(can(Player.COMMAND_CHANGE_MEDIA_ITEMS));
        Timeline.Window window = new Timeline.Window();
        for (int i = 0; i < count && i < QUEUE_ROWS; i++) {
            MediaItem item = timeline.getWindow(i, window).mediaItem;
            sig.append('|').append(item.mediaId).append('=').append(item.mediaMetadata.title);
        }
        String signature = sig.toString();
        if (signature.equals(queueSignature)) return;
        queueSignature = signature;

        queueList.removeAllViews();
        queueHeading.setText(count == 0 ? "Queue" : "Queue (" + count + ")");
        enable(clear, count > 0 && can(Player.COMMAND_CHANGE_MEDIA_ITEMS));
        boolean jump = can(Player.COMMAND_SEEK_TO_MEDIA_ITEM), change = can(Player.COMMAND_CHANGE_MEDIA_ITEMS);
        for (int i = 0; i < count && i < QUEUE_ROWS; i++) {
            final int index = i;
            MediaItem item = timeline.getWindow(i, window).mediaItem;
            CharSequence name = item.mediaMetadata.title != null ? item.mediaMetadata.title : item.mediaId;
            LinearLayout row = new LinearLayout(this);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setMinimumHeight(dp(48));
            row.setPaddingRelative(dp(12), dp(4), dp(4), dp(4));
            row.setBackground(round(i == current ? 0xffdcebe4 : Color.WHITE, 10));
            TextView label = text((i == current ? "▶  " : "") + name, 15, i == current ? GREEN : INK);
            label.setMaxLines(2);
            label.setEllipsize(TextUtils.TruncateAt.END);
            if (i == current) label.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            row.addView(label, new LinearLayout.LayoutParams(0, -2, 1));
            if (jump && i != current) {
                row.setOnClickListener(v -> { if (controller != null) controller.seekToDefaultPosition(index); });
                row.setContentDescription("Play " + name);
            }
            if (change) {
                Button remove = button("×", "Remove " + name, () -> { if (controller != null) controller.removeMediaItem(index); });
                row.addView(remove, new LinearLayout.LayoutParams(dp(48), dp(44)));
            }
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
            lp.topMargin = dp(4);
            queueList.addView(row, lp);
        }
        if (count > QUEUE_ROWS) queueList.addView(text("…and " + (count - QUEUE_ROWS) + " more", 14, MUTED));
    }

    private void renderTargets() {
        targets.removeAllViews();
        addChip("This phone", LOCAL);
        for (Screen s : screens) addChip(s.name, s.id);
        if (!screensProblem.isEmpty()) {
            TextView note = text(screensProblem, 14, MUTED);
            note.setPaddingRelative(dp(8), 0, dp(8), 0);
            targets.addView(note);
        }
    }

    private void addChip(String label, String id) {
        boolean on = id.equals(target);
        Button chip = button(label, (on ? "Selected, " : "Control ") + label, () -> { if (!id.equals(target)) switchTo(id, label); });
        chip.setTextColor(on ? Color.WHITE : INK);
        chip.setBackground(round(on ? GREEN : Color.WHITE, 18));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, dp(40));
        lp.setMarginEnd(dp(8));
        targets.addView(chip, lp);
    }

    // ── layout ───────────────────────────────────────────────────────────────

    private void buildViews() {
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(PAPER);
        scroll.setFillViewport(true);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(dp(16), dp(20), dp(16), dp(24));
        scroll.addView(col);

        TextView heading = text("Now playing", 26, INK);
        heading.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        col.addView(heading);

        HorizontalScrollView strip = new HorizontalScrollView(this);
        strip.setHorizontalScrollBarEnabled(false);
        targets = new LinearLayout(this);
        targets.setGravity(Gravity.CENTER_VERTICAL);
        strip.addView(targets);
        LinearLayout.LayoutParams stripLp = new LinearLayout.LayoutParams(-1, -2);
        stripLp.topMargin = dp(12);
        stripLp.bottomMargin = dp(16);
        col.addView(strip, stripLp);

        art = new ImageView(this);
        art.setScaleType(ImageView.ScaleType.CENTER_CROP);
        art.setBackground(round(0xffdfe7e2, 16));
        art.setClipToOutline(true);
        art.setContentDescription("Artwork");
        int side = Math.min(getResources().getDisplayMetrics().widthPixels - dp(32), dp(320));
        LinearLayout.LayoutParams artLp = new LinearLayout.LayoutParams(side, side * 9 / 16);
        artLp.gravity = Gravity.CENTER_HORIZONTAL;
        col.addView(art, artLp);

        title = text("", 22, INK);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        title.setPadding(0, dp(16), 0, 0);
        title.setMaxLines(3);
        title.setEllipsize(TextUtils.TruncateAt.END);
        col.addView(title);
        subtitle = text("", 15, MUTED);
        col.addView(subtitle);
        status = text("", 15, GREEN);
        status.setPadding(0, dp(6), 0, 0);
        col.addView(status);

        seek = new SeekBar(this);
        seek.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar bar, int progress, boolean fromUser) {
                if (fromUser) elapsed.setText(clock(progress));
            }
            @Override public void onStartTrackingTouch(SeekBar bar) { dragging = true; }
            @Override public void onStopTrackingTouch(SeekBar bar) {
                dragging = false;
                if (controller != null && can(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM)) controller.seekTo(bar.getProgress());
            }
        });
        LinearLayout.LayoutParams seekLp = new LinearLayout.LayoutParams(-1, -2);
        seekLp.topMargin = dp(12);
        col.addView(seek, seekLp);
        LinearLayout times = new LinearLayout(this);
        elapsed = text("0:00", 13, MUTED);
        remaining = text("", 13, MUTED);
        remaining.setGravity(Gravity.END);
        times.addView(elapsed, new LinearLayout.LayoutParams(0, -2, 1));
        times.addView(remaining, new LinearLayout.LayoutParams(0, -2, 1));
        col.addView(times);

        LinearLayout transport = new LinearLayout(this);
        transport.setGravity(Gravity.CENTER);
        prev = button("⏮", "Previous", () -> controller.seekToPrevious());
        back = button("−10", "Back 10 seconds", () -> controller.seekBack());
        playPause = button("▶", "Play", () -> {
            if (controller.getPlayWhenReady()) controller.pause();
            else { if (controller.getPlaybackState() == Player.STATE_IDLE) controller.prepare(); controller.play(); }
        });
        forward = button("+10", "Forward 10 seconds", () -> controller.seekForward());
        next = button("⏭", "Next", () -> controller.seekToNext());
        for (Button b : new Button[]{prev, back, playPause, forward, next}) {
            transport.addView(b, new LinearLayout.LayoutParams(0, dp(56), 1));
        }
        playPause.setTextSize(22);
        playPause.setTextColor(Color.WHITE);
        playPause.setBackground(round(GREEN, 28));
        LinearLayout.LayoutParams transportLp = new LinearLayout.LayoutParams(-1, -2);
        transportLp.topMargin = dp(8);
        col.addView(transport, transportLp);

        LinearLayout options = new LinearLayout(this);
        stop = button("Stop", "Stop", () -> controller.stop());
        shuffle = button("Shuffle off", "Shuffle", () -> controller.setShuffleModeEnabled(!controller.getShuffleModeEnabled()));
        repeat = button("Repeat off", "Repeat", () -> {
            int m = controller.getRepeatMode();
            controller.setRepeatMode(m == Player.REPEAT_MODE_OFF ? Player.REPEAT_MODE_ALL
                    : m == Player.REPEAT_MODE_ALL ? Player.REPEAT_MODE_ONE : Player.REPEAT_MODE_OFF);
        });
        for (Button b : new Button[]{stop, shuffle, repeat}) options.addView(b, weight());
        col.addView(options, spaced(8));

        LinearLayout volumeRow = new LinearLayout(this);
        volDown = button("Vol −", "Volume down", () -> controller.decreaseDeviceVolume(0));
        volUp = button("Vol +", "Volume up", () -> controller.increaseDeviceVolume(0));
        volumeRow.addView(volDown, weight());
        volumeRow.addView(volUp, weight());
        col.addView(volumeRow, spaced(4));

        LinearLayout queueHead = new LinearLayout(this);
        queueHead.setGravity(Gravity.CENTER_VERTICAL);
        queueHeading = text("Queue", 18, INK);
        queueHeading.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        queueHead.addView(queueHeading, new LinearLayout.LayoutParams(0, -2, 1));
        clear = button("Clear", "Clear the queue", this::confirmClear);
        queueHead.addView(clear, new LinearLayout.LayoutParams(dp(96), dp(40)));
        col.addView(queueHead, spaced(20));
        queueList = new LinearLayout(this);
        queueList.setOrientation(LinearLayout.VERTICAL);
        col.addView(queueList, new LinearLayout.LayoutParams(-1, -2));

        setContentView(scroll);
        renderTargets();
        render();
    }

    private void confirmClear() {
        if (controller == null) return;
        new AlertDialog.Builder(this)
                .setMessage("Clear the queue on " + targetName + "?")
                .setPositiveButton("Clear", (d, w) -> { if (controller != null) controller.clearMediaItems(); })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private LinearLayout.LayoutParams weight() {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, dp(44), 1);
        lp.setMarginEnd(dp(6));
        return lp;
    }

    private LinearLayout.LayoutParams spaced(int top) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.topMargin = dp(top);
        return lp;
    }

    /** A button whose action runs only while a controller is connected. */
    private Button button(String label, String description, Runnable action) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(15);
        b.setTextColor(INK);
        b.setBackground(round(Color.WHITE, 12));
        b.setContentDescription(description);
        b.setOnClickListener(v -> {
            if (controller != null) {
                try { action.run(); } catch (RuntimeException e) { Log.w(TAG, "now playing: " + e.getClass().getSimpleName()); }
            }
        });
        return b;
    }

    private static void enable(View v, boolean on) {
        v.setEnabled(on);
        v.setAlpha(on ? 1f : 0.35f);
    }

    private TextView text(String s, int size, int color) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(size);
        t.setTextColor(color);
        return t;
    }

    private GradientDrawable round(int color, int radius) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(dp(radius));
        return g;
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    static String clock(long ms) {
        long s = Math.max(0, ms) / 1000;
        long h = s / 3600, m = (s % 3600) / 60, sec = s % 60;
        return h > 0 ? String.format(Locale.US, "%d:%02d:%02d", h, m, sec) : String.format(Locale.US, "%d:%02d", m, sec);
    }
}

package net.kckern.daylight.cap.mediaservice.shell;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
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
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
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
 * session. Both are Media3 sessions behind one MediaController (DaylightMediaService for
 * the phone, RemoteControlService for a screen), so the screen below is the same either
 * way. A control is shown or enabled only when the target's player makes its command
 * available: what a target can do is declared there, never guessed here.
 *
 * Layout, from what established players do rather than a card per control (the
 * Jellyfin/Navidrome UI survey, ops:docs/_wip/audits/2026-11-25-player-benchmark-
 * jellyfin-navidrome.md): the target is one button at the top that opens a picker with
 * the current one checked; then art, title, the scrubber, and one primary row with a
 * filled play circle. Music puts shuffle and repeat beside the skips; long items (20 min
 * or more, or no length) put back and forward 10 s there instead. Toggles say their
 * state by tint. Stop and Clear live in the ⋮ menu; the queue opens in a sheet from a
 * "next up" line. A screen's volume is the hardware keys. The status line shows only
 * when something is not right.
 *
 * Not exported. Opened by this app only: the setup screen, a "player:" one-tap action
 * (through the payload's media/now-playing link) and both media notifications.
 */
public class NowPlayingActivity extends Activity {
    private static final String TAG = "Daylight-Media";
    static final String EXTRA_TARGET = "target";
    static final String LOCAL = "local";
    private static final String PREFS = "daylight.nowplaying";
    private static final int INK = 0xff14382f, GREEN = 0xff125b47, PAPER = 0xfff4f7f4, MUTED = 0xff7b8c85, LINE = 0xffdfe7e2;
    private static final int QUEUE_ROWS = 100;

    private static final class Screen {
        final String id, name, type;
        Screen(String id, String name, String type) { this.id = id; this.name = name; this.type = type; }
    }

    /** The registry's device type as an icon: a picker row says what kind of thing it plays on. */
    static int iconFor(String type, String name) {
        if (type == null) type = "";
        if (type.equals("speaker")) {
            return name != null && name.toLowerCase(Locale.ROOT).contains("headset")
                    ? R.drawable.daylight_np_headphones : R.drawable.daylight_np_speaker;
        }
        if (type.contains("tablet")) return R.drawable.daylight_np_tablet;
        return R.drawable.daylight_np_tv;
    }

    private int targetIcon(String id) {
        if (LOCAL.equals(id)) return R.drawable.daylight_np_phone;
        for (Screen s : screens) if (s.id.equals(id)) return iconFor(s.type, s.name);
        return iconFor(prefs().getString("type:" + id, ""), nameOf(id));
    }

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable ticker = this::tickPosition;
    private final Runnable clearVolumeLine = () -> { volumeLine = ""; render(); };
    private ExecutorService io;
    /** Artwork on its own thread: a slow screens list must not hold a cover back. */
    private ExecutorService artIo;
    private final Runnable reconnect = this::connect;
    /** While on screen with no controller, connect again after this long (doubling to 15 s). */
    private long reconnectMs = 1000;
    private boolean started;
    private String connectionLine = "";
    private final PayloadMedia media = new PayloadMedia();
    private final List<Screen> screens = new ArrayList<>();
    private String screensProblem = "";
    private String target = LOCAL;
    private String targetName = "This phone";
    private ListenableFuture<MediaController> pending;
    private MediaController controller;
    private String remoteStatus = "";
    private String volumeLine = "";
    private boolean dragging;
    private String shownArtwork;
    private Dialog queueSheet;

    private TextView targetLabel, title, subtitle, status, elapsed, remaining, upNext;
    private ImageView targetIcon, art;
    private SeekBar seek;
    private ImageButton more, playPause, prev, next, leftEdge, rightEdge;
    private TextView leftEdgeNumber, rightEdgeNumber;
    private FrameLayout leftEdgeBox, rightEdgeBox;
    private LinearLayout upNextRow, times;
    private View upNextRule;

    @Override protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        io = Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "Daylight-nowplaying");
            t.setDaemon(true);
            return t;
        });
        artIo = Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "Daylight-nowplaying-art");
            t.setDaemon(true);
            return t;
        });
        buildViews();
        chooseInitialTarget(getIntent(), saved);
        loadScreens();
        Log.i(TAG, "now playing opened, target " + target);
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String asked = intent == null ? "" : intent.getStringExtra(EXTRA_TARGET);
        if (asked != null && !asked.isEmpty() && !asked.equals(target)) switchTo(asked, nameOf(asked));
        else if (controller == null && pending == null && started) connect();
    }

    /** The target chosen here outlives a rotation; the opening intent's does not override it. */
    @Override protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        out.putString(EXTRA_TARGET, target);
    }

    @Override protected void onStart() {
        super.onStart();
        started = true;
        reconnectMs = 1000;
        connect();
        main.post(ticker);
        if (screens.isEmpty() || !screensProblem.isEmpty()) loadScreens();
    }

    @Override protected void onStop() {
        started = false;
        main.removeCallbacks(ticker);
        main.removeCallbacks(reconnect);
        disconnect();
        super.onStop();
    }

    @Override protected void onDestroy() {
        if (io != null) io.shutdownNow();
        if (artIo != null) artIo.shutdownNow();
        super.onDestroy();
    }

    /**
     * Lost or never got the player (the service was killed, a bind failed on a cold start):
     * say so and try again while the screen is open, rather than sit on disabled controls.
     */
    private void lostPlayer(String why) {
        connectionLine = why;
        render();
        if (!started) return;
        main.removeCallbacks(reconnect);
        main.postDelayed(reconnect, reconnectMs);
        Log.w(TAG, "now playing: " + why + ", again in " + reconnectMs + " ms");
        reconnectMs = Math.min(15_000, reconnectMs * 2);
    }

    // ── targets ──────────────────────────────────────────────────────────────

    private SharedPreferences prefs() { return getSharedPreferences(PREFS, MODE_PRIVATE); }

    private void chooseInitialTarget(Intent intent, Bundle saved) {
        String asked = saved != null ? saved.getString(EXTRA_TARGET) : null;
        if (asked == null || asked.isEmpty()) asked = intent == null ? null : intent.getStringExtra(EXTRA_TARGET);
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
        setIntent(new Intent(getIntent()).putExtra(EXTRA_TARGET, id));
        main.removeCallbacks(reconnect);
        reconnectMs = 1000;
        connectionLine = "";
        remoteStatus = "";
        shownArtwork = null;
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
                    found.add(new Screen(s.getString("id"), s.optString("name", s.getString("id")), s.optString("type", "")));
                }
                if (!reply.optBoolean("ok", false)) problem = "Screens unavailable";
            } catch (Exception unavailable) {
                problem = "Can't reach home";
            }
            String p = problem;
            main.post(() -> {
                screens.clear();
                screens.addAll(found);
                SharedPreferences.Editor e = prefs().edit();
                for (Screen sc : found) e.putString("type:" + sc.id, sc.type);
                e.apply();
                screensProblem = p;
                if (!LOCAL.equals(target)) {
                    String named = nameOf(target);
                    // The pick was sent before the names were known: send it again, named.
                    if (!named.equals(targetName) && controller != null && controller.isConnected()) {
                        targetName = named;
                        Bundle args = new Bundle();
                        args.putString(RemoteControlService.EXTRA_DEVICE, target);
                        args.putString(RemoteControlService.EXTRA_NAME, named);
                        controller.sendCustomCommand(new SessionCommand(RemoteControlService.TARGET, Bundle.EMPTY), args);
                    }
                    targetName = named;
                }
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
                            if (c == controller) { controller = null; lostPlayer("Reconnecting…"); }
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
                    connectionLine = "";
                    reconnectMs = 1000;
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
                    lostPlayer("Could not reach the player; trying again");
                }
            }, main::post);
        } catch (RuntimeException failed) {
            Log.w(TAG, "now playing: could not reach the media service: " + failed.getClass().getSimpleName());
            pending = null;
            lostPlayer("Could not reach the player; trying again");
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

    /**
     * Long items (talks, courses, films, a share) seek; music shuffles. The same rule as the
     * phone's session and the car (CarControls.longForm: from a household list, or 20 minutes
     * or more), so this screen and the notification agree. A screen's item with no length
     * (a live stream, a share still being fetched) counts as long.
     */
    private boolean longForm() {
        MediaController c = controller;
        if (c == null || c.getMediaItemCount() == 0) return false;
        long d = c.getDuration();
        if (remote() && d == C.TIME_UNSET) return true;
        return CarControls.longForm(NodeItems.listId(c.getCurrentMediaItem()), d);
    }

    /**
     * Next for a long item on this phone: the session withholds track skips there (a car's
     * skip becomes a 10 s jump), and offers the next item as its NEXT_TRACK command.
     */
    private boolean nextByCommand() {
        return !remote() && longForm() && controller != null && !can(Player.COMMAND_SEEK_TO_NEXT)
                && controller.isSessionCommandAvailable(new SessionCommand(CarControls.NEXT_ACTION, Bundle.EMPTY));
    }

    private void render() {
        MediaController c = controller;
        MediaMetadata meta = c == null ? MediaMetadata.EMPTY : c.getMediaMetadata();
        boolean hasItem = c != null && c.getMediaItemCount() > 0;
        CharSequence name = meta.title != null ? meta.title : meta.displayTitle;
        title.setText(hasItem && !TextUtils.isEmpty(name) ? name : "Nothing playing");
        title.setTextColor(hasItem ? INK : MUTED);
        CharSequence by = remote() ? null : meta.artist;
        subtitle.setText(hasItem && !TextUtils.isEmpty(by) ? by : "");
        subtitle.setVisibility(subtitle.getText().length() == 0 ? View.GONE : View.VISIBLE);

        String line;
        if (!volumeLine.isEmpty()) line = volumeLine;
        else if (c == null) line = pending != null ? "Connecting…" : connectionLine;
        else if (remote()) line = remoteStatus;
        else line = c.getPlayerError() != null ? "Could not play this" : "";
        status.setText(line);
        status.setVisibility(line.isEmpty() ? View.GONE : View.VISIBLE);

        boolean playing = active(c);
        playPause.setImageResource(playing ? R.drawable.daylight_np_pause : R.drawable.daylight_np_play);
        playPause.setContentDescription(playing ? "Pause" : "Play");
        enable(playPause, hasItem && can(Player.COMMAND_PLAY_PAUSE));
        enable(prev, hasItem && can(Player.COMMAND_SEEK_TO_PREVIOUS));
        enable(next, hasItem && (can(Player.COMMAND_SEEK_TO_NEXT) || (nextByCommand() && c.hasNextMediaItem())));

        if (longForm()) {
            edge(leftEdge, leftEdgeNumber, R.drawable.daylight_np_replay, "Back 10 seconds", true, can(Player.COMMAND_SEEK_BACK), false);
            edge(rightEdge, rightEdgeNumber, R.drawable.daylight_np_forward, "Forward 10 seconds", true, can(Player.COMMAND_SEEK_FORWARD), false);
        } else {
            boolean shuffled = c != null && c.getShuffleModeEnabled();
            int mode = c == null ? Player.REPEAT_MODE_OFF : c.getRepeatMode();
            edge(leftEdge, leftEdgeNumber, R.drawable.daylight_np_shuffle, shuffled ? "Shuffle, on" : "Shuffle, off",
                    false, hasItem && can(Player.COMMAND_SET_SHUFFLE_MODE), shuffled);
            edge(rightEdge, rightEdgeNumber,
                    mode == Player.REPEAT_MODE_ONE ? R.drawable.daylight_np_repeat_one : R.drawable.daylight_np_repeat,
                    mode == Player.REPEAT_MODE_ONE ? "Repeat one" : mode == Player.REPEAT_MODE_ALL ? "Repeat all" : "Repeat, off",
                    false, hasItem && can(Player.COMMAND_SET_REPEAT_MODE), mode != Player.REPEAT_MODE_OFF);
        }
        enable(more, hasItem && (can(Player.COMMAND_STOP) || can(Player.COMMAND_CHANGE_MEDIA_ITEMS) || longForm()));

        renderUpNext();
        renderArtwork(hasItem ? meta.artworkUri : null, hasItem);
        renderTargets();
        if (queueSheet != null && queueSheet.isShowing()) fillQueue((LinearLayout) queueSheet.findViewById(QUEUE_LIST));
        tickPosition();
    }

    /**
     * Whether play/pause should read "pause": the player means to play AND holds something
     * loaded. A stopped player keeps playWhenReady, so that alone would show pause on a
     * stopped screen.
     */
    private static boolean active(Player c) {
        if (c == null || !c.getPlayWhenReady()) return false;
        int state = c.getPlaybackState();
        return state == Player.STATE_READY || state == Player.STATE_BUFFERING;
    }

    /** One of the two buttons beside the skips: a toggle tinted by its state, or a 10 s jump. */
    private void edge(ImageButton b, TextView number, int icon, String description, boolean jump, boolean on, boolean active) {
        b.setImageResource(icon);
        b.setContentDescription(description);
        b.setImageTintList(ColorStateList.valueOf(active ? GREEN : jump ? INK : MUTED));
        number.setVisibility(jump ? View.VISIBLE : View.GONE);
        enable((View) b.getParent(), on);
    }

    private void tickPosition() {
        main.removeCallbacks(ticker);
        MediaController c = controller;
        long duration = c == null ? C.TIME_UNSET : c.getDuration();
        long position = c == null ? 0 : Math.max(0, c.getCurrentPosition());
        boolean known = duration != C.TIME_UNSET && duration > 0;
        seek.setEnabled(known && can(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM));
        if (!dragging) {
            seek.setMax(known ? (int) Math.min(Integer.MAX_VALUE, duration) : 1);
            seek.setProgress(known ? (int) Math.min(position, duration) : 0);
        }
        boolean any = c != null && c.getMediaItemCount() > 0;
        // Nothing to scrub: no bar, no times.
        seek.setVisibility(any ? View.VISIBLE : View.INVISIBLE);
        times.setVisibility(any ? View.VISIBLE : View.INVISIBLE);
        elapsed.setText(any ? clock(dragging ? seek.getProgress() : position) : "");
        remaining.setText(known ? "−" + clock(Math.max(0, duration - (dragging ? seek.getProgress() : position))) : "");
        if (c != null && c.isPlaying()) main.postDelayed(ticker, 500);
        else if (c != null) main.postDelayed(ticker, 1500);
    }

    /**
     * The picture, in its own shape. With none, the box says so plainly: a note for an item
     * that has no art, and a short band with the target's icon when nothing plays, instead
     * of a large empty square.
     */
    private void renderArtwork(Uri uri, boolean hasItem) {
        String key = (uri == null ? "" : uri.toString()) + "|" + hasItem + "|" + target;
        if (key.equals(shownArtwork)) return;
        shownArtwork = key;
        placeholder(hasItem ? R.drawable.daylight_np_note : targetIcon(target), hasItem ? 1f : 0.4f);
        if (uri == null) return;
        String url = uri.toString();
        artIo.execute(() -> {
            Bitmap bitmap = PlaylistArtwork.load(url, 900);
            main.post(() -> {
                if (!key.equals(shownArtwork) || bitmap == null) return;
                art.setImageTintList(null);
                art.setPadding(0, 0, 0, 0);
                art.setScaleType(ImageView.ScaleType.CENTER_CROP);
                art.setImageBitmap(bitmap);
                // A video's still is wide, an album cover square: the box takes the picture's shape.
                setArtHeight(bitmap.getWidth() > bitmap.getHeight() * 1.2f ? 9f / 16f : 1f);
            });
        });
    }

    private void placeholder(int icon, float ratio) {
        art.setScaleType(ImageView.ScaleType.FIT_CENTER);
        art.setImageResource(icon);
        art.setImageTintList(ColorStateList.valueOf(MUTED));
        int pad = Math.round(((LinearLayout.LayoutParams) art.getLayoutParams()).width * ratio * 0.34f);
        art.setPadding(pad, pad, pad, pad);
        setArtHeight(ratio);
    }

    private void setArtHeight(float ratio) {
        LinearLayout.LayoutParams lp = (LinearLayout.LayoutParams) art.getLayoutParams();
        int h = Math.round(lp.width * ratio);
        if (lp.height != h) { lp.height = h; art.setLayoutParams(lp); }
    }

    /** The line under the controls: what plays next, and a way into the queue. */
    private void renderUpNext() {
        MediaController c = controller;
        int count = c == null ? 0 : c.getMediaItemCount();
        upNextRow.setVisibility(count > 0 ? View.VISIBLE : View.GONE);
        upNextRule.setVisibility(count > 0 ? View.VISIBLE : View.GONE);
        if (count == 0) return;
        int nextIndex = c.getNextMediaItemIndex();
        if (nextIndex == C.INDEX_UNSET || nextIndex >= count) {
            upNext.setText(count == 1 ? "Nothing after this" : "End of the queue");
        } else {
            CharSequence t = c.getMediaItemAt(nextIndex).mediaMetadata.title;
            upNext.setText("Next: " + (t == null ? "" : t));
        }
    }

    private final int QUEUE_LIST = View.generateViewId();

    private void openQueue() {
        if (controller == null) return;
        Dialog sheet = new Dialog(this);
        sheet.requestWindowFeature(Window.FEATURE_NO_TITLE);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setBackground(round(PAPER, 16));
        col.setPadding(dp(16), dp(12), dp(8), dp(12));

        LinearLayout head = new LinearLayout(this);
        head.setGravity(Gravity.CENTER_VERTICAL);
        TextView heading = text("Queue", 18, INK);
        heading.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        head.addView(heading, new LinearLayout.LayoutParams(0, -2, 1));
        TextView clear = text("Clear", 15, GREEN);
        clear.setPadding(dp(12), dp(10), dp(12), dp(10));
        clear.setOnClickListener(v -> confirmClear(sheet));
        clear.setVisibility(can(Player.COMMAND_CHANGE_MEDIA_ITEMS) ? View.VISIBLE : View.GONE);
        head.addView(clear);
        col.addView(head);

        ScrollView scroll = new ScrollView(this);
        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setId(QUEUE_LIST);
        scroll.addView(list);
        col.addView(scroll, new LinearLayout.LayoutParams(-1, -2));
        sheet.setContentView(col);
        fillQueue(list);
        Window w = sheet.getWindow();
        if (w != null) {
            w.setBackgroundDrawableResource(android.R.color.transparent);
            w.setGravity(Gravity.BOTTOM);
            int rows = controller == null ? 1 : Math.max(1, Math.min(QUEUE_ROWS, controller.getMediaItemCount()));
            int fit = dp(80) + rows * dp(53);
            w.setLayout(-1, Math.min(fit, Math.round(getResources().getDisplayMetrics().heightPixels * 0.7f)));
        }
        sheet.setOnDismissListener(d -> { if (queueSheet == sheet) queueSheet = null; });
        queueSheet = sheet;
        sheet.show();
    }

    private void fillQueue(LinearLayout list) {
        if (list == null) return;
        list.removeAllViews();
        MediaController c = controller;
        Timeline timeline = c == null ? Timeline.EMPTY : c.getCurrentTimeline();
        int count = timeline.getWindowCount();
        int current = c == null ? -1 : c.getCurrentMediaItemIndex();
        boolean playing = active(c);
        boolean jump = can(Player.COMMAND_SEEK_TO_MEDIA_ITEM), change = can(Player.COMMAND_CHANGE_MEDIA_ITEMS);
        Timeline.Window window = new Timeline.Window();
        if (count == 0) list.addView(text("The queue is empty", 15, MUTED));
        for (int i = 0; i < count && i < QUEUE_ROWS; i++) {
            final int index = i;
            MediaItem item = timeline.getWindow(i, window).mediaItem;
            CharSequence name = item.mediaMetadata.title != null ? item.mediaMetadata.title : item.mediaId;
            boolean now = i == current;
            LinearLayout row = new LinearLayout(this);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setMinimumHeight(dp(52));
            ImageView mark = new ImageView(this);
            if (now) {
                mark.setImageResource(playing ? R.drawable.daylight_np_play : R.drawable.daylight_np_pause);
                mark.setImageTintList(ColorStateList.valueOf(GREEN));
                mark.setContentDescription(playing ? "Playing" : "Paused");
            }
            row.addView(mark, new LinearLayout.LayoutParams(dp(28), dp(20)));
            TextView label = text(name.toString(), 15, now ? GREEN : INK);
            label.setMaxLines(2);
            label.setEllipsize(TextUtils.TruncateAt.END);
            if (now) label.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            row.addView(label, new LinearLayout.LayoutParams(0, -2, 1));
            if (jump && !now) {
                row.setOnClickListener(v -> { if (controller != null) controller.seekToDefaultPosition(index); });
                row.setContentDescription("Play " + name);
            }
            if (change) {
                ImageButton remove = icon(R.drawable.daylight_np_remove, "Remove " + name, MUTED,
                        () -> controller.removeMediaItem(index));
                row.addView(remove, new LinearLayout.LayoutParams(dp(44), dp(44)));
            }
            list.addView(row, new LinearLayout.LayoutParams(-1, -2));
            View rule = new View(this);
            rule.setBackgroundColor(LINE);
            list.addView(rule, new LinearLayout.LayoutParams(-1, 1));
        }
        if (count > QUEUE_ROWS) list.addView(text("and " + (count - QUEUE_ROWS) + " more", 14, MUTED));
    }

    /** The target button: which player this screen drives. */
    private void renderTargets() {
        targetIcon.setImageResource(targetIcon(target));
        targetLabel.setText(targetName);
    }

    /** Pick a player: this phone and every screen, the current one checked (Jellyfin's "Play On"). */
    private void openTargets() {
        if (screens.isEmpty() || !screensProblem.isEmpty()) loadScreens();
        List<String> ids = new ArrayList<>();
        List<String> names = new ArrayList<>();
        ids.add(LOCAL); names.add("This phone");
        for (Screen s : screens) { ids.add(s.id); names.add(s.name); }
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(dp(8), dp(8), dp(8), dp(8));
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Play on").setView(col).create();
        for (int i = 0; i < ids.size(); i++) {
            String id = ids.get(i), label = names.get(i);
            boolean on = id.equals(target);
            LinearLayout row = new LinearLayout(this);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setMinimumHeight(dp(52));
            row.setPaddingRelative(dp(12), 0, dp(12), 0);
            ImageView kind = new ImageView(this);
            kind.setImageResource(targetIcon(id));
            kind.setImageTintList(ColorStateList.valueOf(on ? GREEN : INK));
            row.addView(kind, new LinearLayout.LayoutParams(dp(24), dp(24)));
            TextView t = text(label, 16, on ? GREEN : INK);
            t.setPaddingRelative(dp(16), 0, 0, 0);
            if (on) t.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            row.addView(t, new LinearLayout.LayoutParams(0, -2, 1));
            if (on) {
                ImageView check = new ImageView(this);
                check.setImageResource(R.drawable.daylight_np_check);
                check.setImageTintList(ColorStateList.valueOf(GREEN));
                row.addView(check, new LinearLayout.LayoutParams(dp(24), dp(24)));
            }
            row.setContentDescription(on ? label + ", playing here" : "Play on " + label);
            row.setOnClickListener(v -> { dialog.dismiss(); if (!id.equals(target)) switchTo(id, label); });
            col.addView(row);
        }
        if (!screensProblem.isEmpty()) {
            TextView note = text(screensProblem, 14, MUTED);
            note.setPaddingRelative(dp(12), dp(8), dp(12), 0);
            col.addView(note);
        }
        dialog.show();
    }

    private void openMore() {
        PopupMenu menu = new PopupMenu(this, more);
        if (longForm()) {
            boolean shuffled = controller != null && controller.getShuffleModeEnabled();
            if (can(Player.COMMAND_SET_SHUFFLE_MODE)) menu.getMenu().add(0, 3, 0, shuffled ? "Shuffle: on" : "Shuffle: off");
            if (can(Player.COMMAND_SET_REPEAT_MODE)) menu.getMenu().add(0, 4, 0, "Repeat: " + repeatWord());
        }
        if (can(Player.COMMAND_STOP)) menu.getMenu().add(0, 1, 0, remote() ? "Stop on " + targetName : "Stop");
        if (can(Player.COMMAND_CHANGE_MEDIA_ITEMS) && controller.getMediaItemCount() > 0) menu.getMenu().add(0, 2, 0, "Clear queue");
        menu.setOnMenuItemClickListener(item -> {
            if (controller == null) return true;
            switch (item.getItemId()) {
                case 1: stop(); break;
                case 2: confirmClear(null); break;
                case 3: controller.setShuffleModeEnabled(!controller.getShuffleModeEnabled()); break;
                case 4: cycleRepeat(); break;
                default: break;
            }
            return true;
        });
        menu.show();
    }

    /**
     * On this phone, the session's own Stop (what the car and the notification use): it also
     * clears the queue and the widget. A screen's Stop is the player command.
     */
    private void stop() {
        SessionCommand own = new SessionCommand(CarControls.STOP_ACTION, Bundle.EMPTY);
        if (!remote() && controller.isSessionCommandAvailable(own)) controller.sendCustomCommand(own, Bundle.EMPTY);
        else controller.stop();
    }

    private String repeatWord() {
        int m = controller == null ? Player.REPEAT_MODE_OFF : controller.getRepeatMode();
        return m == Player.REPEAT_MODE_ONE ? "one" : m == Player.REPEAT_MODE_ALL ? "all" : "off";
    }

    private void cycleRepeat() {
        int m = controller.getRepeatMode();
        controller.setRepeatMode(m == Player.REPEAT_MODE_OFF ? Player.REPEAT_MODE_ALL
                : m == Player.REPEAT_MODE_ALL ? Player.REPEAT_MODE_ONE : Player.REPEAT_MODE_OFF);
    }

    private void confirmClear(Dialog sheet) {
        if (controller == null) return;
        new AlertDialog.Builder(this)
                .setMessage(remote() ? "Clear the queue on " + targetName + "?" : "Clear the queue?")
                .setPositiveButton("Clear", (d, w) -> {
                    if (controller != null) controller.clearMediaItems();
                    if (sheet != null) sheet.dismiss();
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    /**
     * While a screen is the target, the volume keys set its volume (Jellyfin hides its
     * slider where there are physical keys). On this phone they stay the phone's.
     */
    @Override public boolean onKeyDown(int keyCode, KeyEvent event) {
        boolean up = keyCode == KeyEvent.KEYCODE_VOLUME_UP, down = keyCode == KeyEvent.KEYCODE_VOLUME_DOWN;
        if ((up || down) && remote() && can(Player.COMMAND_SET_DEVICE_VOLUME_WITH_FLAGS)) {
            // The level is worked out from the one before and set outright, so what the line
            // says, the player's placeholder and what the screen is asked for are one number.
            int level = Math.max(0, Math.min(100, controller.getDeviceVolume() + (up ? 1 : -1) * ScreenCommands.VOLUME_STEP));
            controller.setDeviceVolume(level, 0);
            volumeLine = "Volume " + level + " on " + targetName;
            main.removeCallbacks(clearVolumeLine);
            main.postDelayed(clearVolumeLine, 1500);
            render();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    // ── layout ───────────────────────────────────────────────────────────────

    private void buildViews() {
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(PAPER);
        scroll.setFillViewport(true);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(dp(20), dp(12), dp(12), dp(24));
        scroll.addView(col);

        // The target, and the ⋮ menu: the only chrome.
        LinearLayout top = new LinearLayout(this);
        top.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout pick = new LinearLayout(this);
        pick.setGravity(Gravity.CENTER_VERTICAL);
        pick.setMinimumHeight(dp(48));
        targetIcon = new ImageView(this);
        targetIcon.setImageTintList(ColorStateList.valueOf(GREEN));
        pick.addView(targetIcon, new LinearLayout.LayoutParams(dp(20), dp(20)));
        targetLabel = text("", 15, GREEN);
        targetLabel.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        targetLabel.setPaddingRelative(dp(8), 0, dp(2), 0);
        pick.addView(targetLabel);
        ImageView caret = new ImageView(this);
        caret.setImageResource(R.drawable.daylight_np_expand);
        caret.setImageTintList(ColorStateList.valueOf(GREEN));
        pick.addView(caret, new LinearLayout.LayoutParams(dp(20), dp(20)));
        pick.setOnClickListener(v -> openTargets());
        pick.setContentDescription("Choose where to play");
        top.addView(pick, new LinearLayout.LayoutParams(0, -2, 1));
        more = icon(R.drawable.daylight_np_more, "More", INK, this::openMore);
        top.addView(more, new LinearLayout.LayoutParams(dp(48), dp(48)));
        col.addView(top);

        art = new ImageView(this);
        art.setScaleType(ImageView.ScaleType.CENTER_CROP);
        art.setBackground(round(LINE, 12));
        art.setClipToOutline(true);
        art.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        int side = Math.min(getResources().getDisplayMetrics().widthPixels - dp(40), dp(380));
        LinearLayout.LayoutParams artLp = new LinearLayout.LayoutParams(side, side);
        artLp.gravity = Gravity.CENTER_HORIZONTAL;
        artLp.topMargin = dp(8);
        col.addView(art, artLp);

        title = text("", 22, INK);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        title.setPadding(0, dp(20), dp(8), 0);
        title.setMaxLines(2);
        title.setEllipsize(TextUtils.TruncateAt.END);
        col.addView(title);
        subtitle = text("", 16, MUTED);
        subtitle.setMaxLines(1);
        subtitle.setEllipsize(TextUtils.TruncateAt.END);
        col.addView(subtitle);

        seek = new SeekBar(this);
        seek.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar bar, int progress, boolean fromUser) { if (fromUser) tickPosition(); }
            @Override public void onStartTrackingTouch(SeekBar bar) { dragging = true; }
            @Override public void onStopTrackingTouch(SeekBar bar) {
                dragging = false;
                if (controller != null && can(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM)) controller.seekTo(bar.getProgress());
            }
        });
        seek.setProgressTintList(ColorStateList.valueOf(GREEN));
        seek.setThumbTintList(ColorStateList.valueOf(GREEN));
        LinearLayout.LayoutParams seekLp = new LinearLayout.LayoutParams(-1, -2);
        seekLp.topMargin = dp(16);
        col.addView(seek, seekLp);
        times = new LinearLayout(this);
        times.setPadding(dp(16), 0, dp(16), 0);
        elapsed = text("", 13, MUTED);
        remaining = text("", 13, MUTED);
        remaining.setGravity(Gravity.END);
        times.addView(elapsed, new LinearLayout.LayoutParams(0, -2, 1));
        times.addView(remaining, new LinearLayout.LayoutParams(0, -2, 1));
        col.addView(times);

        // One primary row: edge, previous, play, next, edge.
        LinearLayout transport = new LinearLayout(this);
        transport.setGravity(Gravity.CENTER_VERTICAL);
        leftEdgeBox = edgeBox(true);
        prev = icon(R.drawable.daylight_np_previous, "Previous", INK, () -> controller.seekToPrevious());
        playPause = icon(R.drawable.daylight_np_play, "Play", Color.WHITE, () -> {
            if (active(controller)) controller.pause();
            else { if (controller.getPlaybackState() == Player.STATE_IDLE) controller.prepare(); controller.play(); }
        });
        playPause.setBackground(round(GREEN, 36));
        playPause.setPadding(dp(18), dp(18), dp(18), dp(18));
        next = icon(R.drawable.daylight_np_next, "Next", INK, () -> {
            if (nextByCommand()) controller.sendCustomCommand(new SessionCommand(CarControls.NEXT_ACTION, Bundle.EMPTY), Bundle.EMPTY);
            else controller.seekToNext();
        });
        rightEdgeBox = edgeBox(false);
        transport.addView(leftEdgeBox, new LinearLayout.LayoutParams(0, dp(56), 1));
        transport.addView(prev, new LinearLayout.LayoutParams(0, dp(56), 1));
        LinearLayout.LayoutParams playLp = new LinearLayout.LayoutParams(dp(72), dp(72));
        playLp.setMarginStart(dp(8));
        playLp.setMarginEnd(dp(8));
        transport.addView(playPause, playLp);
        transport.addView(next, new LinearLayout.LayoutParams(0, dp(56), 1));
        transport.addView(rightEdgeBox, new LinearLayout.LayoutParams(0, dp(56), 1));
        LinearLayout.LayoutParams transportLp = new LinearLayout.LayoutParams(-1, -2);
        transportLp.topMargin = dp(8);
        col.addView(transport, transportLp);

        status = text("", 14, GREEN);
        status.setGravity(Gravity.CENTER_HORIZONTAL);
        status.setPadding(0, dp(12), 0, 0);
        col.addView(status);

        // Next up, and the way into the queue.
        upNextRow = new LinearLayout(this);
        upNextRow.setGravity(Gravity.CENTER_VERTICAL);
        upNextRow.setMinimumHeight(dp(52));
        upNextRow.setPaddingRelative(dp(4), 0, dp(4), 0);
        ImageView queueIcon = new ImageView(this);
        queueIcon.setImageResource(R.drawable.daylight_np_queue);
        queueIcon.setImageTintList(ColorStateList.valueOf(INK));
        upNextRow.addView(queueIcon, new LinearLayout.LayoutParams(dp(22), dp(22)));
        upNext = text("", 15, INK);
        upNext.setPaddingRelative(dp(12), 0, 0, 0);
        upNext.setMaxLines(1);
        upNext.setEllipsize(TextUtils.TruncateAt.END);
        upNextRow.addView(upNext, new LinearLayout.LayoutParams(0, -2, 1));
        upNextRow.setOnClickListener(v -> openQueue());
        upNextRow.setContentDescription("Open the queue");
        LinearLayout.LayoutParams upLp = new LinearLayout.LayoutParams(-1, -2);
        upLp.topMargin = dp(20);
        upNextRule = new View(this);
        upNextRule.setBackgroundColor(LINE);
        col.addView(upNextRule, new LinearLayout.LayoutParams(-1, 1));
        ((LinearLayout.LayoutParams) upNextRule.getLayoutParams()).topMargin = dp(20);
        col.addView(upNextRow, new LinearLayout.LayoutParams(-1, -2));

        setContentView(scroll);
        render();
    }

    /** The slot beside a skip: shuffle or repeat for music, a 10 s jump (icon with "10") for long items. */
    private FrameLayout edgeBox(boolean left) {
        FrameLayout box = new FrameLayout(this);
        ImageButton b = icon(R.drawable.daylight_np_shuffle, "", MUTED, () -> {
            if (longForm()) { if (left) controller.seekBack(); else controller.seekForward(); }
            else if (left) controller.setShuffleModeEnabled(!controller.getShuffleModeEnabled());
            else cycleRepeat();
        });
        box.addView(b, new FrameLayout.LayoutParams(-1, -1));
        TextView number = text("10", 9, INK);
        number.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        number.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        FrameLayout.LayoutParams nLp = new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER);
        nLp.topMargin = dp(2);
        box.addView(number, nLp);
        if (left) { leftEdge = b; leftEdgeNumber = number; } else { rightEdge = b; rightEdgeNumber = number; }
        return box;
    }

    /** An icon button whose action runs only while a controller is connected. */
    private ImageButton icon(int drawable, String description, int tint, Runnable action) {
        ImageButton b = new ImageButton(this);
        b.setImageResource(drawable);
        b.setImageTintList(ColorStateList.valueOf(tint));
        b.setScaleType(ImageView.ScaleType.FIT_CENTER);
        b.setPadding(dp(12), dp(12), dp(12), dp(12));
        b.setBackground(null);
        b.setContentDescription(description);
        b.setOnClickListener(v -> {
            if (controller == null) return;
            try { action.run(); } catch (RuntimeException e) { Log.w(TAG, "now playing: " + e.getClass().getSimpleName()); }
        });
        return b;
    }

    private static void enable(View v, boolean on) {
        v.setEnabled(on);
        v.setAlpha(on ? 1f : 0.3f);
        if (v instanceof FrameLayout) for (int i = 0; i < ((FrameLayout) v).getChildCount(); i++) ((FrameLayout) v).getChildAt(i).setEnabled(on);
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

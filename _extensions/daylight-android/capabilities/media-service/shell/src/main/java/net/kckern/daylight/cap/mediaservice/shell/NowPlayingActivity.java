package net.kckern.daylight.cap.mediaservice.shell;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.text.TextUtils;
import android.util.Log;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.ScrollView;
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

import net.kckern.daylight.shellkit.CoverColor;
import net.kckern.daylight.shellkit.DaylightTheme;
import net.kckern.daylight.shellkit.DaylightTheme.Type;
import net.kckern.daylight.shellkit.PlaylistArtwork;
import net.kckern.daylight.shellkit.ThemeColors;
import net.kckern.daylight.shellkit.UiTelemetry;

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
 * Layout, after Plexamp (ops:docs/superpowers/specs/2026-11-26-phone-player-parity-design.md):
 * a slim top bar (close, where it plays, the D-pad for a screen); the stage, which holds
 * the cover (swipe it to skip), the lyrics or the queue in its place; the track's
 * loudness as the seek bar, with elapsed and remaining (tap: total) beside it; artist,
 * title, album and year, centred; the audio quality; one transport row (previous, a large
 * play in a disc of the cover's color, next; long items put back and forward 10 s at its
 * edges); and one row of icons: queue, lyrics, shuffle, more, repeat, output. The page
 * takes its colors from the cover (CoverColor, DaylightTheme.withAccent) over a soft,
 * blurred copy of it. A screen's volume is the hardware keys. The status line shows only
 * when something is not right, or a sleep timer is set.
 *
 * Not exported. Opened by this app only: the setup screen, a "player:" one-tap action
 * (through the payload's media/now-playing link) and both media notifications.
 */
public class NowPlayingActivity extends Activity {
    private static final String TAG = "Daylight-Media";
    static final String EXTRA_TARGET = "target";
    static final String LOCAL = "local";
    /** Open with the D-pad shown (a screen target only): the Connect tab's remote rows. */
    static final String EXTRA_PAD = "pad";
    private static final String PREFS = "daylight.nowplaying";
    private static final int QUEUE_ROWS = 100;
    private static final int WAVE_SAMPLES = 96;

    private enum Stage { ART, LYRICS, QUEUE }

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
    /** The waveform and lyrics: never behind a screen poll or a cover. */
    private ExecutorService detailIo;
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
    /** The screen's reach as its session last said (IDLE, OFF, NOT_ON, …); empty for this phone. */
    private String remoteReach = "";
    /** Over the stage while the screen has nothing to play: what to start there, or a way out. */
    private ScrollView startBox;
    private LinearLayout startList;
    private String startShownFor = "";
    private String volumeLine = "";
    private String shownArtwork;

    private DaylightTheme base, theme;
    private int coverAccent = CoverColor.NONE;
    private Stage stage = Stage.ART;
    private final PositionClock clock = new PositionClock();
    private String clockItem = "";
    private TrackDetail.TimeDisplay timeDisplay = TrackDetail.TimeDisplay.REMAINING;
    /** The content id whose waveform, quality and lyrics are loaded (or loading). */
    private String detailFor = "";
    private String quality = "";
    private TrackDetail.Lyrics lyrics = TrackDetail.Lyrics.NONE;

    private FrameLayout root;
    private ImageView backdrop;
    private View backdropFade;
    private TextView targetLabel, title, artistLine, albumLine, qualityLine, status, elapsed, remaining, queueHeading;
    private ImageView targetIcon, targetCaret, art, lyricsCover;
    /** On the cover when the track has lyrics: says so, and opens them. */
    private TextView lyricsBadge;
    private AspectFrame artFrame;
    private LinearLayout pick, transport, bottom;
    private WaveformBar wave;
    private LyricsView lyricsView;
    private ScrollView queueScroll;
    private LinearLayout queueBox;
    private LinearLayout queueList;
    private ImageButton close, playPause, prev, next, leftEdge, rightEdge, padToggle;
    private ImageButton queueButton, lyricsButton, shuffleButton, moreButton, repeatButton, outputButton;
    private TextView leftEdgeNumber, rightEdgeNumber, clearButton;
    /** In the shuffle slot for long items: the speed ("1.2×"); music has no speed. */
    private TextView speedButton;
    private FrameLayout leftEdgeBox, rightEdgeBox, stageBox;
    private LinearLayout player, pad;
    private TextView padStatus;
    private boolean padShown;
    /** D-pad presses: one at a time, in order, apart from the player's reads and commands. */
    private ExecutorService padIo;
    private final Runnable clearPadStatus = this::render;
    /** Until when the pad's line shows a press's answer; after it, the screen's own status. */
    private long padLineUntil;
    /** A press still waiting this long is not sent: a late OK on a menu is worse than none (R5). */
    private static final long PAD_STALE_MS = 2000;
    private static final long PAD_REPEAT_FIRST_MS = 400, PAD_REPEAT_MS = 150;
    private final List<View> padSurfaces = new ArrayList<>();
    private TextView okKey, backLabel;
    private ImageView backIcon;
    private LinearLayout backKey;

    @Override protected void attachBaseContext(Context base) {
        super.attachBaseContext(DaylightTheme.wrap(base));
    }

    @Override protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        // A sheet over what was there: it rises on open and falls back down on close.
        overridePendingTransition(R.anim.daylight_np_rise, R.anim.daylight_np_hold);
        UiTelemetry.install(this);
        io = executor("Daylight-nowplaying");
        padIo = executor("Daylight-nowplaying-pad");
        artIo = executor("Daylight-nowplaying-art");
        detailIo = executor("Daylight-nowplaying-detail");
        base = DaylightTheme.of(this);
        theme = base;
        timeDisplay = TrackDetail.TimeDisplay.of(prefs().getString("time", ""));
        buildViews();
        chooseInitialTarget(getIntent(), saved);
        loadScreens();
        // Opened as a screen's remote (the phone home's Connect tab): the pad, at once.
        if (saved == null && getIntent() != null && getIntent().getBooleanExtra(EXTRA_PAD, false) && remote()) showPad(true);
        Log.i(TAG, "now playing opened, target " + target);
    }

    /** A named event for the household log store (UiTelemetry: on disk first, sent when online). */
    private void note(String name, Object... kv) {
        JSONObject d = new JSONObject();
        try {
            for (int i = 0; i + 1 < kv.length; i += 2) d.put((String) kv[i], kv[i + 1]);
            d.put("target", remote() ? "screen" : "local");
        } catch (Exception ignored) { }
        UiTelemetry.event("NowPlaying", name, d);
    }

    private static ExecutorService executor(String name) {
        return Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, name);
            t.setDaemon(true);
            return t;
        });
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String asked = intent == null ? "" : intent.getStringExtra(EXTRA_TARGET);
        if (asked != null && !asked.isEmpty() && !asked.equals(target)) switchTo(asked, nameOf(asked));
        else if (controller == null && pending == null && started) connect();
        if (intent != null && intent.getBooleanExtra(EXTRA_PAD, false) && remote()) showPad(true);
    }

    /** The target chosen here outlives a rotation; the opening intent's does not override it. */
    @Override protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        out.putString(EXTRA_TARGET, target);
        out.putString("stage", stage.name());
    }

    @Override protected void onRestoreInstanceState(Bundle saved) {
        super.onRestoreInstanceState(saved);
        String s = saved.getString("stage", "");
        for (Stage st : Stage.values()) if (st.name().equals(s)) stage = st;
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

    @Override public void finish() {
        super.finish();
        overridePendingTransition(R.anim.daylight_np_hold, R.anim.daylight_np_fall);
    }

    @Override protected void onDestroy() {
        for (ExecutorService e : new ExecutorService[] { io, artIo, padIo, detailIo }) if (e != null) e.shutdownNow();
        super.onDestroy();
    }

    /** Back leaves the lyrics or the queue for the cover before it leaves the screen. */
    @Override public void onBackPressed() {
        if (padShown) { showPad(false); return; }
        if (stage != Stage.ART) { setStage(Stage.ART); return; }
        super.onBackPressed();
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
        note("player.target", "to", LOCAL.equals(id) ? "local" : id);
        disconnect();
        target = id;
        targetName = name;
        prefs().edit().putString(EXTRA_TARGET, id).putString("name:" + id, name).apply();
        setIntent(new Intent(getIntent()).putExtra(EXTRA_TARGET, id));
        main.removeCallbacks(reconnect);
        reconnectMs = 1000;
        connectionLine = "";
        remoteStatus = "";
        remoteReach = "";
        shownArtwork = null;
        clock.reset();
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
                            remoteReach = extras.getString(RemoteControlService.EXTRA_REACH, "");
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

    private boolean canSkipNext() {
        MediaController c = controller;
        return c != null && c.getMediaItemCount() > 0
                && (can(Player.COMMAND_SEEK_TO_NEXT) || (nextByCommand() && c.hasNextMediaItem()));
    }

    private void skipNext() {
        if (controller == null) return;
        if (nextByCommand()) controller.sendCustomCommand(new SessionCommand(CarControls.NEXT_ACTION, Bundle.EMPTY), Bundle.EMPTY);
        else controller.seekToNext();
    }

    private void render() {
        MediaController c = controller;
        MediaMetadata meta = c == null ? MediaMetadata.EMPTY : c.getMediaMetadata();
        boolean hasItem = c != null && c.getMediaItemCount() > 0;
        CharSequence name = meta.title != null ? meta.title : meta.displayTitle;
        boolean idleScreen = remote() && !hasItem && "IDLE".equals(remoteReach);
        boolean offScreen = remote() && !hasItem && ("OFF".equals(remoteReach) || "NOT_ON".equals(remoteReach));
        title.setText(hasItem && !TextUtils.isEmpty(name) ? name
                : idleScreen ? "Play something on " + targetName
                : offScreen ? targetName + " is off" : "Nothing playing");
        showStart(idleScreen ? "idle" : offScreen ? "off" : "");
        title.setTextColor(hasItem ? theme.ink : theme.inkMuted);
        // A screen's player names the screen as the artist; that is the top bar's job.
        CharSequence by = remote() ? null : meta.artist;
        show(artistLine, hasItem ? by : null);
        show(albumLine, hasItem ? albumLine(meta) : null);

        String line;
        if (!volumeLine.isEmpty()) line = volumeLine;
        else if (c == null) line = pending != null ? "Connecting…" : connectionLine;
        else if (remote()) line = remoteStatus;
        else line = c.getPlayerError() != null ? "Could not play this" : "";
        if (line.isEmpty() && !remote()) line = SleepTimer.describeNow();
        status.setText(line);
        // One line, always reserved; a long message shrinks to fit rather than adding a line.
        status.setVisibility(line.isEmpty() ? View.INVISIBLE : View.VISIBLE);
        status.setContentDescription(line);

        boolean playing = active(c);
        playPause.setImageResource(playing ? R.drawable.daylight_np_pause : R.drawable.daylight_np_play);
        playPause.setContentDescription(playing ? "Pause" : "Play");
        enable(playPause, hasItem && can(Player.COMMAND_PLAY_PAUSE));
        enable(prev, hasItem && can(Player.COMMAND_SEEK_TO_PREVIOUS));
        enable(next, canSkipNext());

        boolean jumps = longForm();
        leftEdgeBox.setVisibility(jumps ? View.VISIBLE : View.INVISIBLE);
        rightEdgeBox.setVisibility(jumps ? View.VISIBLE : View.INVISIBLE);
        enable(leftEdgeBox, jumps && can(Player.COMMAND_SEEK_BACK));
        enable(rightEdgeBox, jumps && can(Player.COMMAND_SEEK_FORWARD));

        boolean shuffled = c != null && c.getShuffleModeEnabled();
        int mode = c == null ? Player.REPEAT_MODE_OFF : c.getRepeatMode();
        toggle(shuffleButton, shuffled, hasItem && can(Player.COMMAND_SET_SHUFFLE_MODE), shuffled ? "Shuffle, on" : "Shuffle, off");
        // Long items trade shuffle for speed; music never shows one (the session holds it at 1x).
        float speed = c == null ? 1f : c.getPlaybackParameters().speed;
        shuffleButton.setVisibility(jumps ? View.GONE : View.VISIBLE);
        speedButton.setVisibility(jumps ? View.VISIBLE : View.GONE);
        speedButton.setText(LongForm.speedLabel(speed));
        speedButton.setTextColor(Math.abs(speed - 1f) > 0.001f ? theme.primary : theme.ink);
        speedButton.setContentDescription("Speed " + LongForm.speedLabel(speed));
        enable(speedButton, jumps && can(Player.COMMAND_SET_SPEED_AND_PITCH));
        repeatButton.setImageResource(mode == Player.REPEAT_MODE_ONE ? R.drawable.daylight_np_repeat_one : R.drawable.daylight_np_repeat);
        toggle(repeatButton, mode != Player.REPEAT_MODE_OFF, hasItem && can(Player.COMMAND_SET_REPEAT_MODE),
                mode == Player.REPEAT_MODE_ONE ? "Repeat one" : mode == Player.REPEAT_MODE_ALL ? "Repeat all" : "Repeat, off");
        toggle(queueButton, stage == Stage.QUEUE, hasItem, stage == Stage.QUEUE ? "Hide the queue" : "Queue");
        toggle(lyricsButton, stage == Stage.LYRICS, hasItem && !lyrics.isEmpty(),
                lyrics.isEmpty() ? "No lyrics" : stage == Stage.LYRICS ? "Hide the lyrics" : "Lyrics");
        // Lyrics to be had read as ink, not the muted grey of a toggle that is off.
        if (stage != Stage.LYRICS && !lyrics.isEmpty()) lyricsButton.setImageTintList(ColorStateList.valueOf(theme.ink));
        lyricsBadge.setText(lyrics.synced ? "Lyrics" : "Lyrics (text)");
        lyricsBadge.setVisibility(hasItem && !lyrics.isEmpty() && stage == Stage.ART ? View.VISIBLE : View.GONE);
        toggle(outputButton, remote(), true, "Play on: " + targetName);
        enable(moreButton, hasItem || (!remote() && SleepTimer.isSet()));
        if (stage == Stage.LYRICS && lyrics.isEmpty()) setStage(Stage.ART);
        if (!hasItem && stage != Stage.ART) setStage(Stage.ART);

        padToggle.setVisibility(remote() ? View.VISIBLE : View.GONE);
        padToggle.setImageTintList(ColorStateList.valueOf(padShown ? theme.primary : theme.ink));
        if (!remote() && padShown) showPad(false);
        // On the pad, the screen's own state (off, not on, can't reach home) when no press is being answered.
        if (padShown && SystemClock.elapsedRealtime() >= padLineUntil) padStatus.setText(line);

        loadDetail(hasItem ? c.getCurrentMediaItem() : null);
        renderArtwork(hasItem ? meta.artworkUri : null, hasItem);
        renderTargets();
        if (stage == Stage.QUEUE) fillQueue();
        tickPosition();
    }

    /**
     * Sets a line that may be empty. Its space is kept either way (INVISIBLE, never GONE):
     * details arrive after the first draw, and the screen must not move when they do.
     */
    private static void show(TextView v, CharSequence text) {
        v.setText(TextUtils.isEmpty(text) ? "" : text);
        v.setVisibility(TextUtils.isEmpty(text) ? View.INVISIBLE : View.VISIBLE);
    }

    /** "All Eyez On Me (1996)", the album alone, or the year alone. */
    private static String albumLine(MediaMetadata meta) {
        String album = meta.albumTitle == null ? "" : meta.albumTitle.toString();
        Integer year = meta.releaseYear != null ? meta.releaseYear : meta.recordingYear;
        if (year == null || year <= 0) return album;
        return album.isEmpty() ? String.valueOf(year) : album + " (" + year + ")";
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

    /** A row icon that says its state by tint: the accent when on, muted ink when off. */
    private void toggle(ImageButton b, boolean on, boolean enabled, String description) {
        b.setImageTintList(ColorStateList.valueOf(on ? theme.primary : theme.inkMuted));
        b.setContentDescription(description);
        b.setSelected(on);
        enable(b, enabled);
    }

    private void tickPosition() {
        main.removeCallbacks(ticker);
        MediaController c = controller;
        long duration = c == null ? C.TIME_UNSET : c.getDuration();
        boolean known = duration != C.TIME_UNSET && duration > 0;
        boolean any = c != null && c.getMediaItemCount() > 0;
        String item = any && c.getCurrentMediaItem() != null ? c.getCurrentMediaItem().mediaId : "";
        if (!item.equals(clockItem)) { clock.reset(); clockItem = item; }
        long now = SystemClock.elapsedRealtime();
        if (c != null) clock.report(Math.max(0, c.getCurrentPosition()), c.isPlaying(), now);
        long position = clock.at(now);
        if (known) position = Math.min(position, duration);
        wave.setEnabled(known && can(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM));
        wave.setDurationMs(known ? duration : 0);
        wave.setVisibility(any ? View.VISIBLE : View.INVISIBLE);
        if (!wave.scrubbing()) {
            wave.setFraction(known ? position / (float) duration : 0f, clock(position) + (known ? " of " + clock(duration) : ""));
            elapsed.setText(any ? clock(position) : "");
            remaining.setText(known ? timeDisplay.right(position, duration, c.getPlaybackParameters().speed) : "");
        }
        if (stage == Stage.LYRICS) lyricsView.setPosition(position);
        if (c != null && c.isPlaying()) main.postDelayed(ticker, stage == Stage.LYRICS ? 100 : 200);
        else if (c != null) main.postDelayed(ticker, 1000);
    }

    // ── the track's waveform, quality and lyrics ─────────────────────────────

    private void loadDetail(MediaItem item) {
        String id = item == null ? "" : item.mediaId;
        if (id == null || id.indexOf(':') <= 0) id = "";
        if (id.equals(detailFor)) return;
        detailFor = id;
        wave.setSamples(null);
        quality = "";
        show(qualityLine, null);
        lyrics = TrackDetail.Lyrics.NONE;
        lyricsView.setLyrics(lyrics);
        if (id.isEmpty()) return;
        final String forId = id;
        detailIo.execute(() -> {
            JSONObject levels = ask(() -> media.trackLevels(forId, WAVE_SAMPLES, 8000));
            main.post(() -> {
                if (!forId.equals(detailFor)) return;
                wave.setSamples(TrackDetail.samples(levels));
                quality = TrackDetail.quality(levels);
                show(qualityLine, quality);
            });
            JSONObject words = ask(() -> media.trackLyrics(forId, 10000));
            main.post(() -> {
                if (!forId.equals(detailFor)) return;
                lyrics = TrackDetail.lyrics(words);
                lyricsView.setLyrics(lyrics);
                Log.i(TAG, "now playing detail: lyrics " + (lyrics.isEmpty() ? "none" : lyrics.synced ? "synced" : "plain"));
                note("player.detail", "waveform", wave != null && levels != null && TrackDetail.samples(levels).length > 0,
                        "quality", !quality.isEmpty(), "lyrics", lyrics.isEmpty() ? "none" : lyrics.synced ? "synced" : "plain");
                render();
            });
        });
    }

    private interface Call { String run() throws Exception; }

    /** A payload answer, or null when it failed or had none. Missing detail is never an error on screen. */
    private static JSONObject ask(Call call) {
        try {
            JSONObject reply = new JSONObject(call.run());
            return reply.optBoolean("ok", false) && !reply.optBoolean("none", false) ? reply : null;
        } catch (Exception unavailable) {
            Log.i(TAG, "now playing detail unavailable: " + unavailable.getClass().getSimpleName());
            return null;
        }
    }

    // ── the cover ────────────────────────────────────────────────────────────

    /**
     * The picture, in its own shape, its color on the page, and a soft copy of it behind
     * everything. With none, the box says so plainly: a note for an item that has no art,
     * and the target's icon when nothing plays.
     */
    private void renderArtwork(Uri uri, boolean hasItem) {
        String key = (uri == null ? "" : uri.toString()) + "|" + hasItem + "|" + target;
        if (key.equals(shownArtwork)) return;
        shownArtwork = key;
        placeholder(hasItem ? R.drawable.daylight_np_note : targetIcon(target));
        if (uri == null) { setAccent(CoverColor.NONE, null); return; }
        String url = uri.toString();
        artIo.execute(() -> {
            Bitmap bitmap = PlaylistArtwork.load(url, 900);
            int accent = CoverColor.NONE;
            Bitmap soft = null;
            if (bitmap != null) {
                Bitmap small = Bitmap.createScaledBitmap(bitmap, 32, 32, true);
                int[] px = new int[32 * 32];
                small.getPixels(px, 0, 32, 0, 0, 32, 32);
                accent = CoverColor.of(px);
                // A tiny copy drawn large and filtered is a blur on every Android version.
                soft = Bitmap.createScaledBitmap(bitmap, 12, 12, true);
            }
            int a = accent;
            Bitmap s = soft;
            main.post(() -> {
                if (!key.equals(shownArtwork) || bitmap == null) return;
                art.setImageTintList(null);
                art.setPadding(0, 0, 0, 0);
                // The box is square from the first draw and stays so (no jump when a picture
                // arrives): a square cover fills it; a video's wide still sits letterboxed in it.
                boolean wide = bitmap.getWidth() > bitmap.getHeight() * 1.2f;
                art.setScaleType(wide ? ImageView.ScaleType.FIT_CENTER : ImageView.ScaleType.CENTER_CROP);
                art.setImageBitmap(bitmap);
                setAccent(a, s);
            });
        });
    }

    private void placeholder(int icon) {
        art.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        art.setImageResource(icon);
        art.setImageTintList(ColorStateList.valueOf(theme.inkMuted));
        int pad = dp(72);
        art.setPadding(pad, pad, pad, pad);
        artFrame.setRatio(1f);
    }

    private void setAccent(int accent, Bitmap soft) {
        backdrop.setImageBitmap(soft);
        backdrop.setVisibility(soft == null ? View.GONE : View.VISIBLE);
        if (accent == coverAccent) return;
        coverAccent = accent;
        theme = base.withAccent(accent);
        applyTheme();
    }

    // ── the stage: cover, lyrics or queue ────────────────────────────────────

    private void setStage(Stage s) {
        if (stage == s) return;
        stage = s;
        crossfade(artFrame, s == Stage.ART);
        crossfade(lyricsView, s == Stage.LYRICS);
        crossfade(queueBox, s == Stage.QUEUE);
        if (s == Stage.LYRICS) lyricsCover.setImageDrawable(art.getDrawable());
        crossfade(lyricsCover, s == Stage.LYRICS);
        if (s == Stage.QUEUE) {
            fillQueue();
            scrollQueueToCurrent();
        }
        Log.i(TAG, "now playing stage " + s.name().toLowerCase(Locale.ROOT));
        note("player.stage", "to", s.name().toLowerCase(Locale.ROOT));
        render();
    }

    /** Shows or hides a stage view with a short fade, so cover and lyrics swap without a jump. */
    private static void crossfade(View v, boolean show) {
        v.animate().cancel();
        if (show) {
            if (v.getVisibility() != View.VISIBLE) { v.setAlpha(0f); v.setVisibility(View.VISIBLE); }
            v.animate().alpha(1f).setDuration(180).start();
        } else if (v.getVisibility() == View.VISIBLE) {
            v.animate().alpha(0f).setDuration(120).withEndAction(() -> { v.setVisibility(View.GONE); v.setAlpha(1f); }).start();
        }
    }

    private void fillQueue() {
        queueList.removeAllViews();
        MediaController c = controller;
        Timeline timeline = c == null ? Timeline.EMPTY : c.getCurrentTimeline();
        int count = timeline.getWindowCount();
        int current = c == null ? -1 : c.getCurrentMediaItemIndex();
        boolean playing = active(c);
        boolean jump = can(Player.COMMAND_SEEK_TO_MEDIA_ITEM), change = can(Player.COMMAND_CHANGE_MEDIA_ITEMS);
        clearButton.setVisibility(change && count > 0 ? View.VISIBLE : View.GONE);
        queueHeading.setText(count == 0 ? "Queue" : "Queue · " + count);
        Timeline.Window window = new Timeline.Window();
        if (count == 0) queueList.addView(theme.text(this, "The queue is empty", Type.BODY, theme.inkMuted, false));
        for (int i = 0; i < count && i < QUEUE_ROWS; i++) {
            final int index = i;
            MediaItem item = timeline.getWindow(i, window).mediaItem;
            CharSequence name = item.mediaMetadata.title != null ? item.mediaMetadata.title : item.mediaId;
            CharSequence by = remote() ? null : item.mediaMetadata.artist;
            boolean now = i == current;
            LinearLayout row = new LinearLayout(this);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setMinimumHeight(dp(56));
            row.setBackground(theme.pressable(null));
            ImageView mark = new ImageView(this);
            if (now) {
                mark.setImageResource(playing ? R.drawable.daylight_np_play : R.drawable.daylight_np_pause);
                mark.setImageTintList(ColorStateList.valueOf(theme.primary));
                mark.setContentDescription(playing ? "Playing" : "Paused");
            }
            row.addView(mark, new LinearLayout.LayoutParams(dp(28), dp(20)));
            LinearLayout words = new LinearLayout(this);
            words.setOrientation(LinearLayout.VERTICAL);
            TextView label = theme.text(this, name.toString(), Type.BODY, now ? theme.primary : theme.ink, now);
            label.setMaxLines(1);
            label.setEllipsize(TextUtils.TruncateAt.END);
            words.addView(label);
            if (!TextUtils.isEmpty(by)) {
                TextView who = theme.text(this, by, Type.LABEL, theme.inkMuted, false);
                who.setMaxLines(1);
                who.setEllipsize(TextUtils.TruncateAt.END);
                words.addView(who);
            }
            row.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
            UiTelemetry.tag(row, now ? "queue.current" : "queue.row");
            if (jump && !now) {
                row.setOnClickListener(v -> { if (controller != null) controller.seekToDefaultPosition(index); });
                row.setContentDescription("Play " + name);
            }
            if (change) {
                ImageButton remove = icon(R.drawable.daylight_np_remove, "Remove " + name, theme.inkMuted,
                        () -> controller.removeMediaItem(index));
                UiTelemetry.tag(remove, "queue.remove");
                row.addView(remove, new LinearLayout.LayoutParams(dp(44), dp(44)));
            }
            queueList.addView(row, new LinearLayout.LayoutParams(-1, -2));
        }
        if (count > QUEUE_ROWS) queueList.addView(theme.text(this, "and " + (count - QUEUE_ROWS) + " more", Type.LABEL, theme.inkMuted, false));
    }

    private void scrollQueueToCurrent() {
        int current = controller == null ? 0 : controller.getCurrentMediaItemIndex();
        queueScroll.post(() -> {
            View row = queueList.getChildAt(Math.max(0, current - 1));
            if (row != null) queueScroll.scrollTo(0, row.getTop());
        });
    }

    // ── an idle or off screen: what to start there, or a way out ─────────────

    /**
     * A screen with nothing on it is a place to start something, not a status to read:
     * Continue listening and your playlists, each started there with one tap, and its own
     * menu through the D-pad. An off screen offers this phone instead. "" hides it.
     */
    private void showStart(String mode) {
        String key = mode.isEmpty() ? "" : mode + ":" + target;
        if (key.equals(startShownFor)) return;
        startShownFor = key;
        boolean on = !mode.isEmpty();
        crossfade(startBox, on);
        crossfade(artFrame, !on && stage == Stage.ART);
        if (!on) return;
        startList.removeAllViews();
        note("player.start-panel", "mode", mode);
        if (mode.equals("off")) {
            startList.addView(startRow(R.drawable.daylight_np_cast, "Play on this phone instead",
                    "Pick another player, or turn " + targetName + " on", "start.local", () -> switchTo(LOCAL, "This phone"), null));
            startList.addView(startRow(R.drawable.daylight_np_cast, "Play on another screen", null, "start.targets", this::openTargets, null));
            return;
        }
        String cached = getSharedPreferences("daylight.home", MODE_PRIVATE).getString("continue", "");
        try {
            JSONArray items = cached.isEmpty() ? new JSONArray() : new JSONArray(cached);
            if (items.length() > 0) startList.addView(startHeading("Continue listening"));
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.optJSONObject(i);
                if (item == null) continue;
                String id = contentOf(item.optString("id")), title = item.optString("title");
                if (id.isEmpty()) continue;
                startList.addView(startRow(0, title, item.optString("subtitle"), "start.continue",
                        () -> startOnScreen("play", id, false, title), item.optString("art")));
            }
        } catch (Exception unreadable) { /* the Play tab fills this cache; without it the list is shorter */ }
        java.util.List<net.kckern.daylight.shellkit.DrivingRadioSettings.Staple> mine =
                new net.kckern.daylight.shellkit.DrivingRadioSettings(this).staged();
        if (!mine.isEmpty()) startList.addView(startHeading("Your playlists"));
        for (net.kckern.daylight.shellkit.DrivingRadioSettings.Staple p : mine) {
            String id = contentOf(p.id);
            startList.addView(startRow(0, p.title, null, "start.playlist",
                    () -> startOnScreen("queue", id, true, p.title), p.art));
        }
        startList.addView(startHeading("Or"));
        startList.addView(startRow(R.drawable.daylight_np_dpad, "Browse on " + targetName,
                "Its own menu, with the phone as the remote", "start.browse", () -> showPad(true), null));
    }

    private static String contentOf(String mediaId) {
        return mediaId != null && mediaId.startsWith("c:") ? mediaId.substring(2) : mediaId == null ? "" : mediaId;
    }

    private TextView startHeading(String words) {
        TextView h = theme.text(this, words, Type.LABEL, theme.inkMuted, true);
        h.setPadding(dp(4), dp(14), 0, dp(6));
        return h;
    }

    private View startRow(int icon, String title, String sub, String tag, Runnable tap, String art) {
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setMinimumHeight(dp(60));
        row.setPadding(dp(8), dp(6), dp(8), dp(6));
        row.setBackground(theme.pressable(null));
        ImageView cover = new ImageView(this);
        cover.setScaleType(icon != 0 ? ImageView.ScaleType.CENTER_INSIDE : ImageView.ScaleType.CENTER_CROP);
        cover.setClipToOutline(true);
        cover.setBackground(theme.round(theme.surfaceVariant, DaylightTheme.Radius.SMALL));
        if (icon != 0) {
            cover.setImageResource(icon);
            cover.setImageTintList(ColorStateList.valueOf(theme.ink));
            cover.setPadding(dp(12), dp(12), dp(12), dp(12));
        }
        row.addView(cover, new LinearLayout.LayoutParams(dp(48), dp(48)));
        if (art != null && !art.isEmpty() && io != null) io.execute(() -> {
            Bitmap b = net.kckern.daylight.shellkit.PlaylistArtwork.load(art, 144);
            if (b != null) main.post(() -> cover.setImageBitmap(b));
        });
        LinearLayout words = new LinearLayout(this);
        words.setOrientation(LinearLayout.VERTICAL);
        words.setPaddingRelative(dp(12), 0, 0, 0);
        TextView t = theme.text(this, title, Type.BODY, theme.ink, true);
        t.setMaxLines(1);
        t.setEllipsize(TextUtils.TruncateAt.END);
        words.addView(t);
        if (!TextUtils.isEmpty(sub)) {
            TextView s = theme.text(this, sub, Type.LABEL, theme.inkMuted, false);
            s.setMaxLines(1);
            s.setEllipsize(TextUtils.TruncateAt.END);
            words.addView(s);
        }
        row.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
        row.setContentDescription(title);
        UiTelemetry.tag(row, tag);
        row.setOnClickListener(v -> tap.run());
        return row;
    }

    /** One tap starts it on the screen (the web's Play on); the player then follows what the screen does. */
    private void startOnScreen(String how, String contentId, boolean shuffle, String title) {
        final String device = target, name = targetName;
        volumeLine = "Starting " + title + " on " + name + "…";
        render();
        note("player.start", "how", how);
        io.execute(() -> {
            String line;
            try {
                JSONObject request = new JSONObject().put("op", "screen-command").put("device", device)
                        .put("command", "load").put(how, contentId);
                if (shuffle) request.put("shuffle", true);
                JSONObject reply = new JSONObject(media.screenCommand(request, 45_000));
                boolean ok = reply.optBoolean("accepted", false);
                line = ok ? "" : "no_answer".equals(reply.optString("code"))
                        ? name + " has not answered yet" : name + " could not start it";
                if (!ok) Log.w(TAG, "start on screen refused " + reply.optInt("status") + " " + reply.optString("code"));
            } catch (Exception failed) {
                line = "Can't reach home";
                Log.w(TAG, "start on screen failed", failed);
            }
            String said = line;
            main.post(() -> {
                if (!device.equals(target)) return;
                volumeLine = said;
                render();
                if (!said.isEmpty()) main.postDelayed(() -> { if (said.equals(volumeLine)) { volumeLine = ""; render(); } }, 6000);
            });
        });
    }

    // ── targets, menus ───────────────────────────────────────────────────────

    /** The target button: which player this screen drives. */
    private void renderTargets() {
        targetIcon.setImageResource(targetIcon(target));
        targetLabel.setText(remote() ? targetName : "This phone");
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
        AlertDialog dialog = new AlertDialog.Builder(this, DaylightTheme.alert()).setTitle("Play on").setView(col).create();
        for (int i = 0; i < ids.size(); i++) {
            String id = ids.get(i), label = names.get(i);
            boolean on = id.equals(target);
            LinearLayout row = new LinearLayout(this);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setMinimumHeight(dp(52));
            row.setPaddingRelative(dp(12), 0, dp(12), 0);
            row.setBackground(base.pressable(null));
            ImageView kind = new ImageView(this);
            kind.setImageResource(targetIcon(id));
            kind.setImageTintList(ColorStateList.valueOf(on ? base.primary : base.ink));
            row.addView(kind, new LinearLayout.LayoutParams(dp(24), dp(24)));
            LinearLayout words = new LinearLayout(this);
            words.setOrientation(LinearLayout.VERTICAL);
            words.setPaddingRelative(dp(16), 0, 0, 0);
            TextView t = base.text(this, label, Type.BODY, on ? base.primary : base.ink, on);
            words.addView(t);
            // What each player is doing, checked as the list opens; the line is reserved so rows
            // do not jump when the answers arrive.
            TextView state = base.text(this, LOCAL.equals(id) ? "Ready" : "Checking…", Type.LABEL, base.inkMuted, false);
            state.setMaxLines(1);
            state.setEllipsize(TextUtils.TruncateAt.END);
            words.addView(state);
            row.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
            if (on) {
                ImageView check = new ImageView(this);
                check.setImageResource(R.drawable.daylight_np_check);
                check.setImageTintList(ColorStateList.valueOf(base.primary));
                row.addView(check, new LinearLayout.LayoutParams(dp(24), dp(24)));
            }
            row.setContentDescription(on ? label + ", playing here" : "Play on " + label);
            UiTelemetry.tag(row, "play-on." + (LOCAL.equals(id) ? "local" : id));
            row.setOnClickListener(v -> { dialog.dismiss(); if (!id.equals(target)) switchTo(id, label); });
            col.addView(row);
            if (!LOCAL.equals(id) && io != null) io.execute(() -> {
                ScreenSnapshot snap;
                try { snap = ScreenSnapshot.parse(new JSONObject(media.screenSession(id, 4000))); }
                catch (Exception unreachable) { snap = ScreenSnapshot.unreachable(); }
                ScreenSnapshot answer = snap;
                main.post(() -> markTarget(row, kind, t, state, answer, on));
            });
        }
        if (!screensProblem.isEmpty()) {
            TextView note = base.text(this, screensProblem, Type.LABEL, base.inkMuted, false);
            note.setPaddingRelative(dp(12), dp(8), dp(12), 0);
            col.addView(note);
        }
        dialog.show();
    }

    /**
     * A player that is off cannot be picked: it is greyed, says Off, and a tap does nothing
     * (the one in use stays pickable so it can be seen). Idle and playing say so.
     */
    private void markTarget(View row, ImageView kind, TextView name, TextView state, ScreenSnapshot snap, boolean current) {
        ScreenSnapshot.Entry now = snap.currentEntry();
        boolean off = snap.reach == ScreenSnapshot.Reach.OFF || snap.reach == ScreenSnapshot.Reach.NOT_ON;
        String line;
        switch (snap.reach) {
            case OFF: case NOT_ON: line = "Off"; break;
            case IDLE: line = "Nothing playing"; break;
            case PLAYING_OR_PAUSED:
                line = (now == null ? "" : now.title) + ("playing".equals(snap.state) ? "" : " · paused");
                if (line.trim().isEmpty() || line.startsWith(" ·")) line = "playing".equals(snap.state) ? "Playing" : "Paused";
                break;
            default: line = "Can't check";
        }
        state.setText(line);
        if (off && !current) {
            row.setAlpha(0.45f);
            row.setEnabled(false);
            row.setClickable(false);
            row.setContentDescription(name.getText() + ", off");
        }
    }

    private void openMore() {
        PopupMenu menu = new PopupMenu(this, moreButton);
        boolean any = controller != null && controller.getMediaItemCount() > 0;
        if (!remote() && any) menu.getMenu().add(0, 5, 0, SleepTimer.isSet() ? "Sleep timer: " + SleepTimer.describeNow() : "Sleep timer…");
        else if (!remote() && SleepTimer.isSet()) menu.getMenu().add(0, 5, 0, "Sleep timer: " + SleepTimer.describeNow());
        if (can(Player.COMMAND_STOP) && any) menu.getMenu().add(0, 1, 0, remote() ? "Stop on " + targetName : "Stop");
        if (can(Player.COMMAND_CHANGE_MEDIA_ITEMS) && any) menu.getMenu().add(0, 2, 0, "Clear queue");
        menu.setOnMenuItemClickListener(item -> {
            if (controller == null) return true;
            switch (item.getItemId()) {
                case 1: stop(); break;
                case 2: confirmClear(); break;
                case 5: chooseSleep(); break;
                default: break;
            }
            return true;
        });
        menu.show();
    }

    /**
     * The speed for long items: the presets, the current one checked. The session keeps the
     * choice for this collection and as the default for long items not set yet; music stays 1x.
     */
    private void chooseSpeed() {
        float now = controller.getPlaybackParameters().speed;
        String[] labels = new String[LongForm.SPEEDS.length];
        int checked = -1;
        for (int i = 0; i < labels.length; i++) {
            labels[i] = LongForm.speedLabel(LongForm.SPEEDS[i]);
            if (Math.abs(LongForm.SPEEDS[i] - now) < 0.001f) checked = i;
        }
        new AlertDialog.Builder(this, DaylightTheme.alert())
                .setTitle("Speed")
                .setSingleChoiceItems(labels, checked, (d, which) -> {
                    d.dismiss();
                    if (controller == null) return;
                    controller.setPlaybackSpeed(LongForm.SPEEDS[which]);
                    note("player.speed", "speed", LongForm.SPEEDS[which]);
                    main.postDelayed(this::render, 150);
                })
                .show();
    }

    private static final int[] SLEEP_MINUTES = { 0, 15, 30, 45, 60, SleepTimer.END_OF_ITEM };

    /** Pause later: in N minutes or at the end of this item. Set in the phone's session, so it holds with the screen closed. */
    private void chooseSleep() {
        String[] labels = { "Off", "15 minutes", "30 minutes", "45 minutes", "1 hour", "At the end of this" };
        new AlertDialog.Builder(this, DaylightTheme.alert())
                .setTitle("Sleep timer")
                .setItems(labels, (d, which) -> {
                    if (controller == null) return;
                    Bundle args = new Bundle();
                    args.putInt(SleepTimer.ARG_MINUTES, SLEEP_MINUTES[which]);
                    controller.sendCustomCommand(new SessionCommand(SleepTimer.ACTION, Bundle.EMPTY), args);
                    note("player.sleep", "minutes", SLEEP_MINUTES[which]);
                    main.postDelayed(this::render, 200);
                })
                .show();
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

    private void cycleRepeat() {
        int m = controller.getRepeatMode();
        controller.setRepeatMode(m == Player.REPEAT_MODE_OFF ? Player.REPEAT_MODE_ALL
                : m == Player.REPEAT_MODE_ALL ? Player.REPEAT_MODE_ONE : Player.REPEAT_MODE_OFF);
    }

    private void confirmClear() {
        if (controller == null) return;
        new AlertDialog.Builder(this, DaylightTheme.alert())
                .setMessage(remote() ? "Clear the queue on " + targetName + "?" : "Clear the queue?")
                .setPositiveButton("Clear", (d, w) -> {
                    if (controller != null) controller.clearMediaItems();
                    setStage(Stage.ART);
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

    // ── the D-pad: the phone as a TV remote for a screen-framework screen ─────

    private void showPad(boolean on) {
        padShown = on && remote();
        pad.setVisibility(padShown ? View.VISIBLE : View.GONE);
        player.setVisibility(padShown ? View.GONE : View.VISIBLE);
        padToggle.setImageTintList(ColorStateList.valueOf(padShown ? theme.primary : theme.ink));
        padToggle.setContentDescription(padShown ? "Show the player" : "Remote control");
        Log.i(TAG, "now playing pad " + (padShown ? "shown" : "hidden") + " for " + target);
    }

    /**
     * One press to the target screen. Sent on the pad's own thread, in order; a press
     * that waited over PAD_STALE_MS is dropped. Never retried. The answer is the screen's
     * own: delivered (200), off (409), no answer (502).
     */
    private void press(String action, String direction) {
        if (!remote()) return;
        final String device = target, name = targetName;
        final long queuedAt = SystemClock.elapsedRealtime();
        final String what = action + (direction == null ? "" : " " + direction);
        padIo.execute(() -> {
            if (SystemClock.elapsedRealtime() - queuedAt > PAD_STALE_MS) {
                Log.i(TAG, "remote input " + what + " not sent: waited too long");
                main.post(() -> padLine("Too slow to send; try again"));
                return;
            }
            JSONObject reply;
            try {
                JSONObject request = new JSONObject().put("op", "screen-command").put("device", device)
                        .put("command", "input").put("action", action);
                if (direction != null) request.put("direction", direction);
                reply = new JSONObject(media.screenCommand(request, 4000));
            } catch (Exception unreachable) {
                reply = null;
            }
            JSONObject answered = reply;
            Log.i(TAG, "remote input " + what + " -> " + (answered == null ? "unreachable"
                    : (answered.optInt("status", 0) + " " + answered.optString("code", "")).trim()));
            note("remote.input", "action", action, "direction", direction == null ? "" : direction,
                    "status", answered == null ? 0 : answered.optInt("status", 0));
            main.post(() -> {
                if (!device.equals(target)) return;
                String line = ScreenPlayer.commandLine(answered, name);
                if (!line.isEmpty()) padLine(line.startsWith("Not confirmed") ? name + " did not respond" : line);
            });
        });
    }

    private void padLine(String line) {
        padLineUntil = SystemClock.elapsedRealtime() + 4000;
        padStatus.setText(line);
        main.removeCallbacks(clearPadStatus);
        main.postDelayed(clearPadStatus, 4000);
    }

    private LinearLayout buildPad() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER_HORIZONTAL);
        box.setPadding(0, dp(24), 0, dp(8));
        int key = Math.min(dp(96), (getResources().getDisplayMetrics().widthPixels - dp(64)) / 3);

        android.widget.GridLayout grid = new android.widget.GridLayout(this);
        grid.setColumnCount(3);
        grid.setRowCount(3);
        View[][] cells = {
                { null, padKey(R.drawable.daylight_np_expand, 180, "Up", "navigate", "up"), null },
                { padKey(R.drawable.daylight_np_expand, 90, "Left", "navigate", "left"), okKey(),
                  padKey(R.drawable.daylight_np_expand, -90, "Right", "navigate", "right") },
                { null, padKey(R.drawable.daylight_np_expand, 0, "Down", "navigate", "down"), null },
        };
        for (View[] row : cells) {
            for (View cell : row) {
                android.widget.GridLayout.LayoutParams lp = new android.widget.GridLayout.LayoutParams();
                lp.width = key; lp.height = key;
                lp.setMargins(dp(6), dp(6), dp(6), dp(6));
                grid.addView(cell == null ? new View(this) : cell, lp);
            }
        }
        // Wrapped, so the cross is centred (a vertical LinearLayout would stretch it to the row).
        box.addView(grid, new LinearLayout.LayoutParams(-2, -2));

        backKey = new LinearLayout(this);
        backKey.setGravity(Gravity.CENTER);
        backKey.setMinimumHeight(dp(56));
        backKey.setPadding(dp(28), 0, dp(28), 0);
        backIcon = new ImageView(this);
        backIcon.setImageResource(R.drawable.daylight_np_back);
        backKey.addView(backIcon, new LinearLayout.LayoutParams(dp(22), dp(22)));
        backLabel = new TextView(this);
        backLabel.setText("Back");
        backLabel.setPadding(dp(10), 0, 0, 0);
        backKey.addView(backLabel);
        backKey.setContentDescription("Back");
        backKey.setOnClickListener(v -> { tick(v); press("escape", null); });
        LinearLayout.LayoutParams backLp = new LinearLayout.LayoutParams(-2, -2);
        backLp.topMargin = dp(20);
        box.addView(backKey, backLp);

        padStatus = new TextView(this);
        padStatus.setGravity(Gravity.CENTER_HORIZONTAL);
        padStatus.setPadding(0, dp(16), 0, 0);
        box.addView(padStatus, new LinearLayout.LayoutParams(-1, -2));
        return box;
    }

    /** A direction: pressed on touch-down, repeated while held (R6), like a gamepad's D-pad. */
    @android.annotation.SuppressLint("ClickableViewAccessibility")
    private View padKey(int icon, float rotation, String description, String action, String direction) {
        ImageButton b = new ImageButton(this);
        b.setImageResource(icon);
        b.setRotation(rotation);
        b.setScaleType(ImageView.ScaleType.FIT_CENTER);
        b.setPadding(dp(22), dp(22), dp(22), dp(22));
        b.setContentDescription(description);
        padSurfaces.add(b);
        final Runnable[] repeat = new Runnable[1];
        repeat[0] = () -> { press(action, direction); main.postDelayed(repeat[0], PAD_REPEAT_MS); };
        b.setOnTouchListener((v, e) -> {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    v.setPressed(true);
                    tick(v);
                    press(action, direction);
                    main.postDelayed(repeat[0], PAD_REPEAT_FIRST_MS);
                    return true;
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    v.setPressed(false);
                    main.removeCallbacks(repeat[0]);
                    return true;
                default:
                    return true;
            }
        });
        // TalkBack and switch access activate with a click, not a touch.
        b.setOnClickListener(v -> press(action, direction));
        return b;
    }

    private View okKey() {
        okKey = new TextView(this);
        okKey.setText("OK");
        okKey.setGravity(Gravity.CENTER);
        okKey.setContentDescription("OK");
        okKey.setClickable(true);
        okKey.setFocusable(true);
        okKey.setOnClickListener(v -> { tick(v); press("select", null); });
        return okKey;
    }

    private static void tick(View v) {
        v.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
    }

    // ── layout ───────────────────────────────────────────────────────────────

    private void buildViews() {
        root = new FrameLayout(this);
        backdrop = new ImageView(this);
        backdrop.setScaleType(ImageView.ScaleType.CENTER_CROP);
        backdrop.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        backdrop.setVisibility(View.GONE);
        root.addView(backdrop, new FrameLayout.LayoutParams(-1, -1));
        backdropFade = new View(this);
        root.addView(backdropFade, new FrameLayout.LayoutParams(-1, -1));

        // No outer scroll: the stage takes the height the rows below leave, so lyrics and a
        // long queue scroll inside it and the transport never leaves the screen.
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(dp(20), dp(4), dp(20), dp(12));
        root.addView(col, new FrameLayout.LayoutParams(-1, -1));

        // Top: close, where it plays, and the D-pad for a screen.
        LinearLayout top = new LinearLayout(this);
        top.setGravity(Gravity.CENTER_VERTICAL);
        close = icon(R.drawable.daylight_np_expand, "Close", 0, this::finish);
        close.setOnClickListener(v -> finish());
        top.addView(close, new LinearLayout.LayoutParams(dp(48), dp(48)));
        pick = new LinearLayout(this);
        pick.setGravity(Gravity.CENTER);
        pick.setMinimumHeight(dp(48));
        targetIcon = new ImageView(this);
        pick.addView(targetIcon, new LinearLayout.LayoutParams(dp(18), dp(18)));
        targetLabel = new TextView(this);
        targetLabel.setPaddingRelative(dp(8), 0, dp(2), 0);
        targetLabel.setMaxLines(1);
        targetLabel.setEllipsize(TextUtils.TruncateAt.END);
        pick.addView(targetLabel);
        targetCaret = new ImageView(this);
        targetCaret.setImageResource(R.drawable.daylight_np_expand);
        pick.addView(targetCaret, new LinearLayout.LayoutParams(dp(18), dp(18)));
        pick.setOnClickListener(v -> openTargets());
        pick.setContentDescription("Choose where to play");
        top.addView(pick, new LinearLayout.LayoutParams(0, -2, 1));
        padToggle = icon(R.drawable.daylight_np_dpad, "Remote control", 0, () -> showPad(!padShown));
        // The pad does not need the player: it may be the only way to reach the screen.
        padToggle.setOnClickListener(v -> showPad(!padShown));
        FrameLayout padSlot = new FrameLayout(this);
        padSlot.addView(padToggle, new FrameLayout.LayoutParams(-1, -1));
        top.addView(padSlot, new LinearLayout.LayoutParams(dp(48), dp(48)));
        col.addView(top);

        // The player, and in its place the D-pad when a screen is driven by hand.
        player = new LinearLayout(this);
        player.setOrientation(LinearLayout.VERTICAL);
        col.addView(player, new LinearLayout.LayoutParams(-1, 0, 1));
        pad = buildPad();
        pad.setVisibility(View.GONE);
        col.addView(pad, new LinearLayout.LayoutParams(-1, -2));

        // The stage: the cover (swipe to skip), the lyrics or the queue.
        stageBox = new FrameLayout(this);
        stageBox.setMinimumHeight(dp(96));
        artFrame = new AspectFrame(this);
        art = new ImageView(this);
        art.setScaleType(ImageView.ScaleType.CENTER_CROP);
        art.setClipToOutline(true);
        art.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        artFrame.addView(art, new FrameLayout.LayoutParams(-1, -1));
        lyricsBadge = new TextView(this);
        lyricsBadge.setCompoundDrawablesRelativeWithIntrinsicBounds(R.drawable.daylight_np_lyrics, 0, 0, 0);
        lyricsBadge.setGravity(Gravity.CENTER_VERTICAL);
        lyricsBadge.setPadding(dp(10), dp(6), dp(14), dp(6));
        lyricsBadge.setCompoundDrawablePadding(dp(6));
        lyricsBadge.setVisibility(View.GONE);
        lyricsBadge.setContentDescription("Show the lyrics");
        lyricsBadge.setOnClickListener(v -> setStage(Stage.LYRICS));
        UiTelemetry.tag(lyricsBadge, "cover.lyrics-badge");
        FrameLayout.LayoutParams badgeLp = new FrameLayout.LayoutParams(-2, dp(36), Gravity.BOTTOM | Gravity.END);
        badgeLp.setMargins(0, 0, dp(10), dp(10));
        artFrame.addView(lyricsBadge, badgeLp);
        swipeToSkip(artFrame);
        stageBox.addView(artFrame, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER));
        lyricsView = new LyricsView(this);
        lyricsView.setSeek(ms -> {
            if (can(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM)) { controller.seekTo(ms); clock.reset(); note("player.lyrics-seek"); }
        });
        lyricsView.setVisibility(View.GONE);
        stageBox.addView(lyricsView, new FrameLayout.LayoutParams(-1, -1));
        // In the lyrics, a small cover in the corner goes back to the cover.
        lyricsCover = new ImageView(this);
        lyricsCover.setScaleType(ImageView.ScaleType.CENTER_CROP);
        lyricsCover.setClipToOutline(true);
        lyricsCover.setElevation(dp(4));
        lyricsCover.setVisibility(View.GONE);
        lyricsCover.setContentDescription("Show the cover");
        lyricsCover.setOnClickListener(v -> setStage(Stage.ART));
        UiTelemetry.tag(lyricsCover, "lyrics.cover");
        FrameLayout.LayoutParams thumbLp = new FrameLayout.LayoutParams(dp(52), dp(52), Gravity.TOP | Gravity.END);
        thumbLp.setMargins(0, dp(4), 0, 0);
        stageBox.addView(lyricsCover, thumbLp);
        queueBox = new LinearLayout(this);
        queueBox.setOrientation(LinearLayout.VERTICAL);
        LinearLayout head = new LinearLayout(this);
        head.setGravity(Gravity.CENTER_VERTICAL);
        queueHeading = new TextView(this);
        head.addView(queueHeading, new LinearLayout.LayoutParams(0, -2, 1));
        clearButton = new TextView(this);
        clearButton.setText("Clear");
        clearButton.setPadding(dp(12), dp(10), dp(4), dp(10));
        clearButton.setOnClickListener(v -> confirmClear());
        head.addView(clearButton);
        queueBox.addView(head);
        queueScroll = new ScrollView(this);
        queueScroll.setVerticalScrollBarEnabled(false);
        queueList = new LinearLayout(this);
        queueList.setOrientation(LinearLayout.VERTICAL);
        queueScroll.addView(queueList);
        queueBox.addView(queueScroll, new LinearLayout.LayoutParams(-1, 0, 1));
        queueBox.setVisibility(View.GONE);
        stageBox.addView(queueBox, new FrameLayout.LayoutParams(-1, -1));
        startBox = new ScrollView(this);
        startBox.setVerticalScrollBarEnabled(false);
        startList = new LinearLayout(this);
        startList.setOrientation(LinearLayout.VERTICAL);
        startBox.addView(startList);
        startBox.setVisibility(View.GONE);
        stageBox.addView(startBox, new FrameLayout.LayoutParams(-1, -1));
        player.addView(stageBox, new LinearLayout.LayoutParams(-1, 0, 1));

        // The seek bar is the track's loudness, with the times at its ends.
        LinearLayout seekRow = new LinearLayout(this);
        seekRow.setGravity(Gravity.CENTER_VERTICAL);
        elapsed = new TextView(this);
        elapsed.setMinWidth(dp(44));
        remaining = new TextView(this);
        remaining.setMinWidth(dp(44));
        remaining.setGravity(Gravity.END);
        remaining.setOnClickListener(v -> {
            timeDisplay = timeDisplay.next();
            note("player.time-display", "mode", timeDisplay.name().toLowerCase(Locale.ROOT));
            prefs().edit().putString("time", timeDisplay.name()).apply();
            tickPosition();
        });
        remaining.setContentDescription("Switch between time left and length");
        wave = new WaveformBar(this);
        wave.setPadding(dp(8), dp(6), dp(8), dp(6));
        wave.setListener(new WaveformBar.Listener() {
            @Override public void onScrub(float fraction, boolean done) {
                MediaController c = controller;
                if (c == null) return;
                long d = c.getDuration();
                if (d == C.TIME_UNSET || d <= 0) return;
                long to = (long) (fraction * d);
                elapsed.setText(clock(to));
                remaining.setText(timeDisplay.right(to, d));
                if (done && can(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM)) {
                    note("player.scrub", "fromPct", Math.round(100f * c.getCurrentPosition() / d), "toPct", Math.round(100f * fraction));
                    c.seekTo(to);
                    clock.reset();
                }
            }
            @Override public void onStep(int direction) {
                if (controller == null) return;
                if (direction > 0 && can(Player.COMMAND_SEEK_FORWARD)) controller.seekForward();
                else if (direction < 0 && can(Player.COMMAND_SEEK_BACK)) controller.seekBack();
                clock.reset();
            }
        });
        seekRow.addView(elapsed);
        seekRow.addView(wave, new LinearLayout.LayoutParams(0, dp(48), 1));
        seekRow.addView(remaining);
        LinearLayout.LayoutParams seekLp = new LinearLayout.LayoutParams(-1, -2);
        seekLp.topMargin = dp(16);
        player.addView(seekRow, seekLp);

        // Artist, title, album (year): centred, as a record sleeve reads.
        artistLine = centred();
        player.addView(artistLine);
        title = centred();
        title.setSingleLine(true);
        title.setEllipsize(TextUtils.TruncateAt.MARQUEE);
        title.setMarqueeRepeatLimit(-1);
        title.setSelected(true);
        title.setHorizontalFadingEdgeEnabled(true);
        player.addView(title);
        albumLine = centred();
        player.addView(albumLine);
        qualityLine = centred();
        qualityLine.setPadding(0, dp(8), 0, 0);
        player.addView(qualityLine);
        status = centred();
        status.setPadding(0, dp(8), 0, 0);
        status.setMaxLines(1);
        status.setAutoSizeTextTypeUniformWithConfiguration(10, 14, 1, android.util.TypedValue.COMPLEX_UNIT_SP);
        player.addView(status);

        // One transport row: (back 10) previous, play, next (forward 10).
        transport = new LinearLayout(this);
        transport.setGravity(Gravity.CENTER);
        leftEdgeBox = edgeBox(true);
        rightEdgeBox = edgeBox(false);
        prev = icon(R.drawable.daylight_np_previous, "Previous", 0, () -> { controller.seekToPrevious(); clock.reset(); });
        playPause = icon(R.drawable.daylight_np_play, "Play", 0, () -> {
            if (active(controller)) controller.pause();
            else { if (controller.getPlaybackState() == Player.STATE_IDLE) controller.prepare(); controller.play(); }
        });
        playPause.setPadding(dp(22), dp(22), dp(22), dp(22));
        next = icon(R.drawable.daylight_np_next, "Next", 0, () -> { skipNext(); clock.reset(); });
        prev.setPadding(dp(14), dp(14), dp(14), dp(14));
        next.setPadding(dp(14), dp(14), dp(14), dp(14));
        // Only the play disc is a fixed size; the others share what is left, so the row fits
        // any width (a 411 dp phone spilled the ±10 buttons off both edges).
        transport.addView(leftEdgeBox, new LinearLayout.LayoutParams(0, dp(52), 1));
        transport.addView(prev, new LinearLayout.LayoutParams(0, dp(64), 1.2f));
        LinearLayout.LayoutParams discLp = new LinearLayout.LayoutParams(dp(84), dp(84));
        discLp.setMarginStart(dp(6));
        discLp.setMarginEnd(dp(6));
        transport.addView(playPause, discLp);
        transport.addView(next, new LinearLayout.LayoutParams(0, dp(64), 1.2f));
        transport.addView(rightEdgeBox, new LinearLayout.LayoutParams(0, dp(52), 1));
        LinearLayout.LayoutParams transportLp = new LinearLayout.LayoutParams(-1, -2);
        transportLp.topMargin = dp(16);
        player.addView(transport, transportLp);

        // One row of icons: queue, lyrics, shuffle, more, repeat, output.
        bottom = new LinearLayout(this);
        bottom.setGravity(Gravity.CENTER_VERTICAL);
        queueButton = icon(R.drawable.daylight_np_queue, "Queue", 0, () -> setStage(stage == Stage.QUEUE ? Stage.ART : Stage.QUEUE));
        lyricsButton = icon(R.drawable.daylight_np_lyrics, "Lyrics", 0, () -> setStage(stage == Stage.LYRICS ? Stage.ART : Stage.LYRICS));
        shuffleButton = icon(R.drawable.daylight_np_shuffle, "Shuffle", 0, () -> controller.setShuffleModeEnabled(!controller.getShuffleModeEnabled()));
        moreButton = icon(R.drawable.daylight_np_more, "More", 0, this::openMore);
        speedButton = new TextView(this);
        speedButton.setGravity(Gravity.CENTER);
        speedButton.setVisibility(View.GONE);
        speedButton.setOnClickListener(v -> { if (controller != null) chooseSpeed(); });
        UiTelemetry.tag(speedButton, "speed");
        // The sleep timer can be cancelled when nothing plays any more.
        moreButton.setOnClickListener(v -> openMore());
        repeatButton = icon(R.drawable.daylight_np_repeat, "Repeat", 0, this::cycleRepeat);
        outputButton = icon(R.drawable.daylight_np_cast, "Play on", 0, this::openTargets);
        outputButton.setOnClickListener(v -> openTargets());
        for (ImageButton b : new ImageButton[] { queueButton, lyricsButton, shuffleButton, moreButton, repeatButton, outputButton }) {
            FrameLayout slot = new FrameLayout(this);
            slot.addView(b, new FrameLayout.LayoutParams(dp(48), dp(48), Gravity.CENTER));
            if (b == shuffleButton) slot.addView(speedButton, new FrameLayout.LayoutParams(dp(64), dp(48), Gravity.CENTER));
            bottom.addView(slot, new LinearLayout.LayoutParams(0, dp(52), 1));
        }
        LinearLayout.LayoutParams bottomLp = new LinearLayout.LayoutParams(-1, -2);
        bottomLp.topMargin = dp(12);
        player.addView(bottom, bottomLp);

        setContentView(root);
        applyTheme();
        render();
    }

    /** Back and forward 10 s for long items: the icon with "10" over it. */
    private FrameLayout edgeBox(boolean left) {
        FrameLayout box = new FrameLayout(this);
        ImageButton b = icon(left ? R.drawable.daylight_np_replay : R.drawable.daylight_np_forward,
                left ? "Back 10 seconds" : "Forward 10 seconds", 0, () -> {
                    if (left) controller.seekBack(); else controller.seekForward();
                    clock.reset();
                });
        box.addView(b, new FrameLayout.LayoutParams(-1, -1));
        TextView number = new TextView(this);
        number.setText("10");
        number.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        FrameLayout.LayoutParams nLp = new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER);
        nLp.topMargin = dp(2);
        box.addView(number, nLp);
        if (left) { leftEdge = b; leftEdgeNumber = number; } else { rightEdge = b; rightEdgeNumber = number; }
        return box;
    }

    /**
     * Swipe the cover sideways to skip, as in Plexamp: it follows the finger, and past a
     * quarter of its width (or a quick flick) it leaves and the next or previous item
     * comes. A tick on a skip. Otherwise it springs back.
     */
    @android.annotation.SuppressLint("ClickableViewAccessibility")
    private void swipeToSkip(View v) {
        final float[] downX = new float[1];
        final long[] downAt = new long[1];
        v.setOnTouchListener((view, e) -> {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    downX[0] = e.getRawX();
                    downAt[0] = e.getEventTime();
                    view.animate().cancel();
                    return true;
                case MotionEvent.ACTION_MOVE:
                    float dx = e.getRawX() - downX[0];
                    if (Math.abs(dx) > dp(8)) view.getParent().requestDisallowInterceptTouchEvent(true);
                    view.setTranslationX(dx);
                    view.setAlpha(1f - Math.min(0.5f, Math.abs(dx) / (view.getWidth() * 2f)));
                    return true;
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    float moved = e.getRawX() - downX[0];
                    long ms = Math.max(1, e.getEventTime() - downAt[0]);
                    boolean flick = Math.abs(moved) > dp(48) && Math.abs(moved) / ms > 0.6f;
                    boolean far = Math.abs(moved) > view.getWidth() / 4f;
                    boolean forward = moved < 0;
                    if (e.getActionMasked() == MotionEvent.ACTION_UP && Math.abs(moved) < dp(8) && ms < 400) {
                        view.animate().translationX(0).alpha(1f).setDuration(120).start();
                        // A tap, not a swipe: the cover turns to the lyrics when there are some.
                        if (!lyrics.isEmpty()) { view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY); setStage(Stage.LYRICS); }
                        return true;
                    }
                    boolean allowed = forward ? canSkipNext() : can(Player.COMMAND_SEEK_TO_PREVIOUS);
                    if (e.getActionMasked() == MotionEvent.ACTION_UP && (flick || far) && allowed && controller != null) {
                        view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK);
                        note("player.swipe-skip", "direction", forward ? "next" : "previous");
                        float out = (forward ? -1 : 1) * view.getWidth();
                        view.animate().translationX(out).alpha(0f).setDuration(160).withEndAction(() -> {
                            if (forward) skipNext(); else controller.seekToPrevious();
                            clock.reset();
                            view.setTranslationX(-out * 0.35f);
                            view.animate().translationX(0).alpha(1f).setDuration(220).start();
                        }).start();
                    } else {
                        view.animate().translationX(0).alpha(1f).setDuration(200).start();
                    }
                    return true;
                default:
                    return true;
            }
        });
        v.setContentDescription("Cover. Tap for lyrics; swipe left for next, right for previous");
        UiTelemetry.tag(v, "cover");
        v.setClickable(true);
    }

    /** Every color on the screen, from the theme (the cover's, when it has one). */
    private void applyTheme() {
        DaylightTheme t = theme;
        int top = ThemeColors.mix(t.background, t.primary, t.dark ? 0.30 : 0.18);
        GradientDrawable page = new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                new int[] { top, t.background, t.background });
        root.setBackground(page);
        // The soft cover fades into the page from a little below the top.
        backdrop.setAlpha(t.dark ? 0.55f : 0.35f);
        backdropFade.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                new int[] { DaylightTheme.withAlpha(t.background, 0x40), DaylightTheme.withAlpha(t.background, 0xd0), t.background }));
        Window w = getWindow();
        w.setStatusBarColor(top);
        w.setNavigationBarColor(t.background);
        View decor = w.getDecorView();
        int flags = decor.getSystemUiVisibility();
        flags = t.dark ? flags & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR : flags | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        decor.setSystemUiVisibility(flags);

        art.setBackground(t.round(t.tile, DaylightTheme.Radius.MEDIUM));
        t.style(lyricsBadge, Type.LABEL, 0xffffffff, true);
        lyricsBadge.setBackground(t.pressable(DaylightTheme.round(0xa0000000, dp(18))));
        lyricsBadge.setCompoundDrawableTintList(ColorStateList.valueOf(0xffffffff));
        lyricsCover.setBackground(t.round(t.tile, DaylightTheme.Radius.SMALL));
        close.setImageTintList(ColorStateList.valueOf(t.ink));
        targetIcon.setImageTintList(ColorStateList.valueOf(t.inkMuted));
        targetCaret.setImageTintList(ColorStateList.valueOf(t.inkMuted));
        t.style(targetLabel, Type.LABEL, t.inkMuted, true);
        pick.setBackground(t.pressable(null));
        t.style(elapsed, Type.CAPTION, t.inkMuted, false);
        t.style(remaining, Type.CAPTION, t.inkMuted, false);
        elapsed.setFontFeatureSettings("tnum");
        remaining.setFontFeatureSettings("tnum");
        wave.setColors(t.primary, t.trackBuffered);
        t.style(artistLine, Type.BODY, t.inkMuted, false);
        t.style(title, Type.HEADLINE, t.ink, true);
        t.style(albumLine, Type.BODY, t.inkMuted, false);
        t.style(qualityLine, Type.CAPTION, t.inkMuted, false);
        qualityLine.setLetterSpacing(0.04f);
        t.style(status, Type.LABEL, t.attention, false);
        // The big button: a disc of the cover's color, the glyph readable on it.
        int disc = ThemeColors.mix(t.background, t.primary, t.dark ? 0.55 : 0.85);
        playPause.setBackground(DaylightTheme.round(disc, dp(42)));
        playPause.setImageTintList(ColorStateList.valueOf(ThemeColors.readableOn(disc)));
        for (ImageButton b : new ImageButton[] { prev, next, leftEdge, rightEdge }) {
            b.setImageTintList(ColorStateList.valueOf(t.ink));
            b.setBackground(t.pressable(null));
        }
        for (TextView n : new TextView[] { leftEdgeNumber, rightEdgeNumber }) {
            t.style(n, Type.CAPTION, t.ink, true);
            n.setTextSize(9);
        }
        for (ImageButton b : new ImageButton[] { queueButton, lyricsButton, shuffleButton, moreButton, repeatButton, outputButton, padToggle, close }) {
            b.setBackground(t.pressable(DaylightTheme.round(0x00000000, dp(24))));
        }
        t.style(queueHeading, Type.TITLE, t.ink, true);
        t.style(speedButton, Type.BODY, t.ink, true);
        speedButton.setBackground(t.pressable(DaylightTheme.round(0x00000000, dp(24))));
        t.style(clearButton, Type.LABEL, t.primary, true);
        lyricsView.setTheme(t);
        // The pad.
        for (View k : padSurfaces) {
            k.setBackground(t.pressable(DaylightTheme.round(t.surfaceVariant, dp(48))));
            ((ImageButton) k).setImageTintList(ColorStateList.valueOf(t.ink));
        }
        if (okKey != null) {
            t.style(okKey, Type.HEADLINE, t.onPrimary, true);
            okKey.setBackground(t.pressable(DaylightTheme.round(t.primary, dp(48))));
        }
        if (backKey != null) {
            backKey.setBackground(t.pressable(t.round(t.surfaceVariant, DaylightTheme.Radius.LARGE)));
            backIcon.setImageTintList(ColorStateList.valueOf(t.ink));
            t.style(backLabel, Type.BODY, t.ink, false);
            t.style(padStatus, Type.LABEL, t.primary, false);
        }
        if (stage == Stage.QUEUE) fillQueue();
        if (controller != null) render();
    }

    private TextView centred() {
        TextView t = new TextView(this);
        t.setGravity(Gravity.CENTER_HORIZONTAL);
        t.setMaxLines(1);
        t.setEllipsize(TextUtils.TruncateAt.END);
        return t;
    }

    /** An icon button whose action runs only while a controller is connected. Tinted by applyTheme or render. */
    private ImageButton icon(int drawable, String description, int tint, Runnable action) {
        ImageButton b = new ImageButton(this);
        b.setImageResource(drawable);
        if (tint != 0) b.setImageTintList(ColorStateList.valueOf(tint));
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
        if (v instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) v).getChildCount(); i++) ((ViewGroup) v).getChildAt(i).setEnabled(on);
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    static String clock(long ms) {
        long s = Math.max(0, ms) / 1000;
        long h = s / 3600, m = (s % 3600) / 60, sec = s % 60;
        return h > 0 ? String.format(Locale.US, "%d:%02d:%02d", h, m, sec) : String.format(Locale.US, "%d:%02d", m, sec);
    }

    /**
     * The cover's box: as large as the stage allows, in the picture's shape (square, or
     * 16:9 for a video's still), centred.
     */
    private static final class AspectFrame extends FrameLayout {
        private float ratio = 1f;

        AspectFrame(Context c) { super(c); }

        void setRatio(float r) {
            if (r == ratio) return;
            ratio = r;
            requestLayout();
        }

        @Override protected void onMeasure(int w, int h) {
            int maxW = MeasureSpec.getSize(w), maxH = MeasureSpec.getSize(h);
            if (MeasureSpec.getMode(h) == MeasureSpec.UNSPECIFIED) maxH = Math.round(maxW * ratio);
            int width = Math.min(maxW, Math.round(maxH / ratio));
            int height = Math.round(width * ratio);
            super.onMeasure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY));
        }
    }
}

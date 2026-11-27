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
import net.kckern.daylight.shellkit.NowPlayingNote;
import net.kckern.daylight.shellkit.PayloadReady;
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
    static int iconFor(String type, String name) { return TargetPicker.iconFor(type, name); }

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
    /** What was just tapped, shown until the player has it (Starting); null when nothing is starting. */
    private Starting starting;
    /** A start that failed: its line stays under the real state, tappable to retry, until it is old. */
    private Starting failedStart;
    /** How long a failed start's line stays under the real state. */
    private static final long FAILED_LINE_MS = 20_000;
    /**
     * Drawn while there is no controller (FirstFrame): the mini player's entry on open, a
     * screen's remembered answer on a switch, the last state while reconnecting. Null once
     * a controller answers.
     */
    private FirstFrame frame;
    /** The last state drawn from a controller, kept for a reconnect. */
    private NowPlayingNote.Entry lastDrawn;
    /** An item this screen was opened to start on this phone (Starting.EXTRA_PLAY); sent once a controller connects. */
    private String playId;
    private boolean playShuffle;
    /** A screen's last answer from the picker (ScreenMemory's encoding), sent with the TARGET command. */
    private String pickedSnapshot;
    /** The status line shows the sleep timer: it is refreshed with the clock. */
    private boolean statusIsSleep;
    /** The lyrics of a new track are being fetched: the lyrics stage stays, saying so. */
    private boolean lyricsLoading;
    /** The detail id wanted now, read by the detail threads to drop stale work. */
    private volatile String detailWant = "";
    /** Screen starts: a 30 s command must not hold the screens list or a cover. */
    private ExecutorService startIo;
    /** Now playing is on screen showing a start: a play service's failure toast would contradict it. */
    private static volatile boolean startShown;

    static boolean showingStart() { return startShown; }
    /** When the player's current item last changed (elapsed ms), to tell a new item from the one before the tap. */
    private long itemChangedAt = -1;
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
    /** The playing item's metadata the name lines were drawn from; null when nothing plays. */
    private MediaMetadata namesMeta;
    /** The current chapter's title, the long-form title line ("" without chapters). */
    private String chapterName = "";
    /** Whether the by-line sits under the album line (a book) rather than above the title. */
    private boolean byLineBelow;
    /** "Chapter 4 of 12 · 9 min left in chapter" for a chaptered book; reserved (blank) for other long items. */
    private TextView chapterLine;
    /** The current item's chapters (none for music, or a book without any). */
    private Chapters chapters = Chapters.NONE;
    private int listedChapter = -1;
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
        net.kckern.daylight.shellkit.PlaylistArtwork.useKept(new java.io.File(getFilesDir(), "kept-art"));
        UiTelemetry.install(this);
        io = executor("Daylight-nowplaying");
        padIo = executor("Daylight-nowplaying-pad");
        artIo = executor("Daylight-nowplaying-art");
        // The waveform, chapters and lyrics are asked at the same time, never in a row.
        detailIo = Executors.newFixedThreadPool(3, r -> {
            Thread t = new Thread(r, "Daylight-nowplaying-detail");
            t.setDaemon(true);
            return t;
        });
        startIo = executor("Daylight-nowplaying-start");
        base = DaylightTheme.of(this);
        theme = base;
        timeDisplay = TrackDetail.TimeDisplay.of(prefs().getString("time", ""));
        buildViews();
        chooseInitialTarget(getIntent(), saved);
        // A start this screen was opened for runs once: not again on a rotation, a recreation
        // after the process was stopped, or a reopen from Recents.
        boolean fromHistory = getIntent() != null
                && (getIntent().getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0;
        if (saved == null && !fromHistory) takeStarting(getIntent());
        else if (saved != null) starting = Starting.restore(saved);
        // The first frame: what the mini player (or a screen's last answer) already showed.
        if (saved == null && remote() && getIntent() != null && target.equals(getIntent().getStringExtra(EXTRA_TARGET))) {
            pickedSnapshot = getIntent().getStringExtra(RemoteControlService.EXTRA_SNAPSHOT);
        }
        if (starting == null) frame = openingFrame(target);
        loadScreens();
        // Opened as a screen's remote (the phone home's Connect tab): the pad, at once.
        if (saved == null && getIntent() != null && getIntent().getBooleanExtra(EXTRA_PAD, false) && remote()) showPad(true);
        render();
        openStageAsked(getIntent());
        Log.i(TAG, "now playing opened, target " + target + (frame != null ? ", first frame from " + frame.why : ""));
    }

    /** What to draw before the controller answers for {@code id}: the mini player's entry, else a screen's last answer. */
    private FirstFrame openingFrame(String id) {
        FirstFrame f = FirstFrame.seed(NowPlayingNote.current(), id);
        if (f != null || LOCAL.equals(id)) return f;
        ScreenMemory.Record r = ScreenMemory.decode(pickedSnapshot);
        if (r == null || !ScreenMemory.fresh(r.at, System.currentTimeMillis())) r = ScreenMemory.recall(this, id);
        return r == null ? null : FirstFrame.screen(r.snapshot(), id,
                r.elapsedAt(System.currentTimeMillis(), SystemClock.elapsedRealtime()));
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
        if (asked != null && !asked.isEmpty() && !asked.equals(target)) switchTo(asked, namedIn(intent, asked), intent.getStringExtra(RemoteControlService.EXTRA_SNAPSHOT));
        else if (controller == null && pending == null && started) connect();
        takeStarting(intent);
        if (intent != null && intent.getBooleanExtra(EXTRA_PAD, false) && remote()) showPad(true);
        openStageAsked(intent);
    }

    /** A book page's Chapters: Now playing opens on its chapter list. */
    static final String EXTRA_STAGE = "np.stage";

    private void openStageAsked(Intent intent) {
        if (intent != null && "chapters".equals(intent.getStringExtra(EXTRA_STAGE))) {
            intent.removeExtra(EXTRA_STAGE);
            setStage(Stage.QUEUE);
            note("player.open-chapters");
        }
    }

    /** The target chosen here outlives a rotation; the opening intent's does not override it. */
    @Override protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        out.putString(EXTRA_TARGET, target);
        if (starting != null) starting.save(out);
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
        startShown = false;
        // Left before the controller connected (Back at once after a tap): the start still goes out.
        if (playId != null && !remote()) handOff(playId, playShuffle);
        playId = null;
        main.removeCallbacks(ticker);
        main.removeCallbacks(reconnect);
        disconnect();
        super.onStop();
    }

    @Override public void finish() {
        // Closed while the tapped item still starts: the mini player below shows it, "Starting…".
        if (starting != null) {
            NowPlayingNote.starting(starting.target, targetName, starting.title, starting.subtitle, starting.art, SystemClock.elapsedRealtime());
        }
        super.finish();
        overridePendingTransition(R.anim.daylight_np_hold, R.anim.daylight_np_fall);
    }

    @Override protected void onDestroy() {
        for (ExecutorService e : new ExecutorService[] { io, artIo, padIo, detailIo, startIo }) if (e != null) e.shutdownNow();
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

    /** The seek bar's span for an item with chapters: Chapter (default) or Whole book, remembered (§12d). */
    private BarScope.Mode barMode() { return BarScope.mode(prefs().getString(BarScope.PREF, null)); }

    private BarScope.Span barSpan(long position, long duration) {
        if (chapters.isEmpty() || remote()) return BarScope.span(duration, null, null, position, BarScope.Mode.BOOK);
        return BarScope.span(duration, chapters.starts, chapters.ends, position, barMode());
    }

    /** The times either side of the bar: the chapter's elapsed and remaining in chapter mode, the file's otherwise. */
    private void setTimes(long position, long duration, float speed) {
        BarScope.Span s = barSpan(position, duration);
        long at = s.chapterMode ? Math.max(0, position - s.startMs) : position;
        long length = s.chapterMode ? s.lengthMs() : duration;
        elapsed.setText(clock(at));
        remaining.setText(timeDisplay.right(at, length, speed));
    }

    private void chooseBarMode() {
        BarScope.Mode now = barMode();
        net.kckern.daylight.shellkit.ItemSheet.of(this, "NowPlaying").heading("Progress bar", "What the seek bar spans in a book with chapters")
                .row(now == BarScope.Mode.CHAPTER ? net.kckern.daylight.shellkit.R.drawable.daylight_ic_check : net.kckern.daylight.shellkit.R.drawable.daylight_ic_chapters,
                        "Chapter", "The current chapter, its time either side", () -> setBarMode(BarScope.Mode.CHAPTER))
                .row(now == BarScope.Mode.BOOK ? net.kckern.daylight.shellkit.R.drawable.daylight_ic_check : net.kckern.daylight.shellkit.R.drawable.daylight_ic_progress_bar,
                        "Whole book", "The whole book, the current chapter marked", () -> setBarMode(BarScope.Mode.BOOK))
                .show();
    }

    private void setBarMode(BarScope.Mode m) {
        prefs().edit().putString(BarScope.PREF, BarScope.saved(m)).apply();
        note("player.progress-bar", "mode", BarScope.saved(m));
        tickPosition();
    }

    private void chooseInitialTarget(Intent intent, Bundle saved) {
        String asked = saved != null ? saved.getString(EXTRA_TARGET) : null;
        if (asked == null || asked.isEmpty()) asked = intent == null ? null : intent.getStringExtra(EXTRA_TARGET);
        if (asked == null || asked.isEmpty()) asked = prefs().getString(EXTRA_TARGET, LOCAL);
        target = asked;
        targetName = LOCAL.equals(asked) ? "This phone" : namedIn(intent, asked);
    }

    /** The name the opening screen passed for {@code id} (Starting.EXTRA_TARGET_NAME), else the one known here. */
    private String namedIn(Intent intent, String id) {
        String named = intent == null ? null : intent.getStringExtra(Starting.EXTRA_TARGET_NAME);
        if (named != null && !named.trim().isEmpty() && id.equals(intent.getStringExtra(EXTRA_TARGET))) {
            if (!LOCAL.equals(id)) prefs().edit().putString("name:" + id, named.trim()).apply();
            return named.trim();
        }
        return nameOf(id);
    }

    private String nameOf(String id) {
        if (LOCAL.equals(id)) return "This phone";
        for (Screen s : screens) if (s.id.equals(id)) return s.name;
        return prefs().getString("name:" + id, id);
    }

    /** @param snapshot the screen's answer the picker read (ScreenMemory's encoding), or null */
    private void switchTo(String id, String name, String snapshot) {
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
        pickedSnapshot = snapshot;
        // From the first frame, what that target is playing (the picker's answer, the mini player's entry).
        ScreenMemory.Record picked = ScreenMemory.decode(snapshot);
        frame = picked != null && !LOCAL.equals(id)
                ? FirstFrame.screen(picked.snapshot(), id, picked.elapsedAt(System.currentTimeMillis(), SystemClock.elapsedRealtime()))
                : null;
        if (frame == null) frame = openingFrame(id);
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

    /** This phone's player error, by cause: home unreachable (it retries) or the item itself. */
    private static String errorLine() {
        String why = PlaybackRecovery.statusNow();
        return why.isEmpty() ? PlaybackRecovery.WONT_PLAY : why;
    }

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
                            long refusedAt = extras.getLong(Starting.EXTRA_REFUSED_AT, -1);
                            if (starting != null && refusedAt >= starting.askedAt) starting.fail();
                            remoteStatus = extras.getString(RemoteControlService.EXTRA_STATUS, "");
                            remoteReach = extras.getString(RemoteControlService.EXTRA_REACH, "");
                            render();
                        }
                        @Override public void onDisconnected(MediaController c) {
                            if (c == controller) {
                                controller = null;
                                // The last state stays on screen, greyed, rather than "Nothing playing".
                                frame = FirstFrame.lost(lastDrawn);
                                lostPlayer("Reconnecting…");
                            }
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
                    frame = null;
                    connectionLine = "";
                    reconnectMs = 1000;
                    c.addListener(new Player.Listener() {
                        @Override public void onEvents(Player player, Player.Events events) {
                            if (events.contains(Player.EVENT_MEDIA_ITEM_TRANSITION) || events.contains(Player.EVENT_TIMELINE_CHANGED)) {
                                itemChangedAt = SystemClock.elapsedRealtime();
                            }
                            render();
                        }
                    });
                    if (remote()) {
                        Bundle args = new Bundle();
                        args.putString(RemoteControlService.EXTRA_DEVICE, target);
                        args.putString(RemoteControlService.EXTRA_NAME, targetName);
                        if (pickedSnapshot != null) args.putString(RemoteControlService.EXTRA_SNAPSHOT, pickedSnapshot);
                        pickedSnapshot = null;
                        c.sendCustomCommand(new SessionCommand(RemoteControlService.TARGET, Bundle.EMPTY), args);
                        watch(c, true);
                    }
                    playPending();
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
        if (chapterSkip(true)) return;
        if (nextByCommand()) controller.sendCustomCommand(new SessionCommand(CarControls.NEXT_ACTION, Bundle.EMPTY), Bundle.EMPTY);
        else controller.seekToNext();
    }

    /** Shows what an opening intent says was just tapped, from the first frame (see Starting). */
    private void takeStarting(Intent intent) {
        Starting s = Starting.from(intent, target, SystemClock.elapsedRealtime());
        if (s == null) return;
        boolean play = intent.getBooleanExtra(Starting.EXTRA_PLAY, false);
        boolean shuffle = intent.getBooleanExtra(Starting.EXTRA_SHUFFLE, false);
        frame = null;
        if (play && remote()) {
            // Play on a screen: the load is sent from here, and this screen shows it starting there.
            String[] load = Starting.screenLoad(s.mediaId);
            if (load != null) {
                note("player.starting", "how", "screen");
                startOnScreen(load[0], load[1], shuffle, s.title, s.art);
                return;
            }
        }
        // One budget for the whole start (PlayBudget): a payload still starting has longer.
        s.giveUpMs = PlayBudget.giveUpMs(PayloadReady.now(PayloadMedia.PORT).ready());
        starting = s;
        note("player.starting", "how", play ? "here" : "opened");
        main.postDelayed(this::render, Starting.SLOW_MS + 50);
        main.postDelayed(this::render, s.giveUpMs + 50);
        if (play && !s.mediaId.isEmpty() && !remote()) {
            playId = s.mediaId;
            playShuffle = shuffle;
            playPending();
        }
        render();
    }

    /**
     * Starts what this screen was opened to play, on its own controller, once (H3: no
     * second screen over this one). Waits for the controller when it is not connected yet.
     */
    private void playPending() {
        MediaController c = controller;
        if (playId == null || remote() || c == null || !c.isConnected()) return;
        String id = playId;
        boolean shuffle = playShuffle;
        playId = null;
        Log.i(TAG, "now playing: starting the tapped item here" + (shuffle ? ", shuffled" : ""));
        note("player.play-here", "shuffle", shuffle);
        c.setMediaItem(playRequest(id, shuffle));
        c.prepare();
        c.play();
    }

    /**
     * Sends a start on a controller of its own, for a screen closed before its controller
     * connected: the tap is never dropped because the person went Back at once.
     */
    private void handOff(String id, boolean shuffle) {
        Log.i(TAG, "now playing closed before connecting: the start goes out anyway");
        try {
            Context app = getApplicationContext();
            ListenableFuture<MediaController> f = new MediaController.Builder(app,
                    new SessionToken(app, new ComponentName(app, DaylightMediaService.class))).buildAsync();
            f.addListener(() -> {
                try {
                    MediaController c = f.get();
                    c.setMediaItem(playRequest(id, shuffle));
                    c.prepare();
                    c.play();
                    // The commands are sent; releasing the controller does not stop the session's player.
                    main.postDelayed(c::release, 2000);
                } catch (Exception failed) {
                    Log.w(TAG, "start hand-off failed: " + failed.getClass().getSimpleName());
                }
            }, main::post);
        } catch (RuntimeException failed) {
            Log.w(TAG, "start hand-off failed: " + failed.getClass().getSimpleName());
        }
    }

    /**
     * A play request for {@code mediaId}. A shuffled list is asked of home shuffled (the
     * session reads the flag), never by shuffling the queue that is there first.
     */
    static MediaItem playRequest(String mediaId, boolean shuffle) {
        MediaItem.Builder b = new MediaItem.Builder().setMediaId(mediaId);
        if (shuffle) {
            Bundle extras = new Bundle();
            extras.putBoolean(LibraryCallback.EXTRA_SHUFFLE, true);
            b.setRequestMetadata(new MediaItem.RequestMetadata.Builder().setExtras(extras).build());
        }
        return b.build();
    }

    /**
     * Whether the player now holds what was tapped: its item changed after the tap, or its
     * title, album or artist is the tapped title (the same thing tapped again, or an item that
     * arrived before this screen connected). Something already playing before the tap stays
     * behind the starting item until then.
     */
    private boolean startedNow(MediaController c, MediaMetadata meta) {
        // The tapped id itself, or the list the current item came from (a c: list, a p: track in its list).
        String want = contentOf(starting.mediaId);
        MediaItem current = c.getCurrentMediaItem();
        // This screen's own request, as its controller holds it until the session answers: a
        // media id ("c:…", "p:…") with no title. Not the item yet, nor is its transition.
        if (current != null && isRequest(current.mediaId)) return false;
        if (!want.isEmpty() && current != null
                && (want.equals(NodeItems.listId(current)) || want.equals(contentOf(current.mediaId)))) return true;
        if (itemChangedAt >= starting.askedAt) return true;
        for (CharSequence m : new CharSequence[] { meta.title, meta.albumTitle, meta.artist, meta.displayTitle }) {
            if (m != null && m.toString().trim().equalsIgnoreCase(starting.title)) return true;
        }
        // Connected after the change with nothing to match by name (a playlist's first track): playing is enough.
        return itemChangedAt < 0 && c.isPlaying() && SystemClock.elapsedRealtime() - starting.askedAt > 1500;
    }

    /** A media id of the tree ("c:plex:1", "p:plex:2|plex:1"), as a play request names it; a played item has a content id. */
    static boolean isRequest(String mediaId) {
        return mediaId != null && mediaId.length() > 2 && mediaId.charAt(1) == ':';
    }

    private void retryStarting() {
        Starting s = starting != null ? starting : failedStart;
        if (s == null || controller == null || s.mediaId.isEmpty()) return;
        failedStart = null;
        note("player.start-retry");
        starting = new Starting(s.target, s.mediaId, s.title, s.subtitle, s.art, SystemClock.elapsedRealtime());
        starting.giveUpMs = PlayBudget.giveUpMs(PayloadReady.now(PayloadMedia.PORT).ready());
        starting.longForm = s.longForm;
        controller.setMediaItem(new MediaItem.Builder().setMediaId(s.mediaId).build());
        controller.prepare();
        controller.play();
        main.postDelayed(this::render, Starting.SLOW_MS + 50);
        main.postDelayed(this::render, starting.giveUpMs + 50);
        render();
    }

    private void render() {
        MediaController c = controller;
        MediaMetadata meta = c == null ? MediaMetadata.EMPTY : c.getMediaMetadata();
        boolean hasItem = c != null && c.getMediaItemCount() > 0;
        long nowMs = SystemClock.elapsedRealtime();
        if (starting != null && !starting.target.equals(target)) starting = null;
        if (starting != null && hasItem && startedNow(c, meta)) {
            note("player.started", "ms", nowMs - starting.askedAt);
            starting = null;
        }
        if (starting != null && c != null && c.getPlayerError() != null) starting.fail();
        if (starting != null && starting.phase(nowMs) == Starting.Phase.FAILED) {
            // Back to what is really there (the old item, a screen's start panel), with the failure said under it.
            note("player.start-failed", "ms", nowMs - starting.askedAt);
            failedStart = starting;
            starting = null;
            final Starting gone = failedStart;
            main.postDelayed(() -> { if (failedStart == gone) { failedStart = null; render(); } }, FAILED_LINE_MS);
        }
        if (failedStart != null && !failedStart.target.equals(target)) failedStart = null;
        final Starting begun = starting;
        startShown = started && begun != null;
        if (begun != null) {
            // The tapped item, from the first frame: its name, who by, its cover, and how starting is going.
            // Laid out exactly as the playing frame is (every line keeps its place), so nothing moves when it lands.
            title.setText(begun.title.isEmpty() ? "Starting…" : begun.title);
            title.setTextColor(begun.title.isEmpty() ? theme.inkMuted : theme.ink);
            show(artistLine, begun.subtitle);
            show(albumLine, null);
            showStart("");
            statusIsSleep = false;
            String line = begun.title.isEmpty() && begun.phase(nowMs) == Starting.Phase.STARTING ? ""
                    : begun.line(nowMs, remote() ? targetName : "");
            status.setText(line);
            status.setVisibility(line.isEmpty() ? View.INVISIBLE : View.VISIBLE);
            status.setContentDescription(line);
            // What still plays until the new item lands can be paused; nothing else acts on the old item.
            boolean playingOld = active(c);
            playPause.setImageResource(playingOld ? R.drawable.daylight_np_pause : R.drawable.daylight_np_play);
            playPause.setContentDescription(playingOld ? "Pause" : "Starting");
            enable(playPause, playingOld);
            enable(prev, false);
            enable(next, false);
            for (View v : new View[] { shuffleButton, repeatButton, queueButton, lyricsButton, speedButton, leftEdgeBox, rightEdgeBox }) enable(v, false);
            if (stage != Stage.ART) setStage(Stage.ART);
            show(qualityLine, null);
            lyricsBadge.setVisibility(View.GONE);
            // The chapter line is reserved only for a long item, as the playing frame does (music has none).
            if (chapterLine != null) { chapterLine.setText(""); chapterLine.setVisibility(begun.longForm && !remote() ? View.INVISIBLE : View.GONE); }
            wave.setVisibility(View.VISIBLE);
            wave.setSamples(null);
            wave.setMarks(null, -1, 0);
            detailFor = "";   // the old item's detail loads again if it turns out to stay
            renderArtwork(begun.art.isEmpty() ? null : Uri.parse(begun.art), true);
            renderTargets();
            tickPosition();
            return;
        }
        if (c == null && frame != null) { renderFrame(); return; }
        CharSequence name = meta.title != null ? meta.title : meta.displayTitle;
        boolean idleScreen = remote() && !hasItem && "IDLE".equals(remoteReach);
        boolean offScreen = remote() && !hasItem && ("OFF".equals(remoteReach) || "NOT_ON".equals(remoteReach));
        // This phone with nothing loaded: a place to start something, as a screen's start panel is.
        boolean idleHere = !remote() && c != null && c.isConnected() && !hasItem;
        if (hasItem) lastDrawn = NowPlayingNotes.entry(target, targetName, c);
        showStart(idleScreen ? "idle" : offScreen ? "off" : idleHere ? "here" : "");
        title.setTextColor(hasItem ? theme.ink : theme.inkMuted);
        if (hasItem) {
            namesMeta = meta;
            renderNames();
        } else {
            namesMeta = null;
            setNameLine(idleScreen ? "Play something on " + targetName : offScreen ? targetName + " is off" : "Nothing playing");
            show(artistLine, null);
            show(albumLine, null);
        }

        String line;
        if (!volumeLine.isEmpty()) line = volumeLine;
        else if (c == null) line = pending != null ? "Connecting…" : connectionLine;
        else if (remote()) line = remoteStatus;
        else line = c.getPlayerError() != null ? errorLine() : "";
        if (failedStart != null) line = failedStart.failedLine(remote() ? targetName : "");
        statusIsSleep = false;
        if (line.isEmpty() && !remote()) { line = SleepTimer.describeNow(); statusIsSleep = !line.isEmpty(); }
        // A kept track says where it plays from (the spec's offline mark).
        boolean offlineMark = false;
        if (line.isEmpty() && !remote() && hasItem && fromPhone(c.getCurrentMediaItem())) {
            line = KeepLabels.playingFromPhone(this, c.getCurrentMediaItem().mediaId);
            offlineMark = true;
        }
        boolean failure = failedStart != null || (!remote() && c != null && c.getPlayerError() != null);
        status.setTextColor(failure ? theme.attention : theme.inkMuted);
        status.setText(offlineMark ? withPhoneGlyph(line) : line);
        // One line, always reserved; a long message shrinks to fit rather than adding a line.
        status.setVisibility(line.isEmpty() ? View.INVISIBLE : View.VISIBLE);
        status.setContentDescription(line);

        boolean playing = active(c);
        playPause.setImageResource(playing ? R.drawable.daylight_np_pause : R.drawable.daylight_np_play);
        playPause.setContentDescription(playing ? "Pause" : "Play");
        enable(playPause, hasItem && can(Player.COMMAND_PLAY_PAUSE));
        enable(prev, hasItem && can(Player.COMMAND_SEEK_TO_PREVIOUS));
        // A chaptered book: Next goes to the next chapter (the last chapter falls back to the queue's rule).
        MediaController cc = controller;
        boolean chapterNext = !chapters.isEmpty() && !remote() && cc != null && chapters.nextStart(cc.getCurrentPosition()) >= 0;
        enable(next, canSkipNext() || chapterNext);

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
        boolean chapterList = chapterList();
        toggle(queueButton, stage == Stage.QUEUE, hasItem, stage == Stage.QUEUE ? (chapterList ? "Hide the chapters" : "Hide the queue")
                : chapterList ? "Chapters" : "Queue");
        toggle(lyricsButton, stage == Stage.LYRICS, hasItem && (!lyrics.isEmpty() || (lyricsLoading && stage == Stage.LYRICS)),
                lyrics.isEmpty() ? "No lyrics" : stage == Stage.LYRICS ? "Hide the lyrics" : "Lyrics");
        // Lyrics to be had read as ink, not the muted grey of a toggle that is off.
        if (stage != Stage.LYRICS && !lyrics.isEmpty()) lyricsButton.setImageTintList(ColorStateList.valueOf(theme.ink));
        lyricsBadge.setText(lyrics.synced ? "Lyrics" : "Lyrics (text)");
        lyricsBadge.setVisibility(hasItem && !lyrics.isEmpty() && stage == Stage.ART && !jumps ? View.VISIBLE : View.GONE);
        // A book, a talk or a course (MediaKind.SPOKEN): no repeat and no lyrics; speed, chapters, ±30 s and sleep stay.
        MediaKind.Controls set = MediaKind.controls(jumps);
        repeatButton.setVisibility(set.repeat ? View.VISIBLE : View.GONE);
        lyricsButton.setVisibility(set.lyrics ? View.VISIBLE : View.GONE);
        toggle(outputButton, remote(), true, "Play on: " + targetName);
        // Tinted like the row's other icons when off (it has no on state); the drawable itself is black.
        moreButton.setImageTintList(ColorStateList.valueOf(theme.inkMuted));
        enable(moreButton, hasItem || (!remote() && SleepTimer.isSet()));
        // The lyrics stay up across a track change while the next track's are fetched; only "none" goes back to the cover.
        if (stage == Stage.LYRICS && ((lyrics.isEmpty() && !lyricsLoading) || !set.lyrics)) setStage(Stage.ART);
        if (!hasItem && stage != Stage.ART) setStage(Stage.ART);

        padToggle.setVisibility(remote() ? View.VISIBLE : View.GONE);
        padToggle.setImageTintList(ColorStateList.valueOf(padShown ? theme.primary : theme.ink));
        if (!remote() && padShown) showPad(false);
        // On the pad, the screen's own state (off, not on, can't reach home) when no press is being answered.
        if (padShown && SystemClock.elapsedRealtime() >= padLineUntil) padStatus.setText(line);

        loadDetail(hasItem ? c.getCurrentMediaItem() : null);
        art.setAlpha(1f);
        renderArtwork(hasItem ? meta.artworkUri : null, hasItem);
        renderTargets();
        if (stage == Stage.QUEUE) fillQueue();
        tickPosition();
    }

    /**
     * The first frame before a controller answers (FirstFrame): what was already shown for
     * this target, greyed when it is not live (reconnecting, a screen's remembered answer),
     * every control off, and a line saying what it waits for. Laid out as the playing frame.
     */
    private void renderFrame() {
        FirstFrame f = frame;
        NowPlayingNote.Entry e = f.entry;
        boolean live = f.why == FirstFrame.Why.CONNECTING;
        title.setText(e.title);
        title.setTextColor(live ? theme.ink : theme.inkMuted);
        show(artistLine, remote() ? null : e.artist);
        show(albumLine, null);
        showStart("");
        statusIsSleep = false;
        String line = f.line(remote() ? targetName : "");
        status.setText(line);
        status.setVisibility(View.VISIBLE);
        status.setContentDescription(line);
        playPause.setImageResource(e.playing ? R.drawable.daylight_np_pause : R.drawable.daylight_np_play);
        playPause.setContentDescription(e.playing ? "Pause" : "Play");
        enable(playPause, false);
        enable(prev, false);
        enable(next, false);
        for (View v : new View[] { shuffleButton, repeatButton, queueButton, lyricsButton, speedButton, leftEdgeBox, rightEdgeBox }) enable(v, false);
        moreButton.setImageTintList(ColorStateList.valueOf(theme.inkMuted));
        enable(moreButton, false);
        lyricsBadge.setVisibility(View.GONE);
        boolean longItem = e.durationMs >= FirstTap.LONG_MS;
        if (chapterLine != null && chapters.isEmpty()) chapterLine.setVisibility(longItem && !remote() ? View.INVISIBLE : View.GONE);
        wave.setVisibility(View.VISIBLE);
        art.setAlpha(live ? 1f : 0.6f);
        renderArtwork(e.artworkUrl.isEmpty() ? null : Uri.parse(e.artworkUrl), true);
        renderTargets();
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

    /**
     * The name lines (TitleLines): music as a sleeve (artist, title, album (year)); a book, talk
     * or course as a book (chapter or part, then the book, then the author, the author's line
     * moved under the book's). A line equal to another is dropped.
     */
    private void renderNames() {
        MediaMetadata meta = namesMeta;
        if (meta == null) return;
        boolean book = longForm();
        CharSequence name = meta.title != null ? meta.title : meta.displayTitle;
        Integer y = meta.releaseYear != null ? meta.releaseYear : meta.recordingYear;
        // A screen's player names the screen as the artist; that is the top bar's job.
        String by = remote() || meta.artist == null ? "" : meta.artist.toString();
        TitleLines l = TitleLines.of(book, book ? chapterName : "", name == null ? "" : name.toString(),
                meta.albumTitle == null ? "" : meta.albumTitle.toString(), by, y == null ? 0 : y);
        placeByLine(book);
        setNameLine(l.title);
        show(albumLine, l.album);
        show(artistLine, l.by);
        // A book whose part and book share a name has no book line: no blank gap for it (the
        // lines are fixed for the item, so nothing moves later).
        if (book && l.album.isEmpty()) albumLine.setVisibility(View.GONE);
    }

    /** The title, set only when it changed (a reset restarts the marquee). */
    private void setNameLine(CharSequence text) {
        if (!TextUtils.equals(title.getText(), text)) title.setText(text);
    }

    /** Music: the artist above the title; a book: the author under the book's title. */
    private void placeByLine(boolean book) {
        if (byLineBelow == book) return;
        byLineBelow = book;
        ViewGroup box = (ViewGroup) artistLine.getParent();
        if (box == null) return;
        box.removeView(artistLine);
        int at = book ? box.indexOfChild(albumLine) + 1 : box.indexOfChild(title);
        box.addView(artistLine, at);
    }

    /**
     * "Playing from this phone" with the on-this-phone glyph before it, in the line's own muted
     * colour (an image span, so the line stays centred and shrinks to fit as before).
     */
    private CharSequence withPhoneGlyph(String line) {
        android.graphics.drawable.Drawable d = getDrawable(net.kckern.daylight.shellkit.R.drawable.daylight_ic_on_phone).mutate();
        int size = Math.round(status.getTextSize() * 1.1f);
        d.setBounds(0, 0, size, size);
        d.setTint(theme.inkMuted);
        android.text.SpannableStringBuilder b = new android.text.SpannableStringBuilder("\u00A0 ").append(line);
        b.setSpan(new android.text.style.ImageSpan(d, android.os.Build.VERSION.SDK_INT >= 29 ? android.text.style.DynamicDrawableSpan.ALIGN_CENTER : android.text.style.DynamicDrawableSpan.ALIGN_BASELINE), 0, 1, android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        return b;
    }

    /** The quality line is music's: a book, talk or course has none (and keeps no space for it). */
    private void showQuality() {
        if (longForm()) { qualityLine.setText(""); qualityLine.setVisibility(View.GONE); return; }
        show(qualityLine, quality);
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
        if (starting != null && c != null && c.getMediaItemCount() > 0 && startedNow(c, c.getMediaMetadata())) { render(); return; }
        if (starting != null) {
            // Nothing of the old item's time shows under the new title.
            wave.setEnabled(false);
            wave.setFraction(0f, "");
            elapsed.setText("");
            remaining.setText("");
            main.postDelayed(ticker, 200);
            return;
        }
        if (c == null && frame != null) {
            // The first frame's place: carried forward while it is the mini player's live entry.
            long now = SystemClock.elapsedRealtime();
            float f = frame.fractionAt(now);
            long at = frame.positionAt(now), d = frame.entry.durationMs;
            wave.setEnabled(false);
            wave.setDurationMs(d > 0 ? d : 0);
            wave.setFraction(Math.max(0f, f), clock(at) + (d > 0 ? " of " + clock(d) : ""));
            elapsed.setText(clock(at));
            remaining.setText(d > 0 ? timeDisplay.right(at, d, 1f) : "");
            if (frame.why == FirstFrame.Why.CONNECTING && frame.entry.playing) main.postDelayed(ticker, 200);
            return;
        }
        // A sleep timer's line counts down with the clock, not only when the player says something.
        if (statusIsSleep) {
            String sleep = SleepTimer.describeNow();
            if (sleep.isEmpty()) render();
            else if (!sleep.contentEquals(status.getText())) { status.setText(sleep); status.setContentDescription(sleep); }
        }
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
            if (!any) { elapsed.setText(""); remaining.setText(""); }
            else if (!known) { elapsed.setText(clock(position)); remaining.setText(""); }
            else setTimes(position, duration, c.getPlaybackParameters().speed);
        }
        if (stage == Stage.LYRICS) lyricsView.setPosition(position);
        renderChapters(position, known ? duration : 0, c == null ? 1f : c.getPlaybackParameters().speed);
        if (c != null && c.isPlaying()) main.postDelayed(ticker, stage == Stage.LYRICS ? 100 : 200);
        else if (c != null) main.postDelayed(ticker, 1000);
    }

    // ── the track's waveform, quality and lyrics ─────────────────────────────

    /**
     * The track's waveform and quality, its chapters and its lyrics: asked at the same time
     * (one after another, a song waited on a chapters call it never needed), each dropped
     * before it is sent when the track has changed meanwhile. A song under 20 minutes is not
     * asked for chapters. The lyrics stage stays up across a track change, saying it is
     * loading, and goes back to the cover only when the new track has none.
     */
    private void loadDetail(MediaItem item) {
        String id = item == null ? "" : item.mediaId;
        if (id == null || id.indexOf(':') <= 0 || isRequest(id)) id = "";
        if (id.equals(detailFor)) return;
        detailFor = id;
        detailWant = id;
        wave.setSamples(null);
        quality = "";
        showQuality();
        lyrics = TrackDetail.Lyrics.NONE;
        lyricsLoading = !id.isEmpty();
        if (lyricsLoading && stage == Stage.LYRICS) lyricsView.setLoading("Loading lyrics…");
        else lyricsView.setLyrics(lyrics);
        chapters = Chapters.NONE;
        listedChapter = -1;
        if (id.isEmpty()) return;
        final String forId = id;
        final long started = SystemClock.elapsedRealtime();
        MediaController mc0 = controller;
        long knownMs = NodeItems.durationMs(item, mc0 == null ? C.TIME_UNSET : mc0.getDuration());
        boolean askChapters = !remote() && !(knownMs > 0 && knownMs < FirstTap.LONG_MS);
        detail(forId, () -> {
            JSONObject levels = ask(() -> media.trackLevels(forId, WAVE_SAMPLES, 8000));
            main.post(() -> {
                if (!forId.equals(detailFor)) return;
                wave.setSamples(TrackDetail.samples(levels));
                quality = TrackDetail.quality(levels);
                showQuality();
                Log.i(TAG, "now playing detail: waveform in " + (SystemClock.elapsedRealtime() - started) + " ms");
            });
        });
        // A long item's chapters (spec: ops:docs/superpowers/specs/2026-11-26-phone-audiobook-chapters.md).
        if (askChapters) detail(forId, () -> {
            JSONObject marks = ask(() -> media.trackChapters(forId, 10000));
            main.post(() -> {
                if (!forId.equals(detailFor) || marks == null) return;
                MediaController mc = controller;
                long fileMs = mc == null || mc.getDuration() == C.TIME_UNSET ? 0 : mc.getDuration();
                chapters = Chapters.parse(marks, fileMs);
                if (chapters.isEmpty()) return;
                JSONObject body = marks.optJSONObject("chapters");
                note("player.chapters", "count", chapters.count(), "provider", body == null ? "" : body.optString("provider"));
                Log.i(TAG, "now playing detail: " + chapters.count() + " chapters");
                if (stage == Stage.QUEUE) fillQueue();
                render();
                tickPosition();
            });
        });
        detail(forId, () -> {
            JSONObject words = ask(() -> media.trackLyrics(forId, 10000));
            main.post(() -> {
                if (!forId.equals(detailFor)) return;
                lyrics = TrackDetail.lyrics(words);
                lyricsLoading = false;
                lyricsView.setLyrics(lyrics);
                Log.i(TAG, "now playing detail: lyrics " + (lyrics.isEmpty() ? "none" : lyrics.synced ? "synced" : "plain")
                        + " in " + (SystemClock.elapsedRealtime() - started) + " ms");
                note("player.detail", "lyrics", lyrics.isEmpty() ? "none" : lyrics.synced ? "synced" : "plain",
                        "chapters", askChapters, "ms", SystemClock.elapsedRealtime() - started);
                render();
            });
        });
    }

    /** One detail question on its own thread, not sent at all when its track is no longer the one shown. */
    private void detail(String forId, Runnable work) {
        try {
            detailIo.execute(() -> { if (forId.equals(detailWant)) work.run(); });
        } catch (java.util.concurrent.RejectedExecutionException closing) { /* the screen is closing */ }
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
        String url = uri == null ? "" : uri.toString();
        // A cover a list or the Play tab just showed is in memory: it draws in this frame (a
        // smaller copy first when that is all there is), and the full size replaces it.
        Bitmap seen = url.isEmpty() ? null : PlaylistArtwork.cachedAny(url, 900);
        if (seen != null) showArtwork(seen);
        else placeholder(hasItem ? R.drawable.daylight_np_note : targetIcon(target));
        if (uri == null) { setAccent(CoverColor.NONE, null); return; }
        if (seen != null && PlaylistArtwork.cached(url, 900) == seen) return;
        artIo.execute(() -> {
            Bitmap bitmap = PlaylistArtwork.load(url, 900);
            main.post(() -> {
                if (!key.equals(shownArtwork) || bitmap == null) return;
                showArtwork(bitmap);
            });
        });
    }

    /** The cover in the box, its color on the page and its soft copy behind. Main thread. */
    private void showArtwork(Bitmap bitmap) {
        Bitmap small = Bitmap.createScaledBitmap(bitmap, 32, 32, true);
        int[] px = new int[32 * 32];
        small.getPixels(px, 0, 32, 0, 0, 32, 32);
        int accent = CoverColor.of(px);
        // A tiny copy drawn large and filtered is a blur on every Android version.
        Bitmap soft = Bitmap.createScaledBitmap(bitmap, 12, 12, true);
        art.setImageTintList(null);
        art.setPadding(0, 0, 0, 0);
        // The box is square from the first draw and stays so (no jump when a picture
        // arrives): a square cover fills it; a video's wide still sits letterboxed in it.
        boolean wide = bitmap.getWidth() > bitmap.getHeight() * 1.2f;
        art.setScaleType(wide ? ImageView.ScaleType.FIT_CENTER : ImageView.ScaleType.CENTER_CROP);
        art.setImageBitmap(bitmap);
        setAccent(accent, soft);
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

    /**
     * Opens the page a line names: the playing track's album or artist, found from the track's
     * own ids (its info's albumId and artistId). Without them, the search on that name.
     */
    private void lookupLine(TextView line, String kind) {
        if (remote() || line.getVisibility() != View.VISIBLE) return;
        String words = String.valueOf(line.getText()).replaceAll("\\s*\\(\\d{4}\\)\\s*$", "").trim();
        MediaItem item = controller == null ? null : controller.getCurrentMediaItem();
        String cid = item == null ? "" : BrowseActivity.contentIdOf(item.mediaId);
        note("player.lookup", "kind", kind);
        if (cid.isEmpty() || io == null) { if (!words.isEmpty()) BrowseActivity.search(this, words, kind); return; }
        io.execute(() -> {
            JSONObject page = null, artist = null;
            try {
                JSONObject parents = new JSONObject(media.parents(cid, 6000)).optJSONObject("parents");
                page = parents == null ? null : parents.optJSONObject("albums".equals(kind) ? "album" : "artist");
                artist = parents == null ? null : parents.optJSONObject("artist");
            } catch (Exception unreachable) { /* the search on the name instead */ }
            JSONObject p = page;
            // The album's page pages through its artist's albums (the parent's children).
            String pagesIn = "albums".equals(kind) && artist != null ? artist.optString("id", null) : null;
            main.post(() -> {
                if (isFinishing()) return;
                if (p != null && !p.optString("id").isEmpty()) {
                    BrowseActivity.open(this, "level", p.optString("id"), p.optString("kind"), p.optString("title"), "", "", pagesIn);
                } else if (!words.isEmpty()) {
                    BrowseActivity.search(this, words, kind);
                }
            });
        });
    }

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
        if (chapterList()) { fillChapters(); return; }
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
        int current = chapterList() && controller != null ? chapters.indexAt(controller.getCurrentPosition())
                : controller == null ? 0 : controller.getCurrentMediaItemIndex();
        queueScroll.post(() -> {
            View row = queueList.getChildAt(Math.max(0, current - 1));
            if (row != null) queueScroll.scrollTo(0, row.getTop());
        });
    }

    // ── chapters ─────────────────────────────────────────────────────────────

    /** A single-file book with chapters: the queue's place shows its chapters instead. */
    private boolean chapterList() {
        MediaController c = controller;
        return !chapters.isEmpty() && c != null && c.getMediaItemCount() == 1 && !remote();
    }

    /** Next / Previous by chapter for a chaptered book; false when there is no chapter to go to. */
    private boolean chapterSkip(boolean forward) {
        MediaController c = controller;
        if (chapters.isEmpty() || c == null || remote()) return false;
        long pos = c.getCurrentPosition();
        long target = forward ? chapters.nextStart(pos) : chapters.previousTarget(pos);
        if (target < 0) return false;
        c.seekTo(target);
        Log.i(TAG, "chapter " + (forward ? "next" : "previous") + ": " + (chapters.indexAt(pos) + 1) + " -> " + (chapters.indexAt(target) + 1));
        note(forward ? "chapter.next" : "chapter.prev", "to", chapters.indexAt(target) + 1);
        return true;
    }

    /** The chapter line and the seek bar's ticks; the line is reserved for any long item so nothing jumps. */
    private void renderChapters(long position, long durationMs, float speed) {
        if (chapterLine == null) return;
        if (chapters.isEmpty() || remote()) {
            if (!chapterName.isEmpty()) { chapterName = ""; renderNames(); }
            chapterLine.setText("");
            chapterLine.setVisibility(longForm() && !remote() ? View.INVISIBLE : View.GONE);
            wave.setMarks(null, -1, 0);
            wave.setSpan(0f, 1f, null);
            return;
        }
        // The bar's span (§12d): the current chapter by default, or the whole book (⋮ Progress bar).
        BarScope.Mode mode = barMode();
        BarScope.Span span = barSpan(position, durationMs);
        if (durationMs > 0) {
            float[] band = !span.chapterMode && span.chapter >= 0
                    ? new float[] { chapters.starts[span.chapter] / (float) durationMs, Math.min(1f, chapters.ends[span.chapter] / (float) durationMs) } : null;
            wave.setSpan(span.startFraction(durationMs), span.endFraction(durationMs), band);
        }
        String line = span.chapterMode ? BarScope.line(BarScope.word(chapters.titles), span, position, durationMs, speed) : chapters.line(position, speed);
        if (!line.contentEquals(chapterLine.getText())) {
            chapterLine.setText(line);
            chapterLine.setContentDescription(line + ". Opens the chapters");
        }
        chapterLine.setVisibility(View.VISIBLE);
        // The title line takes a chapter's own name; a bare number ("Chapter 4") is already the chapter line's.
        String nowChapter = chapters.nameOf(chapters.indexAt(position));
        if (!nowChapter.equals(chapterName)) { chapterName = nowChapter; renderNames(); }
        // The mini player's second line on every screen: the chapter, while this book plays.
        NowPlayingNote.detail(LOCAL, chapters.subtitle(position));
        int at = chapters.indexAt(position);
        float[] notches = BarScope.notches(chapters.marks(durationMs), wave.getWidth() - wave.getPaddingLeft() - wave.getPaddingRight(),
                getResources().getDisplayMetrics().density, mode);
        wave.setMarks(notches, notches.length == 0 ? -1 : at - 1, theme.inkMuted);
        if (stage == Stage.QUEUE && chapterList() && at != listedChapter) fillQueue();
    }

    /** The chapter list: number, name, length; the current one marked; a tap goes to its start. */
    private void fillChapters() {
        MediaController c = controller;
        int current = c == null ? 0 : chapters.indexAt(c.getCurrentPosition());
        listedChapter = current;
        clearButton.setVisibility(View.GONE);
        queueHeading.setText("Chapters · " + chapters.count());
        for (int i = 0; i < chapters.count(); i++) {
            final int index = i;
            boolean now = i == current;
            LinearLayout row = new LinearLayout(this);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setMinimumHeight(dp(48));
            row.setBackground(theme.pressable(null));
            TextView num = theme.text(this, String.valueOf(i + 1), Type.LABEL, now ? theme.primary : theme.inkMuted, now);
            num.setGravity(Gravity.END);
            row.addView(num, new LinearLayout.LayoutParams(dp(32), -2));
            String name = chapters.nameOf(i);
            TextView label = theme.text(this, name.isEmpty() ? "Chapter " + (i + 1) : name, Type.BODY, now ? theme.primary : theme.ink, now);
            label.setMaxLines(1);
            label.setEllipsize(TextUtils.TruncateAt.END);
            label.setPaddingRelative(dp(12), 0, dp(8), 0);
            row.addView(label, new LinearLayout.LayoutParams(0, -2, 1));
            row.addView(theme.text(this, chapters.lengthOf(i), Type.LABEL, theme.inkMuted, false));
            row.setContentDescription((now ? "Playing: " : "Go to ") + (name.isEmpty() ? "chapter " + (i + 1) : name));
            UiTelemetry.tag(row, "chapters.row");
            row.setOnClickListener(v -> {
                if (controller == null) return;
                controller.seekTo(chapters.starts[index]);
                note("chapters.row", "to", index + 1);
                clock.reset();
            });
            queueList.addView(row, new LinearLayout.LayoutParams(-1, -2));
        }
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
                    "Pick another player, or turn " + targetName + " on", "start.local", () -> switchTo(LOCAL, "This phone", null), null));
            startList.addView(startRow(R.drawable.daylight_np_cast, "Play on another screen", null, "start.targets", this::openTargets, null));
            return;
        }
        boolean here = mode.equals("here");
        net.kckern.daylight.shellkit.DrivingRadioSettings radio = new net.kckern.daylight.shellkit.DrivingRadioSettings(this);
        if (here) {
            // This phone, nothing loaded: what played last first, one tap to carry on.
            String[] last = radio.last();
            if (last != null && !last[0].isEmpty()) {
                String what = last[1].isEmpty() ? "what played last" : last[1];
                startList.addView(startRow(0, "Resume " + what, last[2], "start.resume",
                        () -> playHereNow(last[0], false, last[1], last[2], last[3]), last[3]));
            }
        }
        String cached = getSharedPreferences("daylight.home", MODE_PRIVATE).getString("continue", "");
        try {
            JSONArray items = cached.isEmpty() ? new JSONArray() : new JSONArray(cached);
            if (items.length() > 0) startList.addView(startHeading("Continue listening"));
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.optJSONObject(i);
                if (item == null) continue;
                String mediaId = item.optString("id"), id = contentOf(mediaId), title = item.optString("title");
                if (id.isEmpty()) continue;
                startList.addView(startRow(0, title, item.optString("subtitle"), "start.continue",
                        () -> {
                            if (here) playHereNow(mediaId, false, title, item.optString("subtitle"), item.optString("art"));
                            else startOnScreen("play", id, false, title, item.optString("art"));
                        }, item.optString("art")));
            }
        } catch (Exception unreadable) { /* the Play tab fills this cache; without it the list is shorter */ }
        java.util.List<net.kckern.daylight.shellkit.DrivingRadioSettings.Staple> mine = radio.staged();
        if (!mine.isEmpty()) startList.addView(startHeading("Your playlists"));
        for (net.kckern.daylight.shellkit.DrivingRadioSettings.Staple p : mine) {
            String id = contentOf(p.id);
            startList.addView(startRow(0, p.title, null, "start.playlist",
                    () -> {
                        if (here) playHereNow("c:" + id, true, p.title, "", p.art);
                        else startOnScreen("queue", id, true, p.title, p.art);
                    }, p.art));
        }
        if (here) {
            startList.addView(startHeading("Or"));
            startList.addView(startRow(R.drawable.daylight_np_cast, "Play on a screen", "Pick one of the household's screens",
                    "start.targets", this::openTargets, null));
            return;
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
        Bitmap seenCover = art == null || art.isEmpty() ? null : PlaylistArtwork.cached(art, 144);
        if (seenCover != null) cover.setImageBitmap(seenCover);
        else if (art != null && !art.isEmpty() && io != null) io.execute(() -> {
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

    /** One tap starts it on this phone, from the idle panel: shown as starting at once, played on this controller. */
    private void playHereNow(String mediaId, boolean shuffle, String title, String subtitle, String art) {
        if (remote() || mediaId == null || mediaId.isEmpty()) return;
        note("player.start", "how", "here");
        Starting s = new Starting(LOCAL, mediaId, title, subtitle, art, SystemClock.elapsedRealtime());
        s.giveUpMs = PlayBudget.giveUpMs(PayloadReady.now(PayloadMedia.PORT).ready());
        starting = s;
        main.postDelayed(this::render, Starting.SLOW_MS + 50);
        main.postDelayed(this::render, s.giveUpMs + 50);
        playId = mediaId;
        playShuffle = shuffle;
        playPending();
        render();
    }

    /** One tap starts it on the screen (the web's Play on); the player then follows what the screen does. */
    private void startOnScreen(String how, String contentId, boolean shuffle, String title, String art) {
        final String device = target, name = targetName;
        final Starting mine = new Starting(device, "", title, "", art, SystemClock.elapsedRealtime());
        // One budget: the command's wait and the Starting give-up are the same number, so
        // the answer (or its absence) is in before the screen says it failed.
        mine.giveUpMs = PlayBudget.SCREEN_MS + 1_000;
        starting = mine;
        frame = null;
        main.postDelayed(this::render, Starting.SLOW_MS + 50);
        main.postDelayed(this::render, mine.giveUpMs + 50);
        render();
        note("player.start", "how", how);
        startIo.execute(() -> {
            String line;
            try {
                JSONObject request = new JSONObject().put("op", "screen-command").put("device", device)
                        .put("command", "load").put(how, contentId);
                if (shuffle) request.put("shuffle", true);
                JSONObject reply = new JSONObject(media.screenCommand(request, PlayBudget.SCREEN_MS));
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
                // A late accept: the failure already shown for this start was wrong; take it back.
                if (said.isEmpty() && failedStart != null && failedStart.title.equals(mine.title)) failedStart = null;
                if (!said.isEmpty() && starting == mine) starting = null;   // refused: say why instead of "Starting…"
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
        List<TargetPicker.Target> targets = new ArrayList<>();
        targets.add(new TargetPicker.Target(LOCAL, "This phone", ""));
        for (Screen s : screens) targets.add(new TargetPicker.Target(s.id, s.name, s.type));
        // Not loaded yet: the screens the phone home last saw; each row's own check tells if it is there.
        if (screens.isEmpty()) targets.addAll(cachedScreens(getSharedPreferences("daylight.home", MODE_PRIVATE).getString("screens", "")));
        TargetPicker.show(this, base, targets, target, screens.isEmpty() ? "" : screensProblem, media, main,
                (id, label, snapshot) -> { if (!id.equals(target)) switchTo(id, label, snapshot); });
    }

    /** The phone home's cached screens list ({id, name, type} rows) as picker targets. */
    static List<TargetPicker.Target> cachedScreens(String json) {
        List<TargetPicker.Target> out = new ArrayList<>();
        try {
            JSONArray items = json == null || json.isEmpty() ? new JSONArray() : new JSONArray(json);
            for (int i = 0; i < items.length(); i++) {
                JSONObject o = items.optJSONObject(i);
                if (o == null || o.optString("id").isEmpty()) continue;
                out.add(new TargetPicker.Target(o.optString("id"), o.optString("name", o.optString("id")), o.optString("type")));
            }
        } catch (Exception unreadable) { /* none */ }
        return out;
    }

    /** ⋮: the item sheet (D17), headed by what plays now. */
    private void openMore() {
        boolean any = controller != null && controller.getMediaItemCount() > 0;
        MediaItem current = controller == null ? null : controller.getCurrentMediaItem();
        androidx.media3.common.MediaMetadata md = controller == null ? null : controller.getMediaMetadata();
        String name = md != null && md.title != null ? md.title.toString() : "";
        String by = md != null && md.artist != null ? md.artist.toString() : "";
        String cover = md != null && md.artworkUri != null ? md.artworkUri.toString() : "";
        org.json.JSONObject kept = !remote() && current != null && !current.mediaId.isEmpty() ? KeepStore.get(this).keptHolding(current.mediaId) : null;
        net.kckern.daylight.shellkit.ItemSheet sheet = net.kckern.daylight.shellkit.ItemSheet.of(this, "NowPlaying")
                .item(cover, longForm() ? net.kckern.daylight.shellkit.CoverGlyph.Kind.BOOK : net.kckern.daylight.shellkit.CoverGlyph.Kind.TRACK,
                        name, remote() ? "On " + targetName : by, kept == null ? "" : net.kckern.daylight.shellkit.KeptIndex.describe(kept));
        if (!remote() && (any || SleepTimer.isSet())) sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_timer, "Sleep timer", SleepTimer.isSet() ? SleepTimer.describeNow() : "", this::chooseSleep);
        if (!remote() && !chapters.isEmpty()) sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_progress_bar, "Progress bar",
                barMode() == BarScope.Mode.BOOK ? "Whole book" : "Chapter", this::chooseBarMode);
        // Keep on this phone: the collection now playing (its list, or the track's album).
        if (!remote() && current != null && !current.mediaId.isEmpty()) {
            if (kept == null) sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_download, "Keep on this phone", () -> keepHere(current));
            else {
                if (net.kckern.daylight.shellkit.KeptIndex.retryable(kept)) sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_replay, "Retry", () -> {
                    note("download.retry.tap");
                    KeepStore.get(this).retry(kept.optString("contentId"), this::say);
                });
                sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_on_phone, "On this phone", net.kckern.daylight.shellkit.KeptIndex.describe(kept), () -> DownloadsActivity.open(this));
            }
        }
        // Crossfade between songs: this phone's player only (a screen decides its own).
        if (!remote() && MediaKind.controls(longForm()).crossfade)
            sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_tune, "Crossfade", crossfadeLabel(crossfadeSeconds()), this::chooseCrossfade);
        if (can(Player.COMMAND_STOP) && any) sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_stop, remote() ? "Stop on " + targetName : "Stop", this::stop);
        if (can(Player.COMMAND_CHANGE_MEDIA_ITEMS) && any) sheet.destructive(net.kckern.daylight.shellkit.R.drawable.daylight_ic_clear_all, "Clear queue", this::confirmClear);
        if (kept != null) sheet.destructive(net.kckern.daylight.shellkit.R.drawable.daylight_ic_delete, "Remove from this phone", () -> {
            note("download.remove.tap");
            KeepStore.get(this).remove(kept.optString("contentId"), this::say);
        });
        sheet.show();
    }

    /** Keeps the collection {@code item} belongs to: its household list when it came from one, its album otherwise. */
    private void keepHere(MediaItem item) {
        if (item == null) return;
        String list = NodeItems.listId(item);
        String id = list.contains(":") ? "c:" + list : "p:" + item.mediaId;
        note("download.keep.tap", "fromList", !list.isEmpty());
        KeepFlow.start(this, id);
    }


    private void say(String line) {
        if (isFinishing() || isDestroyed()) return;
        android.widget.Toast.makeText(this, line, android.widget.Toast.LENGTH_LONG).show();
    }

    /**
     * The speed for long items in the speed sheet (D19) over the speed button: it applies as
     * it moves. The session keeps the choice for this collection and as the default for long
     * items not set yet; music stays 1x.
     */
    private void chooseSpeed() {
        if (controller == null) return;
        SpeedSheet.show(this, speedButton, controller.getPlaybackParameters().speed, longForm(), s -> {
            if (controller == null) return;
            controller.setPlaybackSpeed(s);
            note("player.speed", "speed", s);
            main.postDelayed(this::render, 150);
        });
    }

    private static final int[] SLEEP_MINUTES = { 0, 15, 30, 45, 60, SleepTimer.END_OF_ITEM };

    /** Pause later: in N minutes or at the end of this item. Set in the phone's session, so it holds with the screen closed. */
    private int crossfadeSeconds() {
        android.content.SharedPreferences p = getSharedPreferences(CrossfadeEngine.PREFS, MODE_PRIVATE);
        Integer chosen = p.contains(CrossfadeEngine.KEY_CHOSEN) ? p.getInt(CrossfadeEngine.KEY_CHOSEN, Crossfade.DEFAULT_SEC) : null;
        Integer deviceDefault = p.contains(CrossfadeEngine.KEY_DEFAULT) ? p.getInt(CrossfadeEngine.KEY_DEFAULT, Crossfade.DEFAULT_SEC) : null;
        return Crossfade.seconds(chosen, deviceDefault);
    }

    private static String crossfadeLabel(int seconds) {
        return seconds <= 0 ? "Off" : seconds + " s";
    }

    /** Off or a length; kept on this phone and wins over the household default. Songs only, never books. */
    private void chooseCrossfade() {
        int now = crossfadeSeconds();
        String[] labels = new String[Crossfade.CHOICES.length];
        int checked = -1;
        for (int i = 0; i < labels.length; i++) {
            labels[i] = crossfadeLabel(Crossfade.CHOICES[i]);
            if (Crossfade.CHOICES[i] == now) checked = i;
        }
        new AlertDialog.Builder(this, DaylightTheme.alert())
                .setTitle("Crossfade between songs")
                .setSingleChoiceItems(labels, checked, (d, which) -> {
                    int sec = Crossfade.CHOICES[which];
                    getSharedPreferences(CrossfadeEngine.PREFS, MODE_PRIVATE).edit().putInt(CrossfadeEngine.KEY_CHOSEN, sec).apply();
                    note("player.crossfade", "seconds", sec);
                    d.dismiss();
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void chooseSleep() {
        boolean chaptered = !chapters.isEmpty() && controller != null;
        String[] labels = chaptered
                ? new String[] { "Off", "15 minutes", "30 minutes", "45 minutes", "1 hour", "End of chapter", "At the end of this" }
                : new String[] { "Off", "15 minutes", "30 minutes", "45 minutes", "1 hour", "At the end of this" };
        new AlertDialog.Builder(this, DaylightTheme.alert())
                .setTitle("Sleep timer")
                .setItems(labels, (d, which) -> {
                    if (controller == null) return;
                    Bundle args = new Bundle();
                    int minutes;
                    if (chaptered && which == 5) {
                        minutes = SleepTimer.END_OF_CHAPTER;
                        args.putLong(SleepTimer.ARG_AT_MS, chapters.endAt(controller.getCurrentPosition()));
                        note("sleep.end-of-chapter", "chapter", chapters.indexAt(controller.getCurrentPosition()) + 1);
                    } else {
                        minutes = SLEEP_MINUTES[chaptered && which == 6 ? 5 : which];
                    }
                    args.putInt(SleepTimer.ARG_MINUTES, minutes);
                    controller.sendCustomCommand(new SessionCommand(SleepTimer.ACTION, Bundle.EMPTY), args);
                    note("player.sleep", "minutes", minutes);
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
        // The times sit level with the bars, below the scale's band when there is one.
        seekRow.setGravity(Gravity.BOTTOM);
        elapsed = new TextView(this);
        elapsed.setMinWidth(dp(44));
        elapsed.setMinHeight(dp(48));
        elapsed.setGravity(Gravity.CENTER_VERTICAL);
        remaining = new TextView(this);
        remaining.setMinWidth(dp(44));
        remaining.setMinHeight(dp(48));
        remaining.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
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
                setTimes(to, d, c.getPlaybackParameters().speed);
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
        // Its own height: 48 dp, and the time scale's band above the bars for an item of 10 min or more.
        seekRow.addView(wave, new LinearLayout.LayoutParams(0, -2, 1));
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
        // The artist and the album open their pages (by name: a search led by that kind).
        artistLine.setOnClickListener(v -> lookupLine(artistLine, "artists"));
        albumLine.setOnClickListener(v -> lookupLine(albumLine, "albums"));
        UiTelemetry.tag(artistLine, "player.artist");
        UiTelemetry.tag(albumLine, "player.album");
        chapterLine = centred();
        chapterLine.setPadding(0, dp(4), 0, 0);
        chapterLine.setVisibility(View.GONE);
        chapterLine.setOnClickListener(v -> { if (!chapters.isEmpty()) { note("chapters.open", "from", "line"); setStage(Stage.QUEUE); } });
        UiTelemetry.tag(chapterLine, "chapters.open");
        player.addView(chapterLine);
        qualityLine = centred();
        qualityLine.setPadding(0, dp(8), 0, 0);
        player.addView(qualityLine);
        status = centred();
        // A failed start's line is its retry (this phone only).
        status.setOnClickListener(v -> { if (failedStart != null && !remote()) retryStarting(); });
        status.setPadding(0, dp(8), 0, 0);
        status.setMaxLines(1);
        status.setAutoSizeTextTypeUniformWithConfiguration(10, 14, 1, android.util.TypedValue.COMPLEX_UNIT_SP);
        player.addView(status);

        // One transport row: (back 10) previous, play, next (forward 10).
        transport = new LinearLayout(this);
        transport.setGravity(Gravity.CENTER);
        leftEdgeBox = edgeBox(true);
        rightEdgeBox = edgeBox(false);
        prev = icon(R.drawable.daylight_np_previous, "Previous", 0, () -> { if (!chapterSkip(false)) controller.seekToPrevious(); clock.reset(); });
        playPause = icon(R.drawable.daylight_np_play, "Play", 0, () -> {
            if (starting != null) { if (active(controller)) controller.pause(); return; }
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
                        // The cover that slides in is the next (or previous) item's, never the old one again.
                        final Uri incoming = incomingArt(forward);
                        view.animate().translationX(out).alpha(0f).setDuration(160).withEndAction(() -> {
                            if (controller == null) return;
                            if (forward) skipNext(); else controller.seekToPrevious();
                            clock.reset();
                            if (incoming != null) showIncoming(incoming);
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

    /**
     * The cover of the item a swipe goes to: Uri.EMPTY when it has none (a neutral box), null
     * when the swipe stays on this item (a chapter, a restart).
     */
    private Uri incomingArt(boolean forward) {
        MediaController c = controller;
        if (c == null || !chapters.isEmpty()) return null;
        int to = forward ? c.getNextMediaItemIndex() : c.getPreviousMediaItemIndex();
        // Previous past 3 s restarts this item (Media3's rule): the same cover stays.
        if (!forward && c.getCurrentPosition() > 3000) return null;
        if (to == C.INDEX_UNSET || to < 0 || to >= c.getMediaItemCount()) return null;
        Uri u = c.getMediaItemAt(to).mediaMetadata.artworkUri;
        return u == null ? Uri.EMPTY : u;
    }

    /** Draws the incoming item's cover from memory (or a neutral box) before the player says it moved. */
    private void showIncoming(Uri uri) {
        String url = uri == null ? "" : uri.toString();
        Bitmap seen = url.isEmpty() ? null : PlaylistArtwork.cachedAny(url, 900);
        if (seen != null) showArtwork(seen); else placeholder(R.drawable.daylight_np_note);
        // render() decides again from the player, loading the full size if only a smaller copy was in memory.
        shownArtwork = null;
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
        wave.setScaleColor(t.inkMuted);
        t.style(artistLine, Type.BODY, t.inkMuted, false);
        t.style(title, Type.HEADLINE, t.ink, true);
        t.style(albumLine, Type.BODY, t.inkMuted, false);
        if (chapterLine != null) t.style(chapterLine, Type.LABEL, t.ink, false);
        t.style(qualityLine, Type.CAPTION, t.inkMuted, false);
        qualityLine.setLetterSpacing(0.04f);
        // Status lines are muted (rule 4: the accent is not a text colour); a failure keeps attention.
        t.style(status, Type.LABEL, t.inkMuted, false);
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
        // The row's icons that render() does not tint through toggle(): their vector is black.
        moreButton.setImageTintList(ColorStateList.valueOf(t.inkMuted));
        padToggle.setImageTintList(ColorStateList.valueOf(padShown ? t.primary : t.ink));
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
        // Every state retints its icons from the new theme, the first frame and Starting too.
        if (title != null) render();
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

    private String fromPhoneFor = "";
    private boolean fromPhone;

    /** Whether the current track plays from its kept copy; looked up once per track, off the main thread. */
    private boolean fromPhone(MediaItem item) {
        String id = item == null ? "" : item.mediaId;
        if (!id.equals(fromPhoneFor)) {
            fromPhoneFor = id;
            fromPhone = false;
            if (!id.isEmpty() && io != null) io.execute(() -> {
                boolean here;
                try { here = KeepStore.get(this).playsFromPhone(id); } catch (RuntimeException e) { here = false; }
                boolean answer = here;
                main.post(() -> { if (id.equals(fromPhoneFor) && answer != fromPhone) { fromPhone = answer; render(); } });
            });
        }
        return fromPhone;
    }
}

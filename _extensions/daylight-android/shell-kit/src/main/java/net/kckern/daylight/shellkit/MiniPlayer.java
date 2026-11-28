package net.kckern.daylight.shellkit;

import android.animation.ObjectAnimator;
import android.app.Activity;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.MotionEvent;
import android.view.View;
import android.view.animation.LinearInterpolator;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The one mini player (ops:docs/superpowers/specs/2026-11-26-phone-lookup-and-browse.md §11),
 * at the bottom of every browse screen: the home's tabs, Search, the Library and its levels,
 * every detail page, On this phone. Not on Now playing (it is the expanded player) nor on
 * the capture screens. Same height, place and look everywhere: a progress line on its top
 * edge, the cover, the title, the by-line ("On <screen>" for a screen, "Starting…" while a
 * tapped item starts, a book's chapter when known), Play/Pause and Next, on a tint of the
 * cover's colour.
 *
 * <p>It reads NowPlayingNote, which the two media services write: one connection to the
 * player for the whole app, none per screen, no polling. The progress line runs on an
 * animator to the item's end while playing. Tap or swipe up opens Now playing on that target
 * (it rises from the bar, drawn from the same entry); Play/Pause flips at once and the
 * player's report corrects it; swipe down hides it on this screen until the next item. It
 * slides away when nothing is loaded; it never says "Nothing playing".
 *
 * <p>A screen adds {@link #view()} as the last child of its vertical root (so its list ends
 * above the bar) and calls {@link #start()}/{@link #stop()} from onStart/onStop.
 */
public final class MiniPlayer {
    static final String NOW_PLAYING = "net.kckern.daylight.cap.mediaservice.shell.NowPlayingActivity";

    private final Activity activity;
    private final String screen;
    private final DaylightTheme t;
    private final LinearLayout bar;
    private final View progress;
    private final ImageView cover;
    private final ImageButton play, next;
    private final TextView title, line;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService art = Executors.newSingleThreadExecutor();
    private ObjectAnimator run;
    private String artUrl = "", dismissed = "";
    private int accent = CoverColor.NONE;
    private long pressedAt = -1;
    private boolean flipped, up, listening, longFired;
    private float downY;
    private final NowPlayingNote.Listener changed = () -> main.post(this::draw);

    public static MiniPlayer attach(Activity a, String screen) { return new MiniPlayer(a, screen); }

    private MiniPlayer(Activity a, String screen) {
        this.activity = a;
        this.screen = screen;
        t = DaylightTheme.of(a);
        bar = new LinearLayout(a);
        bar.setTag(VIEW_TAG);
        bar.setOrientation(LinearLayout.VERTICAL);
        bar.setVisibility(View.GONE);
        progress = new View(a);
        progress.setPivotX(0);
        bar.addView(progress, new LinearLayout.LayoutParams(-1, dp(2)));
        LinearLayout row = new LinearLayout(a);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(12), dp(8), dp(4), dp(8));
        cover = new ImageView(a);
        cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
        cover.setClipToOutline(true);
        cover.setBackground(DaylightTheme.round(t.tile, dp(8)));
        row.addView(cover, new LinearLayout.LayoutParams(dp(44), dp(44)));
        LinearLayout words = new LinearLayout(a);
        words.setOrientation(LinearLayout.VERTICAL);
        words.setPadding(dp(12), 0, dp(8), 0);
        title = t.text(a, "", DaylightTheme.Type.BODY, t.ink, true);
        title.setMaxLines(1);
        title.setEllipsize(android.text.TextUtils.TruncateAt.END);
        words.addView(title);
        line = t.text(a, "", DaylightTheme.Type.LABEL, t.inkMuted, false);
        line.setMaxLines(1);
        line.setEllipsize(android.text.TextUtils.TruncateAt.END);
        words.addView(line);
        row.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
        play = button(R.drawable.daylight_mini_play, "Play");
        play.setOnClickListener(v -> toggle());
        UiTelemetry.tag(play, "mini.play-pause");
        row.addView(play, new LinearLayout.LayoutParams(dp(48), dp(48)));
        next = button(R.drawable.daylight_mini_next, "Next");
        next.setOnClickListener(v -> {
            NowPlayingNote.Entry e = NowPlayingNote.current();
            if (e != null && e.transport != null) { v.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY); e.transport.next(); }
        });
        UiTelemetry.tag(next, "mini.next");
        row.addView(next, new LinearLayout.LayoutParams(dp(48), dp(48)));
        bar.addView(row, new LinearLayout.LayoutParams(-1, -2));
        bar.setOnClickListener(v -> open("tap"));
        bar.setOnLongClickListener(v -> longPress());
        // TalkBack: the same sheet as the long-press, named for what is playing.
        MoreOptions.attach(bar, () -> {
            NowPlayingNote.Entry now = NowPlayingNote.current();
            return now == null ? "" : now.title;
        }, this::longPress);
        bar.setOnTouchListener(this::swipe);
        UiTelemetry.tag(bar, "mini.open");
        paint();
    }

    /** The bar, to add as the last child of the screen's vertical root. */
    public View view() { return bar; }

    /** The mini player's view tag: a line drawn over the screen (a keep in progress) sits above it. */
    public static final String VIEW_TAG = "daylight.miniPlayer";

    public void start() {
        if (listening) return;
        listening = true;
        NowPlayingNote.listen(changed);
        // A paused item the service let go of (stopped in the background) comes back: the bar follows its report.
        if (MiniPlayerState.wake(NowPlayingNote.forTarget("local"), ShellStart.savedQueue(activity))) ShellStart.wakeSavedQueue(activity);
        draw();
    }

    public void stop() {
        listening = false;
        NowPlayingNote.unlisten(changed);
        if (run != null) run.cancel();
        main.removeCallbacksAndMessages(null);
    }

    /** Call from the screen's onDestroy. */
    public void release() {
        stop();
        art.shutdownNow();
    }

    private boolean canOpen() {
        return activity.getPackageManager().resolveActivity(new Intent().setClassName(activity, NOW_PLAYING), 0) != null;
    }

    private void draw() {
        if (activity.isDestroyed()) return;
        NowPlayingNote.Entry e = NowPlayingNote.current();
        long now = SystemClock.elapsedRealtime();
        // A swipe-down holds only for the item it hid: the next one shows.
        if (e != null && !dismissed.isEmpty() && !MiniPlayerState.key(e).equals(dismissed)) dismissed = "";
        boolean show = canOpen() && MiniPlayerState.shown(e, dismissed, now);
        if (!show) { hide(); return; }
        if (pressedAt >= 0 && now - pressedAt > 3000) pressedAt = -1;
        boolean playing = MiniPlayerState.playing(e, pressedAt, flipped);
        title.setText(e.title);
        String said = MiniPlayerState.line(e);
        line.setText(said);
        // The line keeps its height when empty: the bar is one height from its first draw.
        line.setVisibility(said.isEmpty() ? View.INVISIBLE : View.VISIBLE);
        play.setImageResource(playing ? R.drawable.daylight_mini_pause : R.drawable.daylight_mini_play);
        play.setContentDescription(playing ? "Pause" : "Play");
        play.setEnabled(e.transport != null);
        play.setAlpha(e.transport != null ? 1f : 0.4f);
        next.setVisibility(e.canNext && e.transport != null ? View.VISIBLE : View.GONE);
        bar.setContentDescription((e.starting ? "Starting: " : playing ? "" : "Paused: ") + e.title
                + (said.isEmpty() || e.starting ? "" : ", " + said) + ". Open Now playing");
        if (!e.artworkUrl.equals(artUrl)) loadArt(e.artworkUrl);
        runProgress(e, playing, now);
        if (e.starting) main.postDelayed(this::draw, MiniPlayerState.STARTING_MS + 500);
        showUp();
    }

    /** The progress line: set to where the item is, then run to its end while playing (no timer). */
    private void runProgress(NowPlayingNote.Entry e, boolean playing, long now) {
        if (run != null) run.cancel();
        float f = e.fractionAt(now);
        progress.setVisibility(f < 0 ? View.INVISIBLE : View.VISIBLE);
        if (f < 0) return;
        progress.setScaleX(Math.max(0f, Math.min(1f, f)));
        if (!playing || e.durationMs <= 0) return;
        long left = Math.max(0, e.durationMs - e.positionAt(now));
        run = ObjectAnimator.ofFloat(progress, "scaleX", progress.getScaleX(), 1f).setDuration(left);
        run.setInterpolator(new LinearInterpolator());
        run.start();
    }

    private void showUp() {
        if (up) return;
        up = true;
        bar.setVisibility(View.VISIBLE);
        bar.setTranslationY(dp(72));
        bar.animate().translationY(0).setDuration(180).start();
    }

    private void hide() {
        if (run != null) run.cancel();
        if (!up) { bar.setVisibility(View.GONE); return; }
        up = false;
        bar.animate().translationY(bar.getHeight() > 0 ? bar.getHeight() : dp(72)).setDuration(180)
                .withEndAction(() -> { if (!up) bar.setVisibility(View.GONE); }).start();
    }

    private void toggle() {
        NowPlayingNote.Entry e = NowPlayingNote.current();
        if (e == null || e.transport == null) return;
        play.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
        boolean was = MiniPlayerState.playing(e, pressedAt, flipped);
        flipped = !was;
        pressedAt = SystemClock.elapsedRealtime();
        event("mini.toggle", "to", flipped ? "play" : "pause");
        draw();   // at once; the player's report corrects it
        e.transport.playPause();
    }

    /** The extra that makes Now playing open its target picker (Play on…); NowPlayingActivity reads it. */
    public static final String EXTRA_PICKER = "np.picker";

    /**
     * Long-press: the item sheet (the item, Open Now playing, Play on…, and last the
     * destructive Stop). Stop and clear acts on this entry's own target: this phone's queue,
     * or the screen Now playing is controlling; never silently the other one.
     */
    private boolean longPress() {
        NowPlayingNote.Entry e = NowPlayingNote.current();
        if (e == null || e.title.isEmpty()) return false;
        bar.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS);
        longFired = true;
        event("mini.long-press", "target", "local".equals(e.target) ? "local" : "screen");
        boolean playing = MiniPlayerState.playing(e, pressedAt, flipped);
        final NowPlayingNote.Transport transport = e.transport;
        final String target = e.target, targetName = e.targetName;
        ItemSheet sheet = ItemSheet.of(activity, screen)
                .item(e.artworkUrl, CoverGlyph.Kind.ALBUM, e.title, MiniPlayerState.line(e),
                        e.starting ? "Starting…" : playing ? "Playing" : "Paused");
        for (String row : MiniPlayerMenu.rows(!e.starting && transport != null, target)) {
            String label = MiniPlayerMenu.label(row, targetName);
            switch (row) {
                case "open": sheet.row(R.drawable.daylight_ic_expand, label, () -> open("sheet")); break;
                case "play_on": sheet.row(R.drawable.daylight_ic_cast, label, () -> openPicker(target, targetName)); break;
                default: sheet.destructive(R.drawable.daylight_ic_stop, label, () -> stopAndClear(transport, target, targetName, row)); break;
            }
        }
        sheet.show();
        return true;
    }

    private void openPicker(String target, String targetName) {
        event("mini.open", "how", "play-on");
        Intent i = new Intent().setClassName(activity, NOW_PLAYING).putExtra("target", target).putExtra("targetName", targetName)
                .putExtra(EXTRA_PICKER, true).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        try { activity.startActivity(i); } catch (RuntimeException absent) { /* not in this build */ }
    }

    private void stopAndClear(NowPlayingNote.Transport transport, String target, String targetName, String row) {
        android.widget.FrameLayout host = activity.findViewById(android.R.id.content);
        int inset = belowBar(host);
        Object token = transport.stopAndClear();
        event("mini.stop", "row", row);
        if (token == null) {
            // Nothing could stop it: never leave the bar up without a word.
            if (host != null) Snack.show(host, t, "Couldn't stop it", null, null, 3000, inset);
            return;
        }
        // The bar goes now; the service's own report agrees a moment later.
        if ("local".equals(target)) NowPlayingNote.update(target, targetName, "", false, SystemClock.elapsedRealtime());
        if (!MiniPlayerMenu.undoable(row) || token == NowPlayingNote.NO_UNDO) return;
        if (host == null) return;
        Snack.show(host, t, "Stopped and cleared", "Undo", () -> {
            boolean ok = transport.restore(token);
            event("mini.undo", "ok", String.valueOf(ok));
            if (!ok) Snack.show(host, t, "Couldn't bring it back", null, null, 3000, inset);
        }, NowPlayingNote.UNDO_SNACK_MS, inset);
    }

    /** How far the bar's bottom edge is above the screen content's bottom (a bottom nav under it), so a line can sit there. */
    private int belowBar(android.widget.FrameLayout host) {
        if (host == null || bar.getHeight() == 0) return 0;
        int[] b = new int[2], h = new int[2];
        bar.getLocationInWindow(b);
        host.getLocationInWindow(h);
        return Math.max(0, (h[1] + host.getHeight()) - (b[1] + bar.getHeight()));
    }

    /** Tap or swipe up: Now playing on that target, rising from the bar, drawn from the same entry. */
    private void open(String how) {
        NowPlayingNote.Entry e = NowPlayingNote.current();
        if (e == null) return;
        event("mini.open", "how", how);
        Intent i = new Intent().setClassName(activity, NOW_PLAYING).putExtra("target", e.target).putExtra("targetName", e.targetName)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        try { activity.startActivity(i); } catch (RuntimeException absent) { /* not in this build */ }
    }

    private boolean swipe(View v, MotionEvent m) {
        switch (m.getActionMasked()) {
            case MotionEvent.ACTION_DOWN: downY = m.getRawY(); longFired = false; return false;
            case MotionEvent.ACTION_MOVE: {
                float dy = m.getRawY() - downY;
                if (dy > 0) bar.setTranslationY(dy);
                return Math.abs(dy) > dp(12);
            }
            case MotionEvent.ACTION_UP: {
                // The finger that long-pressed lifting (maybe after drifting) is not a swipe.
                if (longFired) { longFired = false; bar.animate().translationY(0).setDuration(120).start(); return true; }
                float dy = m.getRawY() - downY;
                if (dy < -dp(24)) { bar.setTranslationY(0); open("swipe"); return true; }
                if (dy > dp(28)) {
                    // Down: away for this screen until the next item; playback goes on.
                    dismissed = MiniPlayerState.key(NowPlayingNote.current());
                    event("mini.dismiss", "how", "swipe");
                    hide();
                    return true;
                }
                bar.animate().translationY(0).setDuration(120).start();
                return Math.abs(dy) > dp(12);
            }
            case MotionEvent.ACTION_CANCEL:
                bar.animate().translationY(0).setDuration(120).start();
                return false;
            default: return false;
        }
    }

    private void loadArt(String url) {
        artUrl = url;
        Bitmap hit = url.isEmpty() ? null : PlaylistArtwork.cached(url, 160);
        if (hit != null || url.isEmpty()) {
            cover.setImageBitmap(hit);
            accent = hit == null ? CoverColor.NONE : accentOf(hit);
            paint();
            return;
        }
        cover.setImageDrawable(null);
        accent = CoverColor.NONE;
        paint();
        try {
            art.execute(() -> {
                Bitmap b = PlaylistArtwork.load(url, 160);
                int a = b == null ? CoverColor.NONE : accentOf(b);
                main.post(() -> {
                    if (activity.isDestroyed() || !url.equals(artUrl)) return;
                    cover.setImageBitmap(b);
                    accent = a;
                    paint();
                });
            });
        } catch (java.util.concurrent.RejectedExecutionException released) { }
    }

    private static int accentOf(Bitmap b) {
        Bitmap small = Bitmap.createScaledBitmap(b, 32, 32, true);
        int[] px = new int[32 * 32];
        small.getPixels(px, 0, 32, 0, 0, 32, 32);
        return CoverColor.of(px);
    }

    /** The surface, tinted by the cover's colour when there is one. */
    private void paint() {
        DaylightTheme c = t.withAccent(accent);
        int fill = ThemeColors.mix(t.surfaceVariant, c.primary, accent == CoverColor.NONE ? 0 : 0.22);
        bar.setBackground(t.pressable(new android.graphics.drawable.ColorDrawable(fill)));
        progress.setBackgroundColor(c.primary);
        int glyph = ThemeColors.readableOn(fill);
        play.setImageTintList(ColorStateList.valueOf(glyph));
        next.setImageTintList(ColorStateList.valueOf(glyph));
        title.setTextColor(glyph);
        line.setTextColor(ThemeColors.mix(fill, glyph, 0.7));
    }

    private ImageButton button(int icon, String said) {
        ImageButton b = new ImageButton(activity);
        b.setImageResource(icon);
        b.setBackground(t.pressable(DaylightTheme.round(0x00000000, dp(22))));
        b.setScaleType(ImageView.ScaleType.FIT_CENTER);
        b.setPadding(dp(8), dp(8), dp(8), dp(8));
        b.setContentDescription(said);
        return b;
    }

    private void event(String name, String key, String value) {
        try { UiTelemetry.event(screen, name, new JSONObject().put("screen", screen).put(key, value)); }
        catch (Exception ignored) { }
    }

    private int dp(int v) { return Math.round(v * activity.getResources().getDisplayMetrics().density); }
}

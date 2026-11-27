package net.kckern.daylight.cap.mediaservice.shell;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.text.Editable;
import android.text.InputType;
import android.text.TextUtils;
import android.text.TextWatcher;
import android.util.Log;
import android.view.GestureDetector;
import android.view.Gravity;
import android.view.MenuItem;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.media3.common.MediaItem;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;

import com.google.common.util.concurrent.ListenableFuture;

import net.kckern.daylight.shellkit.DaylightTheme;
import net.kckern.daylight.shellkit.DaylightTheme.Radius;
import net.kckern.daylight.shellkit.DaylightTheme.Type;
import net.kckern.daylight.shellkit.UiTelemetry;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Lookup and browse (ops:docs/superpowers/specs/2026-11-26-phone-lookup-and-browse.md): one
 * screen in three modes. Search (grouped results, recent searches), the library's first
 * level, and a level of the library. A level of one thing (an album, a playlist, a station,
 * an artist, an author, a book, a series) is a detail page, chosen by its kind (MediaKind):
 * a header with one primary circular button, at most four secondary icon buttons and a ⋮
 * overflow beside the cover; an author's or artist's page is about the person (portrait, facts, summary).
 * Row second lines never repeat the page (RowLine). A detail page opened from a list pages
 * left and right through that list (Neighbours); Back returns to the list scrolled to the
 * entry shown. The name is in the top bar next to Back; the page takes its colours from its
 * cover (DetailLook). An album's tracks and a book's parts are one compact numbered line
 * each; a row's menu is its long-press. The mini player (shell-kit MiniPlayer) is at the
 * bottom of every level.
 * Lookup, not discovery: nothing is proposed. Every list is drawn from its last answer at
 * once and replaced in place; rows have a fixed height, so nothing jumps. Offline it shows
 * what is on this phone and says so. Not exported.
 */
public final class BrowseActivity extends Activity {
    static final String TAG = "Daylight-Media";
    static final String MODE_SEARCH = "search", MODE_LIBRARY = "library";
    static final String EXTRA_NEIGHBOURS = "neighbours", EXTRA_INDEX = "index", EXTRA_PAGES_IN = "pagesIn", EXTRA_SHOWN = "shownId";
    private static final int REQ_DETAIL = 41;
    private static final String PREFS = "daylight.browse";
    private static final int ROW_DP = 64;
    private static final long WAIT_MS = 12_000;

    private final Handler main = new Handler(Looper.getMainLooper());
    // One executor per purpose: a 45 s screen command or a slow level never holds up a search.
    /** Levels, More, a book's progress and Mark finished. */
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    /** Searches: a queued search the person has typed past is skipped, not run. */
    private final ExecutorService searchIo = Executors.newSingleThreadExecutor();
    /** Screens: the Play on list and the screen commands. */
    private final ExecutorService screenIo = Executors.newSingleThreadExecutor();
    /** The neighbours' pages, fetched ahead so a swipe lands on a drawn page. */
    private final ExecutorService prefetchIo = Executors.newSingleThreadExecutor();
    private final ExecutorService covers = Executors.newFixedThreadPool(2);
    private final PayloadMedia media = new PayloadMedia();
    private DaylightTheme t;
    private LinearLayout column, results, headerBox;
    private TextView status;
    private String mode, parent, kind, title, subtitle, art, group;
    private final List<JSONObject> rows = new ArrayList<>();
    private final List<View> rowViews = new ArrayList<>();
    /** Search: each group's rows, for paging a page opened from one through the rest of its group. */
    private final java.util.Map<String, List<JSONObject>> searchGroups = new java.util.HashMap<>();
    private TextView progressLine, barTitle;
    /** A detail page's root: its background is the cover's gradient (DetailLook). */
    private LinearLayout page;
    /** "13 tracks · 1 h 3 min" over the list, with its hairline (DetailLook.countLine). */
    private TextView countLine;
    private View countRule;
    /** The header cover's colour (CoverColor), and the cover it came from. */
    private int coverAccent = net.kckern.daylight.shellkit.CoverColor.NONE;
    private String accentUrl = "";
    /** A book's parts' places from home ({id: {playhead, duration, finished}}), for the sheet's header. */
    private JSONObject partPlaces;
    /** The title playing on this phone as the rows were drawn: a change redraws the rows. */
    private String playingShown = "";
    private LinearLayout azStrip;
    private ScrollView scroller;
    private volatile int generation;
    /** The level's rows, kept by id: a refreshed answer updates them in place (no blink, no lost press). */
    private net.kckern.daylight.shellkit.KeyedRows<JSONObject> keyed;
    private ListenableFuture<MediaController> pending;
    private MediaController controller;
    private final net.kckern.daylight.shellkit.TapGuard playGuard = new net.kckern.daylight.shellkit.TapGuard();
    private net.kckern.daylight.shellkit.MiniPlayer mini;
    /** The person's header answer (About), or null until it arrives. */
    private JSONObject about;
    /** Home answered the about request (or could not): the header's reserved places can close. */
    private boolean aboutAnswered;
    private Neighbours neighbours = Neighbours.NONE;
    private GestureDetector swipe;

    /** Opens the search, the library, or one level of it. */
    static void open(Context c, String mode, String parent, String kind, String title, String subtitle, String art) {
        open(c, mode, parent, kind, title, subtitle, art, null);
    }

    /** A level that pages through {@code pagesIn}'s children (Now playing's album line: the artist's albums). */
    static void open(Context c, String mode, String parent, String kind, String title, String subtitle, String art, String pagesIn) {
        Intent i = new Intent(c, BrowseActivity.class).putExtra("mode", mode).putExtra("parent", parent)
                .putExtra("kind", kind).putExtra("title", title).putExtra("subtitle", subtitle).putExtra("art", art);
        if (pagesIn != null) i.putExtra(EXTRA_PAGES_IN, pagesIn);
        if (!(c instanceof Activity)) i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        c.startActivity(i);
    }

    /** Search, opened with words already in the field and one group shown first (Now playing's album or artist). */
    static void search(Context c, String query, String group) {
        Intent i = new Intent(c, BrowseActivity.class).putExtra("mode", MODE_SEARCH).putExtra("query", query).putExtra("group", group);
        if (!(c instanceof Activity)) i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        c.startActivity(i);
    }

    @Override protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (field != null) out.putString("typed", field.getText().toString());
    }

    @Override protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        net.kckern.daylight.shellkit.ShellStart.ensure(this);
        t = DaylightTheme.of(this);
        Intent in = getIntent();
        mode = in.getStringExtra("mode");
        parent = in.getStringExtra("parent");
        kind = MediaKind.normal(nz(in.getStringExtra("kind")));
        title = nz(in.getStringExtra("title"));
        subtitle = nz(in.getStringExtra("subtitle"));
        art = nz(in.getStringExtra("art"));
        group = nz(in.getStringExtra("group"));
        if (mode == null) mode = parent == null ? MODE_LIBRARY : "level";
        neighbours = Neighbours.parse(in.getStringExtra(EXTRA_NEIGHBOURS), in.getIntExtra(EXTRA_INDEX, -1));
        if (getActionBar() != null) {
            getActionBar().setDisplayHomeAsUpEnabled(true);
            if (detail()) {
                // A detail page: its name is in the bar next to Back, always (2026-11-27, as Plexamp).
                barTitle = t.text(this, title, Type.TITLE, t.ink, true);
                barTitle.setSingleLine(true);
                barTitle.setEllipsize(TextUtils.TruncateAt.END);
                getActionBar().setDisplayShowTitleEnabled(false);
                getActionBar().setDisplayShowCustomEnabled(true);
                getActionBar().setCustomView(barTitle);
            }
        }
        setTitle(MODE_SEARCH.equals(mode) ? "Search" : MODE_LIBRARY.equals(mode) ? "Library" : title.isEmpty() ? "Library" : title);

        page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(t.background);
        // A rotation keeps what was typed (audit: the text was lost).
        String typed = saved != null && saved.containsKey("typed") ? nz(saved.getString("typed")) : nz(in.getStringExtra("query"));
        if (MODE_SEARCH.equals(mode)) page.addView(searchField(typed));
        scroller = new ScrollView(this);
        column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setPadding(dp(16), dp(8), dp(16), dp(24));
        scroller.addView(column);
        page.addView(scroller, new LinearLayout.LayoutParams(-1, 0, 1));
        // The mini player: its list ends above it, so the last row is never under it.
        mini = net.kckern.daylight.shellkit.MiniPlayer.attach(this, "Browse");
        page.addView(mini.view(), new LinearLayout.LayoutParams(-1, -2));
        setContentView(page);
        swipe = new GestureDetector(this, new GestureDetector.SimpleOnGestureListener() {
            @Override public boolean onFling(MotionEvent a, MotionEvent b, float vx, float vy) {
                if (a == null || b == null || !neighbours.pages()) return false;
                float dx = b.getX() - a.getX(), dy = b.getY() - a.getY();
                if (Math.abs(dx) < dp(64) || Math.abs(dx) < Math.abs(dy) * 1.6f) return false;
                page(dx < 0 ? 1 : -1);
                return true;
            }
        });

        buildPage();
        UiTelemetry.event("Browse", "browse.view", new JSONObject(java.util.Map.of("kind", "level".equals(mode) ? kind : mode)));
        Log.i(TAG, "browse open " + mode + " " + kind);

        if (MODE_SEARCH.equals(mode)) {
            String q = typed;
            if (q.isEmpty()) showRecent(); else runSearch(q);
        } else {
            startLevel();
            String pagesIn = in.getStringExtra(EXTRA_PAGES_IN);
            if (!neighbours.pages() && pagesIn != null && detail()) loadNeighboursFrom(pagesIn);
        }
    }

    private boolean started;

    @Override protected void onStart() {
        super.onStart();
        mini.start();
        // The row that plays shows the playing glyph: redrawn as the item changes.
        playingShown = playingTitle();
        net.kckern.daylight.shellkit.NowPlayingNote.listen(playingChanged);
        if (started && !rows.isEmpty()) redrawRows();
        // Back from Now playing or On this phone: the book's progress and Keep's state are read again.
        if (started && detail()) fillHeader();
        started = true;
        keepShown = keepState();
        main.removeCallbacks(keepWatch);
        if (detail()) main.postDelayed(keepWatch, KEEP_WATCH_MS);
    }

    /** How often an open page re-reads its keep (a Keep, a removal or an automatic keep made elsewhere). */
    private static final long KEEP_WATCH_MS = 2000;
    /** The keep state the header was drawn with. */
    private String keepShown = "";

    /**
     * The page's keep as the header shows it: the kept entry (state, auto or not) and the
     * collection's line. A change (Keep on a book kept automatically, a download landing)
     * redraws the header in place, so it never says "Kept automatically" after a Keep.
     */
    private String keepState() {
        if (!detail() || parent == null) return "";
        String cid = contentIdOf(parent);
        JSONObject k = KeepLabels.holding(net.kckern.daylight.shellkit.KeptIndex.read(getFilesDir()), cid);
        return (k == null ? "-" : k.optString("state") + "|" + k.optBoolean("auto")) + "|" + KeepLabels.collectionLine(this, cid);
    }

    private final Runnable keepWatch = new Runnable() {
        @Override public void run() {
            if (isFinishing() || isDestroyed()) return;
            String now = keepState();
            if (!now.equals(keepShown)) {
                keepShown = now;
                fillHeader();
            }
            main.postDelayed(this, KEEP_WATCH_MS);
        }
    };

    @Override protected void onStop() {
        main.removeCallbacks(keepWatch);
        net.kckern.daylight.shellkit.NowPlayingNote.unlisten(playingChanged);
        mini.stop();
        super.onStop();
    }

    @Override protected void onDestroy() {
        super.onDestroy();
        mini.release();
        io.shutdownNow();
        searchIo.shutdownNow();
        screenIo.shutdownNow();
        prefetchIo.shutdownNow();
        covers.shutdownNow();
        if (pending != null) MediaController.releaseFuture(pending);
        else if (controller != null) controller.release();
        pending = null;
        controller = null;
    }

    @Override public boolean onOptionsItemSelected(MenuItem item) {
        if (item.getItemId() == android.R.id.home) { finish(); return true; }
        return super.onOptionsItemSelected(item);
    }

    /** Back from a paged detail page: the list it came from is scrolled to the entry shown now. */
    @Override public void finish() {
        if (neighbours.pages() && neighbours.current() != null) setResult(RESULT_OK, new Intent().putExtra(EXTRA_SHOWN, neighbours.current().id));
        super.finish();
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != REQ_DETAIL || result != RESULT_OK || data == null) return;
        String shown = data.getStringExtra(EXTRA_SHOWN);
        if (shown == null) return;
        for (int i = 0; i < results.getChildCount(); i++) {
            View v = results.getChildAt(i);
            if (shown.equals(v.getTag(R.id.daylight_browse_row_id))) {
                final View row = v;
                scroller.post(() -> scroller.scrollTo(0, Math.max(0, results.getTop() + row.getTop() - dp(64))));
                return;
            }
        }
    }

    /** Horizontal swipes page a detail page; everything else scrolls as usual. */
    @Override public boolean dispatchTouchEvent(MotionEvent e) {
        if (detail() && neighbours.pages() && swipe != null && swipe.onTouchEvent(e)) {
            MotionEvent cancel = MotionEvent.obtain(e);
            cancel.setAction(MotionEvent.ACTION_CANCEL);
            super.dispatchTouchEvent(cancel);
            cancel.recycle();
            return true;
        }
        return super.dispatchTouchEvent(e);
    }

    private boolean detail() { return "level".equals(mode) && MediaKind.detail(kind); }

    /** The page's frame: header (a detail page), status, the A–Z strip and the rows. */
    private void buildPage() {
        column.removeAllViews();
        rows.clear();
        rowViews.clear();
        about = null;
        aboutAnswered = false;
        progressLine = null;
        partPlaces = null;
        countLine = null;
        countRule = null;
        headerBox = new LinearLayout(this);
        headerBox.setOrientation(LinearLayout.VERTICAL);
        column.addView(headerBox);
        status = t.text(this, "", Type.LABEL, t.inkMuted, false);
        if (detail()) {
            // One row over the list, reserved from the first frame (DetailLook.slots): the loading
            // or failure words on the left, one line, and the count flush right with a hairline
            // under it (as Plexamp). The words never take a line of their own, so the list does
            // not move when they go (2026-11-27: Inferno's rows jumped up as "Loading…" left).
            LinearLayout statusRow = new LinearLayout(this);
            statusRow.setGravity(Gravity.CENTER_VERTICAL);
            statusRow.setPadding(0, dp(4), 0, dp(6));
            status.setMaxLines(1);
            status.setEllipsize(TextUtils.TruncateAt.END);
            status.setVisibility(View.INVISIBLE);
            status.addTextChangedListener(new TextWatcher() {
                @Override public void beforeTextChanged(CharSequence s, int a, int b, int c) { }
                @Override public void onTextChanged(CharSequence s, int a, int b, int c) { }
                @Override public void afterTextChanged(Editable e) { status.setVisibility(e.length() == 0 ? View.INVISIBLE : View.VISIBLE); }
            });
            statusRow.addView(status, new LinearLayout.LayoutParams(0, -2, 1));
            countLine = t.text(this, "\u00A0", Type.LABEL, t.inkMuted, false);
            countLine.setGravity(Gravity.END);
            countLine.setMaxLines(1);
            countLine.setPadding(dp(8), 0, 0, 0);
            statusRow.addView(countLine, new LinearLayout.LayoutParams(-2, -2));
            column.addView(statusRow, new LinearLayout.LayoutParams(-1, -2));
            if (MediaKind.listsRows(kind) && !MediaKind.aboutPerson(kind)) {
                countRule = new View(this);
                countRule.setBackgroundColor(t.outline);
                column.addView(countRule, new LinearLayout.LayoutParams(-1, Math.max(1, dp(1) / 2)));
            } else {
                countLine = null;
            }
            fillHeader();
        } else {
            fillHeader();
            status.setMinHeight(dp(20));
            column.addView(status);
        }
        // The A–Z strip of a long level: its height is reserved only once a level is long.
        azStrip = new LinearLayout(this);
        android.widget.HorizontalScrollView azScroll = new android.widget.HorizontalScrollView(this);
        azScroll.setHorizontalScrollBarEnabled(false);
        azScroll.addView(azStrip);
        column.addView(azScroll);
        results = new LinearLayout(this);
        results.setOrientation(LinearLayout.VERTICAL);
        column.addView(results);
        keyed = new net.kckern.daylight.shellkit.KeyedRows<>(results, new net.kckern.daylight.shellkit.KeyedRows.Rows<JSONObject>() {
            @Override public String key(JSONObject n) { return n.optString("id"); }
            @Override public String signature(JSONObject n) { return n.toString() + "|" + bookSignature(n) + "|" + isPlayingRow(n); }
            @Override public View create(JSONObject n) { return row(n, null); }
            // A changed row is drawn again; an unchanged one is not touched.
            @Override public View update(View old, JSONObject n) { return row(n, null); }
        });
        if (barTitle != null) barTitle.setText(title);
    }

    private void startLevel() {
        if (detail() && !MediaKind.listsRows(kind)) {
            status.setText("Plays as a radio station: its songs with station IDs between them.");
        } else {
            showCached();
            load(0);
        }
        // A person's header; or a page opened by a link with no name yet (daylight://media/book/<id>):
        // its title, by-line and cover come from home's info.
        // An album's too: its artist and year for the by-line ("Rush · 2007"); a book's for its
        // author, whose page the by-line opens.
        if ((MediaKind.aboutPerson(kind) || "album".equals(MediaKind.normal(kind)) || "book".equals(kind) || (detail() && title.isEmpty())) && "level".equals(mode)) loadAbout();
        prefetchNeighbours();
    }

    // ── search ──────────────────────────────────────────────────────────────

    private EditText field;
    private final Runnable debounced = () -> runSearch(field == null ? "" : field.getText().toString());

    private View searchField(String query) {
        field = new EditText(this);
        field.setHint("Books, talks, albums, artists, playlists");
        field.setSingleLine(true);
        field.setInputType(InputType.TYPE_CLASS_TEXT);
        field.setImeOptions(EditorInfo.IME_ACTION_SEARCH);
        field.setText(query);
        field.setTextColor(t.ink);
        field.setHintTextColor(t.inkMuted);
        field.setBackground(t.round(t.surface, Radius.LARGE));
        field.setPadding(dp(16), dp(12), dp(16), dp(12));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, dp(52));
        lp.setMargins(dp(16), dp(12), dp(16), dp(4));
        field.setLayoutParams(lp);
        field.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int a, int b, int c) { }
            @Override public void onTextChanged(CharSequence s, int a, int b, int c) { }
            @Override public void afterTextChanged(Editable s) {
                main.removeCallbacks(debounced);
                if (s.toString().trim().isEmpty()) showRecent(); else main.postDelayed(debounced, 250);
            }
        });
        field.setOnEditorActionListener((v, action, e) -> { main.removeCallbacks(debounced); runSearch(v.getText().toString()); return true; });
        UiTelemetry.tag(field, "search.field");
        if (query.isEmpty()) field.requestFocus();
        return field;
    }

    private void showRecent() {
        generation++;
        clearResults();
        JSONArray recent = recent();
        status.setText(recent.length() == 0 ? "Search the household's books, talks, music and playlists." : "Recent searches");
        for (int i = 0; i < recent.length(); i++) {
            String q = recent.optString(i);
            TextView r = t.text(this, q, Type.BODY, t.ink, false);
            r.setGravity(Gravity.CENTER_VERTICAL);
            r.setMinHeight(dp(48));
            r.setBackground(t.pressable(null));
            r.setOnClickListener(v -> { field.setText(q); field.setSelection(q.length()); runSearch(q); });
            UiTelemetry.tag(r, "search.recent");
            results.addView(r);
        }
        if (recent.length() > 0) results.addView(link("Clear recent searches", "search.clear_recent", () -> {
            prefs().edit().remove("recent").apply();
            showRecent();
        }));
    }

    private void runSearch(String raw) {
        final String q = raw == null ? "" : raw.trim();
        if (q.isEmpty()) { showRecent(); return; }
        final int mine = ++generation;
        status.setText("Searching…");
        searchIo.execute(() -> {
            // Typed past while it waited in the queue: this search is not asked at all.
            if (mine != generation) return;
            JSONObject answer;
            String reason = "";
            try { answer = new JSONObject(media.lookup(q, WAIT_MS)); }
            catch (Exception failed) { answer = null; reason = reasonOf(failed); Log.w(TAG, "search failed: " + failed.getClass().getSimpleName()); }
            JSONObject a = answer;
            String why = reason;
            main.post(() -> { if (mine == generation && !isFinishing()) showResults(q, a, why); });
        });
    }

    /** The cause of a failed or offline answer: what the payload said went wrong, and this phone's network. */
    private net.kckern.daylight.shellkit.FailureWords.Cause causeOf(JSONObject answer, String reason) {
        String r = answer != null ? net.kckern.daylight.shellkit.FailureWords.reasonOf(answer) : reason;
        return net.kckern.daylight.shellkit.FailureWords.cause(r, net.kckern.daylight.shellkit.FailureWords.networkValidated(this));
    }

    /** "starting" while the payload is not up yet; otherwise none (the payload's answer says why). */
    private static String reasonOf(Exception failed) {
        return failed instanceof net.kckern.daylight.api.PayloadPort.NotReadyException ? "starting" : "";
    }

    private boolean waitingUp;

    /** Once, when the payload attaches: {@code then} on the main thread, if this page is still open. */
    private void whenUp(Runnable then) {
        if (waitingUp) return;
        waitingUp = true;
        Thread w = new Thread(() -> {
            boolean up = media.awaitReady(10 * 60_000L);
            main.post(() -> { waitingUp = false; if (up && !isFinishing() && !isDestroyed()) then.run(); });
        }, "Daylight-browse-wait");
        w.setDaemon(true);
        w.start();
    }

    private void clearResults() {
        results.removeAllViews();
        keyed.reset();
    }

    private void showResults(String q, JSONObject answer, String reason) {
        clearResults();
        searchGroups.clear();
        if (answer == null || !answer.optBoolean("ok", false)) {
            net.kckern.daylight.shellkit.FailureWords.Cause cause = causeOf(answer, reason);
            status.setText(net.kckern.daylight.shellkit.FailureWords.line(cause));
            results.addView(link("Retry", "search.retry", () -> runSearch(q)));
            // Typed while the app was starting up (or its code was being replaced): searched
            // again by itself the moment it is up, not left for a second tap (audit).
            if (cause == net.kckern.daylight.shellkit.FailureWords.Cause.STARTING) whenUp(() -> {
                if (field != null && q.equals(field.getText().toString())) runSearch(q);
            });
            return;
        }
        rememberSearch(q);
        JSONArray groups = answer.optJSONArray("groups");
        boolean offline = answer.optBoolean("offline");
        int count = 0;
        for (int g = 0; groups != null && g < groups.length(); g++) count += groups.optJSONObject(g).optJSONArray("items").length();
        try { UiTelemetry.event("Browse", "search.query", new JSONObject().put("length", q.length()).put("results", count).put("offline", offline)); }
        catch (Exception ignored) { }
        // Offline answers are what is kept on this phone; the line says why home did not answer.
        String away = offline ? net.kckern.daylight.shellkit.FailureWords.head(causeOf(answer, "")) + " · searching what's on this phone" : "";
        if (count == 0) {
            status.setText(offline ? away + " · nothing kept matches \"" + q + "\"." : "Nothing called \"" + q + "\". Try fewer words.");
            if (offline) results.addView(link("Retry", "search.retry", () -> runSearch(q)));
            return;
        }
        status.setText(away);
        // The group asked for (Now playing's album or artist line) comes first.
        List<JSONObject> ordered = new ArrayList<>();
        for (int g = 0; groups != null && g < groups.length(); g++) {
            JSONObject grp = groups.optJSONObject(g);
            if (group.equals(grp.optString("key"))) ordered.add(0, grp); else ordered.add(grp);
        }
        for (JSONObject grp : ordered) {
            TextView h = t.text(this, grp.optString("title") + (grp.optInt("more") > 0 ? " · " + grp.optInt("more") + " more" : ""),
                    Type.LABEL, t.inkMuted, true);
            h.setPadding(0, dp(14), 0, dp(4));
            results.addView(h);
            JSONArray items = grp.optJSONArray("items");
            List<JSONObject> list = new ArrayList<>();
            for (int i = 0; items != null && i < items.length(); i++) list.add(items.optJSONObject(i));
            searchGroups.put(grp.optString("key"), list);
            for (JSONObject n : list) {
                View r = row(n, grp.optString("key"));
                results.addView(r);
            }
        }
    }

    private JSONArray recent() {
        try { return new JSONArray(prefs().getString("recent", "[]")); } catch (Exception e) { return new JSONArray(); }
    }

    private void rememberSearch(String q) {
        JSONArray old = recent(), now = new JSONArray().put(q);
        for (int i = 0; i < old.length() && now.length() < 10; i++) if (!q.equalsIgnoreCase(old.optString(i))) now.put(old.optString(i));
        prefs().edit().putString("recent", now.toString()).apply();
    }

    // ── library and levels ──────────────────────────────────────────────────

    private String cacheKey() { return cacheKeyOf(mode, parent); }

    private static String cacheKeyOf(String mode, String parent) { return MODE_LIBRARY.equals(mode) ? "lib" : "lvl|" + parent; }

    private void showCached() {
        String cached = prefs().getString(cacheKey(), "");
        if (cached.isEmpty()) {
            // Fixed-height placeholders, each the real row's height (a part page's compact row
            // or a cover row: DetailLook.slots), so the answer replaces them without the page moving.
            boolean compact = detail() && isPartPage(kind);
            int rowDp = compact ? DetailLook.COMPACT_ROW_DP : ROW_DP;
            int count = detail() ? DetailLook.slots(kind, false).rowsReserved : 6;
            for (int i = 0; i < count; i++) {
                View ph = new View(this);
                ph.setBackground(t.round(t.surface, Radius.SMALL));
                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, dp(rowDp - 8));
                lp.topMargin = dp(4);
                lp.bottomMargin = dp(4);
                results.addView(ph, lp);
            }
            // Words with the placeholders (audit: up to 12 s of wordless boxes), and a second
            // line once home is slow, so a wait never reads as a page with nothing on it.
            status.setText(loadingWords(MODE_LIBRARY.equals(mode), title));
            final int asked = generation;
            main.postDelayed(() -> {
                if (!isFinishing() && keyed.isEmpty() && rows.isEmpty() && asked == generation) status.setText(SLOW_WORDS);
            }, SLOW_AFTER_MS);
            return;
        }
        try { draw(new JSONArray(cached), null, false); } catch (Exception ignored) { }
    }

    static final long SLOW_AFTER_MS = 4_000;
    static final String SLOW_WORDS = "Home is slow to answer · still asking…";

    /** "Loading the library…", "Loading Paradise Lost…". */
    static String loadingWords(boolean library, String title) {
        if (library) return "Loading the library…";
        return title == null || title.trim().isEmpty() ? "Loading…" : "Loading " + title.trim() + "…";
    }

    private void load(int page) {
        final int mine = ++generation;
        final String asked = parent;
        io.execute(() -> {
            JSONObject answer;
            String reason = "";
            try {
                answer = new JSONObject(MODE_LIBRARY.equals(mode) ? media.library(WAIT_MS) : media.browse(browseId(kind, asked), page, 50, WAIT_MS));
            } catch (Exception failed) {
                answer = null;
                reason = reasonOf(failed);
                Log.w(TAG, "browse failed: " + failed.getClass().getSimpleName());
            }
            JSONObject a = answer;
            String why = reason;
            main.post(() -> { if (mine == generation && !isFinishing() && same(asked, parent)) answered(a, why); });
        });
    }

    private static boolean same(String a, String b) { return a == null ? b == null : a.equals(b); }

    private void answered(JSONObject answer, String reason) {
        if (answer == null || !answer.optBoolean("ok", false)) {
            // Why home did not answer, in its own words (offline, not answering, not found,
            // refused). The last answer stays on show under it; with none, the page leads to
            // what is on this phone.
            net.kckern.daylight.shellkit.FailureWords.Cause cause = causeOf(answer, reason);
            boolean retry = net.kckern.daylight.shellkit.FailureWords.retryable(cause)
                    || cause == net.kckern.daylight.shellkit.FailureWords.Cause.STARTING;
            if (cause == net.kckern.daylight.shellkit.FailureWords.Cause.STARTING) whenUp(() -> load(0));
            if (!rows.isEmpty()) {
                status.setText(net.kckern.daylight.shellkit.FailureWords.head(cause) + " · showing the last answer" + (retry ? " · Retry" : ""));
                if (retry) status.setOnClickListener(v -> { status.setOnClickListener(null); load(0); });
                return;
            }
            clearResults();
            status.setText(cause == net.kckern.daylight.shellkit.FailureWords.Cause.OFFLINE
                    ? "Offline: this isn't kept on this phone." : net.kckern.daylight.shellkit.FailureWords.line(cause));
            LinearLayout ways = new LinearLayout(this);
            ways.addView(link("On this phone", "browse.offline_kept", () -> DownloadsActivity.open(this)));
            if (retry) ways.addView(link("Retry", "browse.retry", () -> load(0)));
            results.addView(ways);
            return;
        }
        JSONArray items = answer.optJSONArray("items");
        boolean offline = answer.optBoolean("offline");
        // Only home's own answer is remembered: an offline one (what is kept) never replaces it.
        if (!offline) prefs().edit().putString(cacheKey(), items == null ? "[]" : items.toString()).apply();
        status.setOnClickListener(null);
        draw(items == null ? new JSONArray() : items, offline ? causeOf(answer, "") : null, false);
    }

    /**
     * The level's rows. Rows are kept by id: an answer equal to what shows changes nothing,
     * and a changed one updates only its own rows (the A–Z strip and a press in progress stay).
     * {@code away}: why this is what is kept on the phone (null for home's own answer).
     */
    private void draw(JSONArray items, net.kckern.daylight.shellkit.FailureWords.Cause away, boolean append) {
        boolean offline = away != null;
        status.setText(offline ? net.kckern.daylight.shellkit.FailureWords.head(away) + " · showing what's on this phone" : "");
        if (items.length() == 0 && !append) {
            clearResults();
            rows.clear();
            rowViews.clear();
            status.setText(offline ? net.kckern.daylight.shellkit.FailureWords.head(away) + " · nothing is kept on this phone yet."
                    : MODE_LIBRARY.equals(mode) ? "Nothing here yet." : "This is empty.");
            drawStrip();
            return;
        }
        // Placeholders or a failure's buttons go; rows already drawn stay where they are.
        if (keyed.isEmpty()) results.removeAllViews();
        if (!append) rows.clear();
        for (int i = 0; i < items.length(); i++) {
            JSONObject n = items.optJSONObject(i);
            if (n != null) rows.add(n);
        }
        if (!keyed.show(rows) && !append) return;   // the same answer: nothing is redrawn
        rowViews.clear();
        rowViews.addAll(keyed.views());
        drawStrip();
        refreshCount();
        if (progressLine != null) loadProgress();
        // An artist's album count is the rows once home gives no count of its own.
        if (MediaKind.aboutPerson(kind)) refreshFacts();
    }

    // ── A–Z ─────────────────────────────────────────────────────────────────

    /** The first letter a row sorts under (a leading "The " or "A " left out, as Plex sorts). */
    static char letterOf(String title) {
        String t = title == null ? "" : title.trim();
        String low = t.toLowerCase(java.util.Locale.ROOT);
        if (low.startsWith("the ")) t = t.substring(4); else if (low.startsWith("a ")) t = t.substring(2);
        if (t.isEmpty()) return '#';
        char c = Character.toUpperCase(t.charAt(0));
        return c >= 'A' && c <= 'Z' ? c : '#';
    }

    /** On a level of 40 rows or more, a strip of the letters present; a tap scrolls to the first row under it. */
    private void drawStrip() {
        azStrip.removeAllViews();
        if (rows.size() < 40 || detail()) return;
        // Letters in A–Z order whatever order the level comes in (a library may list by date added);
        // each goes to the first row under it.
        java.util.TreeMap<Character, Integer> first = new java.util.TreeMap<>();
        for (int i = 0; i < rows.size(); i++) {
            String id = rows.get(i).optString("id");
            if (id.startsWith("m:")) continue;
            char c = letterOf(rows.get(i).optString("title"));
            if (!first.containsKey(c)) first.put(c, i);
        }
        if (first.size() < 3) return;
        for (java.util.Map.Entry<Character, Integer> e : first.entrySet()) {
            TextView l = t.text(this, String.valueOf(e.getKey()), Type.LABEL, t.ink, true);
            l.setGravity(Gravity.CENTER);
            l.setBackground(t.pressable(null));
            int at = e.getValue();
            l.setOnClickListener(v -> {
                if (at < rowViews.size()) scroller.smoothScrollTo(0, results.getTop() + rowViews.get(at).getTop());
                action("az");
            });
            l.setContentDescription("Jump to " + e.getKey());
            azStrip.addView(l, new LinearLayout.LayoutParams(dp(36), dp(40)));
        }
    }

    // ── a book: progress, speed, finished ────────────────────────────────────

    private List<String> trackIds() {
        List<String> ids = new ArrayList<>();
        for (JSONObject r : rows) {
            String cid = contentIdOf(r.optString("id"));
            if (r.optString("id").startsWith("p:") && !cid.isEmpty()) ids.add(cid);
        }
        return ids;
    }

    /**
     * Every part of this book, not only the loaded rows (audit: a book of more than 50 parts
     * counted its first page): the loaded ids, then home's further pages while each is full.
     * Off the main thread.
     */
    private List<String> allPartIds(List<String> loaded) {
        return allPartIds(loaded, null);
    }

    /** @param lengths filled with each part's length (seconds) as home's rows give it, when not null */
    private List<String> allPartIds(List<String> loaded, java.util.Map<String, Long> lengths) {
        List<String> ids = new ArrayList<>(loaded);
        int pageSize = 50;
        for (int page = Math.max(1, loaded.size() / pageSize); ids.size() >= page * pageSize && page < 40; page++) {
            JSONArray items;
            try { items = new JSONObject(media.browse(browseId(kind, parent), page, pageSize, WAIT_MS)).optJSONArray("items"); }
            catch (Exception noMore) { break; }
            int before = ids.size();
            for (int i = 0; items != null && i < items.length(); i++) {
                JSONObject row = items.optJSONObject(i);
                String id = row == null ? "" : row.optString("id");
                String cid = contentIdOf(id);
                if (id.startsWith("p:") && !cid.isEmpty() && !ids.contains(cid)) ids.add(cid);
                if (lengths != null && id.startsWith("p:") && row.optLong("durationSec", 0) > 0) lengths.put(cid, row.optLong("durationSec"));
            }
            if (ids.size() == before) break;
        }
        return ids;
    }

    /** Each loaded part's length (seconds), from its row. */
    private java.util.Map<String, Long> partLengths() {
        java.util.Map<String, Long> out = new java.util.HashMap<>();
        for (JSONObject r : rows) {
            String id = r.optString("id");
            if (id.startsWith("p:") && r.optLong("durationSec", 0) > 0) out.put(contentIdOf(id), r.optLong("durationSec"));
        }
        return out;
    }

    private void loadProgress() {
        final List<String> loaded = trackIds();
        if (loaded.isEmpty()) return;
        final java.util.Map<String, Long> lengths = partLengths();
        io.execute(() -> {
            final List<String> ids = allPartIds(loaded, lengths);
            JSONObject p = null, reply = null;
            String reason = "";
            try { reply = new JSONObject(media.progress(ids, WAIT_MS)); p = reply.optJSONObject("progress"); }
            catch (Exception e) { reason = reasonOf(e); }
            JSONObject got = p, said = reply;
            String why = reason;
            main.post(() -> {
                if (isFinishing() || progressLine == null) return;
                partPlaces = got;
                progressLine.setText(progressWords(ids, lengths, got, progressUnavailable(causeOf(said, why))));
                // The whole book's parts, not only the loaded page of them.
                long total = 0;
                for (String id : ids) total += lengths.containsKey(id) ? lengths.get(id) : 0;
                showCount(ids.size(), total);
            });
        });
    }

    /** "2 h 10 min left · 34 %", "Finished", or "Not started" from the parts' progress (seconds). */
    static String progressWords(List<String> ids, JSONObject progress) {
        return progressWords(ids, null, progress, "Progress isn't available offline");
    }

    /** The progress line when home gave none, by why. */
    static String progressUnavailable(net.kckern.daylight.shellkit.FailureWords.Cause cause) {
        switch (cause) {
            case OFFLINE: return "Progress isn't available offline";
            case STARTING: return "Progress shows once started up";
            default: return "Progress: " + net.kckern.daylight.shellkit.FailureWords.line(cause);
        }
    }

    static String progressWords(List<String> ids, JSONObject progress, String unavailable) {
        return progressWords(ids, null, progress, unavailable);
    }

    /**
     * What is left of the whole book from its place, at 1× (BookLeft, TimeLeft: one rule with
     * the author's row, Continue and Now playing), and how far in.
     *
     * @param lengths     each part's length from its row (a part with no place counts whole)
     * @param unavailable the line when there is no progress answer (why home did not answer)
     */
    static String progressWords(List<String> ids, java.util.Map<String, Long> lengths, JSONObject progress, String unavailable) {
        if (progress == null) return unavailable;
        BookLeft b = BookLeft.of(ids, lengths, progress);
        if (!b.started) return "Not started";
        if (b.finished) return "Finished";
        return net.kckern.daylight.shellkit.TimeLeft.words(b.leftSec) + " · " + b.percent + " %";
    }

    private SharedPreferences speeds() { return getSharedPreferences(LongFormPolicy.PREFS, MODE_PRIVATE); }

    private String speedKey() { return LongForm.speedKey(null, title); }

    private float bookSpeed() {
        SharedPreferences p = speeds();
        float fallback = p.getFloat(LongForm.DEFAULT_KEY, 1f);
        return LongForm.clampSpeed(p.getFloat("speed:" + speedKey(), fallback));
    }

    /**
     * The book's speed in the speed sheet (D19), the same memory Now playing uses for it
     * ("speed:" + its key) and the long-form default. Applies as it moves; the Speed label
     * redraws when the sheet closes.
     */
    private void chooseSpeed(View anchor) {
        SpeedSheet.show(this, anchor, bookSpeed(), true, s -> {
            speeds().edit().putFloat("speed:" + speedKey(), s).putFloat(LongForm.DEFAULT_KEY, s).apply();
            action("speed");
        }).onClose(this::fillHeader);
    }

    /** Marks {@code ids} finished (or not): the whole book, its parts up to one, or one lecture. */
    private void markFinished(List<String> ids, boolean finished, String what, boolean ask) {
        markFinished(ids, finished, what, ask, false);
    }

    /** @param wholeBook every part of the book, read from home when more than the loaded rows */
    private void markFinished(List<String> ids, boolean finished, String what, boolean ask, boolean wholeBook) {
        if (ids.isEmpty()) { Toast.makeText(this, "Open the book's parts first", Toast.LENGTH_SHORT).show(); return; }
        Runnable run = () -> {
            action(finished ? "mark_finished" : "mark_unfinished");
            io.execute(() -> {
                String line;
                try {
                    List<String> use = wholeBook ? allPartIds(ids) : ids;
                    int n = new JSONObject(media.markFinished(use, finished, WAIT_MS)).optInt("marked");
                    line = n > 0 ? (finished ? "Marked finished" : "Marked not finished") : "Could not mark it";
                } catch (Exception e) { line = "Can't reach home"; }
                String said = line;
                main.post(() -> { if (!isFinishing()) { Toast.makeText(this, said, Toast.LENGTH_SHORT).show(); loadProgress(); } });
            });
        };
        if (!ask) { run.run(); return; }
        new AlertDialog.Builder(this, DaylightTheme.alert()).setTitle(what == null || what.trim().isEmpty() ? "Mark finished?" : "Mark " + what + " finished?")
                .setMessage("It leaves Continue listening on every screen.").setPositiveButton("Mark finished", (d, w) -> run.run())
                .setNegativeButton("Cancel", null).show();
    }

    /** Your playlists (the Play tab's tiles and the widget picker's list): this album or playlist, shuffled for a playlist. */
    private void addToYourPlaylists() {
        String cid = contentIdOf(parent);
        net.kckern.daylight.shellkit.DrivingRadioSettings s = new net.kckern.daylight.shellkit.DrivingRadioSettings(this);
        if (s.isStaged(cid)) { Toast.makeText(this, "Already in Your playlists", Toast.LENGTH_SHORT).show(); return; }
        s.stage(cid, title, kind.startsWith("playlist"));
        if (!art.isEmpty()) s.setArt(cid, art);
        action("add_to_playlists");
        Toast.makeText(this, "Added to Your playlists", Toast.LENGTH_SHORT).show();
    }

    /**
     * The id a level is read by. A playlist reached by its own id (a tile, a link) is read
     * through the list catalog (a:0|<id>), as the car reads it: as a container it lists itself.
     */
    static String browseId(String kind, String parent) {
        if (kind != null && (kind.startsWith("playlist") || kind.equals("station")) && parent != null && parent.startsWith("c:")) return "a:0|" + contentIdOf(parent);
        return parent;
    }

    /** The content id inside a media id: c:<id>, p:<id>|<list>, or the id itself. */
    static String contentIdOf(String mediaId) {
        if (mediaId == null) return "";
        String s = mediaId;
        // a:<skip>|<id> and s:<skip>|<id> (the list catalog) carry the id after the bar.
        if ((s.startsWith("a:") || s.startsWith("s:") || s.startsWith("m:")) && s.indexOf('|') > 0) return s.substring(s.indexOf('|') + 1);
        if (s.startsWith("c:") || s.startsWith("p:")) s = s.substring(2);
        int bar = s.indexOf('|');
        return bar >= 0 ? s.substring(0, bar) : s;
    }

    /** What a row opened from a level is (MediaKind.childKind). */
    static String childKind(String parentKind, String id) { return MediaKind.childKind(parentKind, id); }

    // ── a detail page's header ──────────────────────────────────────────────

    /** The collection itself, as the player and Keep take it (c:<id>), whatever id reached this page. */
    private String self() { return parent.startsWith("c:") ? parent : "c:" + contentIdOf(parent); }

    /** The header's cover or portrait, square. */
    private static final int COVER_DP = 132;

    /**
     * The header (2026-11-27, after Plexamp's album page): on the library's first level a line;
     * on a detail page the cover or portrait on the left and, right of it, a collection's
     * by-line (an album's artist opens the artist), a book's progress, the primary circular
     * button tinted from the cover (DetailLook.playFill) and a row of the secondary icons and
     * ⋮. The page's name is in the top bar. A person's page has the facts and the summary right
     * of the portrait (clamped to the lines that fit; More opens the rest below, full width) and
     * the action row (round play with "Continue <book>", ⋮) under it. Then the neighbours.
     */
    private void fillHeader() {
        headerBox.removeAllViews();
        headerBox.setPadding(0, dp(8), 0, dp(4));
        if (MODE_LIBRARY.equals(mode)) {
            headerBox.addView(t.text(this, "Everything the household keeps, by library.", Type.LABEL, t.inkMuted, false));
            return;
        }
        if (!detail()) return;
        boolean person = MediaKind.aboutPerson(kind);
        JSONObject cont = about == null ? null : about.optJSONObject("continue");
        MediaKind.ActionSet set = MediaKind.actions(kind, "book".equals(kind) || cont != null);

        // A person's page while home's about is on its way: the facts, the summary and the
        // Continue row keep their places (no jump when it lands, 2026-11-27).
        boolean loading = person && about == null && !aboutAnswered;
        LinearLayout top = new LinearLayout(this);
        top.setGravity(Gravity.TOP);
        ImageView cover = new ImageView(this);
        cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
        cover.setClipToOutline(true);
        net.kckern.daylight.shellkit.CoverGlyph.behind(cover, t, net.kckern.daylight.shellkit.CoverGlyph.of(kind), dp(COVER_DP), dp(8));
        cover.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        top.addView(cover, new LinearLayout.LayoutParams(dp(COVER_DP), dp(COVER_DP)));
        String portrait = about == null ? "" : about.optString("portrait", "");
        loadHeaderCover(cover, !portrait.isEmpty() && (person || art.isEmpty()) ? portrait : art);
        LinearLayout side = new LinearLayout(this);
        side.setOrientation(LinearLayout.VERTICAL);
        side.setPadding(dp(14), 0, 0, 0);
        TextView rest = null;
        if (person) rest = personSide(side, loading);
        else collectionSide(side, set, cont);
        // A person's side is the portrait's height exactly: what arrives later moves nothing below it.
        top.addView(side, new LinearLayout.LayoutParams(0, person ? dp(COVER_DP) : -2, 1));
        headerBox.addView(top);
        if (rest != null) headerBox.addView(rest);
        if (person) headerBox.addView(personActions(set, cont, loading));
        if (neighbours.pages()) headerBox.addView(neighbourLine());
        else if (neighboursPending) {
            // Now playing's album line asked for the artist's albums: their line's place is kept.
            View held = new View(this);
            headerBox.addView(held, new LinearLayout.LayoutParams(-1, dp(36 + 8)));
        }
        if (progressLine != null && !rows.isEmpty()) loadProgress();
    }

    /** Right of a collection's cover: its by-line, a book's progress, the primary, then the icons and ⋮. */
    private void collectionSide(LinearLayout side, MediaKind.ActionSet set, JSONObject cont) {
        String by = byLine();
        // An album's or a book's by-line always keeps its one line, at the height it has as a
        // link (DetailLook.slots): home's about landing, or not, never moves the list.
        DetailLook.Slots slots = DetailLook.slots(kind, true);
        if (!by.isEmpty() || slots.bylineLines > 0) {
            TextView facts = t.text(this, by.isEmpty() ? "\u00A0" : by, Type.BODY, t.inkMuted, false);
            facts.setTag("facts");
            facts.setMaxLines(slots.bylineLines > 0 ? slots.bylineLines : 2);
            facts.setEllipsize(TextUtils.TruncateAt.END);
            if (slots.bylineLines > 0) { facts.setMinHeight(dp(32)); facts.setGravity(Gravity.CENTER_VERTICAL); }
            linkArtist(facts);
            side.addView(facts);
        }
        if ("book".equals(kind)) {
            // A book: how far in and what is left (filled once its parts are known).
            progressLine = t.text(this, " ", Type.LABEL, t.inkMuted, false);
            progressLine.setPadding(0, dp(2), 0, 0);
            side.addView(progressLine);
        }
        String autoLine = KeepLabels.collectionLine(this, contentIdOf(parent));
        // The keep line keeps its place even when empty: a keep landing redraws it in place.
        if (!autoLine.isEmpty() || slots.keepLines > 0) {
            TextView keepLine = t.text(this, autoLine.isEmpty() ? "\u00A0" : autoLine, Type.LABEL, t.inkMuted, false);
            keepLine.setMaxLines(1);
            keepLine.setEllipsize(TextUtils.TruncateAt.END);
            side.addView(keepLine);
        }
        if (set.primary != null) {
            LinearLayout holder = new LinearLayout(this);
            holder.setGravity(Gravity.CENTER_HORIZONTAL);
            holder.setPadding(0, dp(10), 0, dp(4));
            holder.addView(primaryButton(set.primary, cont), new LinearLayout.LayoutParams(dp(56), dp(56)));
            side.addView(holder, new LinearLayout.LayoutParams(-1, -2));
        }
        if (!set.secondary.isEmpty() || !set.overflow.isEmpty()) {
            LinearLayout icons = new LinearLayout(this);
            icons.setGravity(Gravity.CENTER_VERTICAL);
            for (MediaKind.Action a : set.secondary) icons.addView(secondaryButton(a), new LinearLayout.LayoutParams(0, dp(44), 1));
            if (!set.overflow.isEmpty()) {
                ImageButton more = iconButton(R.drawable.daylight_np_more, "More actions for " + title);
                more.setOnClickListener(v -> overflow(v, set.overflow));
                UiTelemetry.tag(more, "browse.overflow");
                icons.addView(more, new LinearLayout.LayoutParams(0, dp(44), 1));
            }
            side.addView(icons, new LinearLayout.LayoutParams(-1, -2));
        }
    }

    /**
     * Right of a person's portrait: the facts, then the summary in the lines that fit beside the
     * portrait (DetailLook.summaryLines) with More under it. More opens the rest below the
     * portrait, full width; with no summary the facts sit alone, centred. While home's answer
     * is on its way the summary's lines are kept blank. Answers the view for the rest (or null).
     */
    private TextView personSide(LinearLayout side, boolean loading) {
        String summary = about == null ? "" : about.optString("summary", "");
        boolean withSummary = !summary.isEmpty() || loading;
        side.setGravity(withSummary ? Gravity.TOP : Gravity.CENTER_VERTICAL);
        String line = RowLine.facts(kind, about, childRows());
        // The facts line is always there (blank until home answers): it never pushes the header.
        TextView facts = t.text(this, line.isEmpty() ? " " : line, Type.BODY, t.inkMuted, false);
        facts.setTag("facts");
        facts.setMaxLines(2);
        facts.setEllipsize(TextUtils.TruncateAt.END);
        side.addView(facts);
        if (!withSummary) return null;
        TextView text = t.text(this, loading ? " " : summary, Type.BODY, t.ink, false);
        text.setPadding(0, dp(6), 0, 0);
        text.setEllipsize(TextUtils.TruncateAt.END);
        text.setMaxLines(1);
        if (loading) text.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        side.addView(text, new LinearLayout.LayoutParams(-1, 0, 1));
        TextView more = link("More", "browse.summary_more", null);
        more.setTextColor(t.inkMuted);
        more.setPadding(0, dp(2), dp(16), 0);
        more.setVisibility(View.INVISIBLE);
        side.addView(more);
        if (loading) return null;
        TextView rest = t.text(this, "", Type.BODY, t.ink, false);
        rest.setPadding(0, dp(2), 0, 0);
        rest.setVisibility(View.GONE);
        final int[] cut = { 0 };
        more.setOnClickListener(v -> {
            boolean open = rest.getVisibility() != View.VISIBLE;
            action(open ? "summary_more" : "summary_less");
            // Open: the lines beside the portrait read on into the rest below (no "…" between them).
            text.setEllipsize(open ? null : TextUtils.TruncateAt.END);
            more.setText(open ? "Less" : "More");
            if (!open) { rest.setVisibility(View.GONE); return; }
            // The rest starts where the lines beside the portrait end, as the text itself broke them.
            text.post(() -> {
                android.text.Layout shown = text.getLayout();
                int n = shown == null ? 0 : Math.min(text.getMaxLines(), shown.getLineCount());
                if (n > 0 && text.getVisibility() == View.VISIBLE) cut[0] = shown.getLineEnd(n - 1);
                rest.setText(DetailLook.rest(summary, cut[0]));
                rest.setVisibility(View.VISIBLE);
            });
        });
        // The clamp, once the side's height and width are known (and again when the facts wrap).
        side.addOnLayoutChangeListener((v, l, tp, r, b, ol, ot, or, ob) -> {
            int width = text.getWidth() - text.getPaddingLeft() - text.getPaddingRight();
            if (width <= 0) return;
            int lines = DetailLook.summaryLines(side.getHeight(), facts.getHeight() + text.getPaddingTop(), more.getHeight(), text.getLineHeight());
            android.text.StaticLayout full = android.text.StaticLayout.Builder.obtain(summary, 0, summary.length(), text.getPaint(), width)
                    .setLineSpacing(text.getLineSpacingExtra(), text.getLineSpacingMultiplier()).setIncludePad(text.getIncludeFontPadding())
                    .setBreakStrategy(text.getBreakStrategy()).setHyphenationFrequency(text.getHyphenationFrequency()).build();
            boolean cutShort = full.getLineCount() > lines;
            int at = !cutShort ? summary.length() : lines <= 0 ? 0 : full.getLineEnd(lines - 1);
            if (text.getMaxLines() == Math.max(1, lines) && cut[0] == at) return;
            cut[0] = at;
            v.post(() -> {
                text.setVisibility(lines <= 0 ? View.INVISIBLE : View.VISIBLE);
                text.setMaxLines(Math.max(1, lines));
                more.setVisibility(cutShort ? View.VISIBLE : View.INVISIBLE);
                if (rest.getVisibility() == View.VISIBLE) rest.setText(DetailLook.rest(summary, at));
            });
        });
        return rest;
    }

    /**
     * A person's action row under the portrait: the primary (the round play with "Continue
     * <book>", Shuffle for an artist) or nothing, and the ⋮ at the end. Its height is kept
     * while home's answer is on its way, so the Continue that arrives moves nothing.
     */
    private View personActions(MediaKind.ActionSet set, JSONObject cont, boolean loading) {
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setMinimumHeight(dp(64));
        row.setPadding(0, dp(8), 0, 0);
        MediaKind.Action primary = set.primary == MediaKind.Action.CONTINUE && cont == null ? null : set.primary;
        if (primary != null && !loading) {
            View b = primaryButton(primary, cont);
            row.addView(b, new LinearLayout.LayoutParams(dp(56), dp(56)));
            String words = primary == MediaKind.Action.CONTINUE ? "Continue " + cont.optString("title")
                    : primary == MediaKind.Action.SHUFFLE_ARTIST ? "Shuffle " + title : "Play";
            TextView label = t.text(this, words, Type.BODY, t.ink, true);
            label.setPadding(dp(12), 0, dp(8), 0);
            label.setMaxLines(2);
            label.setEllipsize(TextUtils.TruncateAt.END);
            label.setGravity(Gravity.CENTER_VERTICAL);
            label.setMinHeight(dp(48));
            label.setBackground(t.pressable(null));
            label.setOnClickListener(v -> b.performClick());
            label.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
            row.addView(label, new LinearLayout.LayoutParams(0, -2, 1));
        } else {
            row.addView(new View(this), new LinearLayout.LayoutParams(0, dp(56), 1));
        }
        ImageButton more = iconButton(R.drawable.daylight_np_more, "More actions for " + title);
        more.setOnClickListener(v -> overflow(v, set.overflow));
        UiTelemetry.tag(more, "browse.overflow");
        row.addView(more, new LinearLayout.LayoutParams(dp(48), dp(48)));
        return row;
    }

    /** The header's cover; its colour tints the page, the bar and the primary (DetailLook). */
    private void loadHeaderCover(ImageView into, String url) {
        into.setTag(url);
        if (url == null || url.isEmpty()) { into.setImageDrawable(null); applyAccent(net.kckern.daylight.shellkit.CoverColor.NONE, ""); return; }
        Bitmap hit = net.kckern.daylight.shellkit.PlaylistArtwork.cached(url, 320);
        if (hit != null) { into.setImageBitmap(hit); applyAccent(url.equals(accentUrl) ? coverAccent : accentOf(hit), url); return; }
        covers.execute(() -> {
            Bitmap b = net.kckern.daylight.shellkit.PlaylistArtwork.load(url, 320);
            int a = b == null ? net.kckern.daylight.shellkit.CoverColor.NONE : accentOf(b);
            main.post(() -> {
                if (isDestroyed() || !url.equals(into.getTag())) return;
                if (b != null) into.setImageBitmap(b);
                applyAccent(a, url);
            });
        });
    }

    private static int accentOf(Bitmap b) {
        Bitmap small = Bitmap.createScaledBitmap(b, 32, 32, true);
        int[] px = new int[32 * 32];
        small.getPixels(px, 0, 32, 0, 0, 32, 32);
        return net.kckern.daylight.shellkit.CoverColor.of(px);
    }

    private boolean accentPainted;

    /** The cover's colour on the page: a gradient from it into the page, the bar over it, the primary's fill. */
    private void applyAccent(int accent, String url) {
        accentUrl = url;
        if (accentPainted && accent == coverAccent) return;
        accentPainted = true;
        coverAccent = accent;
        int top = DetailLook.gradientTop(t.background, accent, t.dark);
        int mid = DetailLook.gradientMiddle(t.background, accent, t.dark);
        page.setBackground(new android.graphics.drawable.GradientDrawable(android.graphics.drawable.GradientDrawable.Orientation.TOP_BOTTOM,
                new int[] { top, mid, t.background }));
        if (getActionBar() != null) getActionBar().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(top));
        if (t.dark) getWindow().setStatusBarColor(top);
        View primary = headerBox.findViewWithTag("primary");
        if (primary instanceof ImageButton) tintPrimary((ImageButton) primary);
    }

    /** The primary's fill: the cover's colour, dark and quiet, with a glyph that reads on it. */
    private void tintPrimary(ImageButton b) {
        int fill = DetailLook.playFill(t.background, coverAccent, t.dark);
        b.setImageTintList(ColorStateList.valueOf(DetailLook.playGlyph(fill)));
        b.setBackground(t.pressable(DaylightTheme.round(fill, dp(28))));
    }

    /** The by-line under a page's name: an album's "Rush · 2007" (RowLine.albumBy), else the row's subtitle. */
    private String byLine() {
        if ("album".equals(MediaKind.normal(kind))) return RowLine.albumBy(subtitle, about);
        if (subtitle.isEmpty() && "book".equals(kind) && about != null) return about.optString("byline", "");
        return subtitle;
    }

    /** An album's by-line opens its artist's page (home's about names the artist's id). */
    private void linkArtist(TextView line) {
        String artistId = about == null ? "" : about.optString("bylineId", "");
        String artist = about == null ? "" : about.optString("byline", "");
        boolean book = "book".equals(kind);
        if (!("album".equals(MediaKind.normal(kind)) || book) || artistId.isEmpty() || artist.isEmpty()) return;
        // It looks like a link (2026-11-27): the artist in ink, the year after it muted, and the "›"
        // at the end of the line ("Rush · 2007 ›"), never between the name and its year.
        String said = line.getText().toString();
        android.text.SpannableStringBuilder b = new android.text.SpannableStringBuilder();
        b.append(artist);
        b.setSpan(new android.text.style.ForegroundColorSpan(t.ink), 0, b.length(), android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        if (said.startsWith(artist)) b.append(said.substring(artist.length()));
        int arrow = b.length();
        b.append(" ›");
        b.setSpan(new android.text.style.ForegroundColorSpan(t.ink), arrow, b.length(), android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        line.setText(b);
        line.setBackground(t.pressable(null));
        line.setMinHeight(dp(32));
        line.setGravity(Gravity.CENTER_VERTICAL);
        line.setContentDescription((book ? "Open author " : "Open artist ") + artist);
        UiTelemetry.tag(line, "browse.album_artist");
        line.setOnClickListener(v -> {
            action(book ? "go_to_author" : "go_to_artist");
            open(this, "level", "c:" + artistId, book ? "author" : "artist", artist, "", "");
        });
    }

    /** The summary line from the loaded rows; a level still paging (a More row) waits for its whole count. */
    private void refreshCount() {
        if (countLine == null) return;
        int n = 0;
        long total = 0;
        for (JSONObject r : rows) {
            String id = r.optString("id");
            if (id.startsWith("m:")) { if (!"book".equals(kind)) showCount(0, 0); return; }
            if (!id.startsWith("p:")) continue;
            n++;
            total += Math.max(0, r.optLong("durationSec", 0));
        }
        showCount(n, total);
    }

    private void showCount(int n, long totalSec) {
        if (countLine == null) return;
        String line = DetailLook.countLine(kind, n, totalSec);
        countLine.setText(line.isEmpty() ? "\u00A0" : line);
    }

    /** Book rows shown on an author's page (the facts' count before home gives one). */
    private int childRows() {
        int n = 0;
        for (JSONObject r : rows) if (!r.optString("id").startsWith("m:")) n++;
        return n;
    }

    private void refreshFacts() {
        View facts = headerBox.findViewWithTag("facts");
        String line = RowLine.facts(kind, about, childRows());
        if (facts instanceof TextView) ((TextView) facts).setText(line.isEmpty() ? "\u00A0" : line);
        else if (!line.isEmpty()) fillHeader();
    }

    /** The one primary action: a 56 dp circle filled with the cover's colour, dark and quiet (DetailLook.playFill). */
    private View primaryButton(MediaKind.Action a, JSONObject cont) {
        ImageButton b = new ImageButton(this);
        b.setImageResource(a == MediaKind.Action.SHUFFLE_ARTIST ? R.drawable.daylight_np_shuffle : R.drawable.daylight_np_play);
        b.setTag("primary");
        tintPrimary(b);
        b.setScaleType(ImageView.ScaleType.CENTER);
        String said;
        Runnable run;
        switch (a) {
            case RESUME: said = "Resume " + title; run = () -> play(self(), false, title, subtitle, art); break;
            case CONTINUE: {
                String book = cont.optString("id"), bookTitle = cont.optString("title");
                said = "Continue " + bookTitle;
                run = () -> play("c:" + book, false, bookTitle, title, art);
                break;
            }
            case SHUFFLE_ARTIST: said = "Shuffle " + title; run = () -> play(self(), true, title, subtitle, art); break;
            default: said = "Play " + title; run = () -> play(self(), false, title, subtitle, art);
        }
        b.setContentDescription(said);
        b.setTooltipText(said);
        b.setOnClickListener(v -> run.run());
        UiTelemetry.tag(b, "browse.primary");
        return b;
    }

    private ImageButton iconButton(int icon, String said) {
        ImageButton b = new ImageButton(this);
        b.setImageResource(icon);
        b.setImageTintList(ColorStateList.valueOf(t.inkMuted));
        b.setBackground(t.pressable(DaylightTheme.round(0x00000000, dp(24))));
        b.setScaleType(ImageView.ScaleType.CENTER);
        b.setContentDescription(said);
        b.setTooltipText(said);
        return b;
    }

    /** A secondary action: a 48 dp icon, muted, no fill, with its words for TalkBack and a long-press tooltip. */
    private View secondaryButton(MediaKind.Action a) {
        switch (a) {
            case SHUFFLE: {
                ImageButton b = iconButton(R.drawable.daylight_np_shuffle, "Shuffle " + title);
                b.setOnClickListener(v -> play(self(), true, title, subtitle, art));
                UiTelemetry.tag(b, "browse.shuffle");
                return b;
            }
            case PLAY_ON: {
                ImageButton b = iconButton(R.drawable.daylight_np_cast, "Play on…");
                b.setOnClickListener(v -> playOn(self(), title, subtitle, art));
                UiTelemetry.tag(b, "browse.play_on");
                return b;
            }
            case KEEP: {
                JSONObject k = KeepLabels.holding(net.kckern.daylight.shellkit.KeptIndex.read(getFilesDir()), contentIdOf(parent));
                boolean ready = k != null && net.kckern.daylight.shellkit.KeptIndex.ready(k);
                ImageButton b = iconButton(k == null ? R.drawable.daylight_np_download : ready ? R.drawable.daylight_np_kept : R.drawable.daylight_np_downloading,
                        k == null ? "Keep on this phone" : net.kckern.daylight.shellkit.KeptIndex.describe(k));
                // Kept is a selected state: the accent; downloading or queued stays muted.
                if (ready) b.setImageTintList(ColorStateList.valueOf(t.primary));
                b.setOnClickListener(v -> { if (k == null) KeepFlow.start(this, self(), title); else DownloadsActivity.open(this); });
                UiTelemetry.tag(b, "browse.keep");
                return b;
            }
            case SPEED: {
                TextView b = t.text(this, LongForm.speedLabel(bookSpeed()), Type.LABEL, t.inkMuted, true);
                b.setGravity(Gravity.CENTER);
                b.setBackground(t.pressable(DaylightTheme.round(0x00000000, dp(24))));
                String said = "Speed " + LongForm.speedLabel(bookSpeed());
                b.setContentDescription(said);
                b.setTooltipText(said);
                b.setOnClickListener(this::chooseSpeed);
                UiTelemetry.tag(b, "browse.speed");
                return b;
            }
            case CHAPTERS: {
                // The chapters glyph, never the queue's: a book has no queue verbs (media kinds §8).
                ImageButton b = iconButton(net.kckern.daylight.shellkit.R.drawable.daylight_ic_chapters, "Chapters of " + title);
                b.setOnClickListener(v -> chapters());
                UiTelemetry.tag(b, "browse.chapters");
                return b;
            }
            default:
                return new View(this);
        }
    }

    /** The rarer actions, in ⋮: the item sheet (D17), headed by this page's item. */
    private void overflow(View anchor, List<MediaKind.Action> actions) {
        String portrait = about == null ? "" : about.optString("portrait", "");
        boolean person = MediaKind.aboutPerson(kind);
        String by = person ? RowLine.facts(kind, about, childRows()) : subtitle;
        net.kckern.daylight.shellkit.ItemSheet sheet = net.kckern.daylight.shellkit.ItemSheet.of(this, "Browse")
                .item(!portrait.isEmpty() && (person || art.isEmpty()) ? portrait : art, net.kckern.daylight.shellkit.CoverGlyph.of(kind), title, by, "");
        for (MediaKind.Action a : actions) {
            switch (a) {
                case PLAY_FROM_START: sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_replay, "Play from the start", this::playFromStart); break;
                case MARK_FINISHED: sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_check, "Mark finished", () -> markFinished(trackIds(), true, title, true, true)); break;
                case ADD_TO_PLAYLISTS: {
                    boolean staged = new net.kckern.daylight.shellkit.DrivingRadioSettings(this).isStaged(contentIdOf(parent));
                    sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_queue_add, staged ? "In Your playlists" : "Add to Your playlists", this::addToYourPlaylists);
                    break;
                }
                default: break;
            }
        }
        // A person's page: Keep all… (their albums or books as a group, spec §3.11), then a search for them.
        if (person) {
            final String self = parent.startsWith("c:") ? parent : "c:" + contentIdOf(parent);
            sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_download, "Keep all…",
                    () -> GroupKeepFlow.start(this, self, kind.startsWith("author") ? "author" : "artist", title));
            sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_search, "Search for " + title, () -> search(this, title, null));
        }
        sheet.show();
    }

    /** "‹ Dante · Thomas More ›": the neighbours a swipe goes to; for TalkBack, Previous and Next buttons. */
    private View neighbourLine() {
        LinearLayout line = new LinearLayout(this);
        line.setGravity(Gravity.CENTER_VERTICAL);
        line.setPadding(0, dp(8), 0, 0);
        Neighbours.Entry p = neighbours.at(-1), n = neighbours.at(1);
        TextView prev = t.text(this, p == null ? MediaKind.edgeWord(kind, true) : "‹ " + p.title, Type.LABEL, t.inkMuted, false);
        prev.setMaxLines(1);
        prev.setEllipsize(TextUtils.TruncateAt.END);
        prev.setMinHeight(dp(36));
        prev.setGravity(Gravity.CENTER_VERTICAL);
        prev.setContentDescription(p == null ? MediaKind.edgeWord(kind, true) : "Previous: " + p.title);
        if (p != null) { prev.setBackground(t.pressable(null)); prev.setOnClickListener(v -> page(-1)); }
        TextView next = t.text(this, n == null ? MediaKind.edgeWord(kind, false) : n.title + " ›", Type.LABEL, t.inkMuted, false);
        next.setMaxLines(1);
        next.setEllipsize(TextUtils.TruncateAt.END);
        next.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
        next.setMinHeight(dp(36));
        next.setContentDescription(n == null ? MediaKind.edgeWord(kind, false) : "Next: " + n.title);
        if (n != null) { next.setBackground(t.pressable(null)); next.setOnClickListener(v -> page(1)); }
        line.addView(prev, new LinearLayout.LayoutParams(0, -2, 1));
        line.addView(next, new LinearLayout.LayoutParams(0, -2, 1));
        return line;
    }

    /** Chapters: Now playing's chapter list; the book resumes first when it is not the one playing. */
    private void chapters() {
        net.kckern.daylight.shellkit.NowPlayingNote.Entry e = net.kckern.daylight.shellkit.NowPlayingNote.current();
        boolean thisBook = false;
        if (e != null && "local".equals(e.target)) for (JSONObject r : rows) if (e.title.equalsIgnoreCase(r.optString("title"))) thisBook = true;
        action("chapters");
        if (thisBook) {
            startActivity(new Intent(this, NowPlayingActivity.class).putExtra(NowPlayingActivity.EXTRA_TARGET, NowPlayingActivity.LOCAL)
                    .putExtra(NowPlayingActivity.EXTRA_STAGE, "chapters").addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP));
            return;
        }
        play(self(), false, title, subtitle, art, "chapters", -1);
    }

    /** Play from the start: the first part at 0, whatever place the book has. */
    private void playFromStart() {
        String first = null;
        for (JSONObject r : rows) if (r.optString("id").startsWith("p:")) { first = r.optString("id"); break; }
        if (first == null) { Toast.makeText(this, "Open the book's parts first", Toast.LENGTH_SHORT).show(); return; }
        play(first, false, title, subtitle, art, null, 0);
    }

    // ── the person's header ─────────────────────────────────────────────────

    /** An author's, speaker's or artist's facts, summary and books (About), from the last answer at once. */
    private void loadAbout() {
        final String cid = contentIdOf(parent);
        final String key = "about|" + cid;
        String cached = prefs().getString(key, "");
        if (!cached.isEmpty()) {
            try { about = new JSONObject(cached); adoptName(about); fillHeader(); redrawRows(); }
            catch (Exception ignored) { }
        }
        final boolean books = MediaKind.hasBooks(kind);
        io.execute(() -> {
            JSONObject got = null;
            try { got = new JSONObject(media.about(cid, books, WAIT_MS)).optJSONObject("about"); }
            catch (Exception unreachable) { Log.w(TAG, "about failed: " + unreachable.getClass().getSimpleName()); }
            JSONObject a = got;
            main.post(() -> {
                if (isFinishing() || !cid.equals(contentIdOf(parent))) return;
                boolean first = !aboutAnswered;
                aboutAnswered = true;
                // No answer: the places kept for it close (the header is drawn without them).
                if (a == null) { if (first && about == null) fillHeader(); return; }
                if (a.toString().equals(cached)) return;
                prefs().edit().putString(key, a.toString()).apply();
                about = a;
                adoptName(a);
                fillHeader();
                // Book rows now know their year and progress: redrawn in place.
                redrawRows();
            });
        });
    }

    /** A page with no name yet (opened by a link) takes the item's own title, by-line and cover. */
    private void adoptName(JSONObject a) {
        if (a == null || !title.isEmpty()) return;
        String named = a.optString("title", "");
        if (named.isEmpty()) return;
        title = named;
        if (subtitle.isEmpty()) subtitle = a.optString("byline", "");
        if (art.isEmpty()) art = a.optString("portrait", "");
        setTitle(title);
        if (barTitle != null) barTitle.setText(title);
        Log.i(TAG, "browse named from info " + contentIdOf(parent));
    }

    /** The rows again, in place: only those whose line changed (a book's progress) are drawn anew. */
    private void redrawRows() {
        if (rows.isEmpty()) return;
        if (keyed.isEmpty()) results.removeAllViews();
        keyed.show(new ArrayList<>(rows));
        rowViews.clear();
        rowViews.addAll(keyed.views());
    }

    private String bookSignature(JSONObject row) {
        JSONObject b = bookOf(row);
        return b == null ? "" : b.toString();
    }

    private JSONObject bookOf(JSONObject row) {
        JSONObject books = about == null ? null : about.optJSONObject("books");
        return books == null ? null : books.optJSONObject(contentIdOf(row.optString("id")));
    }

    // ── neighbours ──────────────────────────────────────────────────────────

    /** Now playing's album line: the artist's albums are the paging set. */
    /** The artist's albums are being asked (loadNeighboursFrom): the neighbours line's place is held. */
    private boolean neighboursPending;

    private void loadNeighboursFrom(String pagesIn) {
        final String at = parent;
        neighboursPending = true;
        fillHeader();
        prefetchIo.execute(() -> {
            JSONArray items = null;
            try { items = new JSONObject(media.browse(pagesIn, 0, 50, WAIT_MS)).optJSONArray("items"); } catch (Exception none) { }
            List<JSONObject> list = new ArrayList<>();
            for (int i = 0; items != null && i < items.length(); i++) list.add(items.optJSONObject(i));
            Neighbours n = Neighbours.fromRows(list, at, kind);
            main.post(() -> {
                if (isFinishing() || !n.pages() || !at.equals(parent)) return;
                neighbours = n;
                fillHeader();
                prefetchNeighbours();
            });
        });
    }

    /** Both neighbours' pages (and covers), fetched as this one opens: a swipe lands on a drawn page. */
    private void prefetchNeighbours() {
        if (!neighbours.pages()) return;
        for (int d : new int[] { 1, -1 }) {
            Neighbours.Entry e = neighbours.at(d);
            if (e == null) continue;
            String key = cacheKeyOf("level", e.id);
            prefetchIo.execute(() -> {
                try {
                    if (!e.art.isEmpty()) net.kckern.daylight.shellkit.PlaylistArtwork.load(e.art, 320);
                    if (MediaKind.listsRows(e.kind) && prefs().getString(key, "").isEmpty()) {
                        JSONObject a = new JSONObject(media.browse(browseId(e.kind, e.id), 0, 50, WAIT_MS));
                        if (a.optBoolean("ok") && !a.optBoolean("offline")) {
                            JSONArray items = a.optJSONArray("items");
                            prefs().edit().putString(key, items.toString()).apply();
                            // The first rows' covers too: the page lands drawn.
                            for (int i = 0; i < items.length() && i < 8; i++) {
                                String u = items.optJSONObject(i) == null ? "" : items.optJSONObject(i).optString("artUrl", "");
                                if (!u.isEmpty()) net.kckern.daylight.shellkit.PlaylistArtwork.load(u, 144);
                            }
                        }
                    }
                    if (MediaKind.aboutPerson(e.kind) && prefs().getString("about|" + contentIdOf(e.id), "").isEmpty()) {
                        JSONObject a = new JSONObject(media.about(contentIdOf(e.id), MediaKind.hasBooks(e.kind), WAIT_MS)).optJSONObject("about");
                        if (a != null) prefs().edit().putString("about|" + contentIdOf(e.id), a.toString()).apply();
                    }
                } catch (Exception notNow) { /* the page fills in place when it is shown */ }
            });
        }
    }

    /** A swipe: the neighbour {@code direction} away, drawn in place from what is known; at an edge, a pull and its word. */
    private void page(int direction) {
        Neighbours.Entry to = neighbours.at(direction);
        try { UiTelemetry.event("Browse", "browse.swipe", new JSONObject().put("kind", kind).put("direction", direction > 0 ? "next" : "previous").put("edge", to == null)); }
        catch (Exception ignored) { }
        if (to == null) {
            // The edge: a rubber-band pull and "First book" / "Last book", never a dead swipe.
            float pull = dp(28) * (direction > 0 ? -1 : 1);
            column.animate().translationX(pull).setDuration(90).withEndAction(() -> column.animate().translationX(0).setDuration(160).start()).start();
            String word = MediaKind.edgeWord(kind, direction < 0);
            Toast.makeText(this, word, Toast.LENGTH_SHORT).show();
            scroller.announceForAccessibility(word);
            return;
        }
        float w = scroller.getWidth();
        column.animate().translationX(direction > 0 ? -w : w).alpha(0f).setDuration(140).withEndAction(() -> {
            neighbours.move(direction);
            parent = to.id;
            kind = MediaKind.normal(to.kind);
            title = to.title;
            subtitle = to.subtitle;
            art = to.art;
            ++generation;
            buildPage();
            startLevel();
            scroller.scrollTo(0, 0);
            column.setTranslationX(direction > 0 ? w : -w);
            column.animate().translationX(0).alpha(1f).setDuration(160).start();
            scroller.announceForAccessibility(title);
        }).start();
    }

    // ── rows ────────────────────────────────────────────────────────────────

    /** @param searchGroup the search group the row is in, or null on a level */
    private View row(JSONObject n, String searchGroup) {
        final String id = n.optString("id");
        final String name = n.optString("title", "Untitled");
        final String sub = n.optString("subtitle", "");
        final String cover = n.optString("artUrl", "");
        final boolean browsable = n.optBoolean("browsable", id.startsWith("c:") || id.startsWith("s:") || id.startsWith("a:") || id.startsWith("m:"));
        final boolean playable = n.optBoolean("playable", id.startsWith("p:"));
        final String rowKind = MediaKind.normal(n.optString("kind", ""));
        final String pageKind = searchGroup != null || !"level".equals(mode) ? "" : kind;
        List<MediaKind.RowAction> menu = searchGroup != null ? MediaKind.searchRowMenu(rowKind) : MediaKind.rowMenu(pageKind);
        // An album's tracks, a book's parts, a series' lectures: one compact numbered line each
        // (2026-11-27), no cover again on every row (a compilation's own art too).
        int part = playable && !browsable && isPartPage(pageKind) ? RowLine.partNumber(rows, id) : 0;
        if (part > 0) return compactRow(n, part, pageKind, menu);
        String pageArtist = pageArtist();
        final String line = id.startsWith("m:") ? "" : RowLine.of(pageKind, n, pageArtist, bookOf(n));
        boolean playing = isPlayingRow(n);
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setBackground(t.pressable(null));
        row.setTag(R.id.daylight_browse_row_id, id);
        ImageView img = new ImageView(this);
        img.setScaleType(ImageView.ScaleType.CENTER_CROP);
        img.setClipToOutline(true);
        net.kckern.daylight.shellkit.CoverGlyph.behind(img, t, net.kckern.daylight.shellkit.CoverGlyph.of(browsable
                ? (MediaKind.hasBooks(pageKind) ? "book" : rowKind.isEmpty() ? MediaKind.childKind(pageKind, id) : rowKind)
                : MediaKind.spoken(pageKind) ? "book" : "track"), dp(48), dp(8));
        row.addView(img, new LinearLayout.LayoutParams(dp(48), dp(48)));
        loadCover(img, cover, 144);
        LinearLayout words = new LinearLayout(this);
        words.setOrientation(LinearLayout.VERTICAL);
        words.setPadding(dp(12), 0, dp(4), 0);
        // One list-title style: regular weight; bold only for the row that is playing.
        TextView top = id.startsWith("m:") ? t.listTitle(this, "More") : playing ? t.text(this, name, Type.BODY, t.ink, true) : t.listTitle(this, name);
        top.setMaxLines(1);
        top.setEllipsize(TextUtils.TruncateAt.END);
        words.addView(top);
        TextView bottom = t.text(this, line, Type.LABEL, t.inkMuted, false);
        bottom.setMaxLines(1);
        bottom.setEllipsize(TextUtils.TruncateAt.END);
        words.addView(bottom);
        row.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
        // A playable row's menu is its long-press (and TalkBack's "More options"): no ⋮ (2026-11-27).
        if (playable && !browsable) attachMenu(row, menu, n);
        MediaKind.Tap tap = id.startsWith("m:") ? MediaKind.Tap.OPEN : MediaKind.rowTap(pageKind, browsable, playable);
        row.setOnClickListener(v -> {
            if (id.startsWith("m:")) { loadMore(n); return; }
            if (tap == MediaKind.Tap.OPEN) {
                String k = rowKind.isEmpty() ? childKind(kind, id) : rowKind;
                UiTelemetry.tag(row, "browse.open");
                openDetail(n, k, searchGroup);
            } else if (tap == MediaKind.Tap.PLAY_FROM_HERE) {
                play(id, false, name, sub, cover, null, -1, MediaKind.spoken(kind) || MediaKind.spoken(rowKind));
            }
        });
        UiTelemetry.tag(row, browsable ? "browse.row" : "browse.track");
        row.setContentDescription(name + (line.isEmpty() ? "" : ", " + line) + (playing ? ", playing" : ""));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, dp(ROW_DP));
        row.setLayoutParams(lp);
        return row;
    }

    /**
     * An album's track or a book's part on one line, about 48 dp (2026-11-27): a muted number
     * in a fixed column (the playing glyph in its place for the row that plays), the title in
     * the list style, the length flush right in tabular figures. A tap plays from it; a
     * long-press opens its sheet, whose header says what the second line used to (a
     * compilation's own artist, a part's place).
     */
    private View compactRow(JSONObject n, int number, String pageKind, List<MediaKind.RowAction> menu) {
        final String id = n.optString("id");
        final String name = n.optString("title", "Untitled");
        final String sub = n.optString("subtitle", "");
        final String cover = n.optString("artUrl", "");
        final long seconds = n.optLong("durationSec", 0);
        boolean playing = isPlayingRow(n);
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setBackground(t.pressable(null));
        row.setTag(R.id.daylight_browse_row_id, id);
        row.setMinimumHeight(dp(48));
        if (playing) {
            ImageView glyph = new ImageView(this);
            glyph.setImageResource(net.kckern.daylight.shellkit.R.drawable.daylight_ic_play);
            glyph.setImageTintList(ColorStateList.valueOf(t.primary));
            glyph.setScaleType(ImageView.ScaleType.FIT_END);
            glyph.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
            row.addView(glyph, new LinearLayout.LayoutParams(dp(32), dp(18)));
        } else {
            TextView num = t.text(this, String.valueOf(number), Type.LABEL, t.inkMuted, false);
            num.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
            num.setFontFeatureSettings("tnum");
            num.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
            row.addView(num, new LinearLayout.LayoutParams(dp(32), -2));
        }
        TextView titleView = playing ? t.text(this, name, Type.BODY, t.ink, true) : t.listTitle(this, name);
        titleView.setMaxLines(1);
        titleView.setEllipsize(TextUtils.TruncateAt.END);
        titleView.setPadding(dp(14), 0, dp(8), 0);
        row.addView(titleView, new LinearLayout.LayoutParams(0, -2, 1));
        TextView length = t.text(this, DetailLook.rowLength(pageKind, seconds), Type.LABEL, t.inkMuted, false);
        length.setFontFeatureSettings("tnum");
        length.setPadding(0, 0, dp(4), 0);
        length.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        row.addView(length, new LinearLayout.LayoutParams(-2, -2));
        row.setOnClickListener(v -> play(id, false, name, sub, cover, null, -1, MediaKind.spoken(kind)));
        attachMenu(row, menu, n);
        UiTelemetry.tag(row, "browse.track");
        row.setContentDescription(DetailLook.rowSpoken(pageKind, number, name, seconds) + (playing ? ", playing" : ""));
        row.setLayoutParams(new LinearLayout.LayoutParams(-1, -2));
        return row;
    }

    /** A row's menu: long-press (with a haptic tick) and TalkBack's "More options for <title>" open its sheet. */
    private void attachMenu(View row, List<MediaKind.RowAction> menu, JSONObject n) {
        if (menu.isEmpty()) return;
        String name = n.optString("title", "Untitled");
        row.setOnLongClickListener(v -> {
            v.performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS);
            action("row_menu");
            rowMenu(v, menu, n);
            return true;
        });
        row.setAccessibilityDelegate(new View.AccessibilityDelegate() {
            @Override public void onInitializeAccessibilityNodeInfo(View host, android.view.accessibility.AccessibilityNodeInfo info) {
                super.onInitializeAccessibilityNodeInfo(host, info);
                info.addAction(new android.view.accessibility.AccessibilityNodeInfo.AccessibilityAction(R.id.daylight_browse_row_menu, "More options for " + name));
            }
            @Override public boolean performAccessibilityAction(View host, int action, Bundle args) {
                if (action == R.id.daylight_browse_row_menu) { rowMenu(host, menu, n); return true; }
                return super.performAccessibilityAction(host, action, args);
            }
        });
    }

    /** The album's own artist (its by-line), for a track's "only when not the album's". */
    private String pageArtist() {
        return "album".equals(MediaKind.normal(kind)) && about != null && !about.optString("byline").isEmpty() ? about.optString("byline") : subtitle;
    }

    /** The title this phone (or the screen shown in the mini player) is playing, or "". */
    private static String playingTitle() {
        net.kckern.daylight.shellkit.NowPlayingNote.Entry e = net.kckern.daylight.shellkit.NowPlayingNote.current();
        return e == null || e.starting ? "" : e.title;
    }

    /** Whether this row is what is playing: its title is the mini player's (a page's rows only). */
    private boolean isPlayingRow(JSONObject n) {
        if (!"level".equals(mode)) return false;
        String playing = playingTitle();
        return !playing.isEmpty() && playing.equalsIgnoreCase(n.optString("title")) && n.optString("id").startsWith("p:");
    }

    /** The mini player's item changed: the rows that were or now are playing are drawn again. */
    private final net.kckern.daylight.shellkit.NowPlayingNote.Listener playingChanged = () -> main.post(() -> {
        if (isDestroyed() || rows.isEmpty() || !"level".equals(mode)) return;
        String now = playingTitle();
        if (now.equals(playingShown)) return;
        playingShown = now;
        redrawRows();
    });

    /** A page whose playable rows are a book's parts, a series' lectures or an album's tracks (numbered, not covered). */
    private static boolean isPartPage(String pageKind) {
        String k = MediaKind.normal(pageKind);
        // An album's tracks too: the album's cover on every row said nothing (2026-11-27), and a
        // compilation's own art goes too: the number is enough.
        return "book".equals(k) || "series".equals(k) || "album".equals(k);
    }

    /** A row's page, with the list it came from as the paging set (the level's rows, or its search group). */
    private void openDetail(JSONObject n, String k, String searchGroup) {
        String id = n.optString("id");
        Intent i = new Intent(this, BrowseActivity.class).putExtra("mode", "level").putExtra("parent", id).putExtra("kind", k)
                .putExtra("title", n.optString("title")).putExtra("subtitle", n.optString("subtitle", "")).putExtra("art", n.optString("artUrl", ""));
        List<JSONObject> from = searchGroup != null ? searchGroups.get(searchGroup) : rows;
        String childDefault = searchGroup != null ? k : childKind(kind, id);
        Neighbours set = from == null ? Neighbours.NONE : Neighbours.fromRows(from, id, childDefault);
        if (set.pages()) i.putExtra(EXTRA_NEIGHBOURS, set.toJson()).putExtra(EXTRA_INDEX, set.index);
        startActivityForResult(i, REQ_DETAIL);
    }

    /** A long level's next page, appended in place of its More row (which comes back when home did not answer). */
    private void loadMore(JSONObject more) {
        final String moreId = more.optString("id");
        // By id: the row's own object may be an earlier answer's copy of the one in the list.
        rows.removeIf(r -> moreId.equals(r.optString("id")));
        keyed.show(rows);
        final int mine = generation;
        io.execute(() -> {
            JSONObject answer;
            String reason = "";
            try { answer = new JSONObject(media.browse(moreId, 0, 50, WAIT_MS)); } catch (Exception e) { answer = null; reason = reasonOf(e); }
            JSONObject a = answer;
            String why = reason;
            main.post(() -> {
                if (mine != generation || isFinishing()) return;
                if (a == null || !a.optBoolean("ok")) {
                    Toast.makeText(this, net.kckern.daylight.shellkit.FailureWords.line(causeOf(a, why)), Toast.LENGTH_SHORT).show();
                    rows.add(more);
                    keyed.show(rows);
                    return;
                }
                draw(a.optJSONArray("items") == null ? new JSONArray() : a.optJSONArray("items"),
                        a.optBoolean("offline") ? causeOf(a, "") : null, true);
            });
        });
    }

    private void rowMenu(View anchor, List<MediaKind.RowAction> actions, JSONObject n) {
        final String id = n.optString("id"), name = n.optString("title", "Untitled"), sub = n.optString("subtitle", ""), cover = n.optString("artUrl", "");
        // The sheet's header says what a compact row has no second line for: a compilation's own
        // artist, a part's place (RowLine.sheetLine).
        String said = "level".equals(mode) ? RowLine.sheetLine(kind, n, pageArtist(), partPlaces == null ? null : partPlaces.optJSONObject(contentIdOf(id))) : sub;
        net.kckern.daylight.shellkit.ItemSheet sheet = net.kckern.daylight.shellkit.ItemSheet.of(this, "Browse")
                .item(cover.isEmpty() ? art : cover, MediaKind.spoken(kind) ? net.kckern.daylight.shellkit.CoverGlyph.Kind.BOOK : net.kckern.daylight.shellkit.CoverGlyph.Kind.TRACK,
                        name, said, "");
        for (MediaKind.RowAction a : actions) {
            switch (a) {
                case PLAY_NEXT: sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_play_next, "Play next", () -> enqueue(id, true, name)); break;
                case ADD_TO_QUEUE: sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_queue_add, "Add to queue", () -> enqueue(id, false, name)); break;
                case GO_TO_ALBUM: sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_album, "Go to album", () -> goToParent(id, "album")); break;
                case GO_TO_ARTIST: sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_person, "Go to artist", () -> goToParent(id, "artist")); break;
                // One music track, or its album (2026-11-27: Keep on a track kept its whole album).
                case KEEP_TRACK: sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_download, KeepChoices.words(KeepChoices.TRACK),
                        () -> { action("keep_track"); KeepFlow.start(this, KeepChoices.trackKeepId(id), name); }); break;
                case KEEP_ALBUM: sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_album, KeepChoices.words(KeepChoices.ALBUM),
                        () -> { action("keep_album"); KeepFlow.start(this, id, "album".equals(MediaKind.normal(kind)) ? title : ""); }); break;
                case PLAY_FROM_HERE: sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_play, "Play from here", () -> play(id, false, name, sub, cover)); break;
                case MARK_FINISHED_UP_TO_HERE: sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_check, "Mark finished up to here", () -> {
                    List<String> upTo = new ArrayList<>();
                    for (String t : trackIds()) { upTo.add(t); if (t.equals(contentIdOf(id))) break; }
                    markFinished(upTo, true, "everything up to " + name, true);
                }); break;
                case MARK_WATCHED: sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_check, "Mark watched", () -> markFinished(java.util.Collections.singletonList(contentIdOf(id)), true, name, false)); break;
                case MARK_UNWATCHED: sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_replay, "Mark unwatched", () -> markFinished(java.util.Collections.singletonList(contentIdOf(id)), false, name, false)); break;
                default: break;
            }
        }
        sheet.show();
    }

    /** Go to album / artist: the track's own parents (its info's ids). */
    private void goToParent(String mediaId, String which) {
        action("go_to_" + which);
        String cid = contentIdOf(mediaId);
        io.execute(() -> {
            JSONObject p = null;
            try {
                JSONObject parents = new JSONObject(media.parents(cid, WAIT_MS)).optJSONObject("parents");
                p = parents == null ? null : parents.optJSONObject(which);
            } catch (Exception unreachable) { }
            JSONObject page = p;
            main.post(() -> {
                if (isFinishing()) return;
                if (page == null) { Toast.makeText(this, "Can't find its " + which + " now", Toast.LENGTH_SHORT).show(); return; }
                open(this, "level", page.optString("id"), page.optString("kind"), page.optString("title"), "", "");
            });
        });
    }

    // ── playing ─────────────────────────────────────────────────────────────

    /**
     * Runs {@code then} on the connected controller. Taps while it connects share the one
     * future (each used to build its own controller, and the earlier one was never released).
     */
    private void withController(java.util.function.Consumer<MediaController> then) {
        if (controller != null && controller.isConnected()) {
            try { then.accept(controller); } finally { playGuard.done(); }
            return;
        }
        if (pending == null || pending.isDone()) {
            // None yet, or a finished one whose controller has gone: releasing the future releases that controller.
            if (pending != null) MediaController.releaseFuture(pending);
            controller = null;
            // The application's context: a play's tap often finishes this page (Now playing opens with
            // CLEAR_TOP), and Android drops a finished activity's bindings itself; releasing a controller
            // bound to it afterwards unbinds twice and crashed the app ("Service not registered").
            android.content.Context app = getApplicationContext();
            SessionToken token = new SessionToken(app, new ComponentName(app, DaylightMediaService.class));
            pending = new MediaController.Builder(app, token).buildAsync();
        }
        final ListenableFuture<MediaController> mine = pending;
        mine.addListener(() -> {
            if (isDestroyed() || mine != pending) { playGuard.done(); return; }
            try { controller = mine.get(); then.accept(controller); }
            catch (Exception failed) { Toast.makeText(this, "This phone's player didn't answer. Try again", Toast.LENGTH_SHORT).show(); }
            finally { playGuard.done(); }
        }, main::post);
    }

    private void play(String mediaId, boolean shuffle, String name, String by, String cover) {
        play(mediaId, shuffle, name, by, cover, null, -1, MediaKind.spoken(kind));
    }

    private void play(String mediaId, boolean shuffle, String name, String by, String cover, String stage, long atMs) {
        play(mediaId, shuffle, name, by, cover, stage, atMs, MediaKind.spoken(kind) || "chapters".equals(stage));
    }

    /**
     * Plays here and opens Now playing. A container plays whole (a book resumes); a track plays
     * from itself in its list. Now playing opens on the tapped item at once (Starting), not on
     * "Nothing playing" while the player fetches it. A shuffle is asked of home with the
     * request (the queue that was playing is never shuffled first). {@code stage}: Now
     * playing opens on its chapters; {@code atMs} ≥ 0: from that place (Play from the start).
     */
    /** @param longItem a book, a talk or a part of one: Now playing's Starting frame is a book's (StartFrame) */
    private void play(String mediaId, boolean shuffle, String name, String by, String cover, String stage, long atMs, boolean longItem) {
        // A second tap on the same item within a second, or while the first is starting, is dropped.
        if (!playGuard.admit((shuffle ? "shuffle|" : "play|") + mediaId, SystemClock.elapsedRealtime())) return;
        action(shuffle ? "shuffle" : "play");
        // One Now playing: an open one takes the new item (onNewIntent reads the Starting extras).
        Intent now = Starting.put(new Intent(this, NowPlayingActivity.class)
                .putExtra(NowPlayingActivity.EXTRA_TARGET, NowPlayingActivity.LOCAL)
                .putExtra(Starting.EXTRA_LONG, longItem)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP), mediaId, name, by, cover);
        if (stage != null) now.putExtra(NowPlayingActivity.EXTRA_STAGE, stage);
        startActivity(now);
        // The queue's source: what "Next from …" names (queue spec §3).
        String source = QueueVerbs.label(mediaId, name, title, MODE_SEARCH.equals(mode) && field != null ? field.getText().toString() : "");
        QueueVerbs.notePlay(source);
        withController(c -> {
            MediaItem request = QueueTag.request(NowPlayingActivity.playRequest(mediaId, shuffle), source);
            if (atMs >= 0) c.setMediaItem(request, atMs);
            else c.setMediaItem(request);
            c.prepare();
            c.play();
        });
    }

    private void enqueue(String mediaId, boolean next, String name) {
        action(next ? "play_next" : "add_to_queue");
        // The queue's own verbs: Play next to the end of the next block, Add to queue before the source (QueueVerbs).
        if (QueueVerbs.enqueue(this, mediaId, next, name)) return;
        withController(c -> {
            MediaItem item = new MediaItem.Builder().setMediaId(mediaId).build();
            boolean empty = c.getMediaItemCount() == 0;
            if (empty) { c.setMediaItem(item); c.prepare(); c.play(); }
            else if (next) c.addMediaItem(c.getCurrentMediaItemIndex() + 1, item);
            else c.addMediaItem(item);
            // Nothing queued: it plays now, and says so (audit: it said "Plays next" and sat idle).
            Toast.makeText(this, (empty ? "Playing: " : next ? "Plays next: " : "Added to the queue: ") + name, Toast.LENGTH_SHORT).show();
        });
    }

    /**
     * Play on: the same picker as Now playing's (this phone first, each screen's state, off
     * ones greyed), open at once from the screens the phone home last saw; each screen is
     * checked in parallel and the list refreshed behind it. This phone plays here; a screen
     * opens Now playing on that screen, showing the item starting, and the load is sent
     * from there.
     */
    private void playOn(String mediaId, String name, String by, String cover) {
        action("play_on");
        SharedPreferences home = getSharedPreferences("daylight.home", MODE_PRIVATE);
        String cachedJson = home.getString("screens", "");
        List<TargetPicker.Target> targets = new ArrayList<>();
        targets.add(new TargetPicker.Target(TargetPicker.LOCAL, "This phone", ""));
        targets.addAll(NowPlayingActivity.cachedScreens(cachedJson));
        TargetPicker.Shown shown = TargetPicker.show(this, t, targets, "", targets.size() == 1 ? "Looking for screens…" : "",
                media, main, (id, label, snapshot) -> {
                    if (TargetPicker.LOCAL.equals(id)) { play(mediaId, false, name, by, cover); return; }
                    action("play_on_screen");
                    startActivity(Starting.put(new Intent(this, NowPlayingActivity.class)
                            .putExtra(NowPlayingActivity.EXTRA_TARGET, id)
                            .putExtra(Starting.EXTRA_TARGET_NAME, label)
                            .putExtra(RemoteControlService.EXTRA_SNAPSHOT, snapshot)
                            .putExtra(Starting.EXTRA_PLAY, true)
                            .putExtra(Starting.EXTRA_LONG, MediaKind.spoken(kind))
                            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP), mediaId, name, by, cover));
                });
        // The list itself, refreshed behind the open picker: new screens are added, the cache kept.
        screenIo.execute(() -> {
            String fresh = null, problem = "";
            try {
                JSONObject reply = new JSONObject(media.screens(6000));
                JSONArray items = reply.optJSONArray("items");
                if (items != null) fresh = items.toString();
            } catch (Exception e) { problem = "Can't reach home: only this phone"; }
            String list = fresh, note = problem;
            main.post(() -> {
                if (isFinishing()) return;
                if (list != null && !list.equals(cachedJson)) home.edit().putString("screens", list).apply();
                shown.add(list == null ? new ArrayList<>() : NowPlayingActivity.cachedScreens(list),
                        list == null && targets.size() > 1 ? "" : note);
            });
        });
    }

    // ── small parts ─────────────────────────────────────────────────────────

    private void action(String verb) {
        try { UiTelemetry.event("Browse", "browse.action", new JSONObject().put("verb", verb).put("kind", kind)); }
        catch (Exception ignored) { }
    }

    /** A cover seen before (here or on another screen) draws in this frame; others load off the main thread. */
    private void loadCover(ImageView into, String url, int px) {
        into.setTag(url);
        if (url == null || url.isEmpty()) { into.setImageDrawable(null); return; }
        Bitmap hit = net.kckern.daylight.shellkit.PlaylistArtwork.cached(url, px);
        if (hit != null) { into.setImageBitmap(hit); return; }
        covers.execute(() -> {
            Bitmap b = net.kckern.daylight.shellkit.PlaylistArtwork.load(url, px);
            // The view may show another row's cover by now (rows update in place).
            if (b != null) main.post(() -> { if (!isDestroyed() && url.equals(into.getTag())) into.setImageBitmap(b); });
        });
    }

    /** A text link (Retry, More, On this phone): ink, never the accent. */
    private TextView link(String label, String tag, Runnable run) {
        TextView b = t.text(this, label, Type.LABEL, t.ink, true);
        b.setPadding(0, dp(12), dp(16), dp(8));
        b.setBackground(t.pressable(null));
        if (run != null) b.setOnClickListener(v -> run.run());
        UiTelemetry.tag(b, tag);
        return b;
    }

    private SharedPreferences prefs() { return getSharedPreferences(PREFS, MODE_PRIVATE); }

    private static String nz(String s) { return s == null ? "" : s; }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }
}

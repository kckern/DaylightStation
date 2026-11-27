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
 * overflow; an author's or artist's page is about the person (portrait, facts, summary).
 * Row second lines never repeat the page (RowLine). A detail page opened from a list pages
 * left and right through that list (Neighbours); Back returns to the list scrolled to the
 * entry shown. The name is shown once: the top bar holds only Back until the header's name
 * scrolls away. The mini player (shell-kit MiniPlayer) is at the bottom of every level.
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
    private TextView progressLine, nameView, barTitle;
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
    private Neighbours neighbours = Neighbours.NONE;
    private GestureDetector swipe;
    private boolean barTitleShown;

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
                // A detail page: the bar holds only Back while the header shows the name.
                barTitle = t.text(this, title, Type.TITLE, t.ink, true);
                barTitle.setSingleLine(true);
                barTitle.setEllipsize(TextUtils.TruncateAt.END);
                barTitle.setAlpha(0f);
                getActionBar().setDisplayShowTitleEnabled(false);
                getActionBar().setDisplayShowCustomEnabled(true);
                getActionBar().setCustomView(barTitle);
            }
        }
        setTitle(MODE_SEARCH.equals(mode) ? "Search" : MODE_LIBRARY.equals(mode) ? "Library" : title.isEmpty() ? "Library" : title);

        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(t.background);
        if (MODE_SEARCH.equals(mode)) page.addView(searchField(nz(in.getStringExtra("query"))));
        scroller = new ScrollView(this);
        column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setPadding(dp(16), dp(8), dp(16), dp(24));
        scroller.addView(column);
        scroller.setOnScrollChangeListener((v, x, y, ox, oy) -> fadeBarTitle());
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
            String q = nz(in.getStringExtra("query"));
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
        // Back from Now playing or On this phone: the book's progress and Keep's state are read again.
        if (started && detail()) fillHeader();
        started = true;
    }

    @Override protected void onStop() {
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
        progressLine = null;
        nameView = null;
        headerBox = new LinearLayout(this);
        headerBox.setOrientation(LinearLayout.VERTICAL);
        column.addView(headerBox);
        fillHeader();
        status = t.text(this, "", Type.LABEL, t.inkMuted, false);
        status.setMinHeight(dp(20));
        column.addView(status);
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
            @Override public String signature(JSONObject n) { return n.toString() + "|" + bookSignature(n); }
            @Override public View create(JSONObject n) { return row(n, null); }
            // A changed row is drawn again; an unchanged one is not touched.
            @Override public View update(View old, JSONObject n) { return row(n, null); }
        });
        if (barTitle != null) { barTitle.setText(title); barTitle.setAlpha(0f); barTitleShown = false; }
    }

    private void startLevel() {
        if (detail() && !MediaKind.listsRows(kind)) {
            status.setText("Plays as a radio station: its songs with station IDs between them.");
        } else {
            showCached();
            load(0);
        }
        if (MediaKind.aboutPerson(kind) && "level".equals(mode)) loadAbout();
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

    private void clearResults() {
        results.removeAllViews();
        keyed.reset();
    }

    private void showResults(String q, JSONObject answer, String reason) {
        clearResults();
        searchGroups.clear();
        if (answer == null || !answer.optBoolean("ok", false)) {
            status.setText(net.kckern.daylight.shellkit.FailureWords.line(causeOf(answer, reason)));
            results.addView(link("Retry", "search.retry", () -> runSearch(q)));
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
            // Fixed-height placeholders, so the answer replaces them without the page moving.
            for (int i = 0; i < 6; i++) {
                View ph = new View(this);
                ph.setBackground(t.round(t.surface, Radius.SMALL));
                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, dp(ROW_DP - 8));
                lp.topMargin = dp(8);
                results.addView(ph, lp);
            }
            return;
        }
        try { draw(new JSONArray(cached), null, false); } catch (Exception ignored) { }
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

    private void loadProgress() {
        final List<String> ids = trackIds();
        if (ids.isEmpty()) return;
        io.execute(() -> {
            JSONObject p = null, reply = null;
            String reason = "";
            try { reply = new JSONObject(media.progress(ids, WAIT_MS)); p = reply.optJSONObject("progress"); }
            catch (Exception e) { reason = reasonOf(e); }
            JSONObject got = p, said = reply;
            String why = reason;
            main.post(() -> {
                if (isFinishing() || progressLine == null) return;
                progressLine.setText(progressWords(ids, got, progressUnavailable(causeOf(said, why))));
            });
        });
    }

    /** "2 h 10 min left · 34 %", "Finished", or "Not started" from the parts' progress (seconds). */
    static String progressWords(List<String> ids, JSONObject progress) {
        return progressWords(ids, progress, "Progress isn't available offline");
    }

    /** The progress line when home gave none, by why. */
    static String progressUnavailable(net.kckern.daylight.shellkit.FailureWords.Cause cause) {
        switch (cause) {
            case OFFLINE: return "Progress isn't available offline";
            case STARTING: return "Progress shows once Daylight has started";
            default: return "Progress: " + net.kckern.daylight.shellkit.FailureWords.line(cause);
        }
    }

    /** @param unavailable the line when there is no progress answer (why home did not answer) */
    static String progressWords(List<String> ids, JSONObject progress, String unavailable) {
        if (progress == null) return unavailable;
        long played = 0, total = 0;
        boolean any = false, allDone = true;
        for (String id : ids) {
            JSONObject p = progress.optJSONObject(id);
            if (p == null) { allDone = false; continue; }
            any = true;
            long d = Math.max(0, p.optLong("duration")), at = Math.max(0, Math.min(d, p.optLong("playhead")));
            boolean done = p.optBoolean("finished") || (d > 0 && at >= d * 0.97);
            total += d;
            played += done ? d : at;
            if (!done) allDone = false;
        }
        if (!any) return "Not started";
        if (allDone) return "Finished";
        long left = Math.max(0, total - played);
        int pct = total > 0 ? (int) Math.round(played * 100.0 / total) : 0;
        String l = left >= 3600 ? (left / 3600) + " h " + (left % 3600) / 60 + " min left" : Math.max(1, left / 60) + " min left";
        return l + " · " + pct + " %";
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
        if (ids.isEmpty()) { Toast.makeText(this, "Open the book's parts first", Toast.LENGTH_SHORT).show(); return; }
        Runnable run = () -> {
            action(finished ? "mark_finished" : "mark_unfinished");
            io.execute(() -> {
                String line;
                try {
                    int n = new JSONObject(media.markFinished(ids, finished, WAIT_MS)).optInt("marked");
                    line = n > 0 ? (finished ? "Marked finished" : "Marked not finished") : "Could not mark it";
                } catch (Exception e) { line = "Can't reach home"; }
                String said = line;
                main.post(() -> { if (!isFinishing()) { Toast.makeText(this, said, Toast.LENGTH_SHORT).show(); loadProgress(); } });
            });
        };
        if (!ask) { run.run(); return; }
        new AlertDialog.Builder(this, DaylightTheme.alert()).setTitle("Mark " + what + " finished?")
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

    /**
     * The header: on the library's first level a line; on a detail page the cover or
     * portrait, the name, the facts or by-line, the progress of a book, the primary
     * circular button at the right edge, the neighbours, the summary, the icon row and ⋮.
     */
    private void fillHeader() {
        headerBox.removeAllViews();
        headerBox.setPadding(0, dp(8), 0, dp(8));
        if (MODE_LIBRARY.equals(mode)) {
            headerBox.addView(t.text(this, "Everything the household keeps, by library.", Type.LABEL, t.inkMuted, false));
            return;
        }
        if (!detail()) return;
        boolean person = MediaKind.aboutPerson(kind);
        JSONObject cont = about == null ? null : about.optJSONObject("continue");
        MediaKind.ActionSet set = MediaKind.actions(kind, "book".equals(kind) || cont != null);

        LinearLayout top = new LinearLayout(this);
        top.setGravity(Gravity.CENTER_VERTICAL);
        ImageView cover = new ImageView(this);
        cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
        cover.setClipToOutline(true);
        net.kckern.daylight.shellkit.CoverGlyph.behind(cover, t, net.kckern.daylight.shellkit.CoverGlyph.of(kind), dp(112), dp(8));
        cover.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        top.addView(cover, new LinearLayout.LayoutParams(dp(112), dp(112)));
        String portrait = about == null ? "" : about.optString("portrait", "");
        loadCover(cover, !portrait.isEmpty() && (person || art.isEmpty()) ? portrait : art, 320);
        LinearLayout words = new LinearLayout(this);
        words.setOrientation(LinearLayout.VERTICAL);
        words.setPadding(dp(14), 0, dp(8), 0);
        nameView = t.text(this, title, Type.TITLE, t.ink, true);
        nameView.setMaxLines(3);
        nameView.setEllipsize(TextUtils.TruncateAt.END);
        words.addView(nameView);
        String by = person ? RowLine.facts(kind, about, childRows()) : subtitle;
        if (!by.isEmpty()) {
            TextView facts = t.text(this, by, Type.LABEL, t.inkMuted, false);
            facts.setTag("facts");
            words.addView(facts);
        }
        if ("book".equals(kind)) {
            // A book: how far in and what is left, under its title (filled once its parts are known).
            progressLine = t.text(this, " ", Type.LABEL, t.inkMuted, false);
            progressLine.setPadding(0, dp(4), 0, 0);
            words.addView(progressLine);
        }
        if (cont != null) {
            TextView label = t.text(this, "Continue " + cont.optString("title"), Type.LABEL, t.ink, true);
            label.setPadding(0, dp(4), 0, 0);
            label.setMaxLines(2);
            label.setEllipsize(TextUtils.TruncateAt.END);
            words.addView(label);
        }
        String autoLine = KeepLabels.collectionLine(this, contentIdOf(parent));
        if (!autoLine.isEmpty()) words.addView(t.text(this, autoLine, Type.LABEL, t.inkMuted, false));
        top.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
        if (set.primary != null) top.addView(primaryButton(set.primary, cont), new LinearLayout.LayoutParams(dp(56), dp(56)));
        // A person's page has no icon row: its ⋮ sits at the header's edge.
        boolean personMore = person && set.secondary.isEmpty() && set.overflow.isEmpty();
        if (personMore) {
            ImageButton more = iconButton(R.drawable.daylight_np_more, "More actions for " + title);
            more.setOnClickListener(v -> overflow(v, set.overflow));
            UiTelemetry.tag(more, "browse.overflow");
            top.addView(more, new LinearLayout.LayoutParams(dp(48), dp(48)));
        }
        headerBox.addView(top);

        if (neighbours.pages()) headerBox.addView(neighbourLine());

        String summary = about == null ? "" : about.optString("summary", "");
        if (!summary.isEmpty()) headerBox.addView(summaryView(summary));

        if (!set.secondary.isEmpty() || !set.overflow.isEmpty()) {
            LinearLayout icons = new LinearLayout(this);
            icons.setGravity(Gravity.CENTER_VERTICAL);
            icons.setPadding(0, dp(8), 0, 0);
            for (MediaKind.Action a : set.secondary) icons.addView(secondaryButton(a), new LinearLayout.LayoutParams(dp(48), dp(48)));
            View gap = new View(this);
            icons.addView(gap, new LinearLayout.LayoutParams(0, 1, 1));
            if (!set.overflow.isEmpty()) {
                ImageButton more = iconButton(R.drawable.daylight_np_more, "More actions for " + title);
                more.setOnClickListener(v -> overflow(v, set.overflow));
                UiTelemetry.tag(more, "browse.overflow");
                icons.addView(more, new LinearLayout.LayoutParams(dp(48), dp(48)));
            }
            headerBox.addView(icons);
        }
        if (progressLine != null && !rows.isEmpty()) loadProgress();
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
        if (facts instanceof TextView) ((TextView) facts).setText(line);
        else if (!line.isEmpty()) fillHeader();
    }

    /** The one primary action: a 56 dp filled circle in the accent at the header's right edge. */
    private View primaryButton(MediaKind.Action a, JSONObject cont) {
        ImageButton b = new ImageButton(this);
        b.setImageResource(a == MediaKind.Action.SHUFFLE_ARTIST ? R.drawable.daylight_np_shuffle : R.drawable.daylight_np_play);
        b.setImageTintList(ColorStateList.valueOf(net.kckern.daylight.shellkit.ThemeColors.readableOn(t.primary)));
        b.setBackground(t.pressable(DaylightTheme.round(t.primary, dp(28))));
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
                b.setOnClickListener(v -> { if (k == null) KeepFlow.start(this, self()); else DownloadsActivity.open(this); });
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
                ImageButton b = iconButton(R.drawable.daylight_np_queue, "Chapters");
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
                case MARK_FINISHED: sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_check, "Mark finished", () -> markFinished(trackIds(), true, title, true)); break;
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

    /** The biography, four lines with More that opens it in place. */
    private View summaryView(String summary) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(0, dp(10), 0, 0);
        TextView text = t.text(this, summary, Type.BODY, t.ink, false);
        text.setMaxLines(4);
        text.setEllipsize(TextUtils.TruncateAt.END);
        box.addView(text);
        TextView more = link("More", "browse.summary_more", null);
        more.setTextColor(t.inkMuted);
        more.setPadding(0, dp(4), dp(4), 0);
        more.setOnClickListener(v -> {
            boolean open = text.getMaxLines() == 4;
            text.setMaxLines(open ? Integer.MAX_VALUE : 4);
            more.setText(open ? "Less" : "More");
        });
        more.setVisibility(View.INVISIBLE);
        box.addView(more);
        // "More" only when there is more than four lines of it.
        text.post(() -> {
            android.text.Layout l = text.getLayout();
            boolean cut = l != null && l.getLineCount() > 0 && l.getEllipsisCount(l.getLineCount() - 1) > 0;
            more.setVisibility(cut ? View.VISIBLE : View.GONE);
        });
        return box;
    }

    /** The top bar's name: shown only once the header's name has scrolled out of view. */
    private void fadeBarTitle() {
        if (barTitle == null || nameView == null) return;
        int nameBottom = headerBox.getTop() + nameView.getBottom() + ((View) nameView.getParent()).getTop()
                + ((View) nameView.getParent().getParent()).getTop();
        boolean show = scroller.getScrollY() > nameBottom;
        if (show == barTitleShown) return;
        barTitleShown = show;
        barTitle.animate().alpha(show ? 1f : 0f).setDuration(160).start();
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
            try { about = new JSONObject(cached); fillHeader(); redrawRows(); }
            catch (Exception ignored) { }
        }
        final boolean books = MediaKind.hasBooks(kind);
        io.execute(() -> {
            JSONObject got = null;
            try { got = new JSONObject(media.about(cid, books, WAIT_MS)).optJSONObject("about"); }
            catch (Exception unreachable) { Log.w(TAG, "about failed: " + unreachable.getClass().getSimpleName()); }
            JSONObject a = got;
            main.post(() -> {
                if (isFinishing() || a == null || !cid.equals(contentIdOf(parent))) return;
                if (a.toString().equals(cached)) return;
                prefs().edit().putString(key, a.toString()).apply();
                about = a;
                fillHeader();
                // Book rows now know their year and progress: redrawn in place.
                redrawRows();
            });
        });
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
    private void loadNeighboursFrom(String pagesIn) {
        final String at = parent;
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
        final String line = id.startsWith("m:") ? "" : RowLine.of(pageKind, n, subtitle, bookOf(n));
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
        TextView top = t.text(this, id.startsWith("m:") ? "More" : name, Type.BODY, t.ink, !id.startsWith("m:"));
        top.setMaxLines(1);
        top.setEllipsize(TextUtils.TruncateAt.END);
        words.addView(top);
        TextView bottom = t.text(this, line, Type.LABEL, t.inkMuted, false);
        bottom.setMaxLines(1);
        bottom.setEllipsize(TextUtils.TruncateAt.END);
        words.addView(bottom);
        row.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
        List<MediaKind.RowAction> menu = searchGroup != null ? MediaKind.searchRowMenu(rowKind) : MediaKind.rowMenu(pageKind);
        if (playable && !browsable && !menu.isEmpty()) {
            ImageButton more = iconButton(R.drawable.daylight_np_more, "More for " + name);
            more.setOnClickListener(v -> rowMenu(v, menu, n));
            UiTelemetry.tag(more, "browse.track_menu");
            row.addView(more, new LinearLayout.LayoutParams(dp(44), dp(48)));
        }
        MediaKind.Tap tap = id.startsWith("m:") ? MediaKind.Tap.OPEN : MediaKind.rowTap(pageKind, browsable, playable);
        row.setOnClickListener(v -> {
            if (id.startsWith("m:")) { loadMore(n); return; }
            if (tap == MediaKind.Tap.OPEN) {
                String k = rowKind.isEmpty() ? childKind(kind, id) : rowKind;
                UiTelemetry.tag(row, "browse.open");
                openDetail(n, k, searchGroup);
            } else if (tap == MediaKind.Tap.PLAY_FROM_HERE) {
                play(id, false, name, sub, cover);
            }
        });
        UiTelemetry.tag(row, browsable ? "browse.row" : "browse.track");
        row.setContentDescription(name + (line.isEmpty() ? "" : ", " + line));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, dp(ROW_DP));
        row.setLayoutParams(lp);
        return row;
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
        net.kckern.daylight.shellkit.ItemSheet sheet = net.kckern.daylight.shellkit.ItemSheet.of(this, "Browse")
                .item(cover.isEmpty() ? art : cover, MediaKind.spoken(kind) ? net.kckern.daylight.shellkit.CoverGlyph.Kind.BOOK : net.kckern.daylight.shellkit.CoverGlyph.Kind.TRACK,
                        name, sub, "");
        for (MediaKind.RowAction a : actions) {
            switch (a) {
                case PLAY_NEXT: sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_play_next, "Play next", () -> enqueue(id, true, name)); break;
                case ADD_TO_QUEUE: sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_queue_add, "Add to queue", () -> enqueue(id, false, name)); break;
                case GO_TO_ALBUM: sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_album, "Go to album", () -> goToParent(id, "album")); break;
                case GO_TO_ARTIST: sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_person, "Go to artist", () -> goToParent(id, "artist")); break;
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
            catch (Exception failed) { Toast.makeText(this, "Could not start playback", Toast.LENGTH_SHORT).show(); }
            finally { playGuard.done(); }
        }, main::post);
    }

    private void play(String mediaId, boolean shuffle, String name, String by, String cover) {
        play(mediaId, shuffle, name, by, cover, null, -1);
    }

    /**
     * Plays here and opens Now playing. A container plays whole (a book resumes); a track plays
     * from itself in its list. Now playing opens on the tapped item at once (Starting), not on
     * "Nothing playing" while the player fetches it. A shuffle is asked of home with the
     * request (the queue that was playing is never shuffled first). {@code stage}: Now
     * playing opens on its chapters; {@code atMs} ≥ 0: from that place (Play from the start).
     */
    private void play(String mediaId, boolean shuffle, String name, String by, String cover, String stage, long atMs) {
        // A second tap on the same item within a second, or while the first is starting, is dropped.
        if (!playGuard.admit((shuffle ? "shuffle|" : "play|") + mediaId, SystemClock.elapsedRealtime())) return;
        action(shuffle ? "shuffle" : "play");
        // One Now playing: an open one takes the new item (onNewIntent reads the Starting extras).
        Intent now = Starting.put(new Intent(this, NowPlayingActivity.class)
                .putExtra(NowPlayingActivity.EXTRA_TARGET, NowPlayingActivity.LOCAL)
                .putExtra(Starting.EXTRA_LONG, MediaKind.spoken(kind) || "chapters".equals(stage))
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
            if (c.getMediaItemCount() == 0) { c.setMediaItem(item); c.prepare(); }
            else if (next) c.addMediaItem(c.getCurrentMediaItemIndex() + 1, item);
            else c.addMediaItem(item);
            Toast.makeText(this, (next ? "Plays next: " : "Added to the queue: ") + name, Toast.LENGTH_SHORT).show();
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

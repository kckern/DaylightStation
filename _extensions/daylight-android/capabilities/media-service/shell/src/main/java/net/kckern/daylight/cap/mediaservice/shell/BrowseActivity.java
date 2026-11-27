package net.kckern.daylight.cap.mediaservice.shell;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
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
import android.view.Gravity;
import android.view.MenuItem;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
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
 * level, and a level of the library (a library, an artist, an album, a book, a playlist),
 * which for a collection carries a header with Play, Shuffle, Play on… and Keep. Lookup,
 * not discovery: nothing is proposed. Every list is drawn from its last answer at once and
 * replaced in place; rows have a fixed height, so nothing jumps. Offline it shows what is
 * on this phone and says so. Not exported.
 */
public final class BrowseActivity extends Activity {
    static final String TAG = "Daylight-Media";
    static final String MODE_SEARCH = "search", MODE_LIBRARY = "library";
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
    private final ExecutorService covers = Executors.newFixedThreadPool(2);
    private final PayloadMedia media = new PayloadMedia();
    private DaylightTheme t;
    private LinearLayout column, results;
    private TextView status;
    private String mode, parent, kind, title, subtitle, art, group;
    private final List<JSONObject> rows = new ArrayList<>();
    private final List<View> rowViews = new ArrayList<>();
    private TextView progressLine;
    private LinearLayout azStrip;
    private ScrollView scroller;
    private volatile int generation;
    /** The level's rows, kept by id: a refreshed answer updates them in place (no blink, no lost press). */
    private net.kckern.daylight.shellkit.KeyedRows<JSONObject> keyed;
    private ListenableFuture<MediaController> pending;
    private MediaController controller;
    private final net.kckern.daylight.shellkit.TapGuard playGuard = new net.kckern.daylight.shellkit.TapGuard();

    /** Opens the search, the library, or one level of it. */
    static void open(Context c, String mode, String parent, String kind, String title, String subtitle, String art) {
        Intent i = new Intent(c, BrowseActivity.class).putExtra("mode", mode).putExtra("parent", parent)
                .putExtra("kind", kind).putExtra("title", title).putExtra("subtitle", subtitle).putExtra("art", art);
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
        kind = nz(in.getStringExtra("kind"));
        title = nz(in.getStringExtra("title"));
        subtitle = nz(in.getStringExtra("subtitle"));
        art = nz(in.getStringExtra("art"));
        group = nz(in.getStringExtra("group"));
        if (mode == null) mode = parent == null ? MODE_LIBRARY : "level";
        setTitle(MODE_SEARCH.equals(mode) ? "Search" : MODE_LIBRARY.equals(mode) ? "Library" : title.isEmpty() ? "Library" : title);
        if (getActionBar() != null) getActionBar().setDisplayHomeAsUpEnabled(true);

        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(t.background);
        if (MODE_SEARCH.equals(mode)) page.addView(searchField(nz(in.getStringExtra("query"))));
        ScrollView scroll = new ScrollView(this);
        scroller = scroll;
        column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setPadding(dp(16), dp(8), dp(16), dp(24));
        scroll.addView(column);
        page.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(page);

        if (!"level".equals(mode) || isCollection()) column.addView(header());
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
            @Override public String signature(JSONObject n) { return n.toString(); }
            @Override public View create(JSONObject n) { return row(n, null); }
            // A changed row is drawn again; an unchanged one is not touched.
            @Override public View update(View old, JSONObject n) { return row(n, null); }
        });
        UiTelemetry.event("Browse", "browse.view", new JSONObject(java.util.Map.of("kind", "level".equals(mode) ? kind : mode)));
        Log.i(TAG, "browse open " + mode + " " + kind);

        if (MODE_SEARCH.equals(mode)) {
            String q = nz(in.getStringExtra("query"));
            if (q.isEmpty()) showRecent(); else runSearch(q);
        } else {
            showCached();
            load(0);
        }
    }

    @Override protected void onDestroy() {
        super.onDestroy();
        io.shutdownNow();
        searchIo.shutdownNow();
        screenIo.shutdownNow();
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

    // ── search ──────────────────────────────────────────────────────────────

    private EditText field;
    private final Runnable debounced = () -> runSearch(field == null ? "" : field.getText().toString());

    private View searchField(String query) {
        field = new EditText(this);
        field.setHint("Books, albums, artists, playlists");
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
        status.setText(recent.length() == 0 ? "Search the household's books, music and playlists." : "Recent searches");
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
            for (int i = 0; items != null && i < items.length(); i++) results.addView(row(items.optJSONObject(i), null));
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

    private boolean isCollection() {
        // One collection gets Play, Shuffle, Play on… and Keep; a whole library or a list of
        // lists never does (Keep on a library of 11,000 books is not a thing to offer).
        return kind.matches("book|books|album|albums|playlist|playlists|artist|artists|author|kept|tracks");
    }

    private String cacheKey() { return MODE_LIBRARY.equals(mode) ? "lib" : "lvl|" + parent; }

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
        io.execute(() -> {
            JSONObject answer;
            String reason = "";
            try {
                answer = new JSONObject(MODE_LIBRARY.equals(mode) ? media.library(WAIT_MS) : media.browse(browseId(kind, parent), page, 50, WAIT_MS));
            } catch (Exception failed) {
                answer = null;
                reason = reasonOf(failed);
                Log.w(TAG, "browse failed: " + failed.getClass().getSimpleName());
            }
            JSONObject a = answer;
            String why = reason;
            main.post(() -> { if (mine == generation && !isFinishing()) answered(a, why); });
        });
    }

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
            ways.addView(button("On this phone", "browse.offline_kept", () -> DownloadsActivity.open(this)));
            if (retry) ways.addView(button("Retry", "browse.retry", () -> load(0)));
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
        if (rows.size() < 40) return;
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
            TextView l = t.text(this, String.valueOf(e.getKey()), Type.LABEL, t.primary, true);
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

    /** The book's speed, the same one Now playing remembers for it (and the long-form default). */
    private void chooseSpeed() {
        final float[] options = { 0.8f, 1f, 1.1f, 1.25f, 1.5f, 1.75f, 2f, 2.5f, 3f };
        String[] labels = new String[options.length];
        for (int i = 0; i < options.length; i++) labels[i] = LongForm.speedLabel(options[i]);
        new AlertDialog.Builder(this, DaylightTheme.alert()).setTitle("Speed for this book").setItems(labels, (d, which) -> {
            SharedPreferences.Editor e = speeds().edit();
            e.putFloat("speed:" + speedKey(), options[which]).putFloat(LongForm.DEFAULT_KEY, options[which]).apply();
            action("speed");
            Toast.makeText(this, "Plays at " + labels[which], Toast.LENGTH_SHORT).show();
            recreate();
        }).setNegativeButton("Cancel", null).show();
    }

    private void markFinished(boolean finished) {
        final List<String> ids = trackIds();
        if (ids.isEmpty()) { Toast.makeText(this, "Open the book's parts first", Toast.LENGTH_SHORT).show(); return; }
        new AlertDialog.Builder(this, DaylightTheme.alert()).setTitle("Mark " + title + " finished?")
                .setMessage("It leaves Continue listening on every screen.").setPositiveButton("Mark finished", (d, w) -> {
                    action("mark_finished");
                    io.execute(() -> {
                        String line;
                        try {
                            int n = new JSONObject(media.markFinished(ids, finished, WAIT_MS)).optInt("marked");
                            line = n > 0 ? "Marked finished" : "Could not mark it";
                        } catch (Exception e) { line = "Can't reach home"; }
                        String said = line;
                        main.post(() -> { if (!isFinishing()) { Toast.makeText(this, said, Toast.LENGTH_SHORT).show(); loadProgress(); } });
                    });
                }).setNegativeButton("Cancel", null).show();
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
        recreate();
    }

    /**
     * The id a level is read by. A playlist reached by its own id (a tile, a link) is read
     * through the list catalog (a:0|<id>), as the car reads it: as a container it lists itself.
     */
    static String browseId(String kind, String parent) {
        if (kind != null && kind.startsWith("playlist") && parent != null && parent.startsWith("c:")) return "a:0|" + contentIdOf(parent);
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

    // ── a collection's header ───────────────────────────────────────────────

    private View header() {
        LinearLayout h = new LinearLayout(this);
        h.setOrientation(LinearLayout.VERTICAL);
        h.setPadding(0, dp(8), 0, dp(8));
        if (MODE_LIBRARY.equals(mode) || MODE_SEARCH.equals(mode)) {
            if (MODE_LIBRARY.equals(mode)) {
                TextView line = t.text(this, "Everything the household keeps, by library.", Type.LABEL, t.inkMuted, false);
                h.addView(line);
            }
            return h;
        }
        LinearLayout top = new LinearLayout(this);
        top.setGravity(Gravity.CENTER_VERTICAL);
        ImageView cover = new ImageView(this);
        cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
        cover.setClipToOutline(true);
        cover.setBackground(t.round(t.tile, Radius.MEDIUM));
        top.addView(cover, new LinearLayout.LayoutParams(dp(112), dp(112)));
        loadCover(cover, art, 320);
        LinearLayout words = new LinearLayout(this);
        words.setOrientation(LinearLayout.VERTICAL);
        words.setPadding(dp(14), 0, 0, 0);
        TextView name = t.text(this, title, Type.TITLE, t.ink, true);
        name.setMaxLines(3);
        name.setEllipsize(TextUtils.TruncateAt.END);
        words.addView(name);
        if (!subtitle.isEmpty()) words.addView(t.text(this, subtitle, Type.LABEL, t.inkMuted, false));
        String autoLine = KeepLabels.collectionLine(this, contentIdOf(parent));
        if (!autoLine.isEmpty()) words.addView(t.text(this, autoLine, Type.LABEL, t.primary, false));
        top.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
        h.addView(top);
        LinearLayout actions = new LinearLayout(this);
        actions.setPadding(0, dp(12), 0, 0);
        boolean book = kind.startsWith("book");
        // The collection itself, as the player and Keep take it (c:<id>), whatever id reached this page.
        final String self = parent.startsWith("c:") ? parent : "c:" + contentIdOf(parent);
        actions.addView(button(book ? "Resume" : "Play", "browse.play", () -> play(self, false, title, subtitle, art)));
        if (!book) actions.addView(button("Shuffle", "browse.shuffle", () -> play(self, true, title, subtitle, art)));
        actions.addView(button("Play on…", "browse.play_on", () -> playOn(self, title, subtitle, art)));
        actions.addView(button("Keep", "browse.keep", () -> KeepFlow.start(this, self)));
        android.widget.HorizontalScrollView actionScroll = new android.widget.HorizontalScrollView(this);
        actionScroll.setHorizontalScrollBarEnabled(false);
        actionScroll.addView(actions);
        h.addView(actionScroll);
        if (book) {
            // A book: how far in and what is left (filled once its parts are known), its speed, and Mark finished.
            progressLine = t.text(this, " ", Type.LABEL, t.inkMuted, false);
            progressLine.setPadding(0, dp(10), 0, 0);
            h.addView(progressLine, 1);
            LinearLayout more = new LinearLayout(this);
            more.setPadding(0, dp(6), 0, 0);
            more.addView(button("Speed " + LongForm.speedLabel(bookSpeed()), "browse.speed", this::chooseSpeed));
            more.addView(button("Mark finished", "browse.mark_finished", () -> markFinished(true)));
            h.addView(more);
        } else if (kind.matches("album|albums|playlist|playlists")) {
            LinearLayout more = new LinearLayout(this);
            more.setPadding(0, dp(6), 0, 0);
            boolean staged = new net.kckern.daylight.shellkit.DrivingRadioSettings(this).isStaged(contentIdOf(parent));
            more.addView(button(staged ? "In Your playlists" : "Add to Your playlists", "browse.add_to_playlists", this::addToYourPlaylists));
            h.addView(more);
        }
        return h;
    }

    // ── rows ────────────────────────────────────────────────────────────────

    private View row(JSONObject n, String unused) {
        final String id = n.optString("id");
        final String name = n.optString("title", "Untitled");
        final String sub = n.optString("subtitle", "");
        final String cover = n.optString("artUrl", "");
        final boolean browsable = n.optBoolean("browsable", id.startsWith("c:") || id.startsWith("s:") || id.startsWith("a:") || id.startsWith("m:"));
        final boolean playable = n.optBoolean("playable", id.startsWith("p:"));
        final String rowKind = n.optString("kind", "");
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setBackground(t.pressable(null));
        ImageView img = new ImageView(this);
        img.setScaleType(ImageView.ScaleType.CENTER_CROP);
        img.setClipToOutline(true);
        img.setBackground(t.round(t.tile, Radius.SMALL));
        row.addView(img, new LinearLayout.LayoutParams(dp(48), dp(48)));
        loadCover(img, cover, 144);
        LinearLayout words = new LinearLayout(this);
        words.setOrientation(LinearLayout.VERTICAL);
        words.setPadding(dp(12), 0, dp(4), 0);
        TextView top = t.text(this, id.startsWith("m:") ? "More" : name, Type.BODY, t.ink, !id.startsWith("m:"));
        top.setMaxLines(1);
        top.setEllipsize(TextUtils.TruncateAt.END);
        words.addView(top);
        TextView bottom = t.text(this, sub, Type.LABEL, t.inkMuted, false);
        bottom.setMaxLines(1);
        bottom.setEllipsize(TextUtils.TruncateAt.END);
        words.addView(bottom);
        row.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
        if (playable && !browsable) {
            TextView more = t.text(this, "⋮", Type.TITLE, t.inkMuted, false);
            more.setGravity(Gravity.CENTER);
            more.setContentDescription("More for " + name);
            more.setOnClickListener(v -> trackMenu(v, id, name, sub, cover));
            UiTelemetry.tag(more, "browse.track_menu");
            row.addView(more, new LinearLayout.LayoutParams(dp(44), dp(48)));
        }
        row.setOnClickListener(v -> {
            if (id.startsWith("m:")) { loadMore(n); }
            else if (browsable) {
                String k = rowKind.isEmpty() ? childKind(kind, id) : rowKind;
                UiTelemetry.tag(row, "browse.open");
                open(this, "level", id, k, name, sub, cover);
            } else if (playable) play(id, false, name, sub, cover);
        });
        UiTelemetry.tag(row, browsable ? "browse.row" : "browse.track");
        row.setContentDescription(name + (sub.isEmpty() ? "" : ", " + sub));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, dp(ROW_DP));
        row.setLayoutParams(lp);
        return row;
    }

    /** What a row opened from a level is: a library's authors or artists, their books or albums, a list source's playlists. */
    static String childKind(String parentKind, String id) {
        // A list source's entries are playlists (reached as a:<skip>|<id>); a source is a list of lists.
        if (id.startsWith("s:")) return "lists";
        if ("lists".equals(parentKind)) return "playlist";
        if (id.startsWith("a:")) return "lists";
        switch (parentKind) {
            case "library-books": return "author";
            case "library": return "artist";
            case "author": return "book";
            case "artist": case "artists": return "album";
            case "lists": return "playlist";
            default: return "collection";
        }
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

    private void trackMenu(View anchor, String id, String name, String sub, String cover) {
        PopupMenu menu = new PopupMenu(this, anchor);
        menu.getMenu().add(0, 1, 0, "Play here");
        // A book is not added to a queue (queue spec §2): it plays to its end on its own.
        if (!kind.startsWith("book")) {
            menu.getMenu().add(0, 2, 0, "Play next");
            menu.getMenu().add(0, 3, 0, "Add to queue");
        }
        menu.getMenu().add(0, 4, 0, "Play on…");
        menu.getMenu().add(0, 5, 0, "Keep on this phone");
        menu.setOnMenuItemClickListener(item -> {
            switch (item.getItemId()) {
                case 1: play(id, false, name, sub, cover); break;
                case 2: enqueue(id, true, name); break;
                case 3: enqueue(id, false, name); break;
                case 4: playOn(id, name, sub, cover); break;
                case 5: KeepFlow.start(this, id); break;
                default: break;
            }
            return true;
        });
        menu.show();
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

    /**
     * Plays here and opens Now playing. A container plays whole (a book resumes); a track plays
     * from itself in its list. Now playing opens on the tapped item at once (Starting), not on
     * "Nothing playing" while the player fetches it. A shuffle is asked of home with the
     * request (the queue that was playing is never shuffled first).
     */
    private void play(String mediaId, boolean shuffle, String name, String by, String cover) {
        // A second tap on the same item within a second, or while the first is starting, is dropped.
        if (!playGuard.admit((shuffle ? "shuffle|" : "play|") + mediaId, SystemClock.elapsedRealtime())) return;
        action(shuffle ? "shuffle" : "play");
        // One Now playing: an open one takes the new item (onNewIntent reads the Starting extras).
        startActivity(Starting.put(new Intent(this, NowPlayingActivity.class)
                .putExtra(NowPlayingActivity.EXTRA_TARGET, NowPlayingActivity.LOCAL)
                .putExtra(Starting.EXTRA_LONG, kind.startsWith("book"))
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP), mediaId, name, by, cover));
        String source = QueueVerbs.label(mediaId, name, title, MODE_SEARCH.equals(mode) && field != null ? field.getText().toString() : "");
        QueueVerbs.notePlay(source);
        withController(c -> {
            c.setMediaItem(QueueTag.request(NowPlayingActivity.playRequest(mediaId, shuffle), source));
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

    private TextView button(String label, String tag, Runnable run) {
        TextView b = t.text(this, label, Type.LABEL, t.primary, true);
        b.setPadding(dp(14), dp(10), dp(14), dp(10));
        b.setBackground(t.pressable(t.round(t.surfaceVariant, Radius.LARGE)));
        b.setOnClickListener(v -> run.run());
        UiTelemetry.tag(b, tag);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, -2);
        lp.setMarginEnd(dp(8));
        b.setLayoutParams(lp);
        return b;
    }

    private TextView link(String label, String tag, Runnable run) {
        TextView b = t.text(this, label, Type.LABEL, t.primary, true);
        b.setPadding(0, dp(12), dp(4), dp(8));
        b.setBackground(t.pressable(null));
        b.setOnClickListener(v -> run.run());
        UiTelemetry.tag(b, tag);
        return b;
    }

    private SharedPreferences prefs() { return getSharedPreferences(PREFS, MODE_PRIVATE); }

    private static String nz(String s) { return s == null ? "" : s; }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }
}

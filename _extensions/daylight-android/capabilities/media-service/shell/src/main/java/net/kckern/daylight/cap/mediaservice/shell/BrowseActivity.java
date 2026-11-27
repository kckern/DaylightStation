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
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final ExecutorService covers = Executors.newFixedThreadPool(2);
    private final PayloadMedia media = new PayloadMedia();
    private DaylightTheme t;
    private LinearLayout column, results;
    private TextView status;
    private String mode, parent, kind, title, subtitle, art, group;
    private final List<JSONObject> rows = new ArrayList<>();
    private int generation;
    private ListenableFuture<MediaController> pending;
    private MediaController controller;

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
        results = new LinearLayout(this);
        results.setOrientation(LinearLayout.VERTICAL);
        column.addView(results);
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
        covers.shutdownNow();
        if (pending != null) MediaController.releaseFuture(pending);
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
        results.removeAllViews();
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
        io.execute(() -> {
            JSONObject answer;
            try { answer = new JSONObject(media.lookup(q, WAIT_MS)); }
            catch (Exception failed) { answer = null; Log.w(TAG, "search failed: " + failed.getClass().getSimpleName()); }
            JSONObject a = answer;
            main.post(() -> { if (mine == generation && !isFinishing()) showResults(q, a); });
        });
    }

    private void showResults(String q, JSONObject answer) {
        results.removeAllViews();
        if (answer == null || !answer.optBoolean("ok", false)) {
            status.setText("Search isn't answering right now.");
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
        if (count == 0) {
            status.setText(offline ? "Searching this phone · nothing kept matches \"" + q + "\"." : "Nothing called \"" + q + "\". Try fewer words.");
            return;
        }
        status.setText(offline ? "Searching this phone" : "");
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
        try { draw(new JSONArray(cached), false, false); } catch (Exception ignored) { }
    }

    private void load(int page) {
        final int mine = ++generation;
        io.execute(() -> {
            JSONObject answer;
            try {
                answer = new JSONObject(MODE_LIBRARY.equals(mode) ? media.library(WAIT_MS) : media.browse(parent, page, 50, WAIT_MS));
            } catch (Exception failed) {
                answer = null;
                Log.w(TAG, "browse failed: " + failed.getClass().getSimpleName());
            }
            JSONObject a = answer;
            main.post(() -> { if (mine == generation && !isFinishing()) answered(a); });
        });
    }

    private void answered(JSONObject answer) {
        if (answer == null || !answer.optBoolean("ok", false)) {
            // Offline is a filter, not an error: the last answer stays on show, and with none
            // the page says this needs a connection and leads to what is on this phone.
            if (!rows.isEmpty()) { status.setText("Offline · showing the last answer"); return; }
            results.removeAllViews();
            status.setText("This needs a connection: it isn't kept on this phone.");
            LinearLayout ways = new LinearLayout(this);
            ways.addView(button("On this phone", "browse.offline_kept", () -> DownloadsActivity.open(this)));
            ways.addView(button("Retry", "browse.retry", () -> load(0)));
            results.addView(ways);
            return;
        }
        JSONArray items = answer.optJSONArray("items");
        boolean offline = answer.optBoolean("offline");
        prefs().edit().putString(cacheKey(), items == null ? "[]" : items.toString()).apply();
        draw(items == null ? new JSONArray() : items, offline, false);
    }

    private void draw(JSONArray items, boolean offline, boolean append) {
        if (!append) { results.removeAllViews(); rows.clear(); }
        status.setText(offline ? "Showing what's on this phone" : "");
        if (items.length() == 0 && !append) {
            status.setText(offline ? "Offline · nothing is kept on this phone yet."
                    : MODE_LIBRARY.equals(mode) ? "Nothing here yet." : "This is empty.");
            return;
        }
        for (int i = 0; i < items.length(); i++) {
            JSONObject n = items.optJSONObject(i);
            if (n == null) continue;
            rows.add(n);
            results.addView(row(n, null));
        }
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
        top.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
        h.addView(top);
        LinearLayout actions = new LinearLayout(this);
        actions.setPadding(0, dp(12), 0, 0);
        boolean book = kind.startsWith("book");
        actions.addView(button(book ? "Resume" : "Play", "browse.play", () -> play(parent, false)));
        if (!book) actions.addView(button("Shuffle", "browse.shuffle", () -> play(parent, true)));
        actions.addView(button("Play on…", "browse.play_on", () -> playOn(parent, title)));
        actions.addView(button("Keep", "browse.keep", () -> KeepFlow.start(this, parent)));
        h.addView(actions);
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
            more.setOnClickListener(v -> trackMenu(v, id, name));
            UiTelemetry.tag(more, "browse.track_menu");
            row.addView(more, new LinearLayout.LayoutParams(dp(44), dp(48)));
        }
        row.setOnClickListener(v -> {
            if (id.startsWith("m:")) { results.removeView(row); loadMore(id); }
            else if (browsable) {
                String k = rowKind.isEmpty() ? childKind(kind, id) : rowKind;
                UiTelemetry.tag(row, "browse.open");
                open(this, "level", id, k, name, sub, cover);
            } else if (playable) play(id, false);
        });
        UiTelemetry.tag(row, browsable ? "browse.row" : "browse.track");
        row.setContentDescription(name + (sub.isEmpty() ? "" : ", " + sub));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, dp(ROW_DP));
        row.setLayoutParams(lp);
        return row;
    }

    /** What a row opened from a level is: a library's authors or artists, their books or albums, a list source's playlists. */
    static String childKind(String parentKind, String id) {
        if (id.startsWith("s:") || id.startsWith("a:")) return "lists";
        switch (parentKind) {
            case "library-books": return "author";
            case "library": return "artist";
            case "author": return "book";
            case "artist": case "artists": return "album";
            case "lists": return "playlist";
            default: return "collection";
        }
    }

    /** A long level's next page, appended in place of its More row. */
    private void loadMore(String moreId) {
        final int mine = generation;
        io.execute(() -> {
            JSONObject answer;
            try { answer = new JSONObject(media.browse(moreId, 0, 50, WAIT_MS)); } catch (Exception e) { answer = null; }
            JSONObject a = answer;
            main.post(() -> {
                if (mine != generation || isFinishing()) return;
                if (a == null || !a.optBoolean("ok")) { Toast.makeText(this, "Can't reach home", Toast.LENGTH_SHORT).show(); return; }
                draw(a.optJSONArray("items") == null ? new JSONArray() : a.optJSONArray("items"), a.optBoolean("offline"), true);
            });
        });
    }

    private void trackMenu(View anchor, String id, String name) {
        PopupMenu menu = new PopupMenu(this, anchor);
        menu.getMenu().add(0, 1, 0, "Play here");
        menu.getMenu().add(0, 2, 0, "Play next");
        menu.getMenu().add(0, 3, 0, "Add to queue");
        menu.getMenu().add(0, 4, 0, "Play on…");
        menu.getMenu().add(0, 5, 0, "Keep on this phone");
        menu.setOnMenuItemClickListener(item -> {
            switch (item.getItemId()) {
                case 1: play(id, false); break;
                case 2: enqueue(id, true, name); break;
                case 3: enqueue(id, false, name); break;
                case 4: playOn(id, name); break;
                case 5: KeepFlow.start(this, id); break;
                default: break;
            }
            return true;
        });
        menu.show();
    }

    // ── playing ─────────────────────────────────────────────────────────────

    private void withController(java.util.function.Consumer<MediaController> then) {
        if (controller != null && controller.isConnected()) { then.accept(controller); return; }
        SessionToken token = new SessionToken(this, new ComponentName(this, DaylightMediaService.class));
        pending = new MediaController.Builder(this, token).buildAsync();
        final ListenableFuture<MediaController> mine = pending;
        mine.addListener(() -> {
            try { controller = mine.get(); then.accept(controller); }
            catch (Exception failed) { Toast.makeText(this, "Could not start playback", Toast.LENGTH_SHORT).show(); }
        }, main::post);
    }

    /** Plays here and opens Now playing. A container plays whole (a book resumes); a track plays from itself in its list. */
    private void play(String mediaId, boolean shuffle) {
        action(shuffle ? "shuffle" : "play");
        withController(c -> {
            c.setShuffleModeEnabled(shuffle);
            c.setMediaItem(new MediaItem.Builder().setMediaId(mediaId).build());
            c.prepare();
            c.play();
            startActivity(new Intent(this, NowPlayingActivity.class).putExtra(NowPlayingActivity.EXTRA_TARGET, NowPlayingActivity.LOCAL));
        });
    }

    private void enqueue(String mediaId, boolean next, String name) {
        action(next ? "play_next" : "add_to_queue");
        withController(c -> {
            MediaItem item = new MediaItem.Builder().setMediaId(mediaId).build();
            if (c.getMediaItemCount() == 0) { c.setMediaItem(item); c.prepare(); }
            else if (next) c.addMediaItem(c.getCurrentMediaItemIndex() + 1, item);
            else c.addMediaItem(item);
            Toast.makeText(this, (next ? "Plays next: " : "Added to the queue: ") + name, Toast.LENGTH_SHORT).show();
        });
    }

    /** Play on a screen: the live screens, then the screen's load (as the web's Play on). */
    private void playOn(String mediaId, String name) {
        action("play_on");
        io.execute(() -> {
            JSONArray screens;
            try { screens = new JSONObject(media.screens(6000)).optJSONArray("items"); } catch (Exception e) { screens = null; }
            JSONArray s = screens;
            main.post(() -> {
                if (isFinishing()) return;
                if (s == null || s.length() == 0) { Toast.makeText(this, "No screens to play on", Toast.LENGTH_SHORT).show(); return; }
                String[] labels = new String[s.length()];
                for (int i = 0; i < s.length(); i++) labels[i] = s.optJSONObject(i).optString("name");
                new AlertDialog.Builder(this, DaylightTheme.alert()).setTitle("Play on")
                        .setItems(labels, (d, which) -> startOn(s.optJSONObject(which).optString("id"), labels[which], mediaId, name))
                        .setNegativeButton("Cancel", null).show();
            });
        });
    }

    private void startOn(String device, String screenName, String mediaId, String name) {
        String contentId = mediaId.startsWith("c:") ? mediaId.substring(2) : mediaId.startsWith("p:") ? mediaId.substring(2).split("\\|")[0] : mediaId;
        boolean list = mediaId.startsWith("c:");
        Toast.makeText(this, "Starting " + name + " on " + screenName + "…", Toast.LENGTH_SHORT).show();
        io.execute(() -> {
            String line;
            try {
                JSONObject reply = new JSONObject(media.screenCommand(new JSONObject().put("op", "screen-command").put("device", device)
                        .put("command", "load").put(list ? "queue" : "play", contentId), 45_000));
                line = reply.optBoolean("accepted") ? "Playing on " + screenName : screenName + " could not start it";
            } catch (Exception e) {
                line = "Can't reach home";
            }
            String said = line;
            main.post(() -> { if (!isFinishing()) Toast.makeText(this, said, Toast.LENGTH_SHORT).show(); });
        });
    }

    // ── small parts ─────────────────────────────────────────────────────────

    private void action(String verb) {
        try { UiTelemetry.event("Browse", "browse.action", new JSONObject().put("verb", verb).put("kind", kind)); }
        catch (Exception ignored) { }
    }

    private void loadCover(ImageView into, String url, int px) {
        if (url == null || url.isEmpty()) return;
        covers.execute(() -> {
            Bitmap b = net.kckern.daylight.shellkit.PlaylistArtwork.load(url, px);
            if (b != null) main.post(() -> { if (!isDestroyed()) into.setImageBitmap(b); });
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

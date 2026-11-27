package net.kckern.daylight.cap.mediaservice.shell;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.MenuItem;
import android.view.View;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import net.kckern.daylight.shellkit.DaylightTheme;
import net.kckern.daylight.shellkit.DaylightTheme.Radius;
import net.kckern.daylight.shellkit.DaylightTheme.Type;
import net.kckern.daylight.shellkit.KeptIndex;
import net.kckern.daylight.shellkit.UiTelemetry;

import org.json.JSONObject;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * On this phone: everything kept, the room it takes ("1.2 GB kept · 4 GB limit · 15 GB free
 * on phone"), over-limit words, items largest first with their size and state (the spec's
 * words), and every action from where it is shown: Retry, Resume, Pause, Manage space, Use
 * mobile data once, Remove; Remove finished; Remove all (confirmed, with the total).
 *
 * <p>Also Android Settings' "Manage space" for this app (android:manageSpaceActivity), the
 * download notification's tap target, and the Play tab's Keep entry (extra "keep": a media id).
 * Not exported: Settings and this app open it.
 */
public final class DownloadsActivity extends Activity {
    static final String EXTRA_KEEP = "keep";
    /** Opens a kept group's Choose… sheet (the Play tab's group ⋮): the group's id, with "chooseKind" and "chooseTitle". */
    static final String EXTRA_CHOOSE = "choose";
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService covers = Executors.newSingleThreadExecutor();
    private final Runnable tick = this::fill;
    private DaylightTheme t;
    private LinearLayout column;

    static void open(Context c) {
        c.startActivity(new Intent(c, DownloadsActivity.class).addFlags(c instanceof Activity ? 0 : Intent.FLAG_ACTIVITY_NEW_TASK));
    }

    @Override protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        // Opened cold (Android Settings' Manage space, the notification): the payload answers
        // every action here, so it is started first.
        net.kckern.daylight.shellkit.ShellStart.ensure(this);
        t = DaylightTheme.of(this);
        setTitle("On this phone");
        if (getActionBar() != null) getActionBar().setDisplayHomeAsUpEnabled(true);
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(t.background);
        column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setPadding(dp(16), dp(12), dp(16), dp(24));
        scroll.addView(column);
        // The mini player below the list (shell-kit MiniPlayer), as on every browse screen.
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(t.background);
        page.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        mini = net.kckern.daylight.shellkit.MiniPlayer.attach(this, "Downloads");
        page.addView(mini.view(), new LinearLayout.LayoutParams(-1, -2));
        setContentView(page);
        UiTelemetry.event("Downloads", "keep.screen", new JSONObject());
        String keep = getIntent() == null ? null : getIntent().getStringExtra(EXTRA_KEEP);
        if (keep != null && !keep.isEmpty() && saved == null) KeepFlow.start(this, keep);
        if (saved == null) choose(getIntent());
    }

    private void choose(Intent i) {
        String gid = i == null ? null : i.getStringExtra(EXTRA_CHOOSE);
        if (gid == null || gid.isEmpty()) return;
        GroupKeepFlow.start(this, gid, i.getStringExtra("chooseKind"), i.getStringExtra("chooseTitle"));
    }

    /** Opened again while showing (a Keep from the Play tab, the notification): the new request is acted on. */
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String keep = intent == null ? null : intent.getStringExtra(EXTRA_KEEP);
        if (keep != null && !keep.isEmpty()) KeepFlow.start(this, keep);
        choose(intent);
    }

    @Override protected void onResume() {
        super.onResume();
        KeepStore.get(this).refresh();
        // Automatic keeps whose removal is due go now (a finished book's 24 h, 30 days unplayed).
        KeepStore.get(this).autoSweepSoon();
        fill();
    }

    @Override protected void onPause() {
        super.onPause();
        main.removeCallbacks(tick);
    }

    private net.kckern.daylight.shellkit.MiniPlayer mini;

    @Override protected void onStart() {
        super.onStart();
        mini.start();
    }

    @Override protected void onStop() {
        mini.stop();
        super.onStop();
    }

    /** What the top bar's ⋮ offers, from the last fill. */
    private boolean barFinished;
    private int barCount;
    private long barTotal;
    private static final int MENU_MORE = 1;

    @Override public boolean onCreateOptionsMenu(android.view.Menu menu) {
        if (barCount > 0) {
            MenuItem more = menu.add(0, MENU_MORE, 0, "More");
            android.graphics.drawable.Drawable d = getDrawable(net.kckern.daylight.shellkit.R.drawable.daylight_ic_more).mutate();
            d.setTint(t.inkMuted);
            more.setIcon(d);
            more.setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS);
        }
        return true;
    }

    /** The top bar's ⋮: Remove finished (when any is) and Remove all, in the item sheet. */
    private void barSheet() {
        KeepStore store = KeepStore.get(this);
        int count = barCount;
        long total = barTotal;
        net.kckern.daylight.shellkit.ItemSheet sheet = net.kckern.daylight.shellkit.ItemSheet.of(this, "Downloads")
                .heading("On this phone", count + (count == 1 ? " item" : " items") + " · " + KeptIndex.size(total));
        if (barFinished) sheet.destructive(net.kckern.daylight.shellkit.R.drawable.daylight_ic_check, "Remove finished", () -> confirm(
                "Remove finished books?", "Books you have finished are removed from this phone.",
                () -> store.removeFinished(this::say)));
        sheet.destructive(net.kckern.daylight.shellkit.R.drawable.daylight_ic_clear_all, "Remove all", () -> confirm(
                "Remove all " + count + (count == 1 ? " item" : " items") + "?",
                KeptIndex.size(total) + " is freed on this phone.", () -> store.removeAll("remove_all", this::say)));
        UiTelemetry.event("Downloads", "keep.bar_menu", new JSONObject());
        sheet.show();
    }

    @Override public boolean onOptionsItemSelected(MenuItem item) {
        if (item.getItemId() == MENU_MORE) { barSheet(); return true; }
        if (item.getItemId() == android.R.id.home) { finish(); return true; }
        return super.onOptionsItemSelected(item);
    }

    /** The room line, notices and Remove buttons, above the rows; rebuilt only when what they say changes. */
    private LinearLayout head;
    private LinearLayout rowsBox;
    private net.kckern.daylight.shellkit.KeyedRows<JSONObject> rows;
    private String headShown;
    private LinearLayout autoBox;
    private String autoShown;

    /**
     * Refreshes the screen in place: the top part is redrawn only when its words change,
     * rows are kept by content id and update their own words and buttons, and only rows
     * that came or went are added or removed. A press on Pause or Remove survives the
     * 2-second refresh while something downloads.
     */
    private void fill() {
        main.removeCallbacks(tick);
        if (isFinishing()) return;
        KeepStore store = KeepStore.get(this);
        JSONObject room = store.room();
        List<JSONObject> items = KeptIndex.read(getFilesDir());
        KeptIndex.largestFirst(items);
        // A kept artist or author is one group with its units under it (spec §3.11).
        List<JSONObject> shownRows = net.kckern.daylight.shellkit.KeptGroups.rows(items);
        if (head == null) {
            head = new LinearLayout(this);
            head.setOrientation(LinearLayout.VERTICAL);
            column.addView(head);
            rowsBox = new LinearLayout(this);
            rowsBox.setOrientation(LinearLayout.VERTICAL);
            column.addView(rowsBox);
            autoBox = new LinearLayout(this);
            autoBox.setOrientation(LinearLayout.VERTICAL);
            column.addView(autoBox);
            rows = new net.kckern.daylight.shellkit.KeyedRows<>(rowsBox, new net.kckern.daylight.shellkit.KeyedRows.Rows<JSONObject>() {
                @Override public String key(JSONObject k) { return net.kckern.daylight.shellkit.KeptGroups.key(k); }
                @Override public String signature(JSONObject k) { return k.toString(); }
                @Override public View create(JSONObject k) {
                    return isGroup(k) ? groupRow(KeepStore.get(DownloadsActivity.this), k) : row(KeepStore.get(DownloadsActivity.this), k);
                }
                @Override public View update(View row, JSONObject k) {
                    if (isGroup(k)) bindGroup(row, k);
                    else bind(KeepStore.get(DownloadsActivity.this), row, k);
                    return row;
                }
            });
        }
        boolean anyFinished = false;
        long total = 0;
        for (JSONObject k : items) { if (k.optBoolean("finished")) anyFinished = true; total += k.optLong("bytes"); }
        boolean restricted = KeepFlow.backgroundRestricted(this);
        String headNow = room.optString("room") + "|" + room.optString("over") + "|" + restricted + "|" + store.location
                + "|" + anyFinished + "|" + items.size() + "|" + total;
        if (!headNow.equals(headShown)) {
            headShown = headNow;
            fillHead(store, room, items.size(), total, anyFinished, restricted);
        }
        rows.show(shownRows);
        fillAuto(store.autoLogShown());
        boolean moving = false;
        for (JSONObject k : items) {
            String s = k.optString("state");
            if (KeptIndex.DOWNLOADING.equals(s) || KeptIndex.CHECKING.equals(s) || KeptIndex.REMOVING.equals(s)
                    || KeptIndex.UPDATING.equals(s) || KeptIndex.QUEUED.equals(s)) moving = true;
        }
        // Until the store has read the limit, refreshed each second so the room line is the real one.
        main.postDelayed(tick, !store.rulesKnown ? 1_000 : moving ? 2_000 : 10_000);
    }

    private void fillHead(KeepStore store, JSONObject room, int count, long total, boolean anyFinished, boolean restricted) {
        head.removeAllViews();
        head.addView(t.text(this, room.optString("room"), Type.BODY, t.ink, true));
        String over = room.optString("over");
        if (!over.isEmpty()) {
            TextView o = t.text(this, over, Type.LABEL, t.attention, false);
            o.setPadding(0, dp(4), 0, 0);
            head.addView(o);
        }
        if (restricted) {
            // Shown while it is true: downloads stop whenever the app is closed.
            TextView hint = t.text(this, "Downloads only run while the app is open: Android restricts it in the background.",
                    Type.LABEL, t.attention, false);
            hint.setPadding(0, dp(6), 0, 0);
            head.addView(hint);
            LinearLayout allow = new LinearLayout(this);
            allow.addView(button("Allow background use", "keep.allow_background", () -> KeepFlow.openBatterySettings(this)));
            head.addView(allow);
        }
        if (KeepRules.SD_MISSING.equals(store.location)) {
            head.addView(t.text(this, "On the SD card — not inserted. Nothing was deleted.", Type.LABEL, t.attention, false));
        }
        // Remove finished and Remove all are in the top bar's ⋮ (D12), not buttons here.
        barFinished = anyFinished;
        barCount = count;
        barTotal = total;
        invalidateOptionsMenu();
        if (count == 0) {
            TextView none = t.text(this, "Nothing is kept on this phone. Keep a book, an album or a playlist from Now playing's ⋮ or by "
                    + "pressing and holding it on the Play tab.", Type.LABEL, t.inkMuted, false);
            none.setPadding(0, dp(12), 0, 0);
            head.addView(none);
        }
    }

    /**
     * Automatic keeps not on the phone (spec §3.10): "Not kept automatically: needs room", and
     * the ones removed in the last 7 days ("Removed: finished") with Keep again (a manual keep,
     * its size shown first). Redrawn only when the list changes.
     */
    private void fillAuto(List<JSONObject> log) {
        String now = log.toString();
        if (now.equals(autoShown)) return;
        autoShown = now;
        autoBox.removeAllViews();
        if (log.isEmpty()) return;
        TextView heading = t.text(this, "Not on this phone", Type.LABEL, t.inkMuted, true);
        heading.setPadding(dp(4), dp(18), 0, dp(2));
        autoBox.addView(heading);
        for (JSONObject e : log) {
            String cid = e.optString("contentId");
            LinearLayout row = new LinearLayout(this);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setPadding(dp(10), dp(8), dp(4), dp(8));
            LinearLayout words = new LinearLayout(this);
            words.setOrientation(LinearLayout.VERTICAL);
            String title = TextUtils.isEmpty(e.optString("title")) ? "Kept item" : e.optString("title");
            words.addView(t.text(this, title, Type.BODY, t.ink, false));
            String line = AutoKeepLog.words(e);
            words.addView(t.text(this, line, Type.LABEL, skippedLine(e) ? t.attention : t.inkMuted, false));
            row.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
            boolean skipped = AutoKeepLog.SKIPPED.equals(e.optString("kind"));
            row.addView(link(skipped ? "Keep" : "Keep again", skipped ? "keep.auto.keep" : "keep.auto.keep_again",
                    () -> KeepFlow.start(this, "c:" + cid)));
            row.setContentDescription(title + ". " + line);
            autoBox.addView(row);
        }
    }

    private static boolean skippedLine(JSONObject e) { return AutoKeepLog.SKIPPED.equals(e.optString("kind")); }

    /** A row's views, so a refresh changes its words and buttons without a new view. */
    private static final class Row {
        ImageView cover;
        TextView name, state;
        /** The state's icon at the row's end (D12); an error's icon retries when tapped. */
        android.widget.ImageButton icon;
        String glyphShown;
        /** The row's kept item as last drawn: the ⋮ sheet reads it when opened. */
        JSONObject shown;
        /** What the row shows now: the buttons read it when pressed, so a refresh need not rebuild them. */
        String title = "";
        long size, frees = -1;
        boolean shared;
    }

    private static boolean isGroup(JSONObject k) {
        return net.kckern.daylight.shellkit.KeptGroups.GROUP.equals(k.optString(net.kckern.daylight.shellkit.KeptGroups.ROW));
    }

    private static boolean isUnit(JSONObject k) {
        return net.kckern.daylight.shellkit.KeptGroups.UNIT.equals(k.optString(net.kckern.daylight.shellkit.KeptGroups.ROW));
    }

    /** A group's views: its words change in place; its ⋮ reads them when pressed. */
    private static final class GroupRow {
        ImageView cover;
        TextView name, line;
        JSONObject shown;
    }

    /**
     * A kept artist or author: its name, "12 books · 4.2 GB", and a ⋮ with Choose… (the sheet
     * again, with what it holds checked) and "Remove all of <name>" (confirmed, with the total).
     * A flat row; its units follow, indented.
     */
    private View groupRow(KeepStore store, JSONObject g) {
        GroupRow h = new GroupRow();
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(4), dp(14), 0, dp(4));
        row.setMinimumHeight(dp(64));
        h.cover = new ImageView(this);
        h.cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
        h.cover.setClipToOutline(true);
        h.cover.setBackground(t.round(t.tile, Radius.SMALL));
        row.addView(h.cover, new LinearLayout.LayoutParams(dp(44), dp(44)));
        LinearLayout words = new LinearLayout(this);
        words.setOrientation(LinearLayout.VERTICAL);
        words.setPadding(dp(12), 0, 0, 0);
        h.name = t.text(this, "", Type.TITLE, t.ink, true);
        h.name.setMaxLines(1);
        h.name.setEllipsize(TextUtils.TruncateAt.END);
        words.addView(h.name);
        h.line = t.text(this, "", Type.LABEL, t.inkMuted, false);
        words.addView(h.line);
        row.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
        TextView more = t.text(this, "⋮", Type.TITLE, t.inkMuted, false);
        more.setGravity(Gravity.CENTER);
        more.setMinWidth(dp(48));
        more.setMinHeight(dp(48));
        more.setBackground(t.pressable(null));
        more.setOnClickListener(v -> groupMenu(store, v, h.shown));
        UiTelemetry.tag(more, "keep.group.menu");
        row.addView(more);
        row.setTag(h);
        UiTelemetry.tag(row, "keep.group.row");
        bindGroup(row, g);
        return row;
    }

    private void bindGroup(View row, JSONObject g) {
        GroupRow h = (GroupRow) row.getTag();
        h.shown = g;
        String title = TextUtils.isEmpty(g.optString("title")) ? "Kept group" : g.optString("title");
        h.name.setText(title);
        String line = net.kckern.daylight.shellkit.KeptGroups.line(g);
        h.line.setText(line);
        row.setContentDescription(title + ". " + line);
        String more = "More for " + title;
        View menu = ((LinearLayout) row).getChildAt(2);
        if (menu != null) menu.setContentDescription(more);
        loadCover(h.cover, g.optString("art"));
    }

    private void groupMenu(KeepStore store, View anchor, JSONObject g) {
        if (g == null) return;
        JSONObject grp = g.optJSONObject("group");
        String gid = grp == null ? "" : grp.optString("id");
        String title = TextUtils.isEmpty(g.optString("title")) ? "this group" : g.optString("title");
        net.kckern.daylight.shellkit.ItemSheet.of(this, "Downloads")
                .heading(title, GroupKeepRules.noun(g.optString("kind"), g.optInt("units")) + " · " + KeptIndex.size(g.optLong("bytes")))
                .row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_tune, "Choose…", () -> {
                    UiTelemetry.event("Downloads", "keep.group.choose", new JSONObject());
                    GroupKeepFlow.start(this, gid, g.optString("kind"), g.optString("title"));
                })
                .destructive(net.kckern.daylight.shellkit.R.drawable.daylight_ic_delete, "Remove all of " + title, () -> {
                    int n = g.optInt("units");
                    confirm("Remove all of " + title + "?", GroupKeepRules.noun(g.optString("kind"), n) + " · "
                                    + KeptIndex.size(g.optLong("bytes")) + ". Anything also kept on its own stays.",
                            () -> store.removeGroup(gid, this::say));
                })
                .show();
    }

    /**
     * A kept item as a flat row (D12): cover, name, its state in words, the state's icon, and a
     * ⋮ whose item sheet holds the verbs (Retry, Resume, Pause, Use mobile data once, Remove).
     * A tap on the row opens the same sheet.
     */
    private View row(KeepStore store, JSONObject k) {
        Row h = new Row();
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setMinimumHeight(dp(64));
        // A unit of a group sits under it, indented.
        row.setPadding(isUnit(k) ? dp(28) : dp(4), dp(6), 0, dp(6));
        row.setBackground(t.pressable(null));
        h.cover = new ImageView(this);
        h.cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
        h.cover.setClipToOutline(true);
        net.kckern.daylight.shellkit.CoverGlyph.behind(h.cover, t, net.kckern.daylight.shellkit.CoverGlyph.Kind.ALBUM, dp(48), t.radius(Radius.SMALL));
        row.addView(h.cover, new LinearLayout.LayoutParams(dp(48), dp(48)));
        LinearLayout text = new LinearLayout(this);
        text.setOrientation(LinearLayout.VERTICAL);
        text.setPadding(dp(12), 0, dp(4), 0);
        h.name = t.text(this, "", Type.BODY, t.ink, true);
        h.name.setMaxLines(1);
        h.name.setEllipsize(TextUtils.TruncateAt.END);
        text.addView(h.name);
        h.state = t.text(this, "", Type.LABEL, t.inkMuted, false);
        h.state.setMaxLines(2);
        text.addView(h.state);
        row.addView(text, new LinearLayout.LayoutParams(0, -2, 1));
        h.icon = new android.widget.ImageButton(this);
        h.icon.setBackground(t.pressable(DaylightTheme.round(0x00000000, dp(24))));
        h.icon.setScaleType(ImageView.ScaleType.CENTER);
        row.addView(h.icon, new LinearLayout.LayoutParams(dp(44), dp(48)));
        android.widget.ImageButton more = new android.widget.ImageButton(this);
        more.setImageResource(net.kckern.daylight.shellkit.R.drawable.daylight_ic_more);
        more.setImageTintList(android.content.res.ColorStateList.valueOf(t.inkMuted));
        more.setBackground(t.pressable(DaylightTheme.round(0x00000000, dp(24))));
        more.setScaleType(ImageView.ScaleType.CENTER);
        more.setOnClickListener(v -> rowSheet(KeepStore.get(this), h));
        UiTelemetry.tag(more, "keep.row.menu");
        row.addView(more, new LinearLayout.LayoutParams(dp(44), dp(48)));
        row.setOnClickListener(v -> rowSheet(KeepStore.get(this), h));
        UiTelemetry.tag(row, "keep.row");
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.topMargin = dp(2);
        row.setLayoutParams(lp);
        row.setTag(h);
        bind(store, row, k);
        return row;
    }

    /** One kept collection's words and state icon on its row (new or refreshed). The icon changes only with the state. */
    private void bind(KeepStore store, View row, JSONObject k) {
        Row h = (Row) row.getTag();
        String cid = k.optString("contentId");
        String title = TextUtils.isEmpty(k.optString("title")) ? "Kept item" : k.optString("title");
        String words = KeptIndex.describe(k);
        long size = Math.max(k.optLong("bytes"), k.optLong("expectedBytes"));
        h.name.setText(title);
        h.state.setText(words + (size > 0 && !words.contains("MB") && !words.contains("GB") ? " · " + KeptIndex.size(size) : ""));
        loadCover(h.cover, k.optString("art"));
        row.setContentDescription(title + ". " + words);
        h.title = title;
        h.size = size;
        h.frees = k.has("frees") ? k.optLong("frees") : -1;
        h.shared = k.optBoolean("shared");
        h.shown = k;
        View menu = ((LinearLayout) row).getChildAt(3);
        if (menu != null) menu.setContentDescription("More for " + title);
        KeepRowState.Glyph g = KeepRowState.glyph(k);
        if (g.name().equals(h.glyphShown)) return;
        h.glyphShown = g.name();
        int icon, tint;
        String said;
        switch (g) {
            case KEPT: icon = R.drawable.daylight_np_kept; tint = t.primary; said = "On this phone"; break;
            case MOVING: icon = R.drawable.daylight_np_downloading; tint = t.inkMuted; said = words; break;
            case PAUSED: icon = net.kckern.daylight.shellkit.R.drawable.daylight_mini_pause; tint = t.inkMuted; said = "Paused"; break;
            case ERROR: icon = net.kckern.daylight.shellkit.R.drawable.daylight_ic_replay; tint = t.attention; said = "Try again"; break;
            default: icon = R.drawable.daylight_np_downloading; tint = t.disabled; said = words; break;
        }
        h.icon.setImageResource(icon);
        h.icon.setImageTintList(android.content.res.ColorStateList.valueOf(tint));
        h.icon.setContentDescription(said);
        h.icon.setTooltipText(said);
        boolean acts = g == KeepRowState.Glyph.ERROR;
        h.icon.setClickable(acts);
        h.icon.setFocusable(acts);
        h.icon.setImportantForAccessibility(acts ? View.IMPORTANT_FOR_ACCESSIBILITY_YES : View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        h.icon.setOnClickListener(acts ? v -> { UiTelemetry.event("Downloads", "keep.retry", new JSONObject()); store.retry(cid, this::say); } : null);
    }

    /** A kept row's item sheet (D17): the item, then its verbs for its state, Remove last. */
    private void rowSheet(KeepStore store, Row h) {
        JSONObject k = h.shown;
        if (k == null) return;
        String cid = k.optString("contentId");
        boolean unit = isUnit(k);
        net.kckern.daylight.shellkit.ItemSheet sheet = net.kckern.daylight.shellkit.ItemSheet.of(this, "Downloads")
                .item(k.optString("art"), net.kckern.daylight.shellkit.CoverGlyph.Kind.ALBUM, h.title, "", h.state.getText().toString());
        for (KeepRowState.Verb v : KeepRowState.verbs(k)) {
            switch (v) {
                case RETRY: sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_replay, "Try again", () -> store.retry(cid, this::say)); break;
                case RESUME: sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_download, "Resume download", () -> { store.resume(cid); fill(); }); break;
                case PAUSE: sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_stop, "Pause download", () -> { store.pause(cid); fill(); }); break;
                case MOBILE_ONCE: sheet.row(net.kckern.daylight.shellkit.R.drawable.daylight_ic_download, "Use mobile data once", store::useMobileDataOnce); break;
                case REMOVE:
                    // What is really freed: only the tracks no other keep holds (shared copies stay).
                    sheet.destructive(net.kckern.daylight.shellkit.R.drawable.daylight_ic_delete, "Remove from this phone", () -> confirm("Remove " + h.title + "?",
                            GroupKeepRules.freedLine(h.frees >= 0 ? h.frees : h.size, h.shared) + (unit ? " The rest of the group stays." : ""),
                            () -> { if (unit) store.removeUnit(cid, this::say); else store.remove(cid, "remove", this::say); }));
                    break;
                default: break;
            }
        }
        UiTelemetry.event("Downloads", "keep.row.sheet", new JSONObject());
        sheet.show();
    }

    /** A cover seen before draws in this frame (the memory cache); others load off the main thread. */
    private void loadCover(ImageView into, String art) {
        if (art == null) art = "";
        if (art.equals(into.getTag())) return;
        into.setTag(art);
        into.setImageDrawable(null);
        if (art.isEmpty()) return;
        Bitmap hit = net.kckern.daylight.shellkit.PlaylistArtwork.cached(art, 160);
        if (hit != null) { into.setImageBitmap(hit); return; }
        final String url = art;
        covers.execute(() -> {
            Bitmap b = net.kckern.daylight.shellkit.PlaylistArtwork.load(url, 160);
            if (b != null) main.post(() -> { if (!isDestroyed() && url.equals(into.getTag())) into.setImageBitmap(b); });
        });
    }

    /** A secondary action as words (no pill, no accent text: rules 2 and 4). */
    private TextView button(String label, String tag, Runnable run) {
        TextView b = t.text(this, label, Type.LABEL, t.ink, true);
        b.setPadding(dp(4), dp(10), dp(14), dp(10));
        b.setBackground(t.pressable(null));
        b.setOnClickListener(v -> run.run());
        UiTelemetry.tag(b, tag);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, -2);
        lp.setMarginEnd(dp(8));
        b.setLayoutParams(lp);
        return b;
    }

    private TextView link(String label, String tag, Runnable run) {
        TextView b = t.text(this, label, Type.LABEL, t.ink, true);
        b.setPadding(dp(12), dp(8), dp(4), dp(4));
        b.setBackground(t.pressable(null));
        b.setOnClickListener(v -> run.run());
        UiTelemetry.tag(b, tag);
        return b;
    }

    private void confirm(String title, String message, Runnable yes) {
        new AlertDialog.Builder(this, DaylightTheme.alert()).setTitle(title).setMessage(message)
                .setPositiveButton("Remove", (d, w) -> yes.run()).setNegativeButton("Cancel", null).show();
    }

    private void say(String line) {
        if (isFinishing() || isDestroyed()) return;
        Toast.makeText(this, line, Toast.LENGTH_LONG).show();
        fill();
    }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    @Override protected void onDestroy() {
        mini.release();
        covers.shutdownNow();
        super.onDestroy();
    }
}

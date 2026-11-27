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
        setContentView(scroll);
        UiTelemetry.event("Downloads", "keep.screen", new JSONObject());
        String keep = getIntent() == null ? null : getIntent().getStringExtra(EXTRA_KEEP);
        if (keep != null && !keep.isEmpty() && saved == null) KeepFlow.start(this, keep);
    }

    /** Opened again while showing (a Keep from the Play tab, the notification): the new request is acted on. */
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String keep = intent == null ? null : intent.getStringExtra(EXTRA_KEEP);
        if (keep != null && !keep.isEmpty()) KeepFlow.start(this, keep);
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

    @Override public boolean onOptionsItemSelected(MenuItem item) {
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
                @Override public String key(JSONObject k) { return k.optString("contentId"); }
                @Override public String signature(JSONObject k) { return k.toString(); }
                @Override public View create(JSONObject k) { return row(KeepStore.get(DownloadsActivity.this), k); }
                @Override public View update(View row, JSONObject k) { bind(KeepStore.get(DownloadsActivity.this), row, k); return row; }
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
        rows.show(items);
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
        LinearLayout buttons = new LinearLayout(this);
        buttons.setPadding(0, dp(12), 0, dp(4));
        if (anyFinished) buttons.addView(button("Remove finished", "keep.remove_finished", () -> confirm(
                "Remove finished books?", "Books you have finished are removed from this phone.",
                () -> store.removeFinished(this::say))));
        if (count > 0) {
            buttons.addView(button("Remove all", "keep.remove_all", () -> confirm(
                    "Remove all " + count + (count == 1 ? " item" : " items") + "?",
                    KeptIndex.size(total) + " is freed on this phone.", () -> store.removeAll("remove_all", this::say))));
        }
        head.addView(buttons);
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
        LinearLayout actions;
        String actionsShown;
        /** What the row shows now: the buttons read it when pressed, so a refresh need not rebuild them. */
        String title = "";
        long size;
    }

    private View row(KeepStore store, JSONObject k) {
        Row h = new Row();
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.VERTICAL);
        row.setPadding(dp(10), dp(10), dp(10), dp(10));
        row.setBackground(t.round(t.surface, Radius.SMALL));
        LinearLayout top = new LinearLayout(this);
        top.setGravity(Gravity.CENTER_VERTICAL);
        h.cover = new ImageView(this);
        h.cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
        h.cover.setClipToOutline(true);
        h.cover.setBackground(t.round(t.tile, Radius.SMALL));
        top.addView(h.cover, new LinearLayout.LayoutParams(dp(52), dp(52)));
        LinearLayout text = new LinearLayout(this);
        text.setOrientation(LinearLayout.VERTICAL);
        text.setPadding(dp(12), 0, 0, 0);
        h.name = t.text(this, "", Type.BODY, t.ink, true);
        h.name.setMaxLines(2);
        h.name.setEllipsize(TextUtils.TruncateAt.END);
        text.addView(h.name);
        h.state = t.text(this, "", Type.LABEL, t.inkMuted, false);
        h.state.setMaxLines(2);
        text.addView(h.state);
        top.addView(text, new LinearLayout.LayoutParams(0, -2, 1));
        row.addView(top);
        h.actions = new LinearLayout(this);
        h.actions.setGravity(Gravity.END);
        row.addView(h.actions);
        UiTelemetry.tag(row, "keep.row");
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.topMargin = dp(8);
        row.setLayoutParams(lp);
        row.setTag(h);
        bind(store, row, k);
        return row;
    }

    /** One kept collection's words and buttons on its row (new or refreshed). Buttons are rebuilt only when they change. */
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
        String action = KeptIndex.action(k);
        String s = k.optString("state");
        // Buttons change with the state, never with a progress tick (a press on Pause survives it).
        String actionsNow = action + "|" + s;
        if (actionsNow.equals(h.actionsShown)) return;
        h.actionsShown = actionsNow;
        h.actions.removeAllViews();
        switch (action) {
            case "Retry": h.actions.addView(link("Retry", "keep.retry", () -> store.retry(cid, this::say))); break;
            case "Resume": h.actions.addView(link("Resume", "keep.resume", () -> { store.resume(cid); fill(); })); break;
            case "Manage space": break;   // this screen is where space is managed
            case "Use mobile data once": h.actions.addView(link("Use mobile data once", "keep.mobile_once", store::useMobileDataOnce)); break;
            default: break;
        }
        if (KeptIndex.DOWNLOADING.equals(s) || KeptIndex.QUEUED.equals(s) || KeptIndex.UPDATING.equals(s)) {
            h.actions.addView(link("Pause", "keep.pause", () -> { store.pause(cid); fill(); }));
        }
        if (!KeptIndex.REMOVING.equals(s) && !KeptIndex.CHECKING.equals(s)) {
            h.actions.addView(link("Remove", "keep.remove", () -> confirm("Remove " + h.title + "?",
                    (h.size > 0 ? KeptIndex.size(h.size) + " is freed on this phone." : "It is removed from this phone."),
                    () -> store.remove(cid, "remove", this::say))));
        }
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
        covers.shutdownNow();
        super.onDestroy();
    }
}

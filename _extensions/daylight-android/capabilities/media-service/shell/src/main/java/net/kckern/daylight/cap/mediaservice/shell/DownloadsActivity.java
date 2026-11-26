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

    @Override protected void onResume() {
        super.onResume();
        KeepStore.get(this).refresh();
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

    private void fill() {
        main.removeCallbacks(tick);
        if (isFinishing()) return;
        KeepStore store = KeepStore.get(this);
        JSONObject room = store.room();
        List<JSONObject> items = KeptIndex.read(getFilesDir());
        KeptIndex.largestFirst(items);
        column.removeAllViews();
        column.addView(t.text(this, room.optString("room"), Type.BODY, t.ink, true));
        String over = room.optString("over");
        if (!over.isEmpty()) {
            TextView o = t.text(this, over, Type.LABEL, t.attention, false);
            o.setPadding(0, dp(4), 0, 0);
            column.addView(o);
        }
        if (KeepFlow.backgroundRestricted(this)) {
            // Shown while it is true: downloads stop whenever the app is closed.
            TextView hint = t.text(this, "Downloads only run while the app is open: Android restricts it in the background.",
                    Type.LABEL, t.attention, false);
            hint.setPadding(0, dp(6), 0, 0);
            column.addView(hint);
            LinearLayout allow = new LinearLayout(this);
            allow.addView(button("Allow background use", "keep.allow_background", () -> KeepFlow.openBatterySettings(this)));
            column.addView(allow);
        }
        if (KeepRules.SD_MISSING.equals(store.location)) {
            column.addView(t.text(this, "On the SD card — not inserted. Nothing was deleted.", Type.LABEL, t.attention, false));
        }
        LinearLayout buttons = new LinearLayout(this);
        buttons.setPadding(0, dp(12), 0, dp(4));
        boolean anyFinished = false;
        long total = 0;
        for (JSONObject k : items) { if (k.optBoolean("finished")) anyFinished = true; total += k.optLong("bytes"); }
        if (anyFinished) buttons.addView(button("Remove finished", "keep.remove_finished", () -> confirm(
                "Remove finished books?", "Books you have finished are removed from this phone.",
                () -> store.removeFinished(this::say))));
        if (!items.isEmpty()) {
            long all = total;
            buttons.addView(button("Remove all", "keep.remove_all", () -> confirm(
                    "Remove all " + items.size() + (items.size() == 1 ? " item" : " items") + "?",
                    KeptIndex.size(all) + " is freed on this phone.", () -> store.removeAll("remove_all", this::say))));
        }
        column.addView(buttons);
        if (items.isEmpty()) {
            TextView none = t.text(this, "Nothing is kept on this phone. Keep a book, an album or a playlist from Now playing's ⋮ or by "
                    + "pressing and holding it on the Play tab.", Type.LABEL, t.inkMuted, false);
            none.setPadding(0, dp(12), 0, 0);
            column.addView(none);
        }
        boolean moving = false;
        for (JSONObject k : items) {
            column.addView(row(store, k));
            String s = k.optString("state");
            if (KeptIndex.DOWNLOADING.equals(s) || KeptIndex.CHECKING.equals(s) || KeptIndex.REMOVING.equals(s)
                    || KeptIndex.UPDATING.equals(s) || KeptIndex.QUEUED.equals(s)) moving = true;
        }
        main.postDelayed(tick, moving ? 2_000 : 10_000);
    }

    private View row(KeepStore store, JSONObject k) {
        String cid = k.optString("contentId");
        String title = TextUtils.isEmpty(k.optString("title")) ? "Kept item" : k.optString("title");
        String words = KeptIndex.describe(k);
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.VERTICAL);
        row.setPadding(dp(10), dp(10), dp(10), dp(10));
        row.setBackground(t.round(t.surface, Radius.SMALL));
        LinearLayout top = new LinearLayout(this);
        top.setGravity(Gravity.CENTER_VERTICAL);
        ImageView cover = new ImageView(this);
        cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
        cover.setClipToOutline(true);
        cover.setBackground(t.round(t.tile, Radius.SMALL));
        top.addView(cover, new LinearLayout.LayoutParams(dp(52), dp(52)));
        String art = k.optString("art");
        if (!art.isEmpty()) covers.execute(() -> {
            Bitmap b = net.kckern.daylight.shellkit.PlaylistArtwork.load(art, 160);
            if (b != null) main.post(() -> cover.setImageBitmap(b));
        });
        LinearLayout text = new LinearLayout(this);
        text.setOrientation(LinearLayout.VERTICAL);
        text.setPadding(dp(12), 0, 0, 0);
        TextView name = t.text(this, title, Type.BODY, t.ink, true);
        name.setMaxLines(2);
        name.setEllipsize(TextUtils.TruncateAt.END);
        text.addView(name);
        long size = Math.max(k.optLong("bytes"), k.optLong("expectedBytes"));
        TextView state = t.text(this, words + (size > 0 && !words.contains("MB") && !words.contains("GB") ? " · " + KeptIndex.size(size) : ""),
                Type.LABEL, t.inkMuted, false);
        state.setMaxLines(2);
        text.addView(state);
        top.addView(text, new LinearLayout.LayoutParams(0, -2, 1));
        row.addView(top);
        LinearLayout actions = new LinearLayout(this);
        actions.setGravity(Gravity.END);
        String action = KeptIndex.action(k);
        String s = k.optString("state");
        switch (action) {
            case "Retry": actions.addView(link("Retry", "keep.retry", () -> store.retry(cid, this::say))); break;
            case "Resume": actions.addView(link("Resume", "keep.resume", () -> { store.resume(cid); fill(); })); break;
            case "Manage space": break;   // this screen is where space is managed
            case "Use mobile data once": actions.addView(link("Use mobile data once", "keep.mobile_once", store::useMobileDataOnce)); break;
            default: break;
        }
        if (KeptIndex.DOWNLOADING.equals(s) || KeptIndex.QUEUED.equals(s) || KeptIndex.UPDATING.equals(s)) {
            actions.addView(link("Pause", "keep.pause", () -> { store.pause(cid); fill(); }));
        }
        if (!KeptIndex.REMOVING.equals(s) && !KeptIndex.CHECKING.equals(s)) {
            actions.addView(link("Remove", "keep.remove", () -> confirm("Remove " + title + "?",
                    (size > 0 ? KeptIndex.size(size) + " is freed on this phone." : "It is removed from this phone."),
                    () -> store.remove(cid, "remove", this::say))));
        }
        row.addView(actions);
        row.setContentDescription(title + ". " + words);
        UiTelemetry.tag(row, "keep.row");
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.topMargin = dp(8);
        row.setLayoutParams(lp);
        return row;
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

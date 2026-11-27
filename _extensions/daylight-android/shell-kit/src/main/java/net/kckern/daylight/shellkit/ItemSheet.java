package net.kckern.daylight.shellkit;

import android.app.Activity;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.view.Gravity;
import android.view.View;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * The one item sheet for every long-press and ⋮ in the phone app (design sweep D17), in
 * place of Android's PopupMenu: a modal bottom sheet ({@link BottomSheet}) that starts with
 * the item itself (its cover or kind glyph, title, by-line and state, such as "Kept
 * automatically · 79 MB" or "34 % · 2 h left"), then rows with a 24 dp icon and a label,
 * then, after a divider, the destructive rows in the error colour. The verbs are the
 * caller's (by kind, MediaKind §8); the sheet only lays them out ({@link SheetRows}).
 */
public final class ItemSheet {
    private final Activity activity;
    private final String screen;
    private final BottomSheet sheet;
    private final DaylightTheme t;
    private final List<SheetRows.Row> rows = new ArrayList<>();
    private View header;
    private View extra;

    public static ItemSheet of(Activity a, String screen) { return new ItemSheet(a, screen); }

    private ItemSheet(Activity a, String screen) {
        this.activity = a;
        this.screen = screen;
        sheet = new BottomSheet(a);
        t = sheet.theme();
    }

    /** The item at the top: cover (or the kind's glyph), title, by-line, state. */
    public ItemSheet item(String coverUrl, CoverGlyph.Kind kind, String title, String byline, String state) {
        LinearLayout row = new LinearLayout(activity);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(20), dp(4), dp(20), dp(12));
        ImageView cover = new ImageView(activity);
        cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
        CoverGlyph.behind(cover, t, kind == null ? CoverGlyph.Kind.ALBUM : kind, dp(56), dp(8));
        row.addView(cover, new LinearLayout.LayoutParams(dp(56), dp(56)));
        loadCover(cover, coverUrl);
        LinearLayout words = new LinearLayout(activity);
        words.setOrientation(LinearLayout.VERTICAL);
        words.setPadding(dp(16), 0, 0, 0);
        TextView name = t.text(activity, title == null ? "" : title, DaylightTheme.Type.TITLE, t.ink, true);
        name.setMaxLines(2);
        name.setEllipsize(android.text.TextUtils.TruncateAt.END);
        name.setAccessibilityHeading(true);
        words.addView(name);
        if (byline != null && !byline.isEmpty()) words.addView(line(byline));
        if (state != null && !state.isEmpty()) words.addView(line(state));
        row.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
        header = row;
        return this;
    }

    /** A heading with no cover (a sheet about this screen, not an item). */
    public ItemSheet heading(String title, String byline) {
        LinearLayout col = new LinearLayout(activity);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(dp(20), dp(4), dp(20), dp(12));
        TextView name = t.text(activity, title, DaylightTheme.Type.TITLE, t.ink, true);
        name.setAccessibilityHeading(true);
        col.addView(name);
        if (byline != null && !byline.isEmpty()) col.addView(line(byline));
        header = col;
        return this;
    }

    /** A view of the caller's under the header, before the rows (Save as playlist's name field). */
    public ItemSheet body(View v) { extra = v; return this; }

    public ItemSheet row(int icon, String label, Runnable run) { return row(icon, label, null, run); }

    public ItemSheet row(int icon, String label, String detail, Runnable run) {
        rows.add(new SheetRows.Row(icon, label, detail, false, run));
        return this;
    }

    /** A destructive row: drawn last, after a divider, in the error colour. */
    public ItemSheet destructive(int icon, String label, Runnable run) {
        rows.add(new SheetRows.Row(icon, label, null, true, run));
        return this;
    }

    public boolean isEmpty() { return rows.isEmpty(); }

    public void show() {
        LinearLayout body = sheet.body();
        if (header != null) body.addView(header);
        View rule = divider();
        if (header != null) body.addView(rule);
        if (extra != null) body.addView(extra);
        for (SheetRows.Slot s : SheetRows.layout(rows)) body.addView(s.divider() ? divider() : rowView(s.row));
        event("sheet.open", rows.size());
        sheet.show();
    }

    public void dismiss() { sheet.dismiss(); }

    private View rowView(SheetRows.Row r) {
        LinearLayout v = new LinearLayout(activity);
        v.setGravity(Gravity.CENTER_VERTICAL);
        v.setPadding(dp(20), 0, dp(20), 0);
        v.setMinimumHeight(dp(52));
        v.setBackground(t.pressable(null));
        int color = r.destructive ? t.danger : t.ink;
        ImageView icon = new ImageView(activity);
        icon.setImageResource(r.icon);
        icon.setImageTintList(ColorStateList.valueOf(r.destructive ? t.danger : t.inkMuted));
        v.addView(icon, new LinearLayout.LayoutParams(dp(24), dp(24)));
        LinearLayout words = new LinearLayout(activity);
        words.setOrientation(LinearLayout.VERTICAL);
        words.setPadding(dp(20), dp(10), 0, dp(10));
        words.addView(t.text(activity, r.label, DaylightTheme.Type.BODY, color, false));
        if (!r.detail.isEmpty()) words.addView(line(r.detail));
        v.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
        v.setContentDescription(r.detail.isEmpty() ? r.label : r.label + ", " + r.detail);
        UiTelemetry.tag(v, "sheet." + r.label.toLowerCase(java.util.Locale.ROOT).replaceAll("[^a-z]+", "-"));
        v.setOnClickListener(x -> {
            sheet.dismiss();
            if (r.run != null) r.run.run();
        });
        return v;
    }

    private TextView line(String s) {
        TextView v = t.text(activity, s, DaylightTheme.Type.LABEL, t.inkMuted, false);
        v.setMaxLines(2);
        v.setEllipsize(android.text.TextUtils.TruncateAt.END);
        return v;
    }

    private View divider() {
        View d = new View(activity);
        d.setBackgroundColor(t.outline);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, Math.max(1, dp(1) / 2));
        lp.topMargin = dp(4);
        lp.bottomMargin = dp(4);
        d.setLayoutParams(lp);
        return d;
    }

    private void loadCover(ImageView into, String url) {
        if (url == null || url.isEmpty()) return;
        Bitmap hit = PlaylistArtwork.cachedAny(url, 160);
        if (hit != null) { into.setImageBitmap(hit); return; }
        new Thread(() -> {
            Bitmap b = PlaylistArtwork.load(url, 160);
            if (b != null) activity.runOnUiThread(() -> { if (!activity.isDestroyed()) into.setImageBitmap(b); });
        }, "item-sheet-cover").start();
    }

    private void event(String name, int count) {
        try { UiTelemetry.event(screen, name, new JSONObject().put("screen", screen).put("rows", count)); }
        catch (Exception ignored) { }
    }

    private int dp(int v) { return Math.round(v * activity.getResources().getDisplayMetrics().density); }
}

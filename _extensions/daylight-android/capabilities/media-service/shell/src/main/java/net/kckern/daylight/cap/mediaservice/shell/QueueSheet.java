package net.kckern.daylight.cap.mediaservice.shell;

import android.app.Activity;
import android.app.Dialog;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import net.kckern.daylight.shellkit.DaylightTheme;
import net.kckern.daylight.shellkit.DaylightTheme.Type;
import net.kckern.daylight.shellkit.UiTelemetry;

import java.util.ArrayList;
import java.util.List;

/**
 * A minimal item sheet for the queue's rows and its ⋮ (design sweep D17): a modal bottom
 * sheet with a scrim, a drag handle, the item itself first (cover, title, by-line), then
 * rows of a 24 dp icon and a label, the destructive ones last after a divider in the error
 * colour. Back, a tap on the scrim or a swipe down closes it. Built to the shape of the
 * shared ItemSheet (media-kinds), so the merge can swap this for that one.
 */
final class QueueSheet {
    static final class Action {
        final int icon;
        final String label;
        final boolean destructive;
        final String tag;
        final Runnable run;
        Action(int icon, String label, boolean destructive, String tag, Runnable run) {
            this.icon = icon; this.label = label; this.destructive = destructive; this.tag = tag; this.run = run;
        }
    }

    private final Activity activity;
    private final String title, byLine;
    private final Bitmap cover;
    private final List<Action> actions = new ArrayList<>();
    private View extra;

    QueueSheet(Activity activity, String title, String byLine, Bitmap cover) {
        this.activity = activity;
        this.title = title == null ? "" : title;
        this.byLine = byLine == null ? "" : byLine;
        this.cover = cover;
    }

    QueueSheet add(int icon, String label, String tag, Runnable run) { actions.add(new Action(icon, label, false, tag, run)); return this; }
    QueueSheet destructive(int icon, String label, String tag, Runnable run) { actions.add(new Action(icon, label, true, tag, run)); return this; }
    /** A view under the header (Save as playlist's name field). */
    QueueSheet extra(View v) { extra = v; return this; }

    Dialog show() {
        DaylightTheme t = DaylightTheme.of(activity);
        float d = activity.getResources().getDisplayMetrics().density;
        Dialog dialog = new Dialog(activity);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        LinearLayout sheet = new LinearLayout(activity);
        sheet.setOrientation(LinearLayout.VERTICAL);
        sheet.setPadding(0, (int) (8 * d), 0, (int) (16 * d));
        android.graphics.drawable.GradientDrawable bg = new android.graphics.drawable.GradientDrawable();
        bg.setColor(t.surface);
        float r = t.radius(DaylightTheme.Radius.MEDIUM);
        bg.setCornerRadii(new float[] { r, r, r, r, 0, 0, 0, 0 });
        sheet.setBackground(bg);

        View handle = new View(activity);
        handle.setBackground(t.round(t.outline, 2 * d));
        LinearLayout.LayoutParams hl = new LinearLayout.LayoutParams((int) (32 * d), (int) (4 * d));
        hl.gravity = Gravity.CENTER_HORIZONTAL;
        hl.setMargins(0, 0, 0, (int) (12 * d));
        sheet.addView(handle, hl);

        if (!title.isEmpty()) {
            LinearLayout head = new LinearLayout(activity);
            head.setGravity(Gravity.CENTER_VERTICAL);
            head.setPadding((int) (16 * d), 0, (int) (16 * d), (int) (12 * d));
            if (cover != null) {
                ImageView c = new ImageView(activity);
                c.setImageBitmap(cover);
                c.setScaleType(ImageView.ScaleType.CENTER_CROP);
                c.setBackground(t.round(t.surfaceVariant, DaylightTheme.Radius.SMALL));
                c.setClipToOutline(true);
                LinearLayout.LayoutParams cl = new LinearLayout.LayoutParams((int) (48 * d), (int) (48 * d));
                cl.setMargins(0, 0, (int) (12 * d), 0);
                head.addView(c, cl);
            }
            LinearLayout words = new LinearLayout(activity);
            words.setOrientation(LinearLayout.VERTICAL);
            TextView tt = t.text(activity, title, Type.TITLE, t.ink, true);
            tt.setMaxLines(2);
            tt.setEllipsize(TextUtils.TruncateAt.END);
            words.addView(tt);
            if (!byLine.isEmpty()) {
                TextView by = t.text(activity, byLine, Type.LABEL, t.inkMuted, false);
                by.setMaxLines(1);
                by.setEllipsize(TextUtils.TruncateAt.END);
                words.addView(by);
            }
            head.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
            sheet.addView(head);
        }
        if (extra != null) sheet.addView(extra);
        boolean dividerDone = false;
        for (Action a : actions) {
            if (a.destructive && !dividerDone) {
                View line = new View(activity);
                line.setBackgroundColor(DaylightTheme.withAlpha(t.outline, 0x55));
                LinearLayout.LayoutParams ll = new LinearLayout.LayoutParams(-1, Math.max(1, (int) d));
                ll.setMargins(0, (int) (4 * d), 0, (int) (4 * d));
                sheet.addView(line, ll);
                dividerDone = true;
            }
            sheet.addView(row(t, d, a, dialog));
        }

        // Swipe down closes it.
        final float[] down = { 0 };
        sheet.setOnTouchListener((v, e) -> {
            if (e.getActionMasked() == MotionEvent.ACTION_DOWN) { down[0] = e.getRawY(); return true; }
            if (e.getActionMasked() == MotionEvent.ACTION_MOVE) { v.setTranslationY(Math.max(0, e.getRawY() - down[0])); return true; }
            if (e.getActionMasked() == MotionEvent.ACTION_UP || e.getActionMasked() == MotionEvent.ACTION_CANCEL) {
                if (v.getTranslationY() > 80 * d) dialog.dismiss();
                else v.animate().translationY(0).setDuration(120).start();
                return true;
            }
            return false;
        });

        dialog.setContentView(sheet);
        dialog.setCanceledOnTouchOutside(true);
        Window w = dialog.getWindow();
        if (w != null) {
            w.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            w.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            w.setGravity(Gravity.BOTTOM);
            w.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
            w.setDimAmount(0.4f);
            w.setWindowAnimations(android.R.style.Animation_InputMethod);
        }
        dialog.show();
        return dialog;
    }

    private View row(DaylightTheme t, float d, Action a, Dialog dialog) {
        LinearLayout row = new LinearLayout(activity);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setMinimumHeight((int) (52 * d));
        row.setPadding((int) (16 * d), 0, (int) (16 * d), 0);
        row.setBackground(t.pressable(null));
        int color = a.destructive ? t.danger : t.ink;
        ImageView icon = new ImageView(activity);
        if (a.icon != 0) icon.setImageResource(a.icon);
        icon.setImageTintList(ColorStateList.valueOf(a.destructive ? t.danger : t.inkMuted));
        LinearLayout.LayoutParams il = new LinearLayout.LayoutParams((int) (24 * d), (int) (24 * d));
        il.setMargins(0, 0, (int) (20 * d), 0);
        row.addView(icon, il);
        row.addView(t.text(activity, a.label, Type.BODY, color, false), new LinearLayout.LayoutParams(0, -2, 1));
        row.setContentDescription(a.label);
        if (a.tag != null) UiTelemetry.tag(row, a.tag);
        row.setOnClickListener(v -> { dialog.dismiss(); a.run.run(); });
        return row;
    }
}

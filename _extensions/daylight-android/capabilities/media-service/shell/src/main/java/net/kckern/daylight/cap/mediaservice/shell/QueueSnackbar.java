package net.kckern.daylight.cap.mediaservice.shell;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import net.kckern.daylight.shellkit.DaylightTheme;
import net.kckern.daylight.shellkit.DaylightTheme.Type;
import net.kckern.daylight.shellkit.UiTelemetry;

/**
 * One line at the bottom naming where a queue verb put the item, with Undo for 6 s
 * (spec §2). Drawn in the tap's own frame, so it is up in well under 100 ms. One at a
 * time per screen: a new one replaces the last.
 */
final class QueueSnackbar {
    static final long SHOW_MS = 6_000;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private QueueSnackbar() { }

    static void show(Activity activity, String text, Runnable undo) {
        if (activity == null || activity.isFinishing()) return;
        ViewGroup root = activity.findViewById(android.R.id.content);
        if (!(root instanceof FrameLayout)) return;
        View old = root.findViewWithTag(QueueSnackbar.class);
        if (old != null) root.removeView(old);
        DaylightTheme t = DaylightTheme.of(activity);
        float d = activity.getResources().getDisplayMetrics().density;
        LinearLayout bar = new LinearLayout(activity);
        bar.setTag(QueueSnackbar.class);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackground(t.round(t.dark ? t.surfaceVariant : t.ink, DaylightTheme.Radius.SMALL));
        bar.setElevation(6 * d);
        bar.setPadding((int) (16 * d), (int) (6 * d), (int) (8 * d), (int) (6 * d));
        bar.setMinimumHeight((int) (48 * d));
        TextView words = t.text(activity, text, Type.BODY, t.dark ? t.ink : t.background, false);
        words.setMaxLines(2);
        words.setEllipsize(TextUtils.TruncateAt.END);
        bar.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
        Runnable remove = () -> { if (bar.getParent() == root) root.removeView(bar); };
        if (undo != null) {
            TextView action = t.text(activity, "Undo", Type.LABEL, t.dark ? t.ink : t.background, true);
            action.setPadding((int) (12 * d), (int) (12 * d), (int) (12 * d), (int) (12 * d));
            action.setBackground(t.pressable(null));
            action.setContentDescription("Undo");
            UiTelemetry.tag(action, "queue.undo");
            action.setOnClickListener(v -> { remove.run(); undo.run(); });
            bar.addView(action);
        }
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM);
        int side = (int) (16 * d);
        lp.setMargins(side, 0, side, (int) (24 * d));
        root.addView(bar, lp);
        bar.setAlpha(0f);
        bar.setTranslationY(16 * d);
        bar.animate().alpha(1f).translationY(0).setDuration(120).start();
        MAIN.postDelayed(() -> {
            if (bar.getParent() != root) return;
            bar.animate().alpha(0f).setDuration(150).withEndAction(remove).start();
        }, SHOW_MS);
    }
}

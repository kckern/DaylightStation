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
import android.widget.ProgressBar;
import android.widget.TextView;

import net.kckern.daylight.shellkit.DaylightTheme;
import net.kckern.daylight.shellkit.DaylightTheme.Type;
import net.kckern.daylight.shellkit.UiTelemetry;

import java.lang.ref.WeakReference;
import java.util.function.Consumer;

/**
 * A keep in progress, inline at the bottom of the screen it was asked on (audit H12):
 * "Checking size of Paradise Lost… · Cancel", then its outcome ("Keeping Paradise Lost on
 * this phone · 412 MB") for a few seconds. It draws {@link KeepStore.Attempt}, which the
 * store owns: closing the screen removes the line, never the keep. Cancel is offered only
 * while the size is checked.
 */
final class KeepBar {
    static final long OUTCOME_MS = 6_000;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private KeepBar() { }

    static void show(Activity activity, KeepStore.Attempt attempt) {
        if (activity == null || activity.isFinishing()) return;
        KeepStore store = KeepStore.get(activity);
        WeakReference<Activity> screen = new WeakReference<>(activity);
        Consumer<KeepStore.Attempt>[] self = new Consumer[1];
        self[0] = a -> {
            Activity now = screen.get();
            if (now == null || now.isFinishing() || now.isDestroyed()) { store.removeAttemptListener(self[0]); return; }
            if (a != attempt) return;
            draw(now, store, a);
            if (a.done) {
                store.removeAttemptListener(self[0]);
                MAIN.postDelayed(() -> { Activity s = screen.get(); if (s != null) hide(s, a); }, OUTCOME_MS);
            }
        };
        store.addAttemptListener(self[0]);
        draw(activity, store, attempt);
    }

    private static void hide(Activity activity, KeepStore.Attempt a) {
        ViewGroup root = activity.findViewById(android.R.id.content);
        if (root == null) return;
        View bar = root.findViewWithTag(KeepBar.class);
        if (bar != null && bar.getTag(R.id.daylight_keep_bar_attempt) == a) {
            bar.animate().alpha(0f).setDuration(150).withEndAction(() -> root.removeView(bar)).start();
        }
    }

    private static void draw(Activity activity, KeepStore store, KeepStore.Attempt a) {
        ViewGroup root = activity.findViewById(android.R.id.content);
        if (!(root instanceof FrameLayout)) return;
        View old = root.findViewWithTag(KeepBar.class);
        if (old != null) root.removeView(old);
        DaylightTheme t = DaylightTheme.of(activity);
        float d = activity.getResources().getDisplayMetrics().density;
        int fg = t.dark ? t.ink : t.background;
        LinearLayout bar = new LinearLayout(activity);
        bar.setTag(KeepBar.class);
        bar.setTag(R.id.daylight_keep_bar_attempt, a);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackground(t.round(t.dark ? t.surfaceVariant : t.ink, DaylightTheme.Radius.SMALL));
        bar.setElevation(6 * d);
        bar.setPadding((int) (16 * d), (int) (6 * d), (int) (8 * d), (int) (6 * d));
        bar.setMinimumHeight((int) (48 * d));
        bar.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        if (a.checking && !a.done) {
            ProgressBar spin = new ProgressBar(activity);
            spin.setIndeterminate(true);
            spin.setIndeterminateTintList(android.content.res.ColorStateList.valueOf(t.primary));
            LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams((int) (20 * d), (int) (20 * d));
            sp.rightMargin = (int) (12 * d);
            bar.addView(spin, sp);
        }
        TextView words = t.text(activity, a.line, Type.BODY, fg, false);
        words.setMaxLines(2);
        words.setEllipsize(TextUtils.TruncateAt.END);
        bar.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
        if (a.checking && !a.done) {
            TextView cancel = t.text(activity, "Cancel", Type.LABEL, fg, true);
            cancel.setPadding((int) (12 * d), (int) (12 * d), (int) (12 * d), (int) (12 * d));
            cancel.setBackground(t.pressable(null));
            cancel.setContentDescription("Cancel keeping " + (a.title.isEmpty() ? "this" : a.title));
            UiTelemetry.tag(cancel, "keep.cancel");
            cancel.setOnClickListener(v -> store.cancel(a.mediaId));
            bar.addView(cancel);
        }
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM);
        int side = (int) (16 * d);
        // Above a bottom bar or mini player when the screen has one.
        lp.setMargins(side, 0, side, (int) (96 * d));
        root.addView(bar, lp);
    }
}

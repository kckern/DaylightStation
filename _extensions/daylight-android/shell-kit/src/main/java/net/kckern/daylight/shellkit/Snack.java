package net.kckern.daylight.shellkit;

import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * A line at the bottom of a screen with one action ("Removed from Continue listening ·
 * Undo"), gone after its time. One at a time: a new one replaces the one showing. The
 * platform has no snackbar without the Material library, which these builds do not carry.
 */
public final class Snack {
    private Snack() { }

    /** Shows {@code text} over the bottom of {@code host} for {@code ms}; {@code action} runs {@code then} and closes it. */
    public static void show(FrameLayout host, DaylightTheme t, String text, String action, Runnable then, long ms) {
        View old = host.findViewWithTag("daylight.snack");
        if (old != null) host.removeView(old);
        float d = host.getResources().getDisplayMetrics().density;
        LinearLayout bar = new LinearLayout(host.getContext());
        bar.setTag("daylight.snack");
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(Math.round(16 * d), Math.round(6 * d), Math.round(8 * d), Math.round(6 * d));
        bar.setBackground(DaylightTheme.round(t.ink, 8 * d));
        TextView said = t.text(host.getContext(), text, DaylightTheme.Type.BODY, t.background, false);
        bar.addView(said, new LinearLayout.LayoutParams(0, -2, 1));
        if (action != null) {
            TextView act = t.text(host.getContext(), action, DaylightTheme.Type.LABEL, t.background, true);
            act.setPadding(Math.round(12 * d), Math.round(12 * d), Math.round(12 * d), Math.round(12 * d));
            act.setOnClickListener(v -> { host.removeView(bar); if (then != null) then.run(); });
            UiTelemetry.tag(act, "snack.action");
            bar.addView(act);
        }
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM);
        int m = Math.round(12 * d);
        lp.setMargins(m, m, m, m);
        host.addView(bar, lp);
        bar.setAlpha(0f);
        bar.animate().alpha(1f).setDuration(150).start();
        bar.announceForAccessibility(text);
        bar.postDelayed(() -> { if (bar.getParent() == host) bar.animate().alpha(0f).setDuration(150).withEndAction(() -> host.removeView(bar)).start(); }, ms);
    }
}

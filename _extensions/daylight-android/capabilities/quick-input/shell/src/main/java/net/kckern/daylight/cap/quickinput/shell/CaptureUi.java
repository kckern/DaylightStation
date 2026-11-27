package net.kckern.daylight.cap.quickinput.shell;

import android.content.Context;
import android.view.Gravity;
import android.widget.TextView;

import net.kckern.daylight.shellkit.DaylightTheme;
import net.kckern.daylight.shellkit.DaylightTheme.Radius;
import net.kckern.daylight.shellkit.DaylightTheme.Type;

/**
 * The parts the capture screens share, drawn in the app theme (shell-kit DaylightTheme):
 * one big primary button, quiet links, and the line every capture ends with. Colors and
 * type come from the theme, so the screens follow dark mode and a device's overrides.
 */
final class CaptureUi {
    private CaptureUi() { }

    /** How long a saved capture's screen waits to see it reach home before it closes. */
    static final long OUTCOME_WAIT_MS = 6_000;
    /** How long the settled line stays up before the screen closes. */
    static final long OUTCOME_HOLD_MS = 1_600;

    /**
     * What every capture says once it is saved (audit H15), inline over the screen's own
     * buttons: "Saved · sending to Journal…", then "Sent to Journal" when home has it, or
     * "Saved · sends when home answers". It reads the payload's state for {@code draftId}
     * (the inbox file's id) every half second for up to {@link #OUTCOME_WAIT_MS}, then
     * holds the last line briefly and runs {@code close}. Back closes at once; the capture
     * is already saved and Capture status keeps following it.
     */
    static void saved(android.app.Activity a, String draftId, String owner, Runnable close) {
        DaylightTheme t = DaylightTheme.of(a);
        android.view.ViewGroup root = a.findViewById(android.R.id.content);
        if (!(root instanceof android.widget.FrameLayout)) { close.run(); return; }
        android.widget.LinearLayout panel = new android.widget.LinearLayout(a);
        panel.setOrientation(android.widget.LinearLayout.VERTICAL);
        panel.setBackgroundColor(t.background);
        panel.setElevation(dp(a, 8));
        panel.setPadding(dp(a, 20), dp(a, 20), dp(a, 20), dp(a, 28));
        panel.setClickable(true);   // the Send under it cannot be pressed twice
        panel.setAccessibilityLiveRegion(android.view.View.ACCESSIBILITY_LIVE_REGION_POLITE);
        TextView line = text(a, CaptureOutcome.saving("").line, Type.TITLE, t.ink, true);
        TextView where = text(a, "Capture status shows where it is", Type.LABEL, t.inkMuted, false);
        panel.addView(line);
        panel.addView(where);
        // Over the screen's whole button area (Send and the links under it), so no edge of
        // a button shows above it: from the bottom up to the end of the typed or recorded content.
        panel.setGravity(Gravity.BOTTOM);
        root.addView(panel, new android.widget.FrameLayout.LayoutParams(-1, Math.max(dp(a, 200), root.getHeight() / 3), Gravity.BOTTOM));
        net.kckern.daylight.shellkit.UiTelemetry.event("Capture", "capture.saved", new org.json.JSONObject());
        android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
        long until = android.os.SystemClock.uptimeMillis() + OUTCOME_WAIT_MS;
        boolean[] closed = { false };
        Runnable finish = () -> { if (!closed[0]) { closed[0] = true; close.run(); } };
        java.util.concurrent.ExecutorService worker = java.util.concurrent.Executors.newSingleThreadExecutor();
        Runnable[] poll = new Runnable[1];
        poll[0] = () -> worker.execute(() -> {
            String state = null, destination = "";
            try {
                org.json.JSONObject reply = new org.json.JSONObject(net.kckern.daylight.api.PayloadPort.named(MemoFiles.PORT)
                        .call(new org.json.JSONObject().put("op", "status").put("owner", owner).toString(), 2_000));
                org.json.JSONArray rows = reply.optJSONArray("inputs");
                for (int i = 0; rows != null && i < rows.length(); i++) {
                    org.json.JSONObject row = rows.optJSONObject(i);
                    if (row != null && row.optString("id").equals(draftId)) {
                        state = row.optString("state");
                        destination = row.optString("destination");
                    }
                }
            } catch (Exception notYet) { /* the payload is busy or starting: asked again */ }
            String s = state, d = destination;
            main.post(() -> {
                if (closed[0] || a.isFinishing() || a.isDestroyed()) { worker.shutdown(); return; }
                boolean over = android.os.SystemClock.uptimeMillis() >= until;
                CaptureOutcome o = CaptureOutcome.of(s, d, net.kckern.daylight.shellkit.FailureWords.networkValidated(a), over);
                line.setText(o.line);
                if (o.settled) {
                    worker.shutdown();
                    net.kckern.daylight.shellkit.UiTelemetry.event("Capture", o.sent ? "capture.sent_seen" : "capture.saved_waiting",
                            new org.json.JSONObject());
                    main.postDelayed(finish, OUTCOME_HOLD_MS);
                } else {
                    main.postDelayed(poll[0], 500);
                }
            });
        });
        poll[0].run();
    }

    static int dp(Context context, int value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }

    static TextView text(Context context, String value, Type type, int color, boolean bold) {
        return DaylightTheme.of(context).text(context, value, type, color, bold);
    }

    /**
     * The screen's one primary action (rule 1, D10): full width, filled in the accent, an
     * 8 dp rectangle (not a pill), at the bottom of the screen.
     */
    static TextView primary(Context context, String label) {
        DaylightTheme t = DaylightTheme.of(context);
        TextView button = t.text(context, label, Type.BODY, t.onPrimary, true);
        button.setGravity(Gravity.CENTER);
        button.setMinHeight(dp(context, 52));
        button.setBackground(t.pressable(t.round(t.primary, Radius.SMALL)));
        button.setClickable(true);
        button.setFocusable(true);
        return button;
    }

    /** A secondary action as words with no fill or frame (Retry, Replace): ink, never the accent. */
    static TextView textButton(Context context, String label) {
        DaylightTheme t = DaylightTheme.of(context);
        TextView button = t.text(context, label, Type.LABEL, t.ink, true);
        button.setGravity(Gravity.CENTER);
        button.setMinHeight(dp(context, 48));
        button.setPadding(dp(context, 12), 0, dp(context, 12), 0);
        button.setBackground(t.pressable(null));
        button.setClickable(true);
        button.setFocusable(true);
        return button;
    }

    /**
     * A choice chip (the one place a pill belongs, rule 2): where a share goes. Selected is
     * a soft accent fill with ink text; the others an outline.
     */
    static TextView chip(Context context, String label, boolean selected) {
        DaylightTheme t = DaylightTheme.of(context);
        TextView chip = t.text(context, label, Type.LABEL, t.ink, selected);
        chip.setGravity(Gravity.CENTER);
        chip.setMinHeight(dp(context, 40));
        chip.setPadding(dp(context, 16), 0, dp(context, 16), 0);
        styleChip(context, chip, selected);
        chip.setClickable(true);
        chip.setFocusable(true);
        return chip;
    }

    static void styleChip(Context context, TextView chip, boolean selected) {
        DaylightTheme t = DaylightTheme.of(context);
        android.graphics.drawable.GradientDrawable shape = new android.graphics.drawable.GradientDrawable();
        shape.setCornerRadius(dp(context, 20));
        if (selected) shape.setColor(net.kckern.daylight.shellkit.ThemeColors.mix(t.background, t.primary, t.dark ? 0.35 : 0.22));
        else { shape.setColor(0x00000000); shape.setStroke(dp(context, 1), t.outline); }
        chip.setBackground(t.pressable(shape));
        chip.setSelected(selected);
        chip.setTypeface(null, selected ? android.graphics.Typeface.BOLD : android.graphics.Typeface.NORMAL);
    }

    /** Quiet text for what is not the point of the screen. */
    static TextView link(Context context, String label) {
        DaylightTheme t = DaylightTheme.of(context);
        // Quiet: muted ink (the accent is kept for the primary, rule 4).
        TextView link = t.text(context, label, Type.LABEL, t.inkMuted, true);
        link.setGravity(Gravity.CENTER);
        link.setMinHeight(dp(context, 48));
        link.setPadding(dp(context, 16), 0, dp(context, 16), 0);
        link.setClickable(true);
        link.setFocusable(true);
        return link;
    }
}

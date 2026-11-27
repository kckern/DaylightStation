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

    /** What every capture says once it is on its way: brief, and where to look afterwards. */
    static void sent(Context context) {
        android.widget.Toast.makeText(context.getApplicationContext(), "Sent ✓  Review it under Capture status",
                android.widget.Toast.LENGTH_SHORT).show();
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

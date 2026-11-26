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

    /** A full-width pill: filled primary when primary, a soft tint when not. */
    static TextView pill(Context context, String label, boolean primary) {
        DaylightTheme t = DaylightTheme.of(context);
        TextView button = t.text(context, label, Type.BODY, primary ? t.onPrimary : t.primary, true);
        button.setGravity(Gravity.CENTER);
        button.setMinHeight(dp(context, 52));
        button.setBackground(t.pressable(t.round(primary ? t.primary : t.surfaceVariant, Radius.LARGE)));
        button.setClickable(true);
        button.setFocusable(true);
        return button;
    }

    /** Quiet text for what is not the point of the screen. */
    static TextView link(Context context, String label) {
        DaylightTheme t = DaylightTheme.of(context);
        TextView link = t.text(context, label, Type.LABEL, t.primary, true);
        link.setGravity(Gravity.CENTER);
        link.setMinHeight(dp(context, 48));
        link.setPadding(dp(context, 16), 0, dp(context, 16), 0);
        link.setClickable(true);
        link.setFocusable(true);
        return link;
    }
}

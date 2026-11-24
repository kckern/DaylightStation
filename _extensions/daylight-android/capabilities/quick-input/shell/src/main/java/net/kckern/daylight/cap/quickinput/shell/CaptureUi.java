package net.kckern.daylight.cap.quickinput.shell;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.widget.TextView;

/**
 * The look of the capture screens: the app's green on a light paper, rounded shapes, one big
 * primary button and quiet secondary text. The same palette as the setup screen and the pickers.
 */
final class CaptureUi {
    static final int INK = 0xff14382f, GREEN = 0xff125b47, PAPER = 0xfff4f7f4, CHIP = 0xffe2ebe6;

    private CaptureUi() { }

    /** What every capture says once it is on its way: brief, and where to look afterwards. */
    static void sent(Context context) {
        android.widget.Toast.makeText(context.getApplicationContext(), "Sent ✓  Review it under Capture status",
                android.widget.Toast.LENGTH_SHORT).show();
    }

    static int dp(Context context, int value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }

    static GradientDrawable round(Context context, int color, int radiusDp) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(color);
        shape.setCornerRadius(dp(context, radiusDp));
        return shape;
    }

    static TextView text(Context context, String value, int sp, int color, boolean bold) {
        TextView view = new TextView(context);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(color);
        if (bold) view.setTypeface(Typeface.DEFAULT_BOLD);
        return view;
    }

    /** A full-width pill: filled green when primary, a soft tint when not. */
    static TextView pill(Context context, String label, boolean primary) {
        TextView button = text(context, label, 16, primary ? Color.WHITE : GREEN, true);
        button.setGravity(Gravity.CENTER);
        button.setMinHeight(dp(context, 52));
        button.setBackground(round(context, primary ? GREEN : CHIP, 26));
        button.setClickable(true);
        button.setFocusable(true);
        return button;
    }

    /** Quiet text for what is not the point of the screen. */
    static TextView link(Context context, String label) {
        TextView link = text(context, label, 14, GREEN, true);
        link.setGravity(Gravity.CENTER);
        link.setMinHeight(dp(context, 48));
        link.setPadding(dp(context, 16), 0, dp(context, 16), 0);
        link.setClickable(true);
        link.setFocusable(true);
        return link;
    }
}

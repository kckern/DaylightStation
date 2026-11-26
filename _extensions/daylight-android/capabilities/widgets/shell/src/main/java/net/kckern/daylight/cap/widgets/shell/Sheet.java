package net.kckern.daylight.cap.widgets.shell;

import android.app.Activity;
import android.app.Dialog;
import android.graphics.Color;
import android.graphics.Outline;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.ViewOutlineProvider;
import android.view.Window;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.function.Consumer;

/**
 * A bottom sheet in the app's own look, instead of the system's plain dialog: a cover with
 * a title, switch rows, and rounded buttons. Built from parts so a screen only says what
 * the sheet holds.
 */
final class Sheet {
    enum Style { PRIMARY, TONAL, DANGER }

    private final Activity activity;
    private final Dialog dialog;
    private final LinearLayout body;

    Sheet(Activity activity) {
        this.activity = activity;
        dialog = new Dialog(activity);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        body = new LinearLayout(activity);
        body.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(20);
        body.setPadding(pad, dp(12), pad, dp(20));
        float radius = dp(24);
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(PlaylistPicker.COLOR_PAPER);
        shape.setCornerRadii(new float[]{radius, radius, radius, radius, 0, 0, 0, 0});
        body.setBackground(shape);
        // The grab bar says it is a sheet.
        View grab = new View(activity);
        grab.setBackground(PlaylistPicker.round(0x33000000, 2, activity));
        LinearLayout.LayoutParams grabParams = new LinearLayout.LayoutParams(dp(40), dp(4));
        grabParams.gravity = Gravity.CENTER_HORIZONTAL;
        grabParams.bottomMargin = dp(16);
        body.addView(grab, grabParams);
        dialog.setContentView(body);
        Window window = dialog.getWindow();
        window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        window.setGravity(Gravity.BOTTOM);
        window.setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.WRAP_CONTENT);
        window.setDimAmount(0.45f);
        window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        dialog.setCanceledOnTouchOutside(true);
    }

    private int dp(int value) {
        return PlaylistPicker.dp(activity, value);
    }

    /** A cover, a title and a line under it. The cover loads in the background. */
    Sheet header(String id, String art, String title, String subtitle) {
        LinearLayout row = new LinearLayout(activity);
        row.setGravity(Gravity.CENTER_VERTICAL);
        FrameLayout frame = new FrameLayout(activity);
        ImageView cover = new ImageView(activity);
        cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
        cover.setBackgroundColor(PlaylistPicker.COLOR_TILE);
        frame.addView(cover, new FrameLayout.LayoutParams(-1, -1));
        TextView note = PlaylistPicker.text(activity, "♪", 26, 0x88125b47, false);
        note.setGravity(Gravity.CENTER);
        frame.addView(note, new FrameLayout.LayoutParams(-1, -1));
        float radius = dp(14);
        frame.setOutlineProvider(new ViewOutlineProvider() {
            @Override public void getOutline(View view, Outline outline) {
                outline.setRoundRect(0, 0, view.getWidth(), view.getHeight(), radius);
            }
        });
        frame.setClipToOutline(true);
        row.addView(frame, new LinearLayout.LayoutParams(dp(72), dp(72)));
        LinearLayout text = new LinearLayout(activity);
        text.setOrientation(LinearLayout.VERTICAL);
        text.setPadding(dp(16), 0, 0, 0);
        TextView heading = PlaylistPicker.text(activity, title, 20, PlaylistPicker.COLOR_INK, true);
        heading.setMaxLines(2);
        heading.setEllipsize(android.text.TextUtils.TruncateAt.END);
        if (android.os.Build.VERSION.SDK_INT >= 28) heading.setAccessibilityHeading(true); // API 28; the phone floor is 26
        text.addView(heading);
        if (subtitle != null && !subtitle.isEmpty()) {
            TextView sub = PlaylistPicker.text(activity, subtitle, 13, PlaylistPicker.COLOR_GREEN, false);
            text.addView(sub);
        }
        row.addView(text, new LinearLayout.LayoutParams(0, -2, 1));
        LinearLayout.LayoutParams rowParams = new LinearLayout.LayoutParams(-1, -2);
        rowParams.bottomMargin = dp(8);
        body.addView(row, rowParams);
        PlaylistPicker.bindCover(cover, note, id, art);
        return this;
    }

    /** A plain heading, for a sheet with no cover. */
    Sheet heading(String title, String subtitle) {
        TextView heading = PlaylistPicker.text(activity, title, 20, PlaylistPicker.COLOR_INK, true);
        if (android.os.Build.VERSION.SDK_INT >= 28) heading.setAccessibilityHeading(true); // API 28; the phone floor is 26
        body.addView(heading);
        if (subtitle != null && !subtitle.isEmpty()) {
            TextView sub = PlaylistPicker.text(activity, subtitle, 14, PlaylistPicker.COLOR_INK, false);
            sub.setAlpha(0.75f);
            sub.setPadding(0, dp(4), 0, dp(4));
            body.addView(sub);
        }
        return this;
    }

    /** A numbered step on a white card. */
    Sheet step(int number, String text) {
        LinearLayout card = new LinearLayout(activity);
        card.setGravity(Gravity.CENTER_VERTICAL);
        card.setPadding(dp(14), dp(12), dp(14), dp(12));
        card.setBackground(PlaylistPicker.round(Color.WHITE, 16, activity));
        TextView badge = PlaylistPicker.text(activity, String.valueOf(number), 14, Color.WHITE, true);
        badge.setGravity(Gravity.CENTER);
        badge.setBackground(PlaylistPicker.round(PlaylistPicker.COLOR_GREEN, 14, activity));
        card.addView(badge, new LinearLayout.LayoutParams(dp(28), dp(28)));
        TextView words = PlaylistPicker.text(activity, text, 15, PlaylistPicker.COLOR_INK, false);
        words.setPadding(dp(14), 0, 0, 0);
        card.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.topMargin = dp(8);
        body.addView(card, params);
        return this;
    }

    /** A line of explanation. */
    Sheet note(String text) {
        if (text == null || text.isEmpty()) return this;
        TextView view = PlaylistPicker.text(activity, text, 13, PlaylistPicker.COLOR_INK, false);
        view.setAlpha(0.75f);
        view.setPadding(0, dp(4), 0, dp(4));
        body.addView(view);
        return this;
    }

    /** A labelled switch on a white card. */
    Sheet toggle(String label, String hint, boolean on, Consumer<Boolean> changed) {
        LinearLayout card = new LinearLayout(activity);
        card.setGravity(Gravity.CENTER_VERTICAL);
        card.setPadding(dp(16), dp(12), dp(12), dp(12));
        card.setBackground(PlaylistPicker.round(Color.WHITE, 16, activity));
        LinearLayout text = new LinearLayout(activity);
        text.setOrientation(LinearLayout.VERTICAL);
        text.addView(PlaylistPicker.text(activity, label, 16, PlaylistPicker.COLOR_INK, true));
        if (hint != null && !hint.isEmpty()) {
            TextView h = PlaylistPicker.text(activity, hint, 12, PlaylistPicker.COLOR_INK, false);
            h.setAlpha(0.65f);
            text.addView(h);
        }
        card.addView(text, new LinearLayout.LayoutParams(0, -2, 1));
        Toggle toggle = new Toggle(activity, on);
        toggle.onChange(changed);
        card.addView(toggle);
        card.setOnClickListener(v -> toggle.toggle());
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.topMargin = dp(8);
        body.addView(card, params);
        return this;
    }

    Sheet button(String label, Style style, Runnable action) {
        TextView button = PlaylistPicker.text(activity, label, 16, Color.WHITE, true);
        button.setGravity(Gravity.CENTER);
        int fill;
        if (style == Style.PRIMARY) {
            fill = PlaylistPicker.COLOR_GREEN;
        } else if (style == Style.TONAL) {
            fill = PlaylistPicker.COLOR_CHIP;
            button.setTextColor(PlaylistPicker.COLOR_GREEN);
        } else {
            fill = 0x00000000;
            button.setTextColor(0xffb3261e);
        }
        button.setBackground(PlaylistPicker.round(fill, 26, activity));
        button.setOnClickListener(v -> {
            dialog.dismiss();
            action.run();
        });
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(52));
        params.topMargin = dp(10);
        body.addView(button, params);
        return this;
    }

    /** Runs when the sheet goes away, however it goes. */
    Sheet onDismiss(Runnable action) {
        dialog.setOnDismissListener(d -> action.run());
        return this;
    }

    void show() {
        dialog.show();
    }
}

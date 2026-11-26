package net.kckern.daylight.cap.widgets.shell;

import android.app.Activity;
import android.app.Dialog;
import android.graphics.Outline;
import android.view.Gravity;
import android.view.View;
import android.view.ViewOutlineProvider;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import net.kckern.daylight.shellkit.DaylightTheme;
import net.kckern.daylight.shellkit.DaylightTheme.Radius;
import net.kckern.daylight.shellkit.DaylightTheme.Type;
import net.kckern.daylight.shellkit.DrivingRadioSettings;

/**
 * Which playlist Driving Radio plays, as a default and one rule per weekday. Each row shows
 * the day, the playlist's cover and its name; a tap opens the picker, with a button to go
 * back to the default (or to turn the default off).
 */
final class DrivingRadioScreen {
    private DrivingRadioScreen() {}

    static void show(Activity activity) {
        DrivingRadioSettings radio = new DrivingRadioSettings(activity);
        DaylightTheme t = DaylightTheme.of(activity);
        Dialog dialog = new Dialog(activity, net.kckern.daylight.shellkit.R.style.Theme_Daylight);
        LinearLayout root = new LinearLayout(activity);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(t.background);

        LinearLayout bar = new LinearLayout(activity);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        TextView back = PlaylistPicker.glyph(activity, "‹", 30, t.ink);
        back.setGravity(Gravity.CENTER);
        back.setContentDescription("Back");
        back.setOnClickListener(v -> dialog.dismiss());
        bar.addView(back, PlaylistPicker.dp(activity, 56), PlaylistPicker.dp(activity, 56));
        bar.addView(PlaylistPicker.text(activity, "Driving Radio", Type.HEADLINE, t.ink, true));
        root.addView(bar, new LinearLayout.LayoutParams(-1, -2));

        TextView explain = PlaylistPicker.text(activity,
                "Starts by itself when Android Auto connects. Pick a playlist for the default, "
                        + "and a different one for any day.", Type.LABEL, t.inkMuted, false);
        explain.setPadding(PlaylistPicker.dp(activity, 20), 0, PlaylistPicker.dp(activity, 20), PlaylistPicker.dp(activity, 12));
        root.addView(explain);

        ScrollView scroll = new ScrollView(activity);
        scroll.setVerticalScrollBarEnabled(false);
        LinearLayout rows = new LinearLayout(activity);
        rows.setOrientation(LinearLayout.VERTICAL);
        rows.setPadding(PlaylistPicker.dp(activity, 16), 0, PlaylistPicker.dp(activity, 16), PlaylistPicker.dp(activity, 24));
        scroll.addView(rows);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));

        Runnable[] draw = new Runnable[1];
        draw[0] = () -> {
            rows.removeAllViews();
            String[] days = new java.text.DateFormatSymbols().getWeekdays();
            days[0] = "Default";
            for (int day = 0; day < days.length; day++) {
                rows.addView(row(activity, radio, day, days, dialog, draw[0]));
            }
        };
        draw[0].run();

        dialog.setContentView(root);
        dialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        dialog.show();
    }

    private static View row(Activity activity, DrivingRadioSettings radio, int day, String[] days,
                            Dialog parent, Runnable redraw) {
        String id = radio.get(day);
        String title = null;
        String art = "";
        for (DrivingRadioSettings.Staple staple : radio.staged()) {
            if (staple.id.equals(id)) { title = staple.title; art = staple.art; }
        }
        boolean none = id.isEmpty();
        DaylightTheme t = DaylightTheme.of(activity);

        LinearLayout card = new LinearLayout(activity);
        card.setGravity(Gravity.CENTER_VERTICAL);
        card.setPadding(PlaylistPicker.dp(activity, 14), PlaylistPicker.dp(activity, 10), PlaylistPicker.dp(activity, 14), PlaylistPicker.dp(activity, 10));
        card.setBackground(t.round(t.surface, Radius.MEDIUM));
        card.setContentDescription(days[day] + ": " + (none ? (day == 0 ? "off" : "uses the default") : title));

        TextView name = PlaylistPicker.text(activity, days[day], Type.BODY, t.ink, true);
        card.addView(name, new LinearLayout.LayoutParams(PlaylistPicker.dp(activity, 96), -2));

        FrameLayout frame = new FrameLayout(activity);
        ImageView cover = new ImageView(activity);
        cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
        cover.setBackgroundColor(t.tile);
        frame.addView(cover, new FrameLayout.LayoutParams(-1, -1));
        TextView note = PlaylistPicker.glyph(activity, none ? "–" : "♪", 20, DaylightTheme.withAlpha(t.primary, 0x88));
        note.setGravity(Gravity.CENTER);
        frame.addView(note, new FrameLayout.LayoutParams(-1, -1));
        float radius = t.radius(Radius.SMALL);
        frame.setOutlineProvider(new ViewOutlineProvider() {
            @Override public void getOutline(View view, Outline outline) {
                outline.setRoundRect(0, 0, view.getWidth(), view.getHeight(), radius);
            }
        });
        frame.setClipToOutline(true);
        card.addView(frame, new LinearLayout.LayoutParams(PlaylistPicker.dp(activity, 52), PlaylistPicker.dp(activity, 52)));
        if (!none) PlaylistPicker.bindCover(cover, note, id, art);

        TextView value = PlaylistPicker.text(activity,
                none ? (day == 0 ? "Off" : "Same as default") : title, Type.BODY,
                none ? t.inkMuted : t.ink, !none);
        value.setPadding(PlaylistPicker.dp(activity, 14), 0, 0, 0);
        value.setMaxLines(2);
        value.setEllipsize(android.text.TextUtils.TruncateAt.END);
        card.addView(value, new LinearLayout.LayoutParams(0, -2, 1));
        card.addView(PlaylistPicker.glyph(activity, "›", 24, t.primary));

        card.setOnClickListener(v -> {
            String previous = radio.get(day);
            String clear = day == 0 ? "Turn Driving Radio off" : "Use the default";
            PlaylistPicker.show(activity, days[day], previous.isEmpty() ? null : clear,
                    previous.isEmpty() ? null : () -> {
                        radio.set(day, "");
                        radio.forgetIfUnused(previous);
                        redraw.run();
                    },
                    entry -> {
                        radio.remember(entry.id, entry.title, entry.art);
                        radio.set(day, entry.id);
                        if (!previous.isEmpty() && !previous.equals(entry.id)) radio.forgetIfUnused(previous);
                        PlaylistPicker.cacheCover(activity, entry.id, entry.art);
                        redraw.run();
                    });
        });
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.topMargin = PlaylistPicker.dp(activity, 8);
        card.setLayoutParams(params);
        return card;
    }
}

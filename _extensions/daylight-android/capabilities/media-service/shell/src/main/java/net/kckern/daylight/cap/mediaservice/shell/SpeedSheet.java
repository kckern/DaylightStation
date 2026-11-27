package net.kckern.daylight.cap.mediaservice.shell;

import android.app.Activity;
import android.content.res.ColorStateList;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.TextView;

import net.kckern.daylight.shellkit.BottomSheet;
import net.kckern.daylight.shellkit.DaylightTheme;
import net.kckern.daylight.shellkit.DaylightTheme.Type;

import java.util.function.Consumer;

/**
 * The speed sheet (design sweep D19), one component for Now playing's speed button and the
 * book page's Speed action: a compact card over the button, under half the screen. The
 * current value large ("1.5×"); a slider from 0.5× to 3× in 0.05 steps between − and +
 * (0.1 each), with a haptic tick at each quarter; five presets as plain text (the current
 * one in ink and checked, never pills); for a long item the footnote "For this book ·
 * remembered". Every change applies at once ({@code apply}); there is no OK. A tap outside
 * or a swipe down closes it. The arithmetic is {@link SpeedSteps}.
 */
final class SpeedSheet {
    private final Activity a;
    private final BottomSheet sheet;
    private final DaylightTheme t;
    private final Consumer<Float> apply;
    private final TextView value;
    private final SeekBar slider;
    private final TextView[] presets = new TextView[SpeedSteps.PRESETS.length];
    private float speed;
    private boolean setting;

    static SpeedSheet show(Activity a, View anchor, float current, boolean longItem, Consumer<Float> apply) {
        SpeedSheet s = new SpeedSheet(a, anchor, current, longItem, apply);
        s.sheet.show();
        return s;
    }

    private SpeedSheet(Activity a, View anchor, float current, boolean longItem, Consumer<Float> apply) {
        this.a = a;
        this.apply = apply;
        sheet = new BottomSheet(a);
        if (anchor != null) sheet.anchorAbove(anchor);
        t = sheet.theme();
        speed = LongForm.clampSpeed(current);
        LinearLayout body = sheet.body();
        body.setPadding(dp(20), 0, dp(20), dp(4));

        value = t.text(a, "", Type.DISPLAY, t.ink, true);
        value.setGravity(Gravity.CENTER);
        value.setFontFeatureSettings("tnum");
        value.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        body.addView(value, new LinearLayout.LayoutParams(-1, -2));

        LinearLayout row = new LinearLayout(a);
        row.setGravity(Gravity.CENTER_VERTICAL);
        ImageButton minus = round(net.kckern.daylight.shellkit.R.drawable.daylight_ic_minus, "Slower");
        minus.setOnClickListener(v -> set(SpeedSteps.nudge(speed, -1), v));
        row.addView(minus, new LinearLayout.LayoutParams(dp(48), dp(48)));
        slider = new SeekBar(a);
        slider.setMax(SpeedSteps.MAX_INDEX);
        slider.setProgressTintList(ColorStateList.valueOf(t.primary));
        slider.setThumbTintList(ColorStateList.valueOf(t.primary));
        slider.setProgressBackgroundTintList(ColorStateList.valueOf(t.outline));
        slider.setContentDescription("Speed");
        slider.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar s, int p, boolean user) { if (user && !setting) set(SpeedSteps.at(p), s); }
            @Override public void onStartTrackingTouch(SeekBar s) { }
            @Override public void onStopTrackingTouch(SeekBar s) { }
        });
        row.addView(slider, new LinearLayout.LayoutParams(0, dp(48), 1));
        ImageButton plus = round(net.kckern.daylight.shellkit.R.drawable.daylight_ic_plus, "Faster");
        plus.setOnClickListener(v -> set(SpeedSteps.nudge(speed, 1), v));
        row.addView(plus, new LinearLayout.LayoutParams(dp(48), dp(48)));
        LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(-1, -2);
        rp.topMargin = dp(4);
        body.addView(row, rp);

        LinearLayout marks = new LinearLayout(a);
        for (int i = 0; i < presets.length; i++) {
            final int k = i;
            LinearLayout target = new LinearLayout(a);
            target.setOrientation(LinearLayout.VERTICAL);
            target.setGravity(Gravity.CENTER);
            target.setMinimumHeight(dp(56));
            target.setBackground(t.pressable(null));
            TextView label = t.text(a, SpeedSteps.presetLabel(i), Type.BODY, t.inkMuted, false);
            label.setGravity(Gravity.CENTER);
            presets[i] = label;
            target.addView(label);
            String note = SpeedSteps.presetNote(i);
            TextView under = t.text(a, note.isEmpty() ? " " : note, Type.CAPTION, t.inkMuted, false);
            under.setGravity(Gravity.CENTER);
            target.addView(under);
            target.setContentDescription(SpeedSteps.presetLabel(i) + (note.isEmpty() ? "" : ", " + note));
            target.setOnClickListener(v -> set(SpeedSteps.PRESETS[k], v));
            net.kckern.daylight.shellkit.UiTelemetry.tag(target, "speed.preset");
            marks.addView(target, new LinearLayout.LayoutParams(0, -2, 1));
        }
        body.addView(marks, new LinearLayout.LayoutParams(-1, -2));

        String foot = SpeedSteps.footnote(longItem);
        if (!foot.isEmpty()) {
            TextView f = t.text(a, foot, Type.CAPTION, t.inkMuted, false);
            f.setGravity(Gravity.CENTER);
            f.setPadding(0, dp(4), 0, dp(4));
            body.addView(f, new LinearLayout.LayoutParams(-1, -2));
        }
        draw();
    }

    /** Runs when the sheet closes (a page redraws its Speed label then, not on every step). */
    SpeedSheet onClose(Runnable r) { sheet.onDismiss(r); return this; }

    private void set(float next, View from) {
        float s = LongForm.clampSpeed(next);
        if (Math.abs(s - speed) < 0.001f) return;
        if (SpeedSteps.crossesQuarter(speed, s)) from.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK);
        speed = s;
        draw();
        apply.accept(s);
    }

    private void draw() {
        value.setText(LongForm.speedLabel(speed));
        value.setContentDescription("Speed " + LongForm.speedLabel(speed));
        setting = true;
        slider.setProgress(SpeedSteps.index(speed));
        setting = false;
        int current = SpeedSteps.preset(speed);
        for (int i = 0; i < presets.length; i++) {
            boolean on = i == current;
            presets[i].setText(on ? "✓ " + SpeedSteps.presetLabel(i) : SpeedSteps.presetLabel(i));
            presets[i].setTextColor(on ? t.ink : t.inkMuted);
            presets[i].setTypeface(t.face(on));
            ((View) presets[i].getParent()).setSelected(on);
        }
    }

    private ImageButton round(int icon, String said) {
        ImageButton b = new ImageButton(a);
        b.setImageResource(icon);
        b.setImageTintList(ColorStateList.valueOf(t.ink));
        b.setBackground(t.pressable(DaylightTheme.round(0x00000000, dp(24))));
        b.setScaleType(ImageView.ScaleType.CENTER);
        b.setContentDescription(said);
        b.setTooltipText(said);
        return b;
    }

    private int dp(int v) { return Math.round(v * a.getResources().getDisplayMetrics().density); }
}

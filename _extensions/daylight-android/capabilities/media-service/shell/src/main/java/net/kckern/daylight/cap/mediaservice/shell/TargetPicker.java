package net.kckern.daylight.cap.mediaservice.shell;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.res.ColorStateList;
import android.os.Handler;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import net.kckern.daylight.shellkit.DaylightTheme;
import net.kckern.daylight.shellkit.DaylightTheme.Type;
import net.kckern.daylight.shellkit.UiTelemetry;

import org.json.JSONObject;

import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;

/**
 * The one "Play on" picker (Now playing's target button, a library page's Play on…): this
 * phone first, then every screen with what it is doing, checked as the list opens ("Off",
 * "Nothing playing", the title). An off screen is greyed and cannot be picked, except the
 * one in use, which stays so it can be seen. Rows reserve their state line, so nothing
 * jumps when the answers arrive.
 */
final class TargetPicker {
    static final String LOCAL = "local";

    private TargetPicker() { }

    /** One row: this phone ({@link #LOCAL}) or a screen's device id, its name and registry type. */
    static final class Target {
        final String id, name, type;
        Target(String id, String name, String type) { this.id = id; this.name = name; this.type = type == null ? "" : type; }
    }

    interface Picked { void on(String id, String name); }

    /** The registry's device type as an icon: a picker row says what kind of thing it plays on. */
    static int iconFor(String type, String name) {
        if (type == null) type = "";
        if (type.equals("speaker")) {
            return name != null && name.toLowerCase(Locale.ROOT).contains("headset")
                    ? R.drawable.daylight_np_headphones : R.drawable.daylight_np_speaker;
        }
        if (type.contains("tablet")) return R.drawable.daylight_np_tablet;
        return R.drawable.daylight_np_tv;
    }

    /** What a screen's row says it is doing. */
    static String stateLine(ScreenSnapshot snap) {
        ScreenSnapshot.Entry now = snap.currentEntry();
        switch (snap.reach) {
            case OFF: case NOT_ON: return "Off";
            case IDLE: return "Nothing playing";
            case PLAYING_OR_PAUSED: {
                boolean playing = "playing".equals(snap.state);
                String title = now == null ? "" : now.title.trim();
                if (title.isEmpty()) return playing ? "Playing" : "Paused";
                return playing ? title : title + " · paused";
            }
            default: return "Can't check";
        }
    }

    /** Whether a row can be picked: anything but an off screen, and always the one in use. */
    static boolean pickable(ScreenSnapshot snap, boolean current) {
        boolean off = snap.reach == ScreenSnapshot.Reach.OFF || snap.reach == ScreenSnapshot.Reach.NOT_ON;
        return current || !off;
    }

    /**
     * Shows the picker. {@code targets} is this phone first, then the screens; {@code current}
     * is checked; {@code note} (a problem reading the screens) shows under the list.
     */
    static void show(Activity a, DaylightTheme base, List<Target> targets, String current, String note,
                     PayloadMedia media, ExecutorService io, Handler main, Picked picked) {
        float density = a.getResources().getDisplayMetrics().density;
        java.util.function.IntUnaryOperator dp = v -> Math.round(v * density);
        LinearLayout col = new LinearLayout(a);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(dp.applyAsInt(8), dp.applyAsInt(8), dp.applyAsInt(8), dp.applyAsInt(8));
        AlertDialog dialog = new AlertDialog.Builder(a, DaylightTheme.alert()).setTitle("Play on").setView(col).create();
        for (Target target : targets) {
            final String id = target.id, label = target.name;
            final boolean on = id.equals(current);
            LinearLayout row = new LinearLayout(a);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setMinimumHeight(dp.applyAsInt(52));
            row.setPaddingRelative(dp.applyAsInt(12), 0, dp.applyAsInt(12), 0);
            row.setBackground(base.pressable(null));
            ImageView kind = new ImageView(a);
            kind.setImageResource(LOCAL.equals(id) ? R.drawable.daylight_np_phone : iconFor(target.type, label));
            kind.setImageTintList(ColorStateList.valueOf(on ? base.primary : base.ink));
            row.addView(kind, new LinearLayout.LayoutParams(dp.applyAsInt(24), dp.applyAsInt(24)));
            LinearLayout words = new LinearLayout(a);
            words.setOrientation(LinearLayout.VERTICAL);
            words.setPaddingRelative(dp.applyAsInt(16), 0, 0, 0);
            TextView name = base.text(a, label, Type.BODY, on ? base.primary : base.ink, on);
            words.addView(name);
            TextView state = base.text(a, LOCAL.equals(id) ? "Ready" : "Checking…", Type.LABEL, base.inkMuted, false);
            state.setMaxLines(1);
            state.setEllipsize(TextUtils.TruncateAt.END);
            words.addView(state);
            row.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
            if (on) {
                ImageView check = new ImageView(a);
                check.setImageResource(R.drawable.daylight_np_check);
                check.setImageTintList(ColorStateList.valueOf(base.primary));
                row.addView(check, new LinearLayout.LayoutParams(dp.applyAsInt(24), dp.applyAsInt(24)));
            }
            row.setContentDescription(on ? label + ", playing here" : "Play on " + label);
            UiTelemetry.tag(row, "play-on." + (LOCAL.equals(id) ? "local" : id));
            row.setOnClickListener(v -> { dialog.dismiss(); picked.on(id, label); });
            col.addView(row);
            if (!LOCAL.equals(id) && io != null) io.execute(() -> {
                ScreenSnapshot snap;
                try { snap = ScreenSnapshot.parse(new JSONObject(media.screenSession(id, 4000))); }
                catch (Exception unreachable) { snap = ScreenSnapshot.unreachable(); }
                ScreenSnapshot answer = snap;
                main.post(() -> mark(row, name, state, answer, on));
            });
        }
        if (note != null && !note.isEmpty()) {
            TextView n = base.text(a, note, Type.LABEL, base.inkMuted, false);
            n.setPaddingRelative(dp.applyAsInt(12), dp.applyAsInt(8), dp.applyAsInt(12), 0);
            col.addView(n);
        }
        dialog.show();
    }

    private static void mark(View row, TextView name, TextView state, ScreenSnapshot snap, boolean current) {
        state.setText(stateLine(snap));
        if (!pickable(snap, current)) {
            row.setAlpha(0.45f);
            row.setEnabled(false);
            row.setClickable(false);
            row.setContentDescription(name.getText() + ", off");
        }
    }
}

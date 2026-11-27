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

    /**
     * A pick: the id, the name, and the screen's answer as the picker read it
     * (ScreenMemory's encoding; null for this phone or a row picked before any answer).
     */
    interface Picked { void on(String id, String name, String snapshot); }

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

    /** The open picker: more screens can be added while it shows (a list fetched after it opened). */
    static final class Shown {
        private final Runnable2<List<Target>, String> add;
        Shown(Runnable2<List<Target>, String> add) { this.add = add; }

        /** Adds rows for targets not shown yet, and sets the note under the list ("" for none). */
        void add(List<Target> more, String note) { add.run(more, note); }
    }

    interface Runnable2<A, B> { void run(A a, B b); }

    /**
     * Shows the picker at once. {@code targets} is this phone first, then the screens (the
     * last known list is enough: a screen's own check says whether it is there). Every
     * screen is checked at the same time, on the picker's own threads; a row reads
     * "Checking…" until its answer. A tap on a row still being checked waits for that row
     * (PickRow). {@code current} is checked; {@code note} shows under the list.
     */
    static Shown show(Activity a, DaylightTheme base, List<Target> targets, String current, String note,
                      PayloadMedia media, Handler main, Picked picked) {
        float density = a.getResources().getDisplayMetrics().density;
        java.util.function.IntUnaryOperator dp = v -> Math.round(v * density);
        LinearLayout col = new LinearLayout(a);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(dp.applyAsInt(8), dp.applyAsInt(8), dp.applyAsInt(8), dp.applyAsInt(8));
        LinearLayout rows = new LinearLayout(a);
        rows.setOrientation(LinearLayout.VERTICAL);
        col.addView(rows);
        TextView noteLine = base.text(a, "", Type.LABEL, base.inkMuted, false);
        noteLine.setPaddingRelative(dp.applyAsInt(12), dp.applyAsInt(8), dp.applyAsInt(12), 0);
        col.addView(noteLine);
        AlertDialog dialog = new AlertDialog.Builder(a, DaylightTheme.alert()).setTitle("Play on").setView(col).create();
        ExecutorService checks = java.util.concurrent.Executors.newCachedThreadPool(r -> {
            Thread t = new Thread(r, "Daylight-play-on-check");
            t.setDaemon(true);
            return t;
        });
        java.util.Set<String> shown = new java.util.HashSet<>();
        boolean[] picking = new boolean[1];
        long openedAt = android.os.SystemClock.elapsedRealtime();
        Runnable2<List<Target>, String> add = (more, words) -> {
            if (words != null) setNote(noteLine, words);
            for (Target target : more) {
                if (!shown.add(target.id)) continue;
                addRow(a, base, dp, rows, target, current, media, main, checks, dialog, picked, picking, openedAt);
            }
        };
        add.run(targets, note == null ? "" : note);
        dialog.setOnDismissListener(d -> checks.shutdownNow());
        dialog.show();
        return new Shown(add);
    }

    private static void setNote(TextView line, String words) {
        line.setText(words);
        line.setVisibility(words.isEmpty() ? View.GONE : View.VISIBLE);
    }

    private static void addRow(Activity a, DaylightTheme base, java.util.function.IntUnaryOperator dp, LinearLayout rows,
                               Target target, String current, PayloadMedia media, Handler main, ExecutorService checks,
                               AlertDialog dialog, Picked picked, boolean[] picking, long openedAt) {
        final String id = target.id, label = target.name;
        final boolean on = id.equals(current), local = LOCAL.equals(id);
        final PickRow state = new PickRow(local, on);
        final String[] answer = new String[1];
        LinearLayout row = new LinearLayout(a);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setMinimumHeight(dp.applyAsInt(52));
        row.setPaddingRelative(dp.applyAsInt(12), 0, dp.applyAsInt(12), 0);
        row.setBackground(base.pressable(null));
        ImageView kind = new ImageView(a);
        kind.setImageResource(local ? R.drawable.daylight_np_phone : iconFor(target.type, label));
        kind.setImageTintList(ColorStateList.valueOf(on ? base.primary : base.ink));
        row.addView(kind, new LinearLayout.LayoutParams(dp.applyAsInt(24), dp.applyAsInt(24)));
        LinearLayout words = new LinearLayout(a);
        words.setOrientation(LinearLayout.VERTICAL);
        words.setPaddingRelative(dp.applyAsInt(16), 0, 0, 0);
        TextView name = base.text(a, label, Type.BODY, on ? base.primary : base.ink, on);
        words.addView(name);
        TextView line = base.text(a, local ? "Ready" : "Checking…", Type.LABEL, base.inkMuted, false);
        line.setMaxLines(1);
        line.setEllipsize(TextUtils.TruncateAt.END);
        words.addView(line);
        row.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
        if (on) {
            ImageView check = new ImageView(a);
            check.setImageResource(R.drawable.daylight_np_check);
            check.setImageTintList(ColorStateList.valueOf(base.primary));
            row.addView(check, new LinearLayout.LayoutParams(dp.applyAsInt(24), dp.applyAsInt(24)));
        }
        row.setContentDescription(on ? label + ", playing here" : "Play on " + label);
        UiTelemetry.tag(row, "play-on." + (local ? "local" : id));
        Runnable pick = () -> {
            if (picking[0]) return;
            picking[0] = true;
            dialog.dismiss();
            picked.on(id, label, answer[0]);
        };
        row.setOnClickListener(v -> {
            switch (state.tap()) {
                case PICK: pick.run(); break;
                case WAIT:
                    line.setText("Checking… plays here when it answers");
                    UiTelemetry.event("PlayOn", "play-on.wait", new JSONObject());
                    break;
                default: break;
            }
        });
        rows.addView(row);
        if (local) return;
        try {
            checks.execute(() -> {
                JSONObject reply = null;
                ScreenSnapshot snap;
                try {
                    reply = new JSONObject(media.screenSession(id, 4000));
                    snap = ScreenSnapshot.parse(reply);
                } catch (Exception unreachable) { snap = ScreenSnapshot.unreachable(); }
                ScreenMemory.remember(a, id, reply);
                ScreenSnapshot got = snap;
                String encoded = got.failed() || reply == null ? null : ScreenMemory.encode(reply, System.currentTimeMillis());
                main.post(() -> {
                    answer[0] = encoded;
                    line.setText(stateLine(got));
                    PickRow.Answer next = state.answer(got);
                    if (next == PickRow.Answer.DISABLE) {
                        row.setAlpha(0.45f);
                        row.setContentDescription(name.getText() + ", off");
                    } else if (next == PickRow.Answer.PICK && dialog.isShowing()) {
                        pick.run();
                    }
                });
            });
        } catch (java.util.concurrent.RejectedExecutionException closed) { /* the picker is gone */ }
    }
}

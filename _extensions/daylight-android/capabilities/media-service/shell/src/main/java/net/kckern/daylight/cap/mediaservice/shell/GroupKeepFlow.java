package net.kckern.daylight.cap.mediaservice.shell;

import android.app.Activity;
import android.app.Dialog;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import net.kckern.daylight.shellkit.DaylightTheme;
import net.kckern.daylight.shellkit.DaylightTheme.Radius;
import net.kckern.daylight.shellkit.DaylightTheme.Type;
import net.kckern.daylight.shellkit.UiTelemetry;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * "Keep all…" on an artist or an author (lifecycle spec §3.11): one modal bottom sheet that
 * is both the confirmation and the customiser. It lists the units (albums or books) with
 * their size and a check each (finished books unchecked, "Include finished (3)"), the total
 * and the room left after, "Keep new ones too" and, for books, "Remove each when finished",
 * and one primary button ("Keep 12 books · 4.2 GB"). When it does not fit it says how much
 * is over and offers "Keep the 7 that fit". The same sheet is the group's Choose… later,
 * opened with what the group holds checked. Nothing else asks again.
 */
public final class GroupKeepFlow {
    private GroupKeepFlow() { }

    /**
     * Opens the sheet for {@code groupId} (an artist's or an author's content id, c: or not),
     * {@code kind} the page's ("artist" or "author"; "" lets the units decide).
     */
    public static void start(Activity a, String groupId, String kind, String title) {
        String gid = groupId == null ? "" : groupId.startsWith("c:") ? groupId.substring(2) : groupId;
        UiTelemetry.event("Downloads", "keep.group.tap", new JSONObject());
        new GroupKeepFlow.Sheet(a, gid, kind == null ? "" : kind, title == null ? "" : title).show();
    }

    private static final class Sheet {
        private final Activity a;
        private final DaylightTheme t;
        private final Dialog dialog;
        private final LinearLayout body, list;
        private final TextView heading, status, total, over, cap, fit;
        private final TextView primary;
        private final String gid, kindAsked;
        private final List<GroupKeepRules.Unit> units = new ArrayList<>();
        private final List<CheckBox> boxes = new ArrayList<>();
        private CheckBox includeFinished;
        private Switch follow, removeFinished;
        private JSONObject preview;
        private String kind;
        private boolean filling;

        Sheet(Activity a, String gid, String kind, String title) {
            this.a = a;
            this.gid = gid;
            this.kindAsked = kind;
            this.kind = kind.startsWith("author") ? GroupKeepRules.AUTHOR : "artist";
            t = DaylightTheme.of(a);
            dialog = new Dialog(a);
            dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
            body = new LinearLayout(a);
            body.setOrientation(LinearLayout.VERTICAL);
            body.setPadding(dp(20), dp(12), dp(20), dp(20));
            float r = t.radius(Radius.LARGE);
            GradientDrawable shape = new GradientDrawable();
            shape.setColor(t.background);
            shape.setCornerRadii(new float[] { r, r, r, r, 0, 0, 0, 0 });
            body.setBackground(shape);
            View grab = new View(a);
            grab.setBackground(DaylightTheme.round(t.scrim, dp(2)));
            LinearLayout.LayoutParams gp = new LinearLayout.LayoutParams(dp(40), dp(4));
            gp.gravity = Gravity.CENTER_HORIZONTAL;
            gp.bottomMargin = dp(14);
            body.addView(grab, gp);
            heading = t.text(a, title.isEmpty() ? "Keep all" : "Keep all of " + title, Type.TITLE, t.ink, true);
            heading.setMaxLines(2);
            heading.setEllipsize(TextUtils.TruncateAt.END);
            if (android.os.Build.VERSION.SDK_INT >= 28) heading.setAccessibilityHeading(true);
            body.addView(heading);
            status = t.text(a, "Checking sizes…", Type.LABEL, t.inkMuted, false);
            status.setPadding(0, dp(4), 0, dp(8));
            body.addView(status);
            int maxList = Math.round(a.getResources().getDisplayMetrics().heightPixels * 0.45f);
            ScrollView scroll = new ScrollView(a) {
                @Override protected void onMeasure(int w, int h) {
                    super.onMeasure(w, MeasureSpec.makeMeasureSpec(maxList, MeasureSpec.AT_MOST));
                }
            };
            list = new LinearLayout(a);
            list.setOrientation(LinearLayout.VERTICAL);
            scroll.addView(list);
            body.addView(scroll, new LinearLayout.LayoutParams(-1, -2));
            LinearLayout foot = new LinearLayout(a);
            foot.setOrientation(LinearLayout.VERTICAL);
            foot.setPadding(0, dp(8), 0, 0);
            body.addView(foot);
            cap = line(foot, t.inkMuted);
            total = line(foot, t.ink);
            over = line(foot, t.attention);
            fit = t.text(a, "", Type.LABEL, t.ink, true);
            fit.setPadding(0, dp(10), 0, dp(10));
            fit.setMinHeight(dp(44));
            fit.setGravity(Gravity.CENTER_VERTICAL);
            fit.setBackground(t.pressable(null));
            fit.setVisibility(View.GONE);
            UiTelemetry.tag(fit, "keep.group.fit");
            foot.addView(fit);
            primary = t.text(a, "Keep", Type.BODY, t.onPrimary, true);
            primary.setGravity(Gravity.CENTER);
            primary.setMinHeight(dp(52));
            primary.setBackground(t.pressable(t.round(t.primary, Radius.MEDIUM)));
            primary.setEnabled(false);
            primary.setAlpha(0.4f);
            UiTelemetry.tag(primary, "keep.group.keep");
            LinearLayout.LayoutParams pp = new LinearLayout.LayoutParams(-1, -2);
            pp.topMargin = dp(12);
            foot.addView(primary, pp);
            dialog.setContentView(body);
            Window w = dialog.getWindow();
            w.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            w.setGravity(Gravity.BOTTOM);
            w.setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.WRAP_CONTENT);
            w.setDimAmount(0.45f);
            w.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
            dialog.setCanceledOnTouchOutside(true);
        }

        private TextView line(LinearLayout into, int color) {
            TextView v = t.text(a, "", Type.LABEL, color, false);
            v.setPadding(0, dp(2), 0, dp(2));
            v.setVisibility(View.GONE);
            into.addView(v);
            return v;
        }

        void show() {
            dialog.show();
            KeepStore.get(a).groupPreview(gid, kindAsked, this::fill);
        }

        private void fill(JSONObject p) {
            if (a.isFinishing() || a.isDestroyed() || !dialog.isShowing()) return;
            if (!p.optBoolean("ok", false)) {
                status.setText(p.optString("words", "These can't be kept now"));
                status.setTextColor(t.attention);
                UiTelemetry.event("Downloads", "keep.group.preview_failed", eventOf("cause", p.optString("cause")));
                return;
            }
            preview = p;
            JSONObject g = p.optJSONObject("group");
            kind = g == null ? kind : g.optString("kind", kind);
            String title = g == null ? "" : g.optString("title");
            if (!title.isEmpty()) heading.setText("Keep all of " + title);
            JSONArray us = p.optJSONArray("units");
            for (int i = 0; us != null && i < us.length(); i++) {
                JSONObject u = us.optJSONObject(i);
                units.add(new GroupKeepRules.Unit(u.optString("contentId"), u.optString("title"), u.optLong("need", -1), u.optLong("bytes"),
                        u.optInt("count"), u.optBoolean("finished"), u.optBoolean("started"), u.optBoolean("held"), u.optBoolean("overCap")));
            }
            boolean kept = g != null && g.optBoolean("kept");
            GroupKeepRules.defaultChecks(units, kept);
            status.setText(GroupKeepRules.noun(kind, units.size()) + (p.optBoolean("sized") ? "" : " · sizes are read on Wi-Fi"));
            filling = true;
            for (GroupKeepRules.Unit u : units) list.addView(unitRow(u));
            int finished = GroupKeepRules.finishedCount(units);
            if (finished > 0) {
                includeFinished = checkRow(GroupKeepRules.includeFinishedLabel(finished), allFinishedChecked(), "keep.group.include_finished");
                includeFinished.setOnCheckedChangeListener((b, on) -> {
                    if (filling) return;
                    GroupKeepRules.includeFinished(units, on);
                    sync();
                });
            }
            follow = switchRow("Keep new ones too", "New " + (GroupKeepRules.AUTHOR.equals(kind) ? "books" : "albums") + " are kept when they arrive",
                    g == null ? GroupKeepRules.AUTHOR.equals(kind) : g.optBoolean("follow"), "keep.group.follow");
            if (GroupKeepRules.AUTHOR.equals(kind)) {
                removeFinished = switchRow("Remove each when finished", "A day after you finish it", g == null || g.optBoolean("removeFinished"),
                        "keep.group.remove_finished");
            }
            int within = p.optInt("withinCap", units.size()), withinTracks = 0;
            for (int i = 0; i < within && i < units.size(); i++) withinTracks += units.get(i).tracks;
            String capWords = GroupKeepRules.capLine(kind, p.optInt("totalTracks"), p.optInt("cap", 5000), within, withinTracks);
            cap.setText(capWords);
            cap.setVisibility(capWords.isEmpty() ? View.GONE : View.VISIBLE);
            filling = false;
            primary.setOnClickListener(v -> keep());
            fit.setOnClickListener(v -> {
                GroupKeepRules.keepThoseThatFit(units, p.optLong("room"));
                UiTelemetry.event("Downloads", "keep.group.fit_chosen", eventOf("units", String.valueOf(GroupKeepRules.checkedCount(units))));
                sync();
            });
            UiTelemetry.event("Downloads", "keep.group.sheet", eventOf("units", String.valueOf(units.size())));
            sync();
        }

        private boolean allFinishedChecked() {
            for (GroupKeepRules.Unit u : units) if (u.finished && !u.checked) return false;
            return true;
        }

        private View unitRow(GroupKeepRules.Unit u) {
            LinearLayout row = new LinearLayout(a);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setMinimumHeight(dp(56));
            row.setBackground(t.pressable(null));
            CheckBox box = new CheckBox(a);
            box.setButtonTintList(ColorStateList.valueOf(t.primary));
            box.setChecked(u.checked);
            box.setEnabled(!u.overCap);
            box.setContentDescription(u.title);
            boxes.add(box);
            row.addView(box);
            LinearLayout words = new LinearLayout(a);
            words.setOrientation(LinearLayout.VERTICAL);
            words.setPadding(dp(8), dp(6), 0, dp(6));
            TextView name = t.text(a, u.title.isEmpty() ? "Untitled" : u.title, Type.BODY, t.ink, false);
            name.setMaxLines(2);
            name.setEllipsize(TextUtils.TruncateAt.END);
            words.addView(name);
            String line = GroupKeepRules.unitLine(u);
            if (!line.isEmpty()) words.addView(t.text(a, line, Type.LABEL, t.inkMuted, false));
            row.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
            box.setOnCheckedChangeListener((b, on) -> {
                if (filling) return;
                u.checked = on;
                sync();
            });
            row.setOnClickListener(v -> { if (box.isEnabled()) box.toggle(); });
            UiTelemetry.tag(row, "keep.group.unit");
            return row;
        }

        private CheckBox checkRow(String label, boolean on, String tag) {
            CheckBox box = new CheckBox(a);
            box.setButtonTintList(ColorStateList.valueOf(t.primary));
            box.setText(label);
            box.setTextColor(t.ink);
            box.setChecked(on);
            box.setMinHeight(dp(48));
            UiTelemetry.tag(box, tag);
            list.addView(box);
            return box;
        }

        private Switch switchRow(String label, String hint, boolean on, String tag) {
            LinearLayout row = new LinearLayout(a);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setMinimumHeight(dp(56));
            LinearLayout words = new LinearLayout(a);
            words.setOrientation(LinearLayout.VERTICAL);
            words.addView(t.text(a, label, Type.BODY, t.ink, false));
            words.addView(t.text(a, hint, Type.LABEL, t.inkMuted, false));
            row.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
            Switch s = new Switch(a);
            s.setChecked(on);
            s.setContentDescription(label);
            s.setThumbTintList(new ColorStateList(new int[][] { { android.R.attr.state_checked }, {} }, new int[] { t.primary, t.inkMuted }));
            s.setTrackTintList(new ColorStateList(new int[][] { { android.R.attr.state_checked }, {} },
                    new int[] { DaylightTheme.withAlpha(t.primary, 0x66), t.track }));
            row.addView(s);
            row.setOnClickListener(v -> s.toggle());
            UiTelemetry.tag(s, tag);
            list.addView(row);
            return s;
        }

        /** The checks, totals, over line and the one button, from the units as they are now. */
        private void sync() {
            filling = true;
            for (int i = 0; i < units.size() && i < boxes.size(); i++) boxes.get(i).setChecked(units.get(i).checked);
            if (includeFinished != null) includeFinished.setChecked(allFinishedChecked());
            filling = false;
            int n = GroupKeepRules.checkedCount(units);
            long need = GroupKeepRules.checkedNeed(units), room = preview.optLong("room");
            boolean sized = preview.optBoolean("sized");
            boolean fits = !sized || need <= room;
            total.setText(GroupKeepRules.totalLine(need, room - need, preview.optBoolean("wifiOnly")));
            total.setVisibility(sized && n > 0 ? View.VISIBLE : View.GONE);
            if (!fits) {
                over.setText(GroupKeepRules.overLine(need - room));
                int fitting = GroupKeepRules.wouldFit(units, room);
                fit.setText(GroupKeepRules.fitButton(kind, fitting) + " ›");
                fit.setVisibility(fitting > 0 ? View.VISIBLE : View.GONE);
            } else {
                fit.setVisibility(View.GONE);
            }
            over.setVisibility(fits ? View.GONE : View.VISIBLE);
            boolean kept = preview.optJSONObject("group") != null && preview.optJSONObject("group").optBoolean("kept");
            primary.setText(n == 0 && kept ? "Keep none" : GroupKeepRules.button(kind, n, need));
            boolean on = fits && (n > 0 || kept);
            primary.setEnabled(on);
            primary.setAlpha(on ? 1f : 0.4f);
        }

        private void keep() {
            JSONObject g = preview.optJSONObject("group");
            List<String> chosen = new ArrayList<>(), listed = new ArrayList<>();
            for (GroupKeepRules.Unit u : units) {
                listed.add(u.id);
                if (u.checked) chosen.add(u.id);
            }
            long need = GroupKeepRules.checkedNeed(units);
            JSONObject group = new JSONObject();
            try {
                group.put("id", gid).put("title", g == null ? "" : g.optString("title")).put("kind", kind)
                        .put("art", g == null ? "" : g.optString("art", ""))
                        .put("follow", follow != null && follow.isChecked())
                        .put("removeFinished", removeFinished != null && removeFinished.isChecked());
            } catch (Exception never) { return; }
            dialog.dismiss();
            Toast.makeText(a, chosen.isEmpty() ? "Removing these from this phone" : "Keeping " + GroupKeepRules.noun(kind, chosen.size()) + "…",
                    Toast.LENGTH_SHORT).show();
            java.util.function.Consumer<String> said = line -> {
                if (!a.isFinishing() && !a.isDestroyed()) Toast.makeText(a, line, Toast.LENGTH_LONG).show();
            };
            // Everything unchecked in Choose…: the group itself goes.
            if (chosen.isEmpty()) KeepStore.get(a).removeGroup(gid, said);
            else KeepStore.get(a).keepGroup(group, chosen, listed, need, said);
        }

        private int dp(int v) { return Math.round(v * a.getResources().getDisplayMetrics().density); }
    }

    private static JSONObject eventOf(String k, String v) {
        try { return new JSONObject().put(k, v); } catch (Exception never) { return new JSONObject(); }
    }
}

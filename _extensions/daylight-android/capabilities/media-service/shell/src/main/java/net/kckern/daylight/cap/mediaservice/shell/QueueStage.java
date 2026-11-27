package net.kckern.daylight.cap.mediaservice.shell;

import android.app.Activity;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.text.InputType;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.ViewGroup;
import android.widget.AbsListView;
import android.widget.BaseAdapter;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;

import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.session.MediaController;

import net.kckern.daylight.cap.mediaservice.shell.QueueModel.End;
import net.kckern.daylight.cap.mediaservice.shell.QueueModel.Region;
import net.kckern.daylight.cap.mediaservice.shell.QueueRows.Kind;
import net.kckern.daylight.cap.mediaservice.shell.QueueRows.Row;
import net.kckern.daylight.shellkit.DaylightTheme;
import net.kckern.daylight.shellkit.DaylightTheme.Type;
import net.kckern.daylight.shellkit.DrivingRadioSettings;
import net.kckern.daylight.shellkit.UiTelemetry;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Supplier;

/**
 * Now playing → Queue (spec §4): sections with headers, History collapsed, drag the handle
 * to reorder, swipe left to remove with Undo, a sheet per row, Clear queued, and in the ⋮
 * Clear all but now playing and Save as playlist; the end card last. It reads the media
 * service's queue in process and redraws in place as the player moves (the scroll stays).
 * Rows are a ListView, so a 900-track playlist draws only what is on screen.
 *
 * A screen's queue (the remote) has no regions here: its items, Now playing and Up next.
 */
final class QueueStage {
    private final Activity activity;
    private final Supplier<DaylightTheme> theme;
    private final PayloadMedia media = new PayloadMedia();
    private final ExecutorService io = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "Daylight-queue-screen");
        t.setDaemon(true);
        return t;
    });
    private final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
    private final float d;

    private final LinearLayout root;
    private final TextView title, status;
    private final ImageButton more;
    private final ListView list;
    private final View dropLine;
    private final Adapter adapter = new Adapter();

    private List<Row> rows = new ArrayList<>();
    private boolean historyOpen;
    private final Set<Long> openGroups = new HashSet<>();
    private String shownKey = "";
    private MediaController controller;
    private boolean remote;
    private final Map<String, Boolean> offlineMemo = new HashMap<>();
    private boolean online = true;

    QueueStage(Activity activity, Supplier<DaylightTheme> theme) {
        this.activity = activity;
        this.theme = theme;
        this.d = activity.getResources().getDisplayMetrics().density;
        DaylightTheme t = theme.get();
        root = new LinearLayout(activity);
        root.setOrientation(LinearLayout.VERTICAL);
        LinearLayout head = new LinearLayout(activity);
        head.setGravity(Gravity.CENTER_VERTICAL);
        title = t.text(activity, "Queue", Type.TITLE, t.ink, true);
        head.addView(title, new LinearLayout.LayoutParams(0, -2, 1));
        more = new ImageButton(activity);
        more.setImageResource(R.drawable.daylight_np_more);
        more.setBackground(t.pressable(null));
        more.setContentDescription("Queue options");
        more.setTooltipText("Queue options");
        UiTelemetry.tag(more, "queue.more");
        more.setOnClickListener(v -> openMore());
        head.addView(more, new LinearLayout.LayoutParams(dp(48), dp(48)));
        root.addView(head);
        status = t.text(activity, "", Type.LABEL, t.inkMuted, false);
        status.setVisibility(View.GONE);
        status.setPadding(0, 0, 0, dp(6));
        root.addView(status);
        FrameLayout frame = new FrameLayout(activity);
        list = new ListView(activity);
        list.setDivider(null);
        list.setVerticalScrollBarEnabled(false);
        list.setSelector(new android.graphics.drawable.ColorDrawable(0));
        list.setAdapter(adapter);
        list.setOverScrollMode(View.OVER_SCROLL_NEVER);
        frame.addView(list, new FrameLayout.LayoutParams(-1, -1));
        dropLine = new View(activity);
        dropLine.setBackgroundColor(t.primary);
        dropLine.setVisibility(View.GONE);
        frame.addView(dropLine, new FrameLayout.LayoutParams(-1, Math.max(2, dp(2))));
        root.addView(frame, new LinearLayout.LayoutParams(-1, 0, 1));
        restyle();
    }

    View view() { return root; }

    private int dp(int v) { return (int) (v * d); }

    private QueueController queue() { return remote ? null : QueueController.live(); }

    /** The colours follow the cover (Now playing re-themes): called on each fill. */
    private void restyle() {
        DaylightTheme t = theme.get();
        title.setTextColor(t.ink);
        status.setTextColor(t.inkMuted);
        more.setImageTintList(ColorStateList.valueOf(t.inkMuted));
        dropLine.setBackgroundColor(t.primary);
    }

    // ── filling ─────────────────────────────────────────────────────────────

    /** Redraws only when something shown changed; the scroll position stays. */
    void fill(MediaController c, boolean isRemote) {
        controller = c;
        remote = isRemote;
        restyle();
        QueueController q = queue();
        more.setVisibility(q != null && q.model().size() > 0 ? View.VISIBLE : View.GONE);
        String line = q == null ? "" : q.status();
        status.setText(line);
        status.setVisibility(line.isEmpty() ? View.GONE : View.VISIBLE);
        String key;
        if (q != null) {
            online = q.online();
            key = q.model().rev() + "|" + q.model().nowIndex() + "|" + historyOpen + "|" + openGroups + "|" + online
                    + "|" + q.end() + "|" + q.ended() + "|" + (c != null && c.isPlaying());
        } else {
            int count = c == null ? 0 : c.getMediaItemCount();
            key = "r|" + count + "|" + (c == null ? -1 : c.getCurrentMediaItemIndex()) + "|" + (c != null && c.isPlaying())
                    + "|" + (c == null || c.getCurrentMediaItem() == null ? "" : c.getCurrentMediaItem().mediaId);
        }
        if (key.equals(shownKey)) return;
        shownKey = key;
        offlineMemo.clear();
        rows = q != null ? QueueRows.build(q.model(), historyOpen, openGroups) : flatRows(c);
        adapter.notifyDataSetChanged();
    }

    /** A screen's queue: no regions to show, its items in order. */
    private static List<Row> flatRows(MediaController c) {
        List<Row> out = new ArrayList<>();
        int count = c == null ? 0 : c.getMediaItemCount();
        int now = c == null ? -1 : c.getCurrentMediaItemIndex();
        if (count == 0 || now < 0) return out;
        out.add(new Row(Kind.HEADER, Region.NOW, now, 1, "Now playing", 0));
        out.add(new Row(Kind.ITEM, Region.NOW, now, 1, "", 0));
        if (now + 1 < count) out.add(new Row(Kind.HEADER, Region.SOURCE, now + 1, count - now - 1, "Up next", 0));
        for (int i = now + 1; i < count; i++) out.add(new Row(Kind.ITEM, Region.SOURCE, i, 1, "", 0));
        return out;
    }

    /** Opening the queue: Now playing in view (only then; it never jumps while open). */
    void scrollToNow() {
        for (int i = 0; i < rows.size(); i++) {
            Row r = rows.get(i);
            if (r.kind == Kind.HEADER && r.region == Region.NOW) {
                final int at = i;
                list.post(() -> list.setSelectionFromTop(at, dp(8)));
                return;
            }
        }
    }

    /** Now playing came forward: a notice a list's tap left ("Playing … · your 4 queued stay"). */
    void onResume() { QueueVerbs.showPending(activity); }

    private MediaItem itemAt(int index) {
        QueueController q = queue();
        if (q != null) return index >= 0 && index < q.model().size() ? q.model().at(index).item : null;
        MediaController c = controller;
        return c != null && index >= 0 && index < c.getMediaItemCount() ? c.getMediaItemAt(index) : null;
    }

    private boolean playsOffline(MediaItem item) {
        QueueController q = queue();
        if (q == null || item == null) return false;
        Boolean known = offlineMemo.get(item.mediaId);
        if (known == null) { known = q.playsOffline(item); offlineMemo.put(item.mediaId, known); }
        return known;
    }

    // ── rows ────────────────────────────────────────────────────────────────

    private final class Adapter extends BaseAdapter {
        @Override public int getCount() { return rows.size(); }
        @Override public Object getItem(int position) { return rows.get(position); }
        @Override public long getItemId(int position) { return position; }
        @Override public int getViewTypeCount() { return Kind.values().length; }
        @Override public int getItemViewType(int position) { return rows.get(position).kind.ordinal(); }
        @Override public boolean isEnabled(int position) { return false; }

        @Override public View getView(int position, View convert, ViewGroup parent) {
            Row r = rows.get(position);
            switch (r.kind) {
                case HEADER: return header(r);
                case GROUP: return group(r);
                case BOOK: return book(r);
                case END: return endCard();
                default: return item(r, position);
            }
        }
    }

    private View header(Row r) {
        DaylightTheme t = theme.get();
        LinearLayout row = new LinearLayout(activity);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0, dp(r.region == Region.HISTORY ? 4 : 14), 0, dp(2));
        TextView h = t.text(activity, r.text, Type.LABEL, t.inkMuted, true);
        h.setMaxLines(1);
        h.setEllipsize(TextUtils.TruncateAt.END);
        row.addView(h, new LinearLayout.LayoutParams(0, -2, 1));
        QueueController q = queue();
        if (q != null && r.region == Region.HISTORY) {
            row.addView(textAction(historyOpen ? "Hide" : "Show", "queue.history", () -> {
                historyOpen = !historyOpen;
                fill(controller, remote);
            }));
        } else if (q != null && r.region == Region.QUEUED) {
            row.addView(textAction("Clear queued", "queue.clear-queued", () -> {
                QueueModel.Undo u = q.clearQueued();
                if (u != null) QueueSnackbar.show(activity, "Cleared your queued", () -> q.undo(u, "clear"));
                fill(controller, remote);
            }));
        } else if (q != null && r.region == Region.RADIO) {
            ImageView mark = new ImageView(activity);
            mark.setImageResource(R.drawable.daylight_q_radio);
            mark.setImageTintList(ColorStateList.valueOf(t.inkMuted));
            row.addView(mark, new LinearLayout.LayoutParams(dp(18), dp(18)));
        }
        return row;
    }

    private TextView textAction(String words, String tag, Runnable run) {
        DaylightTheme t = theme.get();
        TextView b = t.text(activity, words, Type.LABEL, t.ink, true);
        b.setPadding(dp(12), dp(10), dp(4), dp(10));
        b.setBackground(t.pressable(null));
        UiTelemetry.tag(b, tag);
        b.setOnClickListener(v -> run.run());
        return b;
    }

    private View item(Row r, int position) {
        DaylightTheme t = theme.get();
        MediaItem item = itemAt(r.index);
        QueueController q = queue();
        boolean isNow = r.region == Region.NOW;
        boolean upcoming = r.index > (q != null ? q.model().nowIndex() : controller == null ? 0 : controller.getCurrentMediaItemIndex());
        LinearLayout row = new LinearLayout(activity);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setMinimumHeight(dp(60));
        row.setBackground(t.pressable(null));
        ImageView mark = new ImageView(activity);
        if (isNow) {
            boolean playing = controller != null && controller.isPlaying();
            mark.setImageResource(playing ? R.drawable.daylight_np_play : R.drawable.daylight_np_pause);
            mark.setImageTintList(ColorStateList.valueOf(t.primary));
            mark.setContentDescription(playing ? "Playing" : "Paused");
        } else if (r.region == Region.RADIO) {
            mark.setImageResource(R.drawable.daylight_q_radio);
            mark.setImageTintList(ColorStateList.valueOf(t.inkMuted));
            mark.setContentDescription("Radio");
        }
        row.addView(mark, new LinearLayout.LayoutParams(dp(28), dp(20)));
        LinearLayout words = new LinearLayout(activity);
        words.setOrientation(LinearLayout.VERTICAL);
        CharSequence name = item == null ? "" : item.mediaMetadata.title != null ? item.mediaMetadata.title : item.mediaId;
        TextView label = t.text(activity, name, Type.BODY, isNow ? t.primary : t.ink, isNow);
        label.setMaxLines(1);
        label.setEllipsize(TextUtils.TruncateAt.END);
        words.addView(label);
        boolean kept = q != null && item != null && playsOffline(item);
        boolean needsNet = q != null && !online && !kept && !isNow;
        CharSequence by = item == null ? null : item.mediaMetadata.artist;
        String byLine = needsNet ? "Needs a connection" : r.region == Region.RADIO
                ? (TextUtils.isEmpty(by) ? "Radio" : "Radio · " + by) : by == null ? "" : by.toString();
        if (!byLine.isEmpty()) {
            TextView who = t.text(activity, byLine, Type.LABEL, t.inkMuted, false);
            who.setMaxLines(1);
            who.setEllipsize(TextUtils.TruncateAt.END);
            words.addView(who);
        }
        row.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
        if (kept) {
            ImageView off = new ImageView(activity);
            off.setImageResource(R.drawable.daylight_q_offline);
            off.setImageTintList(ColorStateList.valueOf(t.inkMuted));
            off.setContentDescription("On this phone");
            row.addView(off, new LinearLayout.LayoutParams(dp(18), dp(18)));
        }
        if (needsNet) row.setAlpha(0.45f);
        if (q != null && upcoming && !isNow) {
            ImageView handle = new ImageView(activity);
            handle.setImageResource(R.drawable.daylight_q_drag);
            handle.setImageTintList(ColorStateList.valueOf(t.inkMuted));
            handle.setScaleType(ImageView.ScaleType.CENTER);
            handle.setContentDescription("Drag to reorder");
            UiTelemetry.tag(handle, "queue.drag");
            handle.setOnTouchListener((v, e) -> drag(e, position, r));
            row.addView(handle, new LinearLayout.LayoutParams(dp(44), dp(48)));
        }
        ImageButton menu = new ImageButton(activity);
        menu.setImageResource(R.drawable.daylight_np_more);
        menu.setImageTintList(ColorStateList.valueOf(t.inkMuted));
        menu.setBackground(t.pressable(null));
        menu.setContentDescription("More for this row");
        UiTelemetry.tag(menu, "queue.row-more");
        menu.setOnClickListener(v -> rowSheet(r));
        if (!isNow || q == null) row.addView(menu, new LinearLayout.LayoutParams(dp(40), dp(48)));
        UiTelemetry.tag(row, isNow ? "queue.current" : r.region == Region.HISTORY ? "queue.history-row" : "queue.row");
        row.setOnTouchListener(new SwipeTap(row, r));
        return row;
    }

    private View group(Row r) {
        DaylightTheme t = theme.get();
        LinearLayout row = new LinearLayout(activity);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setMinimumHeight(dp(60));
        row.setBackground(t.pressable(null));
        row.addView(new View(activity), new LinearLayout.LayoutParams(dp(28), 1));
        TextView label = t.text(activity, r.text, Type.BODY, t.ink, false);
        label.setMaxLines(1);
        label.setEllipsize(TextUtils.TruncateAt.END);
        row.addView(label, new LinearLayout.LayoutParams(0, -2, 1));
        ImageView expand = new ImageView(activity);
        expand.setImageResource(R.drawable.daylight_np_expand);
        expand.setImageTintList(ColorStateList.valueOf(t.inkMuted));
        row.addView(expand, new LinearLayout.LayoutParams(dp(40), dp(24)));
        row.setContentDescription("Show the " + r.count + " tracks");
        UiTelemetry.tag(row, "queue.group");
        row.setOnClickListener(v -> { openGroups.add(r.group); fill(controller, remote); });
        return row;
    }

    /** A book is one row: its part, and the time left in it. */
    private View book(Row r) {
        DaylightTheme t = theme.get();
        QueueController q = queue();
        MediaItem item = itemAt(r.index);
        LinearLayout row = new LinearLayout(activity);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setMinimumHeight(dp(64));
        ImageView mark = new ImageView(activity);
        boolean playing = controller != null && controller.isPlaying();
        mark.setImageResource(playing ? R.drawable.daylight_np_play : R.drawable.daylight_np_pause);
        mark.setImageTintList(ColorStateList.valueOf(t.primary));
        row.addView(mark, new LinearLayout.LayoutParams(dp(28), dp(20)));
        LinearLayout words = new LinearLayout(activity);
        words.setOrientation(LinearLayout.VERTICAL);
        CharSequence album = item == null ? null : item.mediaMetadata.albumTitle;
        CharSequence name = !TextUtils.isEmpty(album) ? album : item == null ? "" : item.mediaMetadata.title;
        TextView label = t.text(activity, name, Type.BODY, t.primary, true);
        label.setMaxLines(1);
        label.setEllipsize(TextUtils.TruncateAt.END);
        words.addView(label);
        if (q != null && item != null) {
            int parts = Math.max(r.count, q.model().sourceAll().size());
            int part = Math.max(1, q.model().at(r.index).order + 1);
            long left = -q.position();
            for (int i = r.index; i < r.index + r.count && i < q.model().size(); i++) left += NodeItems.durationMs(itemAt(i), 0);
            StringBuilder s = new StringBuilder();
            if (parts > 1) s.append("Part ").append(part).append(" of ").append(parts);
            if (left > 0) s.append(s.length() > 0 ? " · " : "").append(QueueRows.left(left));
            if (s.length() > 0) words.addView(t.text(activity, s.toString(), Type.LABEL, t.inkMuted, false));
        }
        row.addView(words, new LinearLayout.LayoutParams(0, -2, 1));
        UiTelemetry.tag(row, "queue.book");
        return row;
    }

    // ── the end card (spec §6) ──────────────────────────────────────────────

    private View endCard() {
        DaylightTheme t = theme.get();
        QueueController q = queue();
        LinearLayout card = new LinearLayout(activity);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(0, dp(14), 0, dp(24));
        if (q == null) return card;
        QueueModel<MediaItem> m = q.model();
        if (q.ended()) {
            card.addView(t.text(activity, "Finished", Type.LABEL, t.inkMuted, true));
            card.addView(choice(R.drawable.daylight_np_replay, "Play again", false, "queue.end.again", q::playAgainFromStart));
        }
        card.addView(t.text(activity, "Then", Type.LABEL, t.inkMuted, true));
        End end = q.end();
        card.addView(choice(R.drawable.daylight_q_stop, "Stop", end == End.STOP, "queue.end.stop", () -> choose(End.STOP)));
        if (m.sourceLong()) {
            int queued = m.count(Region.QUEUED);
            if (queued > 0) card.addView(choice(R.drawable.daylight_q_next, "Then: your " + queued + " queued",
                    end == End.KEEP_PLAYING, "queue.end.queued", () -> choose(End.KEEP_PLAYING)));
        } else {
            if (q.radioAvailable()) card.addView(choice(R.drawable.daylight_q_radio, "Keep playing similar",
                    end == End.KEEP_PLAYING, "queue.end.radio", () -> choose(End.KEEP_PLAYING)));
            card.addView(choice(R.drawable.daylight_np_repeat, "Repeat", end == End.REPEAT, "queue.end.repeat", () -> choose(End.REPEAT)));
        }
        return card;
    }

    private void choose(End e) {
        QueueController q = queue();
        if (q == null) return;
        q.setEnd(e);
        fill(controller, remote);
    }

    private View choice(int icon, String words, boolean selected, String tag, Runnable run) {
        DaylightTheme t = theme.get();
        LinearLayout row = new LinearLayout(activity);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setMinimumHeight(dp(52));
        row.setBackground(t.pressable(null));
        ImageView i = new ImageView(activity);
        i.setImageResource(icon);
        i.setImageTintList(ColorStateList.valueOf(selected ? t.primary : t.inkMuted));
        LinearLayout.LayoutParams il = new LinearLayout.LayoutParams(dp(24), dp(24));
        il.setMargins(dp(2), 0, dp(16), 0);
        row.addView(i, il);
        row.addView(t.text(activity, words, Type.BODY, t.ink, selected), new LinearLayout.LayoutParams(0, -2, 1));
        if (selected) {
            ImageView check = new ImageView(activity);
            check.setImageResource(R.drawable.daylight_np_check);
            check.setImageTintList(ColorStateList.valueOf(t.primary));
            row.addView(check, new LinearLayout.LayoutParams(dp(24), dp(24)));
        }
        row.setContentDescription(words + (selected ? ", chosen" : ""));
        UiTelemetry.tag(row, tag);
        row.setOnClickListener(v -> run.run());
        return row;
    }

    // ── taps, swipes, drags ─────────────────────────────────────────────────

    private void tap(Row r) {
        QueueController q = queue();
        if (q != null) {
            if (r.region == Region.HISTORY) q.playAgain(r.index);
            else if (r.region != Region.NOW) q.jump(r.index);
            return;
        }
        MediaController c = controller;
        if (c != null && r.region != Region.NOW && c.isCommandAvailable(Player.COMMAND_SEEK_TO_MEDIA_ITEM)) c.seekToDefaultPosition(r.index);
    }

    private void removeRow(Row r) {
        QueueController q = queue();
        if (q != null) {
            QueueModel.Undo u = q.remove(r.index);
            if (u != null) QueueSnackbar.show(activity, r.region == Region.HISTORY ? "Removed from history" : "Removed from the queue",
                    () -> q.undo(u, "remove"));
            fill(controller, remote);
            return;
        }
        MediaController c = controller;
        if (c != null && c.isCommandAvailable(Player.COMMAND_CHANGE_MEDIA_ITEMS)) c.removeMediaItem(r.index);
    }

    /** A row's tap and its swipe left (remove with Undo), and a long press for its sheet. */
    private final class SwipeTap implements View.OnTouchListener {
        private final View row;
        private final Row r;
        private float x0, y0;
        private boolean swiping, moved, longDone;
        private final int slop = ViewConfiguration.get(activity).getScaledTouchSlop();
        private final Runnable longPress;

        SwipeTap(View row, Row r) {
            this.row = row;
            this.r = r;
            this.longPress = () -> { longDone = true; rowSheet(r); };
        }

        @Override public boolean onTouch(View v, MotionEvent e) {
            boolean swipeable = r.region != Region.NOW && (queue() != null || controller != null);
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    x0 = e.getRawX(); y0 = e.getRawY(); swiping = false; moved = false; longDone = false;
                    v.setPressed(true);
                    main.postDelayed(longPress, ViewConfiguration.getLongPressTimeout());
                    return true;
                case MotionEvent.ACTION_MOVE: {
                    float dx = e.getRawX() - x0, dy = e.getRawY() - y0;
                    if (!moved && (Math.abs(dx) > slop || Math.abs(dy) > slop)) { moved = true; main.removeCallbacks(longPress); v.setPressed(false); }
                    if (!swiping && swipeable && dx < -slop && Math.abs(dx) > Math.abs(dy) * 1.5f) {
                        swiping = true;
                        list.requestDisallowInterceptTouchEvent(true);
                    }
                    if (swiping) row.setTranslationX(Math.min(0, dx));
                    return true;
                }
                case MotionEvent.ACTION_UP: {
                    main.removeCallbacks(longPress);
                    v.setPressed(false);
                    if (swiping) {
                        float dx = e.getRawX() - x0;
                        if (dx < -row.getWidth() * 0.33f) {
                            row.animate().translationX(-row.getWidth()).alpha(0f).setDuration(140)
                                    .withEndAction(() -> { row.setTranslationX(0); row.setAlpha(1f); removeRow(r); }).start();
                        } else {
                            row.animate().translationX(0).setDuration(140).start();
                        }
                    } else if (!moved && !longDone) {
                        tap(r);
                    }
                    return true;
                }
                case MotionEvent.ACTION_CANCEL:
                    main.removeCallbacks(longPress);
                    v.setPressed(false);
                    row.animate().translationX(0).setDuration(120).start();
                    return true;
                default:
                    return false;
            }
        }
    }

    private int dragFrom = -1, dropAt = -1;
    private final int[] listOnScreen = new int[2];

    /** The handle: hold and move the row to its new place; a line shows where it lands. */
    private boolean drag(MotionEvent e, int position, Row r) {
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                dragFrom = position;
                dropAt = position;
                list.requestDisallowInterceptTouchEvent(true);
                list.getLocationOnScreen(listOnScreen);
                View me = list.getChildAt(position - list.getFirstVisiblePosition());
                if (me != null) me.setAlpha(0.5f);
                return true;
            case MotionEvent.ACTION_MOVE: {
                float y = e.getRawY() - listOnScreen[1];
                if (y < dp(48)) list.smoothScrollBy(-dp(24), 40);
                else if (y > list.getHeight() - dp(48)) list.smoothScrollBy(dp(24), 40);
                int p = list.pointToPosition(dp(20), (int) Math.max(0, Math.min(list.getHeight() - 1, y)));
                if (p != AbsListView.INVALID_POSITION) {
                    dropAt = p;
                    View target = list.getChildAt(p - list.getFirstVisiblePosition());
                    if (target != null) {
                        dropLine.setVisibility(View.VISIBLE);
                        dropLine.setTranslationY(target.getTop());
                    }
                }
                return true;
            }
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL: {
                dropLine.setVisibility(View.GONE);
                for (int i = 0; i < list.getChildCount(); i++) list.getChildAt(i).setAlpha(1f);
                int from = dragFrom, at = dropAt;
                dragFrom = -1;
                if (e.getActionMasked() == MotionEvent.ACTION_UP && at >= 0 && at != from) drop(r, at);
                return true;
            }
            default:
                return false;
        }
    }

    /** Puts the dragged row before the row it was dropped on, in that row's section. */
    private void drop(Row dragged, int at) {
        QueueController q = queue();
        if (q == null || at >= rows.size()) return;
        QueueModel<MediaItem> m = q.model();
        Row target = rows.get(at);
        int before;
        Region region;
        switch (target.kind) {
            case HEADER:
                if (target.region == Region.HISTORY || target.region == Region.NOW) { before = m.nowIndex() + 1; region = firstUpcoming(m); }
                else {
                    before = target.index;
                    // Dropped above "Next from …" with nothing queued: it becomes yours.
                    region = target.region == Region.SOURCE && m.count(Region.QUEUED) == 0 && !m.sourceLong() ? Region.QUEUED : target.region;
                }
                break;
            case END:
                before = m.size();
                region = m.size() > m.nowIndex() + 1 ? m.at(m.size() - 1).region : Region.QUEUED;
                break;
            default:
                if (target.region == Region.HISTORY || target.region == Region.NOW) { before = m.nowIndex() + 1; region = firstUpcoming(m); }
                else { before = target.index; region = target.region; }
        }
        int from = dragged.index;
        int to = from < before ? before - 1 : before;
        if (q.move(from, to, region)) fill(controller, remote);
    }

    private static Region firstUpcoming(QueueModel<MediaItem> m) {
        return m.sourceLong() ? Region.SOURCE : Region.QUEUED;
    }

    // ── sheets ──────────────────────────────────────────────────────────────

    private void rowSheet(Row r) {
        if (r.kind != Kind.ITEM) return;
        MediaItem item = itemAt(r.index);
        if (item == null) return;
        QueueController q = queue();
        String name = item.mediaMetadata.title == null ? "" : item.mediaMetadata.title.toString();
        String by = item.mediaMetadata.artist == null ? "" : item.mediaMetadata.artist.toString();
        Bitmap cover = item.mediaMetadata.artworkUri == null ? null
                : net.kckern.daylight.shellkit.PlaylistArtwork.cachedAny(item.mediaMetadata.artworkUri.toString(), dp(48));
        QueueSheet sheet = new QueueSheet(activity, name, by, cover);
        boolean spoken = NodeItems.longFormKind(item);
        if (q != null && r.region == Region.HISTORY) {
            sheet.add(R.drawable.daylight_np_play, "Play again", "queue.sheet.again", () -> q.playAgain(r.index));
        } else if (q != null && r.region != Region.NOW && !spoken) {
            sheet.add(R.drawable.daylight_q_next, "Play next", "queue.sheet.next", () -> {
                if (q.playNextFrom(r.index)) QueueSnackbar.show(activity, "Plays next", null);
                fill(controller, remote);
            });
        }
        if (!remote && !spoken) {
            sheet.add(R.drawable.daylight_q_album, "Go to album", "queue.sheet.album", () -> goTo(item, "albums"));
            sheet.add(R.drawable.daylight_q_artist, "Go to artist", "queue.sheet.artist", () -> goTo(item, "artists"));
        }
        if (r.region != Region.NOW) {
            sheet.destructive(R.drawable.daylight_q_delete, r.region == Region.HISTORY ? "Remove from history" : "Remove",
                    "queue.sheet.remove", () -> removeRow(r));
        }
        sheet.show();
    }

    /** Opens the item's album or artist page, from its own ids; else the search on the name. */
    private void goTo(MediaItem item, String kind) {
        String cid = BrowseActivity.contentIdOf(item.mediaId);
        CharSequence words = "albums".equals(kind) ? item.mediaMetadata.albumTitle : item.mediaMetadata.artist;
        String w = words == null ? "" : words.toString();
        io.execute(() -> {
            JSONObject page = null;
            try {
                JSONObject parents = new JSONObject(media.parents(cid, 6000)).optJSONObject("parents");
                page = parents == null ? null : parents.optJSONObject("albums".equals(kind) ? "album" : "artist");
            } catch (Exception unreachable) { /* the search on the name instead */ }
            JSONObject p = page;
            main.post(() -> {
                if (activity.isFinishing()) return;
                if (p != null && !p.optString("id").isEmpty()) {
                    BrowseActivity.open(activity, "level", p.optString("id"), p.optString("kind"), p.optString("title"), "", "");
                } else if (!w.isEmpty()) {
                    BrowseActivity.search(activity, w, kind);
                }
            });
        });
    }

    /** The screen's ⋮: Clear all but now playing, Save as playlist. */
    private void openMore() {
        QueueController q = queue();
        if (q == null) return;
        QueueSheet sheet = new QueueSheet(activity, "Queue", q.model().label().isEmpty() ? "" : "Next from " + q.model().label(), null);
        sheet.add(R.drawable.daylight_q_save, "Save as playlist", "queue.save", this::savePlaylist);
        if (q.model().size() > q.model().nowIndex() + 1) {
            sheet.destructive(R.drawable.daylight_q_clear, "Clear all but now playing", "queue.clear-all", () -> {
                QueueModel.Undo u = q.clearUpcoming();
                if (u != null) QueueSnackbar.show(activity, "Cleared the queue", () -> q.undo(u, "clear"));
                fill(controller, remote);
            });
        }
        sheet.show();
    }

    /** Now playing plus Queued by you plus Next from &lt;source&gt;, as a household list named "Queue <date>". */
    private void savePlaylist() {
        QueueController q = queue();
        if (q == null) return;
        DaylightTheme t = theme.get();
        EditText field = new EditText(activity);
        field.setSingleLine(true);
        field.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        field.setText(QueueRows.playlistName(java.util.Calendar.getInstance()));
        field.setSelectAllOnFocus(true);
        field.setTextColor(t.ink);
        LinearLayout box = new LinearLayout(activity);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(16), 0, dp(16), dp(8));
        box.addView(t.text(activity, "Name", Type.LABEL, t.inkMuted, false));
        box.addView(field);
        TextView save = t.text(activity, "Save", Type.BODY, t.onPrimary, true);
        save.setGravity(Gravity.CENTER);
        save.setBackground(t.round(t.primary, DaylightTheme.Radius.SMALL));
        save.setMinHeight(dp(48));
        UiTelemetry.tag(save, "queue.save.confirm");
        LinearLayout.LayoutParams sl = new LinearLayout.LayoutParams(-1, -2);
        sl.setMargins(0, dp(12), 0, 0);
        box.addView(save, sl);
        int count = 0;
        QueueModel<MediaItem> m = q.model();
        for (int i = m.nowIndex(); i >= 0 && i < m.size(); i++) if (m.at(i).region != Region.RADIO) count++;
        android.app.Dialog dialog = new QueueSheet(activity, "Save as playlist", count + (count == 1 ? " item" : " items") + ", in queue order", null)
                .extra(box).show();
        save.setOnClickListener(v -> {
            String name = field.getText().toString().trim();
            if (name.isEmpty()) return;
            dialog.dismiss();
            saveAs(name);
        });
    }

    private void saveAs(String name) {
        QueueController q = queue();
        if (q == null) return;
        QueueModel<MediaItem> m = q.model();
        JSONArray items = new JSONArray();
        try {
            for (int i = m.nowIndex(); i >= 0 && i < m.size(); i++) {
                QueueModel.Entry<MediaItem> e = m.at(i);
                if (e.region == Region.RADIO) continue;
                String cid = BrowseActivity.contentIdOf(e.item.mediaId);
                if (cid.isEmpty()) continue;
                items.put(new JSONObject().put("id", cid).put("title", e.item.mediaMetadata.title == null ? "" : e.item.mediaMetadata.title.toString()));
            }
        } catch (Exception broken) { return; }
        final int count = items.length();
        QueueSnackbar.show(activity, "Saving " + name + "…", null);
        io.execute(() -> {
            String line;
            String id = "";
            try {
                JSONObject reply = new JSONObject(media.savePlaylist(name, items, 15_000));
                id = reply.optString("id");
                line = reply.optBoolean("ok") && !id.isEmpty() ? "Saved to Your playlists" : "Could not save the playlist";
            } catch (Exception e) {
                line = "Can't reach home: the playlist was not saved";
            }
            String said = line, made = id;
            main.post(() -> {
                if (!made.isEmpty()) {
                    new DrivingRadioSettings(activity).stage(made, name, false);
                    q.event("queue.save_playlist", "count", count);
                }
                if (!activity.isFinishing()) QueueSnackbar.show(activity, said, null);
            });
        });
    }
}

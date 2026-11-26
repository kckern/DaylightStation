package net.kckern.daylight.cap.mediaservice.shell;

import android.content.Context;
import android.os.SystemClock;
import android.text.TextUtils;
import android.view.MotionEvent;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import net.kckern.daylight.shellkit.DaylightTheme;

/**
 * Lyrics in place of the cover. Synced lyrics follow the song: the line being sung is
 * full ink and bold and sits a third of the way down, the rest are dimmed, and a tap on
 * a line seeks there. Unsynced lyrics are plain text to read and scroll. After the user
 * scrolls, the view leaves the position alone for HOLD_MS before following again
 * (as Plexamp and Spotify do).
 */
final class LyricsView extends ScrollView {
    interface SeekTo { void seekTo(long ms); }

    private static final long HOLD_MS = 4000;
    private final LinearLayout column;
    private TrackDetail.Lyrics lyrics = TrackDetail.Lyrics.NONE;
    private DaylightTheme theme;
    private SeekTo seek;
    private int current = -2;
    private long heldUntil;

    LyricsView(Context context) {
        super(context);
        setVerticalScrollBarEnabled(false);
        setFillViewport(true);
        column = new LinearLayout(context);
        column.setOrientation(LinearLayout.VERTICAL);
        addView(column, new LayoutParams(-1, -2));
    }

    void setTheme(DaylightTheme t) {
        theme = t;
        restyle();
    }

    void setSeek(SeekTo s) { seek = s; }

    void setLyrics(TrackDetail.Lyrics l) {
        lyrics = l == null ? TrackDetail.Lyrics.NONE : l;
        current = -2;
        column.removeAllViews();
        int pad = dp(8);
        int top = lyrics.synced ? getHeight() / 3 : dp(8);
        column.setPadding(0, Math.max(dp(8), top), 0, lyrics.synced ? getHeight() / 2 : dp(24));
        for (int i = 0; i < lyrics.lines.length; i++) {
            TextView line = new TextView(getContext());
            String text = lyrics.lines[i];
            // A timed empty line is an instrumental gap: a short rest mark, not nothing.
            line.setText(TextUtils.isEmpty(text.trim()) ? (lyrics.synced ? "♪" : " ") : text);
            line.setPadding(0, pad, 0, pad);
            net.kckern.daylight.shellkit.UiTelemetry.tag(line, "lyrics.line");
            final long at = lyrics.times[i];
            if (lyrics.synced && at >= 0) {
                line.setOnClickListener(v -> { if (seek != null) seek.seekTo(at); });
            }
            column.addView(line, new LinearLayout.LayoutParams(-1, -2));
        }
        restyle();
        scrollTo(0, 0);
    }

    TrackDetail.Lyrics lyrics() { return lyrics; }

    /** Follows the song to {@code positionMs}. */
    void setPosition(long positionMs) {
        int now = lyrics.indexAt(positionMs);
        if (now == current) return;
        current = now;
        restyle();
        if (now >= 0 && SystemClock.elapsedRealtime() >= heldUntil) {
            View line = column.getChildAt(now);
            if (line != null) smoothScrollTo(0, Math.max(0, line.getTop() - getHeight() / 3));
        }
    }

    @Override public boolean onTouchEvent(MotionEvent e) {
        heldUntil = SystemClock.elapsedRealtime() + HOLD_MS;
        return super.onTouchEvent(e);
    }

    @Override protected void onSizeChanged(int w, int h, int oldW, int oldH) {
        super.onSizeChanged(w, h, oldW, oldH);
        if (h != oldH && lyrics.synced) column.setPadding(0, h / 3, 0, h / 2);
    }

    private void restyle() {
        if (theme == null) return;
        for (int i = 0; i < column.getChildCount(); i++) {
            TextView line = (TextView) column.getChildAt(i);
            boolean on = lyrics.synced && i == current;
            int color = !lyrics.synced ? theme.ink : on ? theme.ink : DaylightTheme.withAlpha(theme.ink, 0x70);
            theme.style(line, lyrics.synced ? DaylightTheme.Type.HEADLINE : DaylightTheme.Type.TITLE, color, lyrics.synced);
        }
    }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }
}

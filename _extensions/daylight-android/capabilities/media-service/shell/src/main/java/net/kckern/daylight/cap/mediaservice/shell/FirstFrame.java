package net.kckern.daylight.cap.mediaservice.shell;

import net.kckern.daylight.shellkit.NowPlayingNote;

/**
 * What Now playing draws before its controller has answered: the mini player's own entry
 * (title, artist, cover, place, playing) when it is for the target being opened, a
 * screen's last known snapshot, or the last state drawn before the player went away. The
 * person tapped something that showed all of this; opening on "Nothing playing" until a
 * controller connects reads as a failure. Pure.
 *
 * <p>A frame is shown greyed (no control acts on it) with a line saying why it is not live
 * yet: "Connecting…" on open, "Reconnecting…" after the player went away, "Checking
 * <screen>…" for a screen's remembered state.
 */
final class FirstFrame {
    enum Why { CONNECTING, RECONNECTING, CHECKING }

    final NowPlayingNote.Entry entry;
    final Why why;

    private FirstFrame(NowPlayingNote.Entry entry, Why why) {
        this.entry = entry;
        this.why = why;
    }

    /** The mini player's entry, when it is for {@code target} and names something; else null. */
    static FirstFrame seed(NowPlayingNote.Entry current, String target) {
        if (current == null || target == null || !target.equals(current.target) || current.title.isEmpty()) return null;
        return new FirstFrame(current, Why.CONNECTING);
    }

    /** The last state drawn, kept on screen while the player reconnects. */
    static FirstFrame lost(NowPlayingNote.Entry last) {
        return last == null || last.title.isEmpty() ? null : new FirstFrame(last, Why.RECONNECTING);
    }

    /** A screen's remembered snapshot as a frame (its current entry), or null when it shows nothing. */
    static FirstFrame screen(ScreenSnapshot snap, String device, long at) {
        if (snap == null || device == null) return null;
        ScreenSnapshot.Entry now = snap.currentEntry();
        if (now == null || now.title.trim().isEmpty()) return null;
        boolean playing = "playing".equals(snap.state);
        String art = now.thumbnail.startsWith("https://") ? now.thumbnail : "";
        return new FirstFrame(new NowPlayingNote.Entry(device, "", now.title.trim(), "", art, playing, false,
                snap.positionMs, now.durationMs > 0 ? now.durationMs : -1, at, null), Why.CHECKING);
    }

    /** The line under the frame. */
    String line(String where) {
        switch (why) {
            case RECONNECTING: return "Reconnecting…";
            case CHECKING: return where == null || where.isEmpty() ? "Checking…" : "Checking " + where + "…";
            default: return "Connecting…";
        }
    }

    /** Where the frame's track is at {@code now}: carried forward only while connecting to what played. */
    long positionAt(long now) {
        return why == Why.CONNECTING ? entry.positionAt(now) : Math.max(0, Math.min(entry.positionMs,
                entry.durationMs > 0 ? entry.durationMs : Long.MAX_VALUE));
    }

    /** 0..1 through the track, or -1 when its length is unknown. */
    float fractionAt(long now) {
        return entry.durationMs > 0 ? positionAt(now) / (float) entry.durationMs : -1f;
    }
}

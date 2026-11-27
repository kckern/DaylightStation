package net.kckern.daylight.cap.mediaservice.shell;

import android.content.Intent;

/**
 * What was just tapped to play, shown by Now playing from its first frame until the player
 * has it (ops:docs/superpowers/specs/2026-11-26-phone-lookup-and-browse.md, "Nothing jumps").
 * The player resolves an item asynchronously (a list from home, a book's parts); before
 * this, Now playing opened on "Nothing playing" for that moment, which reads as a failure.
 *
 * <p>Any screen that starts playback and opens Now playing puts these extras on the Now
 * playing intent. They are plain strings so a screen in another capability (the phone
 * home's Play tab) can set them by name.
 */
final class Starting {
    static final String EXTRA_ID = "starting.id";
    static final String EXTRA_TITLE = "starting.title";
    static final String EXTRA_SUBTITLE = "starting.subtitle";
    static final String EXTRA_ART = "starting.art";
    /** Session extra (elapsedRealtime ms): the player refused the last play request (LibraryCallback). */
    static final String EXTRA_REFUSED_AT = "start.refusedAt";
    private static final String SAVED = "starting.saved.";

    /** After this, the line says it is taking longer. */
    static final long SLOW_MS = 8_000;
    /** After this with nothing playing, it is a failure with a retry. */
    static final long GIVE_UP_MS = 30_000;

    enum Phase { STARTING, SLOW, FAILED }

    final String target, mediaId, title, subtitle, art;
    final long askedAt;
    private boolean failed;

    Starting(String target, String mediaId, String title, String subtitle, String art, long askedAt) {
        this.target = nz(target);
        this.mediaId = nz(mediaId);
        this.title = nz(title);
        this.subtitle = nz(subtitle);
        this.art = nz(art);
        this.askedAt = askedAt;
    }

    /** The starting item an intent carries for {@code target}, or null when it carries none. */
    static Starting from(Intent intent, String target, long now) {
        if (intent == null) return null;
        String title = intent.getStringExtra(EXTRA_TITLE);
        if (title == null || title.trim().isEmpty()) return null;
        return new Starting(target, intent.getStringExtra(EXTRA_ID), title.trim(),
                intent.getStringExtra(EXTRA_SUBTITLE), intent.getStringExtra(EXTRA_ART), now);
    }

    /** Puts the starting item on a Now playing intent (title required; the rest may be empty). */
    static Intent put(Intent intent, String mediaId, String title, String subtitle, String art) {
        if (title == null || title.trim().isEmpty()) return intent;
        return intent.putExtra(EXTRA_ID, nz(mediaId)).putExtra(EXTRA_TITLE, title.trim())
                .putExtra(EXTRA_SUBTITLE, nz(subtitle)).putExtra(EXTRA_ART, nz(art));
    }

    /** Kept over a rotation or a recreated screen: askedAt is elapsedRealtime, which survives both. */
    void save(android.os.Bundle out) {
        out.putString(SAVED + "target", target);
        out.putString(SAVED + "id", mediaId);
        out.putString(SAVED + "title", title);
        out.putString(SAVED + "subtitle", subtitle);
        out.putString(SAVED + "art", art);
        out.putLong(SAVED + "at", askedAt);
        out.putBoolean(SAVED + "failed", failed);
    }

    static Starting restore(android.os.Bundle saved) {
        if (saved == null || saved.getString(SAVED + "title") == null) return null;
        Starting s = new Starting(saved.getString(SAVED + "target"), saved.getString(SAVED + "id"), saved.getString(SAVED + "title"),
                saved.getString(SAVED + "subtitle"), saved.getString(SAVED + "art"), saved.getLong(SAVED + "at"));
        if (saved.getBoolean(SAVED + "failed")) s.fail();
        return s;
    }

    /** The player reported an error, or refused the request, before it had the item. */
    void fail() { failed = true; }

    Phase phase(long now) {
        if (failed || now - askedAt >= GIVE_UP_MS) return Phase.FAILED;
        return now - askedAt >= SLOW_MS ? Phase.SLOW : Phase.STARTING;
    }

    /** The status line while starting; {@code where} is "" on this phone, or a screen's name. */
    String line(long now, String where) {
        if (phase(now) == Phase.SLOW) return where.isEmpty() ? "Still starting… home is slow" : "Still starting on " + where + "…";
        return where.isEmpty() ? "Starting…" : "Starting on " + where + "…";
    }

    /** The line shown under the real state once starting failed (tappable to retry on this phone). */
    String failedLine(String where) {
        if (!where.isEmpty()) return where + " didn't start " + title;
        return mediaId.isEmpty() ? "Couldn't start " + title : "Couldn't start " + title + " · tap to try again";
    }

    /** True when a retry is possible (this phone, failed, and the id is known). */
    boolean retryable(long now) {
        return phase(now) == Phase.FAILED && !mediaId.isEmpty();
    }

    private static String nz(String s) { return s == null ? "" : s; }
}

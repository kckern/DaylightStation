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
    /**
     * Now playing starts the item itself (on its own controller, once per intent), so no
     * second screen sits over it: the Play tab's cards and tiles, a media link, Play on.
     */
    static final String EXTRA_PLAY = "starting.play";
    /** With EXTRA_PLAY: the list is asked of home shuffled. */
    static final String EXTRA_SHUFFLE = "starting.shuffle";
    /** The tapped item is long (a book, a talk): its chapter line is reserved from the first frame. */
    static final String EXTRA_LONG = "starting.long";
    /** Beside Now playing's "target": the target's name, so no raw device id is ever shown. */
    static final String EXTRA_TARGET_NAME = "targetName";
    /** Session extra (elapsedRealtime ms): the player refused the last play request (LibraryCallback). */
    static final String EXTRA_REFUSED_AT = "start.refusedAt";
    private static final String SAVED = "starting.saved.";

    /** After this, the line says it is taking longer. */
    static final long SLOW_MS = 8_000;
    /** After this with nothing playing, it is a failure with a retry (a warm start's PlayBudget). */
    static final long GIVE_UP_MS = PlayBudget.WARM_MS;

    enum Phase { STARTING, SLOW, FAILED }

    final String target, mediaId, title, subtitle, art;
    final long askedAt;
    /** How long this start may take (PlayBudget): a cold payload or a screen has more. */
    long giveUpMs = GIVE_UP_MS;
    /** The tapped item is long: the chapter line keeps its place from the first frame. */
    boolean longForm;
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
        boolean play = intent.getBooleanExtra(EXTRA_PLAY, false);
        // A start Now playing makes itself may come with only an id (a media link).
        if ((title == null || title.trim().isEmpty()) && !play) return null;
        Starting s = new Starting(target, intent.getStringExtra(EXTRA_ID), title == null ? "" : title.trim(),
                intent.getStringExtra(EXTRA_SUBTITLE), intent.getStringExtra(EXTRA_ART), now);
        s.longForm = intent.getBooleanExtra(EXTRA_LONG, false);
        return s;
    }

    /**
     * What a screen is asked to load for a media id: {"queue", content id} for a list
     * ("c:"), {"play", content id} for an item ("p:id" or "p:id|parent"), or null for
     * anything else.
     */
    static String[] screenLoad(String mediaId) {
        if (mediaId == null || mediaId.length() < 3 || mediaId.charAt(1) != ':') return null;
        String rest = mediaId.substring(2);
        if (mediaId.startsWith("c:")) return rest.isEmpty() ? null : new String[] { "queue", rest };
        if (!mediaId.startsWith("p:")) return null;
        int bar = rest.indexOf('|');
        String id = bar < 0 ? rest : rest.substring(0, bar);
        return id.isEmpty() ? null : new String[] { "play", id };
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
        out.putLong(SAVED + "budget", giveUpMs);
        out.putBoolean(SAVED + "long", longForm);
    }

    static Starting restore(android.os.Bundle saved) {
        if (saved == null || saved.getString(SAVED + "title") == null) return null;
        Starting s = new Starting(saved.getString(SAVED + "target"), saved.getString(SAVED + "id"), saved.getString(SAVED + "title"),
                saved.getString(SAVED + "subtitle"), saved.getString(SAVED + "art"), saved.getLong(SAVED + "at"));
        if (saved.getBoolean(SAVED + "failed")) s.fail();
        s.giveUpMs = saved.getLong(SAVED + "budget", GIVE_UP_MS);
        s.longForm = saved.getBoolean(SAVED + "long", false);
        return s;
    }

    /** The player reported an error, or refused the request, before it had the item. */
    void fail() { failed = true; }

    Phase phase(long now) {
        if (failed || now - askedAt >= giveUpMs) return Phase.FAILED;
        return now - askedAt >= SLOW_MS ? Phase.SLOW : Phase.STARTING;
    }

    /** The status line while starting; {@code where} is "" on this phone, or a screen's name. */
    String line(long now, String where) {
        if (phase(now) == Phase.SLOW) return where.isEmpty() ? "Still starting… home is slow" : "Still starting on " + where + "…";
        return where.isEmpty() ? "Starting…" : "Starting on " + where + "…";
    }

    /** The line shown under the real state once starting failed (tappable to retry on this phone). */
    String failedLine(String where) {
        String what = title.isEmpty() ? "it" : title;
        if (!where.isEmpty()) return where + " didn't start " + what;
        return mediaId.isEmpty() ? "Couldn't start " + what : "Couldn't start " + what + " · tap to try again";
    }

    /** True when a retry is possible (this phone, failed, and the id is known). */
    boolean retryable(long now) {
        return phase(now) == Phase.FAILED && !mediaId.isEmpty();
    }

    private static String nz(String s) { return s == null ? "" : s; }
}

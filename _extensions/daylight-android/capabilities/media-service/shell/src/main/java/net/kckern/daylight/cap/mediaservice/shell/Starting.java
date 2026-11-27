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
    /**
     * What this phone's player held at the tap (its media id; "" for nothing), from the
     * tapping screen when it knows (Browse's own controller). Without it, Now playing notes
     * the previous item only from what its controller saw before the tap (notePrevious).
     */
    static final String EXTRA_PREVIOUS = "starting.previous";
    /** Beside Now playing's "target": the target's name, so no raw device id is ever shown. */
    static final String EXTRA_TARGET_NAME = "targetName";
    /** Session extra (elapsedRealtime ms): the player refused the last play request (LibraryCallback). */
    static final String EXTRA_REFUSED_AT = "start.refusedAt";
    /** The payload's code for that refusal ("unreachable", "backend_refused", "not_found", "starting", ""). */
    static final String EXTRA_REFUSED_WHY = "start.refusedWhy";
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

    /** A start known only by what was tapped (a link with no title, the mini player's entry): "Starting…" until it lands. */
    static Starting bare(String target, String mediaId, long askedAt) {
        return new Starting(target, mediaId, "", "", "", askedAt);
    }

    /**
     * The content id that was playing when the tap happened (the previous item), once known;
     * null until then. While the player still holds it, the start has not landed, whatever
     * its name or how long it has played (2026-11-27: a track tapped while another played
     * showed the old one for 3 s, because "playing for 1.5 s" counted as landed).
     */
    String previous;

    /** The tapping screen's answer (EXTRA_PREVIOUS): what the player held at the tap, "" for nothing. Wins over notePrevious. */
    void previousAtTap(String id) {
        previous = bareId(id);
    }

    /**
     * What a tapping screen passes as EXTRA_PREVIOUS: its own connected controller's item
     * ("" for none, or for a request still resolving), else this phone's mini player entry,
     * which the service reported before the tap ("" when nothing is loaded). Null when it
     * cannot know (another start in flight, an entry with no id): the extra is left off.
     */
    static String previousAt(boolean connected, String controllerId, net.kckern.daylight.shellkit.NowPlayingNote.Entry note) {
        if (connected) return controllerId == null || NowPlayingActivity.isRequest(controllerId) ? "" : controllerId;
        if (note == null) return "";
        return note.starting || note.mediaId.isEmpty() ? null : note.mediaId;
    }

    /**
     * Notes what a controller saw the player holding, as of {@code seenAt} (elapsedRealtime):
     * only an item it held from before the tap is the previous one. A controller that
     * connected after the tap may already see the tapped item (a kept album resolves on the
     * phone at once, before Now playing connects); that is never "previous" (2026-11-27: it
     * was, and the album showed "Starting…" over its own playing track). Only the first
     * counted call counts.
     */
    void notePrevious(String currentId, long seenAt) {
        if (previous == null && seenAt <= askedAt) previous = bareId(currentId);
    }

    /**
     * True while {@code id} (a player's media id: "plex:1", "p:plex:1|plex:9", "c:plex:2")
     * is not what was tapped: Now playing, the mini player and the queue then show only the
     * tapped item, never this one. A tapped list ("c:") matches its own id; a tapped track
     * ("p:id|parent") its own id, never its parent (another track of the same album is not it).
     */
    boolean suppresses(String id) {
        String want = tappedId();
        if (want.isEmpty() || id == null) return true;
        for (String part : id.split("\\|")) if (want.equals(bareId(part))) return false;
        return true;
    }

    /**
     * Whether the player now holds the tapped item: never while it shows our own request or
     * still holds the previous item; at once when its item or list is the tapped id; else on
     * a change after the tap, a matching name, or (connected after the change) playing a while.
     */
    boolean landed(String currentId, String listId, boolean request, boolean changedSinceTap,
                   boolean nameMatches, boolean playingAWhile) {
        if (request) return false;
        if (currentId != null && !currentId.isEmpty() && !suppresses(currentId)) return true;
        if (listId != null && !listId.isEmpty() && mediaId.startsWith("c:") && !suppresses(listId)) return true;
        if (previous != null && !previous.isEmpty() && previous.equals(bareId(currentId))) return false;
        return changedSinceTap || nameMatches || playingAWhile;
    }

    /** The tapped item's own content id: "plex:2" for "c:plex:2" and for "p:plex:2|plex:1". */
    String tappedId() {
        String id = mediaId;
        int bar = id.indexOf('|');
        if (bar >= 0) id = id.substring(0, bar);
        return bareId(id);
    }

    private static String bareId(String id) {
        if (id == null) return "";
        String t = id.trim();
        return t.length() > 2 && t.charAt(1) == ':' && (t.charAt(0) == 'c' || t.charAt(0) == 'p') ? t.substring(2) : t;
    }

    /** The starting item an intent carries for {@code target}, or null when it carries none. */
    static Starting from(Intent intent, String target, long now) {
        if (intent == null) return null;
        return of(target, now, intent.getStringExtra(EXTRA_ID), intent.getStringExtra(EXTRA_TITLE),
                intent.getStringExtra(EXTRA_SUBTITLE), intent.getStringExtra(EXTRA_ART),
                intent.getBooleanExtra(EXTRA_PLAY, false), intent.getBooleanExtra(EXTRA_LONG, false),
                intent.hasExtra(EXTRA_PREVIOUS) ? intent.getStringExtra(EXTRA_PREVIOUS) : null);
    }

    /**
     * The starting item from an intent's extras ({@code previous} null when the intent has no
     * EXTRA_PREVIOUS), or null when it carries none. Pure.
     */
    static Starting of(String target, long now, String id, String title, String subtitle, String art,
                       boolean play, boolean longForm, String previous) {
        // A start Now playing makes itself may come with only an id (a media link); any
        // start with an id is shown starting, never as whatever played before it.
        if ((title == null || title.trim().isEmpty()) && !play && (id == null || id.trim().isEmpty())) return null;
        Starting s = new Starting(target, id, title == null ? "" : title.trim(), subtitle, art, now);
        s.longForm = longForm;
        if (previous != null) s.previousAtTap(previous);
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

    /** Puts the starting item on a Now playing intent (a title or an id; the rest may be empty). */
    static Intent put(Intent intent, String mediaId, String title, String subtitle, String art) {
        if ((title == null || title.trim().isEmpty()) && (mediaId == null || mediaId.trim().isEmpty())) return intent;
        return intent.putExtra(EXTRA_ID, nz(mediaId)).putExtra(EXTRA_TITLE, nz(title).trim())
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
        if (previous != null) out.putString(SAVED + "previous", previous);
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
        s.previous = saved.getString(SAVED + "previous");
        return s;
    }

    /** The player reported an error, or refused the request, before it had the item. */
    void fail() { failed = true; }

    /** Why it was refused, as the line says it ("" when not known). */
    private String why = "";

    /** Refused, with the payload's code and whether Android has a working network (audit: one line for every cause). */
    void fail(String code, boolean online) {
        failed = true;
        why = whyWords(code, online);
    }

    static String whyWords(String code, boolean online) {
        String c = code == null ? "" : code;
        if (c.contains("starting")) return "still starting up";
        if (c.contains("not_found") || c.contains("bad_request")) return "home does not have it";
        if (c.contains("refused") || c.contains("forbidden")) return "home refused this phone";
        if (c.contains("unreachable") || c.contains("timeout")) return online ? "home isn't answering" : "offline";
        return "";
    }

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
        if (!where.isEmpty()) return where + " didn't start " + what + (why.isEmpty() ? "" : ": " + why);
        String head = "Couldn't start " + what + (why.isEmpty() ? "" : ": " + why);
        return mediaId.isEmpty() ? head : head + " · tap to try again";
    }

    /** True when a retry is possible (this phone, failed, and the id is known). */
    boolean retryable(long now) {
        return phase(now) == Phase.FAILED && !mediaId.isEmpty();
    }

    private static String nz(String s) { return s == null ? "" : s; }
}

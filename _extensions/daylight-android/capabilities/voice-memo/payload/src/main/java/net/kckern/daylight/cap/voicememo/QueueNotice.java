package net.kckern.daylight.cap.voicememo;

/**
 * What the owner is told about the upload queue, from its state. Pure. A notice is
 * a count and a state, never anything about what a memo holds.
 */
final class QueueNotice {
    static final String ID = "memo-queue";
    /** A tap opens this link: it tries everything again and says what is there. Keyed by the notifications capability. */
    static final String LINK = "daylight://memo/queue";
    /** The Discard action of a notice about parked memos. Asked twice before anything is deleted. */
    static final String DISCARD_LINK = "daylight://memo/discard";
    static final String DISCARD_LABEL = "Discard";

    final String title;
    final String text;
    final String link = LINK;
    /** The label of the notice's one action, or "" for none. */
    final String actionLabel;
    final String actionLink;

    private QueueNotice(String title, String text) { this(title, text, false); }

    private QueueNotice(String title, String text, boolean discard) {
        this.title = title;
        this.text = text;
        this.actionLabel = discard ? DISCARD_LABEL : "";
        this.actionLink = discard ? DISCARD_LINK : "";
    }

    static QueueNotice of(int waiting, int parked, String blocked) { return of(waiting, parked, blocked, false, 0); }

    /**
     * @param waiting      memos queued or being sent
     * @param parked       memos that were refused or gave up
     * @param blocked      why nothing can be sent at all, or ""
     * @param notAllowed   the backend does not take memos from this phone for this user yet
     * @param limitUntilMs when the backend takes memos again after its daily allowance; 0 when not held
     * @return null when there is nothing to tell, and a notice that is up should come down
     */
    static QueueNotice of(int waiting, int parked, String blocked, boolean notAllowed, long limitUntilMs) {
        int kept = waiting + parked;
        if (kept == 0) return null;
        if (blocked != null && !blocked.isEmpty()) {
            return new QueueNotice("Voice memos are not set up",
                    blocked + ". " + memos(kept) + (kept == 1 ? " is" : " are") + " kept on this phone.");
        }
        if (parked > 0) {
            return new QueueNotice("Voice memos", memos(parked) + " could not be sent"
                    + (waiting > 0 ? ", " + waiting + " waiting" : "") + ". Tap to try again.", true);
        }
        if (notAllowed) {
            return new QueueNotice("Voice memos", "This phone is not allowed to send memos yet. "
                    + memos(waiting) + (waiting == 1 ? " is" : " are") + " kept and will be sent once it is.");
        }
        if (limitUntilMs > 0) {
            return new QueueNotice("Voice memos", "The daily allowance for voice memos is used up. Sending resumes at about "
                    + clock(limitUntilMs) + ". " + memos(waiting) + " waiting.");
        }
        return new QueueNotice("Voice memos", memos(waiting) + " waiting to upload");
    }

    /** The phone's own time of day, to the minute, with the day when it is not today's. */
    static String clock(long atMs) {
        return new java.text.SimpleDateFormat("EEE HH:mm", java.util.Locale.US).format(new java.util.Date(atMs));
    }

    static String memos(int n) { return n + (n == 1 ? " voice memo" : " voice memos"); }

    /** Two notices with the same key say the same thing; it is then not posted again. */
    String key() { return title + "\n" + text; }
}

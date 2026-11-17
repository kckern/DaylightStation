package net.kckern.daylight.cap.voicememo;

/**
 * What the owner is told about the upload queue, from its state. Pure. A notice is
 * a count and a state, never anything about what a memo holds.
 */
final class QueueNotice {
    static final String ID = "memo-queue";
    /** A tap opens this link: it tries everything again and says what is there. Keyed by the notifications capability. */
    static final String LINK = "daylight://memo/queue";

    final String title;
    final String text;
    final String link = LINK;

    private QueueNotice(String title, String text) {
        this.title = title;
        this.text = text;
    }

    /**
     * @param waiting memos queued or being sent
     * @param parked  memos that were refused or gave up
     * @param blocked why nothing can be sent at all, or ""
     * @return null when there is nothing to tell, and a notice that is up should come down
     */
    static QueueNotice of(int waiting, int parked, String blocked) {
        int kept = waiting + parked;
        if (kept == 0) return null;
        if (blocked != null && !blocked.isEmpty()) {
            return new QueueNotice("Voice memos are not set up",
                    blocked + ". " + memos(kept) + (kept == 1 ? " is" : " are") + " kept on this phone.");
        }
        if (parked > 0) {
            return new QueueNotice("Voice memos", memos(parked) + " could not be sent"
                    + (waiting > 0 ? ", " + waiting + " waiting" : "") + ". Tap to try again.");
        }
        return new QueueNotice("Voice memos", memos(waiting) + " waiting to upload");
    }

    static String memos(int n) { return n + (n == 1 ? " voice memo" : " voice memos"); }

    /** Two notices with the same key say the same thing; it is then not posted again. */
    String key() { return title + "\n" + text; }
}

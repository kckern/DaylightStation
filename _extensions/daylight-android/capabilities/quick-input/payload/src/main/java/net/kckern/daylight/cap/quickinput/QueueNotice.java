package net.kckern.daylight.cap.quickinput;

import java.util.List;
import java.util.Map;

/**
 * What the owner is told about the upload queue, from its state. Pure. A notice is
 * counts, a state and the labels of the destinations concerned ("Journal", "Meal
 * photo"), never anything about what an input holds: no word that was said or typed
 * and nothing of a photo.
 */
final class QueueNotice {
    static final String ID = "input-queue";
    /** A tap opens this link: it tries everything again and says what is there. Keyed by the notifications capability. */
    static final String LINK = "daylight://input/queue";
    /** The Discard action of a notice about parked inputs. Asked twice before anything is deleted. */
    static final String DISCARD_LINK = "daylight://input/discard";
    static final String DISCARD_LABEL = "Discard";
    static final String TITLE = "Quick inputs";

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

    /**
     * @param waiting    destination label to how many inputs for it are queued or being sent
     * @param parked     destination label to how many were refused or gave up
     * @param blocked    why nothing can be sent at all, or ""
     * @param notAllowed the labels of the destinations the backend does not take from this phone yet
     * @param limits     destination label to when the backend takes inputs for it again, for each held by its daily allowance
     * @return null when there is nothing to tell, and a notice that is up should come down
     */
    static QueueNotice of(Map<String, Integer> waiting, Map<String, Integer> parked, String blocked,
                          List<String> notAllowed, Map<String, Long> limits) {
        int waitingCount = total(waiting);
        int parkedCount = total(parked);
        int kept = waitingCount + parkedCount;
        if (kept == 0) return null;
        if (blocked != null && !blocked.isEmpty()) {
            Map<String, Integer> all = new java.util.LinkedHashMap<>(waiting);
            for (Map.Entry<String, Integer> p : parked.entrySet()) {
                Integer n = all.get(p.getKey());
                all.put(p.getKey(), (n == null ? 0 : n) + p.getValue());
            }
            return new QueueNotice("Quick inputs are not set up",
                    blocked + ". " + inputs(kept) + (kept == 1 ? " is" : " are") + " kept on this phone" + breakdown(all) + ".");
        }
        if (parkedCount > 0) {
            return new QueueNotice(TITLE, inputs(parkedCount) + " could not be sent" + breakdown(parked)
                    + (waitingCount > 0 ? ", " + waitingCount + " waiting" : "") + ". Tap to try again.", true);
        }
        if (notAllowed != null && !notAllowed.isEmpty()) {
            return new QueueNotice(TITLE, "This phone is not allowed to send to " + either(notAllowed) + " yet. "
                    + inputs(waitingCount) + (waitingCount == 1 ? " is" : " are") + " kept and will be sent once it is.");
        }
        if (limits != null && !limits.isEmpty()) {
            StringBuilder text = new StringBuilder();
            for (Map.Entry<String, Long> limit : limits.entrySet()) {
                text.append("The daily allowance for ").append(limit.getKey()).append(" is used up. Sending resumes at about ")
                        .append(clock(limit.getValue())).append(". ");
            }
            return new QueueNotice(TITLE, text + inputs(waitingCount) + " waiting.");
        }
        return new QueueNotice(TITLE, inputs(waitingCount) + " waiting to upload" + breakdown(waiting));
    }

    static final String STATUS = "daylight://input/status";

    static String captureId(String owner, String inputId) {
        return "capture-" + java.util.UUID.nameUUIDFromBytes((owner + ":" + inputId)
                .getBytes(java.nio.charset.StandardCharsets.UTF_8)).toString().replace("-", "");
    }

    static String captureLink(String owner, String inputId, String action) {
        return STATUS + "?owner=" + owner + "&id=" + inputId + action;
    }

    static String captureMessage(String state) {
        switch (state) {
            case "UNUSABLE": return "Couldn’t identify food";
            case "REJECTED": return "Capture could not be used";
            case "DENIED": return "This phone isn’t allowed to send this capture";
            case "WAIT": return "Queued until the daily allowance renews";
            case "RETRY": return "Waiting to retry";
            case "UNCERTAIN": return "Waiting to confirm delivery";
            case "PROCESSING": return "Processing";
            case "ACCEPTED": return "Accepted";
            case "DELIVERED": return "Delivered";
            case "LOST": return "Capture file is missing";
            default: return "Queued";
        }
    }

    static String captureAction(String state) {
        switch (state) {
            case "UNUSABLE":
            case "REJECTED":
            case "LOST": return "Replace capture";
            case "RETRY":
            case "UNCERTAIN":
            case "DENIED":
            case "QUEUED": return "Retry";
            default: return "";
        }
    }

    private static int total(Map<String, Integer> counts) {
        int n = 0;
        if (counts != null) for (int c : counts.values()) n += c;
        return n;
    }

    /** " (Journal 2, Meal photo 1)": which destinations the count is for. */
    private static String breakdown(Map<String, Integer> counts) {
        StringBuilder out = new StringBuilder();
        for (Map.Entry<String, Integer> c : counts.entrySet()) {
            if (c.getValue() <= 0) continue;
            out.append(out.length() == 0 ? " (" : ", ").append(c.getKey()).append(' ').append(c.getValue());
        }
        return out.length() == 0 ? "" : out + ")";
    }

    /** "Meal", "Meal or Journal", "Meal, Journal or Walk". */
    private static String either(List<String> labels) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < labels.size(); i++) {
            if (i > 0) out.append(i == labels.size() - 1 ? " or " : ", ");
            out.append(labels.get(i));
        }
        return out.toString();
    }

    /** The phone's own time of day, to the minute, with the day when it is not today's. */
    static String clock(long atMs) {
        return new java.text.SimpleDateFormat("EEE HH:mm", java.util.Locale.US).format(new java.util.Date(atMs));
    }

    static String inputs(int n) { return n + (n == 1 ? " input" : " inputs"); }

    /** Two notices with the same key say the same thing; it is then not posted again. */
    String key() { return title + "\n" + text; }
}

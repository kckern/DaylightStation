package net.kckern.daylight.cap.quickinput.shell;

/**
 * What a capture says once it is saved, from the payload's state for it (audit H15): "Sent"
 * only when home has it. Pure, so each line is tested.
 *
 * <ul>
 * <li>DELIVERED, ACCEPTED: "Sent to Journal" (done);</li>
 * <li>PROCESSING, or queued on a working network inside the wait: "Saved · sending to Journal…";</li>
 * <li>queued with no network, or still queued when the wait ends: "Saved · sends when home answers";</li>
 * <li>WAIT: "Saved · sends when the daily allowance renews";</li>
 * <li>DENIED, REJECTED, UNUSABLE, LOST: "Saved · not accepted: see Capture status".</li>
 * </ul>
 */
final class CaptureOutcome {
    final String line;
    /** Nothing more will change while the screen waits: it can close. */
    final boolean settled;
    /** Home has it. */
    final boolean sent;

    private CaptureOutcome(String line, boolean settled, boolean sent) {
        this.line = line;
        this.settled = settled;
        this.sent = sent;
    }

    /** The first line, drawn in the tap's frame, before the payload has answered. */
    static CaptureOutcome saving(String destination) {
        return new CaptureOutcome("Saved · sending" + to(destination) + "…", false, false);
    }

    /**
     * @param state      the payload's state for this capture, or null when it has no row yet
     * @param online     Android says the network reaches the internet
     * @param waitIsOver the screen's wait for an answer has ended
     */
    static CaptureOutcome of(String state, String destination, boolean online, boolean waitIsOver) {
        String s = state == null ? "" : state;
        switch (s) {
            case "DELIVERED":
            case "ACCEPTED":
                return new CaptureOutcome("Sent" + to(destination), true, true);
            case "WAIT":
                return new CaptureOutcome("Saved · sends when the daily allowance renews", true, false);
            case "DENIED":
            case "REJECTED":
            case "UNUSABLE":
            case "LOST":
                return new CaptureOutcome("Saved · not accepted: see Capture status", true, false);
            default:
                break;
        }
        if (!online) return new CaptureOutcome("Saved · sends when home answers", true, false);
        if (waitIsOver) {
            return "PROCESSING".equals(s)
                    ? new CaptureOutcome("Saved · still sending" + to(destination) + ": see Capture status", true, false)
                    : new CaptureOutcome("Saved · sends when home answers", true, false);
        }
        return saving(destination);
    }

    private static String to(String destination) {
        return destination == null || destination.trim().isEmpty() ? "" : " to " + destination.trim();
    }
}

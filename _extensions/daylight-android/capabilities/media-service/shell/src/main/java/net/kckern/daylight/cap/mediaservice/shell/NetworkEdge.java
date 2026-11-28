package net.kckern.daylight.cap.mediaservice.shell;

/**
 * "The network is back", from a stream of capability reports, pure. Android reports every
 * signal or bandwidth change on a validated network; only a not-validated (or lost) to
 * validated transition counts, and so does the first validated report after registering
 * (the callback's immediate one), so a flapping signal never counts as a return.
 */
final class NetworkEdge {
    private boolean validated;

    /** @return true when this report is the network coming back */
    synchronized boolean onCapabilities(boolean nowValidated) {
        boolean back = nowValidated && !validated;
        validated = nowValidated;
        return back;
    }

    synchronized void onLost() { validated = false; }
}

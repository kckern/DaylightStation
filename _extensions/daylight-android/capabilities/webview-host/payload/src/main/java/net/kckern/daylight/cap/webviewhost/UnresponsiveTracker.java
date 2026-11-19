package net.kckern.daylight.cap.webviewhost;

/**
 * How long the renderer has been continuously unresponsive. Pure Java.
 * A slow page is alive; only a renderer that stays unresponsive for the whole limit is ended.
 */
final class UnresponsiveTracker {
    private long sinceMs;       // 0 = responsive
    private boolean hung;

    synchronized void unresponsive(long nowMs) {
        if (!hung) { hung = true; sinceMs = nowMs; }
    }

    synchronized void responsive() { hung = false; sinceMs = 0; }

    synchronized boolean shouldTerminate(long nowMs, int limitSec) {
        return limitSec > 0 && hung && nowMs - sinceMs >= limitSec * 1000L;
    }
}

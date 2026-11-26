package net.kckern.daylight.cap.mediaservice;

/**
 * Whether home answered lately. A call that could not reach the backend marks it down for
 * a minute: in that minute a play of something kept on the phone is answered from the
 * phone at once, without waiting on another connection attempt (captive or in-flight
 * Wi-Fi says "connected" and answers nothing). Any answer from the backend (a poll, a
 * resolve) marks it up again. Pure; thread-safe.
 */
final class BackendHealth {
    static final long DOWN_FOR_MS = 60_000;
    private long downUntil;

    synchronized void failed(long now) { downUntil = now + DOWN_FOR_MS; }

    synchronized void answered() { downUntil = 0; }

    synchronized boolean down(long now) { return now < downUntil; }
}

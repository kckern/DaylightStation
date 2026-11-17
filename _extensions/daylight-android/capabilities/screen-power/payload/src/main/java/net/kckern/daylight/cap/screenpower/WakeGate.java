package net.kckern.daylight.cap.screenpower;

import java.util.concurrent.atomic.AtomicLong;

/**
 * Whether a "wake the display" poke may act now. Pure Java. poke() is called on the
 * MIDI thread for every note-on, so this is one compare-and-set and no allocation.
 */
final class WakeGate {
    private final AtomicLong lastWakeAt = new AtomicLong(Long.MIN_VALUE / 2);

    /**
     * @param minuteOfDay local time, 0..1439
     * @param start,end   "HH:mm" daily window in which nothing wakes; blank or malformed = no window
     */
    boolean allow(long nowMs, int minuteOfDay, long cooldownMs, String start, String end) {
        if (inWindow(minuteOfDay, parseHhmm(start), parseHhmm(end))) return false;
        long last = lastWakeAt.get();
        if (nowMs - last < cooldownMs) return false;
        return lastWakeAt.compareAndSet(last, nowMs);   // a burst claims the window exactly once
    }

    /** True while a wake is too recent for another. One read, no claim: the check a note-on makes first. */
    boolean cooling(long nowMs, long cooldownMs) {
        return nowMs - lastWakeAt.get() < cooldownMs;
    }

    static boolean inWindow(int minute, int start, int end) {
        if (start < 0 || end < 0 || start == end) return false;
        return start < end ? (minute >= start && minute < end) : (minute >= start || minute < end);
    }

    /** Minutes of the day, or -1 when blank or invalid. */
    static int parseHhmm(String s) {
        if (s == null) return -1;
        s = s.trim();
        int colon = s.indexOf(':');
        if (colon <= 0) return -1;
        try {
            int h = Integer.parseInt(s.substring(0, colon).trim());
            int m = Integer.parseInt(s.substring(colon + 1).trim());
            return h < 0 || h > 23 || m < 0 || m > 59 ? -1 : h * 60 + m;
        } catch (NumberFormatException e) {
            return -1;
        }
    }
}

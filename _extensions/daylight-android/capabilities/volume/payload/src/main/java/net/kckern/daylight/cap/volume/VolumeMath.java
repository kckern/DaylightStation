package net.kckern.daylight.cap.volume;

/** Percent to stream index and back. Pure Java. */
final class VolumeMath {
    private VolumeMath() { }

    /** Rounds down, as Fully does, so levels stored for Fully keep their meaning. */
    static int indexFor(int level, int maxIndex) {
        if (maxIndex <= 0) return 0;
        int clamped = Math.max(0, Math.min(100, level));
        return clamped * maxIndex / 100;
    }

    /**
     * As above, never below the stream's lowest index: a level that maps under it (0 on
     * a stream whose minimum is 1) becomes the minimum.
     */
    static int indexFor(int level, int minIndex, int maxIndex) {
        int floor = Math.max(0, Math.min(minIndex, Math.max(0, maxIndex)));
        return Math.max(floor, indexFor(level, maxIndex));
    }

    /** Rounds up, so that indexFor(levelFor(i)) == i and a read value written back changes nothing. */
    static int levelFor(int index, int maxIndex) {
        if (maxIndex <= 0) return 0;
        int clamped = Math.max(0, Math.min(maxIndex, index));
        return (clamped * 100 + maxIndex - 1) / maxIndex;
    }

    /** An AudioManager.STREAM_* value. Null means STREAM_MUSIC (3). */
    static int stream(Object raw) {
        if (raw == null) return 3;
        int s;
        if (raw instanceof Integer) s = (Integer) raw;
        else if (raw instanceof String) {
            try { s = Integer.parseInt(((String) raw).trim()); }
            catch (NumberFormatException e) { throw new IllegalArgumentException("stream must be an integer 0..10"); }
        } else throw new IllegalArgumentException("stream must be an integer 0..10");
        if (s < 0 || s > 10) throw new IllegalArgumentException("stream must be an integer 0..10");
        return s;
    }
}

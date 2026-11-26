package net.kckern.daylight.shellkit;

import java.util.concurrent.CopyOnWriteArrayList;

/**
 * What is playing, and where, for the app's own screens: the phone's home shows it as a
 * "Playing on …" strip that opens Now playing (JellyBox's playing-elsewhere strip). The
 * two media services write it (this phone's, and the screen remote's), each for its own
 * target; the most recent one that is playing wins, and a target that stops clears its
 * entry. In process only: nothing is stored or sent.
 */
public final class NowPlayingNote {
    /** One target's state. {@code target} is "local" or a device id. */
    public static final class Entry {
        public final String target, targetName, title;
        public final boolean playing;
        final long at;

        Entry(String target, String targetName, String title, boolean playing, long at) {
            this.target = target;
            this.targetName = targetName;
            this.title = title;
            this.playing = playing;
            this.at = at;
        }
    }

    public interface Listener { void changed(); }

    private static volatile Entry local, remote;
    private static final CopyOnWriteArrayList<Listener> listeners = new CopyOnWriteArrayList<>();

    private NowPlayingNote() { }

    /** A service's report. An empty title means nothing is loaded there: the entry goes. */
    public static void update(String target, String targetName, String title, boolean playing, long now) {
        Entry e = title == null || title.isEmpty() ? null : new Entry(target, targetName, title, playing, now);
        Entry before = "local".equals(target) ? local : remote;
        if (same(before, e)) return;
        if ("local".equals(target)) local = e; else remote = e;
        for (Listener l : listeners) l.changed();
    }

    /** What the strip shows: the one playing (the newer, if both are), else the newer paused one; null for none. */
    public static Entry current() {
        Entry a = local, b = remote;
        if (a == null) return b;
        if (b == null) return a;
        if (a.playing != b.playing) return a.playing ? a : b;
        return a.at >= b.at ? a : b;
    }

    public static void listen(Listener l) { listeners.addIfAbsent(l); }

    public static void unlisten(Listener l) { listeners.remove(l); }

    static void clearForTests() { local = null; remote = null; listeners.clear(); }

    private static boolean same(Entry a, Entry b) {
        if (a == null || b == null) return a == b;
        return a.target.equals(b.target) && a.title.equals(b.title) && a.playing == b.playing
                && a.targetName.equals(b.targetName);
    }
}

package net.kckern.daylight.cap.widgets.shell;

/**
 * The phone home's four sections and the bottom bar's order (design sweep D2): Play,
 * Capture, Connect, Services, Play first and the section a cold start opens on. A section
 * keeps its number (0 Services, 1 Capture, 2 Play, 3 Connect: what the page builder and the
 * loads answer by); the bar and the sideways flick follow {@link #ORDER}. Pure.
 */
final class HomeSections {
    static final int SERVICES = 0, CAPTURE = 1, PLAY = 2, CONNECT = 3;
    static final String[] NAMES = { "Services", "Capture", "Play", "Connect" };
    /** The bar, left to right. */
    static final int[] ORDER = { PLAY, CAPTURE, CONNECT, SERVICES };

    private HomeSections() { }

    /** The section a cold start opens on. */
    static int first() { return PLAY; }

    /** Where {@code section} stands in the bar (0..3). */
    static int position(int section) {
        for (int i = 0; i < ORDER.length; i++) if (ORDER[i] == section) return i;
        return 0;
    }

    /** The section a flick {@code direction} (+1 toward the right of the bar) lands on: the same one at an end. */
    static int step(int section, int direction) {
        int at = Math.max(0, Math.min(ORDER.length - 1, position(section) + direction));
        return ORDER[at];
    }

    /** A saved section, or the first when it is not one. */
    static int restored(int saved) { return saved >= 0 && saved < NAMES.length ? saved : first(); }

    /** What TalkBack says for a destination: "Play, tab 1 of 4, selected". */
    static String spoken(int section, boolean selected) {
        return NAMES[section] + ", tab " + (position(section) + 1) + " of " + ORDER.length + (selected ? ", selected" : "");
    }
}

package net.kckern.daylight.cap.mediaservice.shell;

/**
 * Swipe down closes Now playing, as in Plexamp, Spotify and Apple Music: the rules, apart
 * from the views. A drag may start anywhere on the screen except a control that moves
 * under the finger itself (the seek bar, a queue row's drag handle, the D-pad). On a list
 * stage (the queue, the lyrics, the chapters) it starts only while that list is at its
 * top, so scrolling back up a list never closes the player. Once moving, it is a dismiss
 * drag only when it goes clearly down; sideways (the cover's skip) or up is left to the
 * screen. Let go past a quarter of the height, or with a downward flick, and the screen
 * closes; short of that it springs back.
 *
 * <p>Distances in px, velocity in px per second; the thresholds are dp scaled by density.
 */
final class DismissGesture {
    /** What a move means so far. */
    enum Move { UNDECIDED, DISMISS, NOT_MINE }

    /** Where the drag started. */
    enum Area { COVER, TEXT, EMPTY, SEEK_BAR, LIST }

    /** A fast downward fling closes it from short of a quarter. */
    static final float FLING_PX_S = 1800f;

    /** Of the screen's height: let go past this and it closes. */
    static final float CLOSE_FRACTION = 0.25f;
    /** A fling must still travel this far: a twitch never closes it. */
    static final float FLICK_MIN_DP = 48f;
    /** Down must beat sideways by this much to be a dismiss, not a skip. */
    static final float DOWN_OVER_SIDEWAYS = 1.5f;

    private final float density, slop;

    DismissGesture(float density, float slopPx) {
        this.density = density;
        this.slop = slopPx;
    }

    /**
     * Whether a touch that lands here may become a dismiss.
     *
     * @param listStage the queue, lyrics or chapters fill the stage
     * @param listAtTop that list is scrolled to its top (ignored on the cover)
     * @param onOwnDrag the touch is on a control that drags by itself (seek bar, drag handle, pad)
     * @param inScrolledList the touch is inside any other list that is not at its top
     */
    static boolean mayStart(boolean listStage, boolean listAtTop, boolean onOwnDrag, boolean inScrolledList) {
        if (onOwnDrag || inScrolledList) return false;
        return !listStage || listAtTop;
    }

    /** From the finger's travel since the touch (down is positive dy). */
    Move decide(float dx, float dy) {
        if (dy > slop && dy > Math.abs(dx) * DOWN_OVER_SIDEWAYS) return Move.DISMISS;
        if (Math.abs(dx) > slop || dy < -slop) return Move.NOT_MINE;
        return Move.UNDECIDED;
    }

    /**
     * The whole decision on letting go: a drag from {@code area}, the finger dx, dy from where
     * it went down, the screen {@code height} and the downward velocity. The seek bar never
     * closes; a list only at its top; the drag must be mostly downward; then past a quarter,
     * or a fling.
     */
    static boolean dismisses(float dx, float dy, int height, float velocityY, Area area, boolean listAtTop) {
        if (area == Area.SEEK_BAR) return false;
        if (area == Area.LIST && !listAtTop) return false;
        if (dy <= 0 || Math.abs(dx) > dy) return false;
        return dy >= height * CLOSE_FRACTION || velocityY >= FLING_PX_S;
    }

    /** On letting go of a drag already taken as a dismiss: close (true) or spring back. A twitch under FLICK_MIN_DP is never a fling. */
    boolean closes(float dx, float dy, int height, float velocityY) {
        if (dy < FLICK_MIN_DP * density && dy < height * CLOSE_FRACTION) return false;
        return dismisses(dx, dy, height, velocityY, Area.EMPTY, true);
    }

    /** How far the sheet sits for a finger at dy: never above where it opened. */
    static float offset(float dy) { return Math.max(0f, dy); }
}

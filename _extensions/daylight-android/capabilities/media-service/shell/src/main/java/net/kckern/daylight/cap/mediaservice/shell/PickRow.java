package net.kckern.daylight.cap.mediaservice.shell;

/**
 * One row of the Play on picker while its screen is being checked. The picker opens at
 * once from the last known screens, every row "Checking…"; a tap on a row still being
 * checked waits for that row's answer and then picks it (or greys it, when the screen
 * turned out to be off), so an off screen is never picked by a tap made too early. Pure;
 * main thread only.
 */
final class PickRow {
    enum Tap {
        /** Pick it now. */
        PICK,
        /** Still checking: picked when the answer comes, if it may be. */
        WAIT,
        /** Off (and not the one in use): nothing happens. */
        IGNORE
    }

    enum Answer {
        /** A tap was waiting and the screen may be picked: pick it now. */
        PICK,
        /** Off: grey the row. */
        DISABLE,
        /** Show the state; nothing else. */
        SHOW
    }

    private final boolean local, current;
    private ScreenSnapshot snap;
    private boolean waiting;

    PickRow(boolean local, boolean current) {
        this.local = local;
        this.current = current;
    }

    /** The answer this row has, or null while it is checked (this phone never is). */
    ScreenSnapshot snapshot() { return snap; }

    boolean checking() { return !local && snap == null; }

    boolean waiting() { return waiting; }

    Tap tap() {
        if (!checking()) return local || TargetPicker.pickable(snap, current) ? Tap.PICK : Tap.IGNORE;
        waiting = true;
        return Tap.WAIT;
    }

    Answer answer(ScreenSnapshot s) {
        snap = s;
        boolean may = TargetPicker.pickable(s, current);
        boolean wasWaiting = waiting;
        waiting = false;
        if (!may) return Answer.DISABLE;
        return wasWaiting ? Answer.PICK : Answer.SHOW;
    }
}

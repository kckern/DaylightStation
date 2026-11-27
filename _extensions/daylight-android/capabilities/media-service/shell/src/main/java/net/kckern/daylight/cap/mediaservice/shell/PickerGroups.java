package net.kckern.daylight.cap.mediaservice.shell;

import java.util.List;

/**
 * Where a row of the Play on sheet goes (design sweep D18): This phone on top; then
 * Available, the screens playing (or paused) first and then the idle ones, a row still
 * being checked staying in Available until it answers; then one collapsed "Off · N" row
 * that opens in place to the off screens. The screen in use is never filed under Off. Pure.
 */
final class PickerGroups {
    enum Group { LOCAL, PLAYING, IDLE, OFF }

    private PickerGroups() { }

    /** A screen's group from its answer ({@code null}: not answered yet). */
    static Group of(ScreenSnapshot.Reach reach, boolean current) {
        if (reach == null) return Group.IDLE;
        switch (reach) {
            case OFF: case NOT_ON: return current ? Group.IDLE : Group.OFF;
            case PLAYING_OR_PAUSED: return Group.PLAYING;
            default: return Group.IDLE;
        }
    }

    /**
     * Where a row of {@code g} goes in Available, given the groups of the rows already there
     * in order: after the last playing row for a playing one, at the end for the rest.
     */
    static int insertAt(List<Group> available, Group g) {
        if (g != Group.PLAYING) return available.size();
        int at = 0;
        for (int i = 0; i < available.size(); i++) if (available.get(i) == Group.PLAYING) at = i + 1;
        return at;
    }

    /** The collapsed row: "Off · 7"; "" when none are off. */
    static String offLabel(int count) { return count <= 0 ? "" : "Off · " + count; }
}

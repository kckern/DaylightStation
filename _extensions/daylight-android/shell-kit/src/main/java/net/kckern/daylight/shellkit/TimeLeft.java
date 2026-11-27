package net.kckern.daylight.shellkit;

/**
 * One rule for "time left" on every phone surface (the author's book row, the book page,
 * Continue listening, the queue's book row, Now playing's "left in book"): what remains of
 * the whole book from its current place, at 1× (the book's own length, whatever the speed),
 * in one form, to the nearest minute: "1 h 38 min left", "36 min left", "Under a minute
 * left". Before this
 * (2026-11-27) the author row said "1 h 38 min left" and the book page "36 min left" for
 * the same book. Pure.
 */
public final class TimeLeft {
    private TimeLeft() { }

    /** "1 h 38 min left", "36 min left", "Under a minute left". */
    public static String words(long seconds) {
        return amount(seconds) + " left";
    }

    /** The amount alone: "1 h 38 min", "36 min", "Under a minute" (for "… left in book"). */
    public static String amount(long seconds) {
        // To the nearest minute: home's two lists of a book's parts can differ by seconds
        // (1835 s and 1850 s for one part), which floored to 1 h 36 and 1 h 37 for the same book.
        long minutes = (Math.max(0, seconds) + 30) / 60;
        if (minutes >= 60) return (minutes / 60) + " h " + (minutes % 60) + " min";
        return minutes > 0 ? minutes + " min" : "Under a minute";
    }
}

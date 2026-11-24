package net.kckern.daylight.cap.onetap;

/** The tile colour of a launcher shortcut, chosen by its icon name so a kind of action keeps one colour. Pure. */
final class ActionTint {
    static final int GREEN = 0xff125b47;
    static final int JOURNAL = 0xff2d6a8f;
    static final int MEAL = 0xffb85a22;
    static final int HEALTH = 0xffa8324f;
    static final int MEDIA = 0xff6a4fa3;

    private ActionTint() { }

    static int of(String icon) {
        if (icon == null) return GREEN;
        switch (icon) {
            case "notebook": case "mic": return JOURNAL;
            case "fork": case "camera": case "barcode": return MEAL;
            case "health": return HEALTH;
            case "play": return MEDIA;
            default: return GREEN;
        }
    }
}

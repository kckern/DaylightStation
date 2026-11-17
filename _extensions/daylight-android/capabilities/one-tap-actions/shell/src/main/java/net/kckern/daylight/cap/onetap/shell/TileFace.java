package net.kckern.daylight.cap.onetap.shell;

/** What one quick-settings slot shows, from what the surface cache holds for it. Pure. */
final class TileFace {
    private static final String DEFAULT_ICON = "ic_action_open";

    final String label;
    /** A drawable name in this module: ic_action_<icon>. */
    final String iconName;
    /** False for a slot with no action: shown unavailable, and a tap does nothing. */
    final boolean available;
    final String link;

    private TileFace(String label, String iconName, boolean available, String link) {
        this.label = label;
        this.iconName = iconName;
        this.available = available;
        this.link = link;
    }

    /** @param link the slot's link, already checked to be the app's own scheme, or empty */
    static TileFace of(int slot, String label, String icon, String link) {
        String name = "Daylight " + slot;
        if (link == null || link.isEmpty()) return new TileFace(name, DEFAULT_ICON, false, "");
        boolean plain = icon != null && icon.matches("[a-z0-9_]{1,24}");
        return new TileFace(label == null || label.isEmpty() ? name : label, plain ? "ic_action_" + icon : DEFAULT_ICON, true, link);
    }
}

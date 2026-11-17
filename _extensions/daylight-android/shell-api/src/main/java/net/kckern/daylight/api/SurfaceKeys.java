package net.kckern.daylight.api;

/**
 * The last-known labels and links of the quick-settings tiles and the widget. The
 * payload writes them into one private preferences file through the shell's Context;
 * the installed tile services and the widget provider only read it, so they draw
 * without a payload. Both sides take the file name and the keys from here.
 *
 *   tile.<1..4>.label | tile.<1..4>.icon | tile.<1..4>.uri
 *   widget.<1..4>.label | widget.<1..4>.icon | widget.<1..4>.uri
 *
 * An empty uri means the slot is unassigned.
 */
public final class SurfaceKeys {
    public static final String PREFS = "daylight_surfaces";
    public static final int TILE_SLOTS = 4;
    public static final int WIDGET_SLOTS = 4;
    public static final String LABEL = "label";
    public static final String ICON = "icon";
    public static final String URI = "uri";
    private static final String LINK_PREFIX = "daylight://";

    private SurfaceKeys() { }

    public static String tile(int slot, String field) { return key("tile", slot, TILE_SLOTS, field); }

    public static String widget(int slot, String field) { return key("widget", slot, WIDGET_SLOTS, field); }

    private static String key(String surface, int slot, int slots, String field) {
        if (slot < 1 || slot > slots) throw new IllegalArgumentException(surface + " slot " + slot + " is outside 1-" + slots);
        return surface + "." + slot + "." + field;
    }

    /**
     * Whether a cached uri may be launched by a tile or the widget: only the app's own
     * link scheme, exactly as the payload writes it. Anything else in the cache is
     * treated as an unassigned slot.
     */
    public static boolean launchable(String uri) {
        return uri != null && uri.startsWith(LINK_PREFIX) && uri.length() > LINK_PREFIX.length();
    }
}

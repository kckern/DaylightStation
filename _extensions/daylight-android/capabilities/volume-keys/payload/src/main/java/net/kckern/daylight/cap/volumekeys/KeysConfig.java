package net.kckern.daylight.cap.volumekeys;

import net.kckern.daylight.core.SettingsRegistry;

/** The key settings behind portal-keys' accessor names. Reads are live. */
final class KeysConfig {
    private final SettingsRegistry s;

    KeysConfig(SettingsRegistry settings) { this.s = settings; }

    static void declare(SettingsRegistry s) {
        // Double-press volume-down sleeps the display; any volume key wakes it.
        s.declare("keys.screenToggleEnabled", SettingsRegistry.Type.BOOLEAN, false);
        // false hands the keys back to Android: the escape hatch when the page breaks.
        s.declare("keys.consumeVolume", SettingsRegistry.Type.BOOLEAN, true);
        // portal-keys refused values outside 150 to 2000 at write time; so does the registry.
        s.declare("keys.doublePressMs", SettingsRegistry.Type.INTEGER, 450, SettingsRegistry.range(150, 2000));
    }

    boolean screenToggleEnabled() { return (Boolean) s.get("keys.screenToggleEnabled"); }
    boolean consumeVolume() { return (Boolean) s.get("keys.consumeVolume"); }
    int doublePressMs() { return (Integer) s.get("keys.doublePressMs"); }
}

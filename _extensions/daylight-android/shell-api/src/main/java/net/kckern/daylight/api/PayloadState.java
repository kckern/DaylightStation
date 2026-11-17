package net.kckern.daylight.api;

import java.io.File;

/**
 * Where a payload keeps its state beneath the shell's payload directory. The payload
 * writes these files and the shell's lifeline deletes one of them
 * (POST /settings/reset), so both sides take the path from here and cannot drift.
 */
public final class PayloadState {
    private PayloadState() { }

    /** The directory a payload keeps its own files in. */
    public static File dir(File payloadDir) { return new File(payloadDir, "state"); }

    /** The runtime settings overrides, inside a state directory. */
    public static File settingsOverridesIn(File stateDir) { return new File(stateDir, "settings-overrides.json"); }

    /** The runtime settings overrides, from the shell's payload directory. */
    public static File settingsOverrides(File payloadDir) { return settingsOverridesIn(dir(payloadDir)); }

    /**
     * Delete the settings overrides and the temporary file a half-finished write leaves
     * beside them. True when no overrides file remains.
     */
    public static boolean deleteSettingsOverrides(File payloadDir) {
        File f = settingsOverrides(payloadDir);
        new File(f.getPath() + ".part").delete();
        return !f.exists() || f.delete();
    }
}

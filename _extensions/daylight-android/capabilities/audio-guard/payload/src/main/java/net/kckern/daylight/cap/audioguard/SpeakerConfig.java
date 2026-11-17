package net.kckern.daylight.cap.audioguard;

import net.kckern.daylight.core.SettingsRegistry;

import java.util.Locale;

/** The speaker settings behind the accessor names A2dpConnector already calls. Reads are live. */
final class SpeakerConfig {
    private final SettingsRegistry s;

    SpeakerConfig(SettingsRegistry settings) { this.s = settings; }

    static void declare(SettingsRegistry s) {
        s.declare("speaker.mac", SettingsRegistry.Type.STRING, "");
        s.declare("speaker.name", SettingsRegistry.Type.STRING, "Speaker");
        // An explicit disconnect survives watchdog ticks, setting changes and payload swaps.
        s.declare("speaker.enabled", SettingsRegistry.Type.BOOLEAN, true);
    }

    String speakerMac() { return ((String) s.get("speaker.mac")).trim().toUpperCase(Locale.US); }
    String speakerName() { return (String) s.get("speaker.name"); }
    boolean bluetoothAudioEnabled() { return (Boolean) s.get("speaker.enabled"); }
}

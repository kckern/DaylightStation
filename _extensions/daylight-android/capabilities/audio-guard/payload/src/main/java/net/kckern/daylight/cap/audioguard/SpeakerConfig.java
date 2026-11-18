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
        // The coexistence switch: whether this app drives the speaker at all, the A2DP
        // connector and the route guard both. Off while piano-bridge still does.
        s.declare("speaker.enabled", SettingsRegistry.Type.BOOLEAN, true);
        // An explicit disconnect (the Bluetooth panel's) survives watchdog ticks, setting
        // changes and payload swaps. The guard keeps running, so the tablet's own speaker
        // stays clamped while the Bluetooth speaker is disconnected on purpose.
        s.declare("speaker.connect", SettingsRegistry.Type.BOOLEAN, true);
    }

    String speakerMac() { return ((String) s.get("speaker.mac")).trim().toUpperCase(Locale.US); }
    String speakerName() { return (String) s.get("speaker.name"); }
    /** What the connector asks before it connects: the switch is on and nobody disconnected on purpose. */
    boolean bluetoothAudioEnabled() { return (Boolean) s.get("speaker.enabled") && (Boolean) s.get("speaker.connect"); }
}

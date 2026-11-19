package net.kckern.daylight.cap.midibridge;

import net.kckern.daylight.core.SettingsRegistry;

import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/** The MIDI link's settings behind the accessor names BleMidiConnector already calls. Reads are live. */
final class MidiConfig {
    private final SettingsRegistry s;

    MidiConfig(SettingsRegistry settings) { this.s = settings; }

    static void declare(SettingsRegistry s) {
        s.declare("midi.serviceUuid", SettingsRegistry.Type.STRING, "03B80E5A-EDE8-4B33-A751-6CE34EC4C700");
        s.declare("midi.targetMac", SettingsRegistry.Type.STRING, "");
        // The old config fell back to one instrument's Bluetooth name. That is a value of
        // one installation, so the default here is empty and the device file supplies it.
        s.declare("midi.targetName", SettingsRegistry.Type.STRING, "");
        // Comma-separated MAC addresses never to connect to.
        s.declare("midi.blocklistMacs", SettingsRegistry.Type.STRING, "");
        // Both feed Handler.postDelayed: zero or less would make a scan or a retry loop spin.
        s.declare("midi.scanTimeoutMs", SettingsRegistry.Type.INTEGER, 15000, SettingsRegistry.range(1000, 120000));
        s.declare("midi.reconnectDelayMs", SettingsRegistry.Type.INTEGER, 3000, SettingsRegistry.range(250, 600000));
        // An explicit disconnect survives watchdog ticks, setting changes and payload swaps.
        s.declare("midi.enabled", SettingsRegistry.Type.BOOLEAN, true);
    }

    String midiServiceUuid() { return (String) s.get("midi.serviceUuid"); }
    String targetMac() { return norm((String) s.get("midi.targetMac")); }
    String targetName() { return (String) s.get("midi.targetName"); }
    int scanTimeoutMs() { return (Integer) s.get("midi.scanTimeoutMs"); }
    int reconnectDelayMs() { return (Integer) s.get("midi.reconnectDelayMs"); }
    boolean bluetoothMidiEnabled() { return (Boolean) s.get("midi.enabled"); }

    Set<String> blocklistMacs() {
        String raw = (String) s.get("midi.blocklistMacs");
        if (raw.trim().isEmpty()) return Collections.emptySet();
        Set<String> out = new HashSet<>();
        for (String part : raw.split(",")) {
            String m = norm(part);
            if (!m.isEmpty()) out.add(m);
        }
        return out;
    }

    private static String norm(String mac) { return mac == null ? "" : mac.trim().toUpperCase(Locale.US); }
}

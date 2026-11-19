package net.kckern.daylight.cap.presence;

import net.kckern.daylight.core.SettingsRegistry;

/** Presence settings behind the accessor names PresenceReporter already calls. Reads are live. */
final class PresenceConfig {
    private final SettingsRegistry s;

    PresenceConfig(SettingsRegistry settings) { this.s = settings; }

    static void declare(SettingsRegistry s) {
        // Empty disables reporting.
        s.declare("presence.endpoint", SettingsRegistry.Type.STRING, "");
        s.declareSecret("presence.token");
        // portal-keys refused values outside 5 s to 10 min at write time; so does the registry.
        s.declare("presence.heartbeatMs", SettingsRegistry.Type.INTEGER, 60000, SettingsRegistry.range(5000, 600000));
    }

    String gateEndpoint() { return (String) s.get("presence.endpoint"); }
    String gateToken() { return (String) s.get("presence.token"); }
    int gateHeartbeatMs() { return (Integer) s.get("presence.heartbeatMs"); }
}

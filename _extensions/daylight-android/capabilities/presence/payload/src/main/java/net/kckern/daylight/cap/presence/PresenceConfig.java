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
        s.declare("presence.heartbeatMs", SettingsRegistry.Type.INTEGER, 60000);
    }

    String gateEndpoint() { return (String) s.get("presence.endpoint"); }
    String gateToken() { return (String) s.get("presence.token"); }
    /** portal-keys refused values outside 5 s to 10 min at write time; clamp at read. */
    int gateHeartbeatMs() { return Math.max(5000, Math.min(600000, (Integer) s.get("presence.heartbeatMs"))); }
}

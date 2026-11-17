package net.kckern.daylight.core;

/** Core's own settings, behind the accessor names the ported classes use. Reads are live. */
public final class CoreConfig {
    private final SettingsRegistry s;
    private final String deviceId;

    CoreConfig(SettingsRegistry settings, String deviceId) {
        this.s = settings;
        this.deviceId = deviceId;
    }

    static void declare(SettingsRegistry s) {
        s.declare("heartbeat.enabled", SettingsRegistry.Type.BOOLEAN, true);
        s.declare("heartbeat.intervalMs", SettingsRegistry.Type.INTEGER, 60000);
        // Empty: the device id from the device file.
        s.declare("heartbeat.deviceId", SettingsRegistry.Type.STRING, "");
        // Empty: nothing is shipped. Device files set "{log_store_insert_url}".
        s.declare("heartbeat.logStoreUrl", SettingsRegistry.Type.STRING, "");
        s.declare("heartbeat.backendUrl", SettingsRegistry.Type.STRING, "");
        // Empty: "daylight-<deviceId>". The context.app of every line this device ships.
        s.declare("logstore.app", SettingsRegistry.Type.STRING, "");
        s.declare("wifi.telemetryEnabled", SettingsRegistry.Type.BOOLEAN, true);
        s.declare("wifi.sampleIntervalMs", SettingsRegistry.Type.INTEGER, 10000);
        s.declare("wifi.degradedRssiDbm", SettingsRegistry.Type.INTEGER, WifiLinkPolicy.DEFAULT_DEGRADED_RSSI_DBM);
        s.declare("wifi.degradedLinkMbps", SettingsRegistry.Type.INTEGER, WifiLinkPolicy.DEFAULT_DEGRADED_LINK_MBPS);
        s.declare("accessibility.selfEnable", SettingsRegistry.Type.BOOLEAN, false);
        s.declare("update.autoConfirm", SettingsRegistry.Type.BOOLEAN, false);
    }

    public boolean heartbeatEnabled() { return (Boolean) s.get("heartbeat.enabled"); }
    public long heartbeatIntervalMs() { return (Integer) s.get("heartbeat.intervalMs"); }
    public String heartbeatDeviceId() { String v = (String) s.get("heartbeat.deviceId"); return v.isEmpty() ? deviceId : v; }
    public String heartbeatLogStoreUrl() { return (String) s.get("heartbeat.logStoreUrl"); }
    public String heartbeatBackendUrl() { return (String) s.get("heartbeat.backendUrl"); }
    public String logStoreApp() { String v = (String) s.get("logstore.app"); return v.isEmpty() ? "daylight-" + deviceId : v; }
    public boolean wifiTelemetryEnabled() { return (Boolean) s.get("wifi.telemetryEnabled"); }
    public long wifiSampleIntervalMs() { return (Integer) s.get("wifi.sampleIntervalMs"); }
    public int wifiDegradedRssiDbm() { return (Integer) s.get("wifi.degradedRssiDbm"); }
    public int wifiDegradedLinkMbps() { return (Integer) s.get("wifi.degradedLinkMbps"); }
    public boolean accessibilitySelfEnable() { return (Boolean) s.get("accessibility.selfEnable"); }
    public boolean updateAutoConfirm() { return (Boolean) s.get("update.autoConfirm"); }
}

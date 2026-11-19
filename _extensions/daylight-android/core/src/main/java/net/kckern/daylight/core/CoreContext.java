package net.kckern.daylight.core;

import net.kckern.daylight.api.ShellServices;

public interface CoreContext {
    ShellServices shell();
    Router router();
    SettingsRegistry settings();
    String deviceId();

    /** Interfaces capabilities offer each other. */
    ServiceRegistry services();

    /** Shell-owned objects by name. */
    Components components();

    /** Contributions to /status, /diagnostics, the heartbeat and the WebSocket status frame. */
    StatusBoard status();

    NoteBus notes();

    /** Notifications between capabilities that are not notes: screen, network, key, kiosk focus. */
    EventBus events();

    /** The names of this build's capabilities, in device-file order. */
    java.util.List<String> capabilityNames();

    /** For example "p3-kiosk". The page bridge reports it as daylight.version. */
    String payloadVersion();

    /** A short ring of recent events, returned by GET /log. */
    EventLog log();

    /** The WebSocket channel on the control port. */
    SocketHub socket();

    /** True for the device's control port and its lifeline port: no capability may listen on either. */
    boolean portReserved(int port);

    /** The APK's one accessibility service, when the device has the `accessibility` capability. */
    AccessibilityHub accessibility();
}

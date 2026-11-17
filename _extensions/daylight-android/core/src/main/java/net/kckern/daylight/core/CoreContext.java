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

    /** A short ring of recent events, returned by GET /log. */
    EventLog log();
}

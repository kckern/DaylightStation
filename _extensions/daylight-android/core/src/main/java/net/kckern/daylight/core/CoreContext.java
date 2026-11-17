package net.kckern.daylight.core;

import net.kckern.daylight.api.ShellServices;

public interface CoreContext {
    ShellServices shell();
    Router router();
    SettingsRegistry settings();
    String deviceId();
}

package net.kckern.daylight.cap.lockdown.shell;

import android.content.Intent;

/** Android maintains this binding for a device-owner app. It starts the shell service. */
public final class DaylightOwnerService extends android.app.admin.DeviceAdminService {
    @Override public void onCreate() {
        super.onCreate();
        try {
            startForegroundService(new Intent().setClassName(this, "net.kckern.daylight.shell.ShellService"));
        } catch (Exception ignored) { }
    }
}

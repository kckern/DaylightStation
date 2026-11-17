package net.kckern.daylight.build;

/** The per-device manifest fragment merged into that device's shell APK. */
public final class DeviceManifestSource {
    /** The capability whose shell half declares the kiosk Activity. */
    static final String KIOSK_CAPABILITY = "webview-host";

    private DeviceManifestSource() { }

    public static String render(DeviceSpec d) {
        StringBuilder s = new StringBuilder();
        s.append("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n");
        s.append("<!-- Generated from devices/").append(d.id).append(".yml. Do not edit. -->\n");
        s.append("<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\"\n");
        s.append("    xmlns:tools=\"http://schemas.android.com/tools\">\n");
        for (String p : d.extraPermissions) {
            s.append("    <uses-permission android:name=\"").append(p)
             .append("\" tools:ignore=\"ProtectedPermissions\" />\n");
        }
        // One launcher icon. In a kiosk build the kiosk Activity (declared by the
        // webview-host shell half) is the app's front door, so the setup Activity
        // gives up its MAIN/LAUNCHER filter. It stays exported and startable by name.
        boolean kiosk = d.capabilities.contains(KIOSK_CAPABILITY);
        if (!d.foregroundServiceTypes.isEmpty() || kiosk) {
            s.append("    <application>\n");
            if (!d.foregroundServiceTypes.isEmpty()) {
                s.append("        <service android:name=\"net.kckern.daylight.shell.ShellService\"\n");
                s.append("            android:foregroundServiceType=\"")
                 .append(String.join("|", d.foregroundServiceTypes)).append("\"\n");
                s.append("            tools:node=\"merge\" />\n");
            }
            if (kiosk) {
                s.append("        <activity android:name=\"net.kckern.daylight.shell.MainActivity\" tools:node=\"merge\">\n");
                s.append("            <intent-filter tools:node=\"removeAll\" />\n");
                s.append("        </activity>\n");
            }
            s.append("    </application>\n");
        }
        return s.append("</manifest>\n").toString();
    }
}

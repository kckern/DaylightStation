package net.kckern.daylight.build;

/** The per-device manifest fragment merged into that device's shell APK. */
public final class DeviceManifestSource {
    /** The capability whose shell half declares the kiosk Activity. */
    static final String KIOSK_CAPABILITY = "webview-host";
    /** The capability that makes the kiosk Activity a HOME candidate. It requires the kiosk capability. */
    static final String LOCKDOWN_CAPABILITY = "lockdown";
    static final String KIOSK_ACTIVITY = "net.kckern.daylight.cap.webviewhost.shell.KioskActivity";

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
                s.append("        <activity android:name=\"net.kckern.daylight.shell.MainActivity\"\n");
                // Stated again here: at target 31 and above lint reads this fragment on its
                // own and refuses an activity with an intent-filter element and no exported.
                s.append("            android:exported=\"true\" tools:node=\"merge\">\n");
                s.append("            <intent-filter tools:node=\"removeAll\" />\n");
                s.append("        </activity>\n");
            }
            // Only a build that lists lockdown is offered as a home app. The filter is added here,
            // beside the launcher filter webview-host's shell half declares on the same Activity.
            // Being a candidate is all this does: the device's home app is chosen on the device.
            if (kiosk && d.capabilities.contains(LOCKDOWN_CAPABILITY)) {
                s.append("        <activity android:name=\"").append(KIOSK_ACTIVITY).append("\"\n");
                s.append("            android:exported=\"true\" tools:node=\"merge\">\n");
                s.append("            <intent-filter>\n");
                s.append("                <action android:name=\"android.intent.action.MAIN\" />\n");
                s.append("                <category android:name=\"android.intent.category.HOME\" />\n");
                s.append("                <category android:name=\"android.intent.category.DEFAULT\" />\n");
                s.append("            </intent-filter>\n");
                s.append("        </activity>\n");
            }
            s.append("    </application>\n");
        }
        return s.append("</manifest>\n").toString();
    }
}

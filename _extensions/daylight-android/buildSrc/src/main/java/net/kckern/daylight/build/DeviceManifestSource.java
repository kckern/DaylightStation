package net.kckern.daylight.build;

/** The per-device manifest fragment merged into that device's shell APK. */
public final class DeviceManifestSource {
    /** The capability whose shell half declares the kiosk Activity. */
    static final String KIOSK_CAPABILITY = "webview-host";
    /** The capability that makes the kiosk Activity a HOME candidate. It requires the kiosk capability. */
    static final String LOCKDOWN_CAPABILITY = "lockdown";
    static final String KIOSK_ACTIVITY = "net.kckern.daylight.cap.webviewhost.shell.KioskActivity";

    /** The capability whose shell half declares the link activity. */
    static final String LINK_CAPABILITY = "notifications";
    static final String LINK_ACTIVITY = "net.kckern.daylight.cap.notifications.shell.LinkActivity";
    /** Lower-case labels joined by dots, two or more. Written into the manifest, so nothing else. */
    private static final java.util.regex.Pattern HOST =
            java.util.regex.Pattern.compile("[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+");

    private DeviceManifestSource() { }

    /** For a device with no appLinks, whose manifest needs nothing from the private file. */
    public static String render(DeviceSpec d) { return render(d, Placeholders.load(null)); }

    /**
     * @param placeholders resolves appLinks.host. Only read for a device that has one, so
     *                     building another device never needs this device's private values.
     */
    public static String render(DeviceSpec d, Placeholders placeholders) {
        String linkHost = "";
        if (!d.appLinksHost.isEmpty()) {
            linkHost = placeholders.resolve(d.appLinksHost, d.id + ".yml appLinks.host");
            // The value is private: the message says what is wrong, never what it is.
            if (!HOST.matcher(linkHost).matches()) {
                throw new CatalogException(d.id + ".yml: appLinks.host must resolve to a lower-case host name with no scheme, port or path");
            }
        }
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
        if (!d.foregroundServiceTypes.isEmpty() || kiosk || !linkHost.isEmpty()) {
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
            // The household site's https links, for the one host the private file names. The
            // filter only makes the app a candidate for such a link; the payload still checks
            // every link's origin and path before anything is opened. Not autoVerify: the
            // site publishes no Digital Asset Links file, so on Android 12 and later the
            // owner turns the host on once under the app's "Open by default" settings.
            if (!linkHost.isEmpty()) {
                s.append("        <activity android:name=\"").append(LINK_ACTIVITY).append("\"\n");
                s.append("            android:exported=\"true\" tools:node=\"merge\">\n");
                s.append("            <intent-filter>\n");
                s.append("                <action android:name=\"android.intent.action.VIEW\" />\n");
                s.append("                <category android:name=\"android.intent.category.DEFAULT\" />\n");
                s.append("                <category android:name=\"android.intent.category.BROWSABLE\" />\n");
                s.append("                <data android:scheme=\"https\" android:host=\"").append(linkHost).append("\" />\n");
                s.append("            </intent-filter>\n");
                s.append("        </activity>\n");
            }
            s.append("    </application>\n");
        }
        return s.append("</manifest>\n").toString();
    }
}

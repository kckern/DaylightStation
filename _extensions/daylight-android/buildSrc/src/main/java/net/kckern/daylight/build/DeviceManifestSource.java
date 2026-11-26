package net.kckern.daylight.build;

/** The per-device manifest fragment merged into that device's shell APK. */
public final class DeviceManifestSource {
    /** The capability whose shell half declares the kiosk Activity. */
    static final String KIOSK_CAPABILITY = "webview-host";
    /** The capability that gives the build its (disabled) HOME alias. It requires the kiosk capability. */
    static final String LOCKDOWN_CAPABILITY = "lockdown";
    static final String KIOSK_ACTIVITY = "net.kckern.daylight.cap.webviewhost.shell.KioskActivity";
    /** The disabled alias that carries the HOME filter. The lockdown payload enables it by this name. */
    public static final String HOME_ALIAS = "net.kckern.daylight.cap.lockdown.shell.KioskHome";

    /** The capability whose shell half declares the link activity. */
    static final String LINK_CAPABILITY = "notifications";
    static final String LINK_ACTIVITY = "net.kckern.daylight.cap.notifications.shell.LinkActivity";
    /** Lower-case labels joined by dots, two or more. Written into the manifest, so nothing else. */
    private static final java.util.regex.Pattern HOST =
            java.util.regex.Pattern.compile("[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+");

    /**
     * Base-shell permissions only a kiosk needs: installing its own update when told to
     * over the control API, and switching its own accessibility service on. They are
     * added to the manifest of a build that is a kiosk and left out of every other
     * (the phone), which has no control API to be told anything over.
     */
    public static final java.util.List<String> KIOSK_BASE_PERMISSIONS = java.util.Collections.unmodifiableList(
            java.util.Arrays.asList("android.permission.REQUEST_INSTALL_PACKAGES", "android.permission.WRITE_SECURE_SETTINGS"));

    /** A kiosk: it lists lockdown, or it shows the kiosk window and has a control API. */
    public static boolean isKiosk(DeviceSpec d) {
        return d.capabilities.contains(LOCKDOWN_CAPABILITY)
                || (d.capabilities.contains(KIOSK_CAPABILITY) && !"none".equals(d.controlBind));
    }

    private DeviceManifestSource() { }

    /** For a device with no appLinks, whose manifest needs nothing from the private file. */
    public static String render(DeviceSpec d) { return render(d, Placeholders.load(null)); }

    /**
     * @param placeholders resolves appLinks.host. Only read for a device that has one, so
     *                     building another device never needs this device's private values.
     */
    public static String render(DeviceSpec d, Placeholders placeholders) {
        return render(d, placeholders, java.util.Collections.<String>emptyList());
    }

    /**
     * @param kioskOnlyPermissions what the device's capabilities mark kioskOnly
     *                             (DeviceCatalog.kioskOnlyPermissions). A kiosk keeps
     *                             them; the manifest of any other device removes them.
     */
    public static String render(DeviceSpec d, Placeholders placeholders, java.util.List<String> kioskOnlyPermissions) {
        // Somebody's own phone: no control API, so nothing here is operated remotely.
        boolean personal = PersonalBuild.applies(d);
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
        if (isKiosk(d)) {
            for (String p : KIOSK_BASE_PERMISSIONS) {
                s.append("    <uses-permission android:name=\"").append(p)
                 .append("\" tools:ignore=\"ProtectedPermissions\" />\n");
            }
        }
        if (!isKiosk(d)) {
            // What only a kiosk uses (drawing over a launched app, the page's camera) is
            // taken out of the APK of a device that is not one.
            for (String p : kioskOnlyPermissions) {
                if (d.extraPermissions.contains(p)) continue;
                s.append("    <uses-permission android:name=\"").append(p).append("\" tools:node=\"remove\" />\n");
            }
        }
        for (String p : d.extraPermissions) {
            // A device file may state one of the kiosk permissions itself; it is declared once.
            if (isKiosk(d) && KIOSK_BASE_PERMISSIONS.contains(p)) continue;
            s.append("    <uses-permission android:name=\"").append(p)
             .append("\" tools:ignore=\"ProtectedPermissions\" />\n");
        }
        // One launcher icon. In a kiosk build the kiosk Activity (declared by the
        // webview-host shell half) is the app's front door, so the setup Activity
        // gives up its MAIN/LAUNCHER filter. It stays exported and startable by name.
        boolean kiosk = d.capabilities.contains(KIOSK_CAPABILITY);
        if (!d.foregroundServiceTypes.isEmpty() || kiosk || !linkHost.isEmpty() || personal) {
            if (personal) {
                // Every address a personal device is built with is https (PersonalBuild.urlFailures),
                // and it joins networks outside the house: no plain-http request leaves it.
                s.append("    <application android:icon=\"@mipmap/ic_daylight_launcher\" android:roundIcon=\"@mipmap/ic_daylight_launcher\" android:usesCleartextTraffic=\"false\" tools:replace=\"android:usesCleartextTraffic\">\n");
            } else {
                s.append("    <application>\n");
            }
            if (!d.foregroundServiceTypes.isEmpty()) {
                s.append("        <service android:name=\"net.kckern.daylight.shell.ShellService\"\n");
                s.append("            android:foregroundServiceType=\"")
                 .append(String.join("|", d.foregroundServiceTypes)).append("\"\n");
                s.append("            tools:node=\"merge\" />\n");
            }
            if (kiosk && !personal) {
                s.append("        <activity android:name=\"net.kckern.daylight.shell.MainActivity\"\n");
                // Stated again here: at target 31 and above lint reads this fragment on its
                // own and refuses an activity with an intent-filter element and no exported.
                s.append("            android:exported=\"true\" tools:node=\"merge\">\n");
                s.append("            <intent-filter tools:node=\"removeAll\" />\n");
                s.append("        </activity>\n");
            }
            if (kiosk && personal) {
                // On a phone any app could start an exported setup activity by name, to put
                // the battery-exemption screen and the permission prompts in front of the
                // owner. The kiosk window is the launcher, so nothing needs to reach this one.
                s.append("        <activity android:name=\"net.kckern.daylight.shell.MainActivity\"\n");
                s.append("            android:exported=\"false\" tools:node=\"merge\" tools:replace=\"android:exported\">\n");
                s.append("            <intent-filter tools:node=\"removeAll\" />\n");
                s.append("        </activity>\n");
                // The window is a phone app's, not a kiosk's: no lock task, and no entry in
                // a TV launcher. Its filters are replaced by the one a phone launcher reads.
                s.append("        <activity android:name=\"").append(KIOSK_ACTIVITY).append("\"\n");
                s.append("            android:exported=\"true\" tools:node=\"merge\" tools:remove=\"android:lockTaskMode\"");
                if (d.capabilities.contains("widgets")) {
                    s.append(" android:taskAffinity=\"").append(d.packageName).append(".service\"");
                }
                s.append(">\n");
                s.append("            <intent-filter tools:node=\"removeAll\" />\n");
                if (d.capabilities.contains("widgets")) {
                    s.append("        </activity>\n");
                    s.append("        <activity android:name=\"net.kckern.daylight.cap.widgets.shell.PhoneHomeActivity\" android:exported=\"true\">\n");
                }
                s.append("            <intent-filter>\n");
                s.append("                <action android:name=\"android.intent.action.MAIN\" />\n");
                s.append("                <category android:name=\"android.intent.category.LAUNCHER\" />\n");
                s.append("            </intent-filter>\n");
                s.append("        </activity>\n");
            }
            // A build that lists lockdown CAN be the home app, and installing it changes no
            // device's home candidates. The HOME filter sits on an alias of the kiosk
            // Activity that is declared disabled, so the system does not see it until
            // POST /lockdown/home enables the alias on the device (the cutover's switch
            // step). A HOME filter that was live at install would add a second candidate;
            // on API 28 that can clear the current default home and put a chooser in
            // front of an unattended kiosk at the next Home press.
            // The Activity is restated first: an alias must follow its target in the
            // merged manifest, and the merger keeps this file's order.
            if (kiosk && d.capabilities.contains(LOCKDOWN_CAPABILITY)) {
                s.append("        <activity android:name=\"").append(KIOSK_ACTIVITY).append("\"\n");
                // A locked kiosk is never one half of a split screen and never a picture-in-
                // picture window: on Android 10 and later every visible activity is resumed,
                // so beside Settings the kiosk would still read as "in front".
                s.append("            android:resizeableActivity=\"false\"\n");
                s.append("            android:supportsPictureInPicture=\"false\"\n");
                s.append("            android:exported=\"true\" tools:node=\"merge\" />\n");
                s.append("        <activity-alias android:name=\"").append(HOME_ALIAS).append("\"\n");
                s.append("            android:targetActivity=\"").append(KIOSK_ACTIVITY).append("\"\n");
                s.append("            android:enabled=\"false\"\n");
                s.append("            android:exported=\"true\">\n");
                s.append("            <intent-filter>\n");
                s.append("                <action android:name=\"android.intent.action.MAIN\" />\n");
                s.append("                <category android:name=\"android.intent.category.HOME\" />\n");
                s.append("                <category android:name=\"android.intent.category.DEFAULT\" />\n");
                s.append("            </intent-filter>\n");
                s.append("        </activity-alias>\n");
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

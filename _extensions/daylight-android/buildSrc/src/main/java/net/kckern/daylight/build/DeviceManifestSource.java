package net.kckern.daylight.build;

/** The per-device manifest fragment merged into that device's shell APK. */
public final class DeviceManifestSource {
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
        if (!d.foregroundServiceTypes.isEmpty()) {
            s.append("    <application>\n");
            s.append("        <service android:name=\"net.kckern.daylight.shell.ShellService\"\n");
            s.append("            android:foregroundServiceType=\"")
             .append(String.join("|", d.foregroundServiceTypes)).append("\"\n");
            s.append("            tools:node=\"merge\" />\n");
            s.append("    </application>\n");
        }
        return s.append("</manifest>\n").toString();
    }
}

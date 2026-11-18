package net.kckern.daylight.build;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/**
 * The rules for a device with `control.bind: none`: somebody's own phone, with other
 * apps on it and networks outside the house around it. Its APK is held to an exact
 * list. Its permissions are the base set, what each listed capability declares (less
 * the ones marked kioskOnly) and what the device file adds; its exported components
 * are the boot receiver and what each listed capability declares under `exported:`.
 * Anything else in the merged manifest fails the build, and so does a plain-http
 * address in its settings.
 */
public final class PersonalBuild {
    /** The permissions of the base shell's own manifest. */
    public static final List<String> BASE_PERMISSIONS = Collections.unmodifiableList(Arrays.asList(
            "android.permission.INTERNET",
            "android.permission.FOREGROUND_SERVICE",
            "android.permission.RECEIVE_BOOT_COMPLETED",
            "android.permission.WAKE_LOCK",
            "android.permission.POST_NOTIFICATIONS",
            "android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
            "android.permission.ACCESS_WIFI_STATE",
            "android.permission.ACCESS_NETWORK_STATE"));

    /** The base shell's one exported component in a build whose launcher is the kiosk window. */
    static final String BOOT_RECEIVER = "net.kckern.daylight.shell.BootReceiver";
    static final String SETUP_ACTIVITY = "net.kckern.daylight.shell.MainActivity";

    /** Settings that hold an address. Each must be https (or empty) on a personal device. */
    private static final List<String> URL_SETTINGS = Collections.unmodifiableList(Arrays.asList(
            "webview.startUrl", "backend.baseUrl", "heartbeat.logStoreUrl", "heartbeat.backendUrl"));
    /** Settings that hold a comma-separated list of origins. */
    private static final List<String> ORIGIN_LIST_SETTINGS = Collections.unmodifiableList(Arrays.asList(
            "links.origins", "webview.allowedOrigins", "webview.bridgeOrigins"));

    /** What the merged manifest of a personal build must hold, exactly. */
    public static final class Expectation {
        public final Set<String> permissions;
        /** Class names of the components another app may reach. */
        public final Set<String> exported;

        public Expectation(Collection<String> permissions, Collection<String> exported) {
            this.permissions = Collections.unmodifiableSet(new TreeSet<>(permissions));
            this.exported = Collections.unmodifiableSet(new TreeSet<>(exported));
        }
    }

    private PersonalBuild() { }

    public static boolean applies(DeviceSpec d) { return "none".equals(d.controlBind); }

    /** The exact list for a personal device; null for any other. */
    public static Expectation expectation(DeviceSpec d, DeviceCatalog catalog) {
        if (!applies(d)) return null;
        List<String> permissions = new ArrayList<>(BASE_PERMISSIONS);
        List<String> exported = new ArrayList<>();
        exported.add(BOOT_RECEIVER);
        // With no kiosk window the setup activity is the launcher icon, and so exported.
        if (!d.capabilities.contains(DeviceManifestSource.KIOSK_CAPABILITY)) exported.add(SETUP_ACTIVITY);
        boolean kiosk = DeviceManifestSource.isKiosk(d);
        for (String name : d.capabilities) {
            CapabilitySpec c = catalog.capability(name);
            permissions.addAll(c.permissions);
            if (kiosk) permissions.addAll(c.kioskOnlyPermissions);
            exported.addAll(c.exported);
        }
        permissions.addAll(d.extraPermissions);
        return new Expectation(permissions, exported);
    }

    /**
     * Every address setting of a personal device that is not https, as messages. The
     * phone's APK allows no cleartext traffic, and a plain-http address would be one
     * anybody on a network it joins could read and answer. A message names the setting
     * and never its value, which is private.
     */
    public static List<String> urlFailures(DeviceSpec d, Map<String, Object> resolvedDefaults) {
        List<String> out = new ArrayList<>();
        if (!applies(d)) return out;
        for (String key : URL_SETTINGS) {
            Object v = resolvedDefaults.get(key);
            if (v instanceof String && !((String) v).trim().isEmpty() && !https((String) v)) {
                out.add(d.id + ".yml: " + key + " must be an https URL on a device with control.bind none");
            }
        }
        for (String key : ORIGIN_LIST_SETTINGS) {
            Object v = resolvedDefaults.get(key);
            if (!(v instanceof String)) continue;
            for (String part : ((String) v).split(",")) {
                if (!part.trim().isEmpty() && !https(part)) {
                    out.add(d.id + ".yml: every entry of " + key + " must be an https origin on a device with control.bind none");
                    break;
                }
            }
        }
        return out;
    }

    private static boolean https(String url) {
        return url.trim().toLowerCase(java.util.Locale.ROOT).startsWith("https://");
    }
}

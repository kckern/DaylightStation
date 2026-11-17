package net.kckern.daylight.build;

import java.util.List;
import java.util.Map;

public final class DeviceSpec {
    public final String id;
    public final String packageName;
    public final int minSdk;
    public final int targetSdk;
    public final List<String> abis;
    public final int controlPort;
    public final int lifelinePort;
    public final int shellVersionCode;
    public final String shellVersionName;
    public final List<String> capabilities;
    /** Dotted setting key to String, Boolean or Integer. */
    public final Map<String, Object> defaults;
    /** Permissions the device declares that no capability owns. */
    public final List<String> extraPermissions;
    /** The shell service's foregroundServiceType values; empty for none. */
    public final List<String> foregroundServiceTypes;
    /** Where the control API and the lifeline listen: "lan" (every interface), "loopback", or "none" (nowhere). */
    public final String controlBind;
    /**
     * The host whose https links the app offers to open, as written in the device file
     * (it may be a {placeholder}); empty for none.
     */
    public final String appLinksHost;

    DeviceSpec(String id, String packageName, int minSdk, int targetSdk, List<String> abis,
               int controlPort, int lifelinePort, int shellVersionCode, String shellVersionName,
               List<String> capabilities, Map<String, Object> defaults,
               List<String> extraPermissions, List<String> foregroundServiceTypes) {
        this(id, packageName, minSdk, targetSdk, abis, controlPort, lifelinePort, shellVersionCode, shellVersionName,
                capabilities, defaults, extraPermissions, foregroundServiceTypes, "lan", "");
    }

    DeviceSpec(String id, String packageName, int minSdk, int targetSdk, List<String> abis,
               int controlPort, int lifelinePort, int shellVersionCode, String shellVersionName,
               List<String> capabilities, Map<String, Object> defaults,
               List<String> extraPermissions, List<String> foregroundServiceTypes,
               String controlBind, String appLinksHost) {
        this.controlBind = controlBind;
        this.appLinksHost = appLinksHost;
        this.id = id;
        this.packageName = packageName;
        this.minSdk = minSdk;
        this.targetSdk = targetSdk;
        this.abis = abis;
        this.controlPort = controlPort;
        this.lifelinePort = lifelinePort;
        this.shellVersionCode = shellVersionCode;
        this.shellVersionName = shellVersionName;
        this.capabilities = capabilities;
        this.defaults = defaults;
        this.extraPermissions = extraPermissions;
        this.foregroundServiceTypes = foregroundServiceTypes;
    }
}

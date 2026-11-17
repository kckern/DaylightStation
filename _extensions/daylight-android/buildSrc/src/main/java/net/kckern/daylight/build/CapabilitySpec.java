package net.kckern.daylight.build;

import java.util.List;

public final class CapabilitySpec {
    public final String name;
    /** Fully qualified payload entry class, or null when the capability has no payload half. */
    public final String entry;
    public final boolean hasPayload;
    public final boolean hasShell;
    /** Capabilities a device must also list when it lists this one. */
    public final List<String> requires;
    /** True when the shell half ships native libraries, so the device needs ABIs. */
    public final boolean nativeCode;

    CapabilitySpec(String name, String entry, boolean hasPayload, boolean hasShell,
                   List<String> requires, boolean nativeCode) {
        this.name = name;
        this.entry = entry;
        this.hasPayload = hasPayload;
        this.hasShell = hasShell;
        this.requires = requires;
        this.nativeCode = nativeCode;
    }
}

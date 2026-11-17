package net.kckern.daylight.build;

public final class CapabilitySpec {
    public final String name;
    /** Fully qualified payload entry class, or null when the capability has no payload half. */
    public final String entry;
    public final boolean hasPayload;
    public final boolean hasShell;

    CapabilitySpec(String name, String entry, boolean hasPayload, boolean hasShell) {
        this.name = name;
        this.entry = entry;
        this.hasPayload = hasPayload;
        this.hasShell = hasShell;
    }
}

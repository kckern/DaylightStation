package net.kckern.daylight.core.spi;

/** Provided by `lockdown` (phase 3) where the app is device owner. Used by `lease-gate`. */
public interface PackageGate {
    /** False when this device cannot hide packages. */
    boolean ready();
    boolean isHidden(String packageName);
    boolean setHidden(String packageName, boolean hidden);
}

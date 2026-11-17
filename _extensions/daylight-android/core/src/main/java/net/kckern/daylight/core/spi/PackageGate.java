package net.kckern.daylight.core.spi;

/**
 * Provided by `lockdown`. Used by `lease-gate`. "Hidden" is the gate's closed state.
 * Where this app is device owner a closed package is hidden from the system. Elsewhere
 * (a device that cannot have a device owner, or has another one) it is kept from the
 * front instead: the watcher recalls the kiosk whenever the package appears.
 */
public interface PackageGate {
    /** False when nothing is enforcing the gate right now. */
    boolean ready();
    boolean isHidden(String packageName);
    boolean setHidden(String packageName, boolean hidden);

    /**
     * Null when a closed package is hidden from the system. Otherwise why it is not:
     * the package is then only kept from the front.
     */
    default String hidingUnsupportedReason() { return null; }
}

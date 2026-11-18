package net.kckern.daylight.core.spi;

/** Provided by `lockdown`, which declares the device-admin receiver. */
public interface DeviceAdminAccess {
    boolean adminActive();

    boolean isOwner();

    /** DevicePolicyManager.lockNow(). Needs an active admin. */
    void lockNow();

    /** Throws UnsupportedException("device owner required") unless this app is device owner. */
    void reboot();
}

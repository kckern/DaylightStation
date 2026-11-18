package net.kckern.daylight.cap.lockdown;

/**
 * Which lockdown mode is in force. Pure Java. The setting says what is wanted; whether
 * this app is device owner says what is possible, and that is read at run time: the
 * Shield can never have a device owner, and the Portal's ownership arrives by transfer.
 */
final class LockMode {
    static final String[] SETTINGS = { "auto", "app", "owner" };

    private LockMode() { }

    /** "owner" or "app". */
    static String resolve(String setting, boolean deviceOwner) {
        return deviceOwner && !"app".equals(setting) ? "owner" : "app";
    }

    /** Why the mode in force is not the one asked for, or null. */
    static String error(String setting, boolean deviceOwner) {
        return "owner".equals(setting) && !deviceOwner
                ? "lockdown.mode is owner but this app is not device owner; running in app mode" : null;
    }
}

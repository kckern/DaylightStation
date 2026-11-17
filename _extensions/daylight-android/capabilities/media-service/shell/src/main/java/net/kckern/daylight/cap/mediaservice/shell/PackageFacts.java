package net.kckern.daylight.cap.mediaservice.shell;

/** What Android knows about the packages on the device, as far as ControllerPolicy asks. */
interface PackageFacts {
    /** The packages that run under this uid, or null when Android names none (or hides them from this app). */
    String[] packagesForUid(int uid);

    /**
     * The SHA-256 of the package's one signing certificate, 64 lower-case hex
     * characters; null when the package is not installed, cannot be read, or has more
     * than one signer.
     */
    String signingSha256(String packageName);

    /** True when the package is signed with the certificate the platform itself ("android") is signed with. */
    boolean platformSigned(String packageName);
}

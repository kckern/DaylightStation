package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.*;

import org.junit.Test;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

public class ControllerPolicyTest {
    private static final int ME = 10234;
    private static final String MY_PACKAGE = "net.kckern.daylight.phone";

    private static final String AUTO = "com.example.car";
    private static final String AUTO_CERT = "aa".repeat(32);
    private static final String OTHER_CERT = "bb".repeat(32);

    /** What Android knows about the packages on a phone, as a test writes it down. */
    private static final class Facts implements PackageFacts {
        final Map<Integer, String[]> byUid = new HashMap<>();
        final Map<String, String> certs = new HashMap<>();
        final Set<String> platform = new HashSet<>();
        @Override public String[] packagesForUid(int uid) { return byUid.get(uid); }
        @Override public String signingSha256(String packageName) { return certs.get(packageName); }
        @Override public boolean platformSigned(String packageName) { return platform.contains(packageName); }
        Facts install(String pkg, int uid, String cert) {
            byUid.put(uid, new String[] { pkg });
            certs.put(pkg, cert);
            return this;
        }
    }

    private final Facts facts = new Facts();
    private final Map<String, String> pins = new HashMap<>();

    private ControllerPolicy.Decision decide(String pkg, int uid, int sdk) {
        return ControllerPolicy.decide(pkg, uid, ME, MY_PACKAGE, sdk, facts, pins);
    }

    private boolean allows(String pkg, int uid) { return decide(pkg, uid, 33).allowed; }

    @Test public void thisAppMayConnect() {
        assertTrue("the play screen and the media notification", allows(MY_PACKAGE, ME));
        assertFalse("this app's name under another uid is not this app", allows(MY_PACKAGE, 10300));
    }

    @Test public void aSystemUidMayConnectWithoutAPin() {
        assertTrue("the system: media keys, a headset button", allows("android", 1000));
        assertTrue("Bluetooth runs as a system uid", allows("com.android.bluetooth", 1002));
        assertTrue("the same app id under a second user", allows("android", 1_001_000));
    }

    /** The system UI runs under an app uid; what makes it the system is the platform's signature. */
    @Test public void aPackageTheCallerOwnsThatIsSignedByThePlatformMayConnectWithoutAPin() {
        facts.install("com.android.systemui", 10045, OTHER_CERT).platform.add("com.android.systemui");
        assertTrue(allows("com.android.systemui", 10045));
        assertFalse("the name alone, from another uid", allows("com.android.systemui", 10300));
    }

    /** Media3 takes the package name from what the caller sends: any app can say it is the car. */
    @Test public void aForgedNameAtAnotherUidIsRefused() {
        facts.install(AUTO, 10150, AUTO_CERT).install("com.example.other", 10300, OTHER_CERT);
        pins.put(AUTO, AUTO_CERT);
        ControllerPolicy.Decision d = decide(AUTO, 10300, 33);
        assertFalse(d.allowed);
        assertEquals("the package is not the caller's", d.reason);
        assertNull("nothing to pin: the caller is not that package", d.observedDigest);
    }

    @Test public void theRightNameWithTheWrongSignatureIsRefused() {
        // A sideloaded APK that took an allowed package's name, on a phone without the real one.
        facts.install(AUTO, 10150, OTHER_CERT);
        pins.put(AUTO, AUTO_CERT);
        ControllerPolicy.Decision d = decide(AUTO, 10150, 33);
        assertFalse(d.allowed);
        assertEquals("the signing certificate is not the pinned one", d.reason);
        assertEquals(OTHER_CERT, d.observedDigest);
    }

    @Test public void theRightNameWithTheRightSignatureIsAllowed() {
        facts.install(AUTO, 10150, AUTO_CERT);
        pins.put(AUTO, AUTO_CERT.toUpperCase(java.util.Locale.ROOT));
        assertTrue(allows(AUTO, 10150));
    }

    /** No pin is no entry: the refusal carries what the owner needs to add one. */
    @Test public void aPackageWithNoPinIsRefusedAndItsCertificateReported() {
        facts.install("com.google.android.projection.gearhead", 10150, AUTO_CERT);
        ControllerPolicy.Decision d = decide("com.google.android.projection.gearhead", 10150, 33);
        assertFalse("no package is trusted by its name", d.allowed);
        assertEquals("no pin for this package", d.reason);
        assertEquals(AUTO_CERT, d.observedDigest);
        assertTrue(d.logLine("com.google.android.projection.gearhead"),
                d.logLine("com.google.android.projection.gearhead").contains("com.google.android.projection.gearhead=" + AUTO_CERT));
    }

    @Test public void aPackageWhoseCertificateCannotBeReadIsRefused() {
        facts.byUid.put(10150, new String[] { AUTO });
        pins.put(AUTO, AUTO_CERT);
        assertFalse(allows(AUTO, 10150));
        assertFalse("a uid Android knows no package for", allows(AUTO, 10151));
    }

    @Test public void aCallerWithNoNameIsRefused() {
        assertFalse(allows(null, 10300));
        assertFalse(allows("", 10300));
    }

    /** Before Android 9 the platform does not say who a legacy controller is, so nothing can be checked. */
    @Test public void anUnnamedLegacyControllerIsRefusedEverywhere() {
        assertFalse(decide(ControllerPolicy.LEGACY_UNKNOWN, -1, 27).allowed);
        assertFalse(decide(ControllerPolicy.LEGACY_UNKNOWN, -1, 33).allowed);
    }

    @Test public void thePinsAreReadFromWhatThePayloadCached() {
        assertEquals("the payload's media-service capability writes this key", "media.controllerPins", ControllerPins.KEY);
        Map<String, String> read = ControllerPins.fromCache("{\"com.example.car\":\"" + AUTO_CERT.toUpperCase(java.util.Locale.ROOT) + "\"}");
        assertEquals(AUTO_CERT, read.get("com.example.car"));
        for (String bad : new String[] { null, "", "not json", "[]", "{\"com.example.car\":\"short\"}", "{\"com.example.car\":7}" }) {
            assertTrue("accepted " + bad, ControllerPins.fromCache(bad).isEmpty());
        }
    }

    @Test public void theIdOfAPlayRequestIsAMediaIdAndNothingElse() {
        assertEquals("p:plex:11", ControllerPolicy.playRequest("p:plex:11"));
        assertEquals("c:plex:10", ControllerPolicy.playRequest("c:plex:10"));
        for (String bad : new String[] { null, "", "root", "https://evil.example/a.mp3", "x:plex:1", "p:", "p:a\nb" }) {
            assertNull("accepted " + bad, ControllerPolicy.playRequest(bad));
        }
        StringBuilder longId = new StringBuilder("p:plex:");
        for (int i = 0; i < 2000; i++) longId.append('a');
        assertNull(ControllerPolicy.playRequest(longId.toString()));
    }
}

package net.kckern.daylight.shellkit;

import static org.junit.Assert.*;

import org.junit.Test;

import java.util.HashMap;
import java.util.Map;

public class SignerPinsTest {
    private static final String CERT = "aa".repeat(32);
    private static final String OTHER = "bb".repeat(32);

    private static final class Facts implements PackageFacts {
        final Map<Integer, String[]> byUid = new HashMap<>();
        final Map<String, String> certs = new HashMap<>();
        @Override public String[] packagesForUid(int uid) { return byUid.get(uid); }
        @Override public String signingSha256(String packageName) { return certs.get(packageName); }
        @Override public boolean platformSigned(String packageName) { return false; }
        Facts install(String pkg, int uid, String cert) {
            byUid.put(uid, new String[] { pkg });
            if (cert != null) certs.put(pkg, cert);
            return this;
        }
    }

    private final Facts facts = new Facts();
    private final Map<String, String> pins = new HashMap<>();

    @Test public void thePinnedPackageOfTheCallersUidSignedWithThePinnedCertificateIsAllowed() {
        facts.install("com.example.host", 10150, CERT);
        pins.put("com.example.host", CERT);
        SignerPins.Result r = SignerPins.check("com.example.host", 10150, facts, pins);
        assertTrue(r.allowed);
        assertEquals("", r.reason);
    }

    @Test public void aNameTheUidDoesNotOwnIsRefusedWithNothingToPin() {
        facts.install("com.example.host", 10150, CERT).install("com.example.other", 10300, OTHER);
        pins.put("com.example.host", CERT);
        SignerPins.Result r = SignerPins.check("com.example.host", 10300, facts, pins);
        assertFalse(r.allowed);
        assertEquals("the package is not the caller's", r.reason);
        assertNull(r.observedDigest);
    }

    @Test public void noPinIsARefusalThatCarriesTheObservedDigest() {
        facts.install("com.example.host", 10150, CERT);
        SignerPins.Result r = SignerPins.check("com.example.host", 10150, facts, pins);
        assertFalse(r.allowed);
        assertEquals("no pin for this package", r.reason);
        assertEquals(CERT, r.observedDigest);
        assertFalse("an empty map is no pins", SignerPins.check("com.example.host", 10150, facts, null).allowed);
    }

    @Test public void theWrongCertificateIsRefused() {
        facts.install("com.example.host", 10150, OTHER);
        pins.put("com.example.host", CERT);
        SignerPins.Result r = SignerPins.check("com.example.host", 10150, facts, pins);
        assertFalse(r.allowed);
        assertEquals("the signing certificate is not the pinned one", r.reason);
        assertEquals(OTHER, r.observedDigest);
    }

    @Test public void anUnreadableCertificateIsRefused() {
        facts.install("com.example.host", 10150, null);
        pins.put("com.example.host", CERT);
        SignerPins.Result r = SignerPins.check("com.example.host", 10150, facts, pins);
        assertFalse(r.allowed);
        assertEquals("the package's signing certificate cannot be read", r.reason);
    }

    @Test public void theCacheIsAnObjectOfPackageToDigestAndAnythingElseIsNoPins() {
        assertEquals(CERT, SignerPins.fromCache("{\"com.example.host\":\"" + CERT.toUpperCase(java.util.Locale.ROOT) + "\"}").get("com.example.host"));
        assertTrue(SignerPins.fromCache(null).isEmpty());
        assertTrue(SignerPins.fromCache("").isEmpty());
        assertTrue(SignerPins.fromCache("[]").isEmpty());
        assertTrue("one bad digest spoils the lot", SignerPins.fromCache("{\"a.b\":\"" + CERT + "\",\"c.d\":\"xyz\"}").isEmpty());
    }
}

package net.kckern.daylight.cap.caractions.shell;

import static org.junit.Assert.*;

import net.kckern.daylight.shellkit.PackageFacts;

import org.junit.Test;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

public class CarHostPolicyTest {
    private static final String AUTO = CarHostPolicy.ANDROID_AUTO;
    private static final String AUTO_CERT = "aa".repeat(32);
    private static final String OTHER_CERT = "bb".repeat(32);

    /** The package facts seam: what Android would say about the packages on the phone. */
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

    @Test public void androidAutoIsAndroidAutosPackage() {
        assertEquals("com.google.android.projection.gearhead", AUTO);
    }

    @Test public void pinnedAndroidAutoBindingFromItsOwnUidIsAllowed() {
        facts.install(AUTO, 10150, AUTO_CERT);
        pins.put(AUTO, AUTO_CERT);
        CarHostPolicy.Decision d = CarHostPolicy.decide(10150, facts, pins);
        assertTrue(d.allowed);
        assertEquals(10150, d.uid);
        assertEquals(AUTO_CERT, d.pinnedDigest);
    }

    /** First connection: refused, and the line says exactly what to pin. */
    @Test public void withNoPinAndroidAutoIsRefusedAndTheLogLineCarriesItsDigest() {
        facts.install(AUTO, 10150, AUTO_CERT);
        CarHostPolicy.Decision d = CarHostPolicy.decide(10150, facts, pins);
        assertFalse(d.allowed);
        assertEquals("no pin for this package", d.reason);
        assertEquals(AUTO_CERT, d.observedDigest);
        assertEquals("refused car host " + AUTO + ": no pin for this package. To allow it, add " + AUTO + "=" + AUTO_CERT
                + " to car.hostPins", d.logLine());
    }

    @Test public void androidAutosNameWithAnotherCertificateIsRefused() {
        facts.install(AUTO, 10150, OTHER_CERT);
        pins.put(AUTO, AUTO_CERT);
        CarHostPolicy.Decision d = CarHostPolicy.decide(10150, facts, pins);
        assertFalse(d.allowed);
        assertEquals("the signing certificate is not the pinned one", d.reason);
        assertEquals(OTHER_CERT, d.observedDigest);
    }

    /** Another app, even one that is pinned, platform-signed or a system uid, is not a car host. */
    @Test public void anyOtherCallerIsRefusedWhateverItHolds() {
        facts.install("com.example.app", 10300, OTHER_CERT);
        pins.put("com.example.app", OTHER_CERT);
        CarHostPolicy.Decision d = CarHostPolicy.decide(10300, facts, pins);
        assertFalse(d.allowed);
        assertEquals("the binding app is not Android Auto", d.reason);
        assertNull("nothing to pin: it is not Android Auto", d.observedDigest);
        assertTrue(d.logLine().contains("com.example.app"));
        assertFalse(d.logLine().contains("To allow it"));

        facts.install("com.android.systemui", 10045, OTHER_CERT).platform.add("com.android.systemui");
        assertFalse(CarHostPolicy.decide(10045, facts, pins).allowed);
        assertFalse("a system uid is not Android Auto", CarHostPolicy.decide(1000, facts, pins).allowed);
        assertFalse("an unknown caller", CarHostPolicy.decide(-1, facts, pins).allowed);
    }

    /** A uid that owns Android Auto's name with no certificate Android can read is refused. */
    @Test public void anUnreadableCertificateIsRefused() {
        facts.byUid.put(10150, new String[] { AUTO });
        pins.put(AUTO, AUTO_CERT);
        CarHostPolicy.Decision d = CarHostPolicy.decide(10150, facts, pins);
        assertFalse(d.allowed);
        assertEquals("the package's signing certificate cannot be read", d.reason);
    }

    @Test public void noPinsAtAllRefusesEverything() {
        facts.install(AUTO, 10150, AUTO_CERT);
        assertFalse(CarHostPolicy.decide(10150, facts, null).allowed);
    }

    /** The screen serves only the host that was decided on: Android Auto, at the uid that passed. */
    @Test public void theScreenServesOnlyTheHostThatPassed() {
        facts.install(AUTO, 10150, AUTO_CERT);
        pins.put(AUTO, AUTO_CERT);
        CarHostPolicy.Decision d = CarHostPolicy.decide(10150, facts, pins);
        assertTrue(CarHostPolicy.serves(d, AUTO, 10150));
        assertFalse(CarHostPolicy.serves(d, AUTO, 10151));
        assertFalse(CarHostPolicy.serves(d, "com.example.app", 10150));
        assertFalse(CarHostPolicy.serves(null, AUTO, 10150));
        assertFalse(CarHostPolicy.serves(CarHostPolicy.decide(10150, facts, null), AUTO, 10150));
    }
}

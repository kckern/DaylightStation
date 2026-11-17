package net.kckern.daylight.cap.lockdown;

import static org.junit.Assert.*;

import org.junit.Test;

public class ExemptionsTest {
    private static final String KIOSK = "net.kckern.daylight.test";

    @Test public void aTimedExemptionMatchesItsRuleUntilItExpires() {
        Exemptions e = new Exemptions();
        e.allowFor("com.android.settings/.bluetooth.BluetoothPairingDialog", 1_000, 5_000);
        assertTrue(e.allows("com.android.settings", "com.android.settings.bluetooth.BluetoothPairingDialog", 5_999));
        assertFalse(e.allows("com.android.settings", "com.android.settings.Settings", 2_000));
        assertFalse(e.allows("com.android.settings", null, 2_000));
        assertFalse(e.allows("com.android.settings", "com.android.settings.bluetooth.BluetoothPairingDialog", 6_000));
    }

    @Test public void aTimedExemptionIsCappedAtOneHour() {
        Exemptions e = new Exemptions();
        e.allowFor("com.a.b", 0, 100 * Exemptions.MAX_MS);
        assertTrue(e.allows("com.a.b", null, Exemptions.MAX_MS - 1));
        assertFalse(e.allows("com.a.b", null, Exemptions.MAX_MS));
    }

    @Test public void whileInFrontLastsUntilThePackageHasBeenSeenAndLeaves() {
        Exemptions e = new Exemptions();
        e.allowWhileInFront("com.retroarch.aarch64", 0);
        e.observeFront(KIOSK, 500);                       // not in front yet
        assertTrue(e.allows("com.retroarch.aarch64", null, 500));
        e.observeFront("com.retroarch.aarch64", 1_500);   // now in front
        e.observeFront("com.retroarch.aarch64", 3_600_000);
        assertTrue("no time limit while it stays in front", e.allows("com.retroarch.aarch64", null, 3_600_000));
        e.observeFront(KIOSK, 3_601_000);                 // left
        assertFalse(e.allows("com.retroarch.aarch64", null, 3_601_000));
    }

    @Test public void whileInFrontExpiresIfThePackageNeverAppears() {
        Exemptions e = new Exemptions();
        e.allowWhileInFront("com.a.b", 0);
        e.observeFront(KIOSK, Exemptions.UNSEEN_MS);
        assertTrue(e.allows("com.a.b", null, Exemptions.UNSEEN_MS));
        e.observeFront(KIOSK, Exemptions.UNSEEN_MS + 1);
        assertFalse(e.allows("com.a.b", null, Exemptions.UNSEEN_MS + 1));
    }

    @Test public void anUnknownForegroundDoesNotEndAWhileInFrontGrant() {
        Exemptions e = new Exemptions();
        e.allowWhileInFront("com.a.b", 0);
        e.observeFront("com.a.b", 1_000);
        e.observeFront(null, 2_000);
        assertTrue(e.allows("com.a.b", null, 2_000));
    }

    @Test public void listsWhatIsInForce() {
        Exemptions e = new Exemptions();
        e.allowFor("com.a.b", 0, 5_000);
        e.allowWhileInFront("com.c.d", 0);
        assertEquals(java.util.Arrays.asList("com.a.b until 5000", "com.c.d while in front"), e.describe(1_000));
        assertEquals(new java.util.TreeSet<>(java.util.Arrays.asList("com.a.b", "com.c.d")), e.packages(1_000));
        e.observeFront(KIOSK, 6_000);
        assertEquals(java.util.Arrays.asList("com.c.d while in front"), e.describe(6_000));
    }

    @Test public void rejectsBadGrants() {
        Exemptions e = new Exemptions();
        for (Runnable bad : new Runnable[] {
                () -> e.allowFor("*", 0, 1_000), () -> e.allowFor("com.a.b,com.c.d", 0, 1_000),
                () -> e.allowFor("com.a.b", 0, 0), () -> e.allowWhileInFront("com.a.*", 0),
                () -> e.allowWhileInFront("com.a.b/.C", 0), () -> e.allowWhileInFront("", 0) }) {
            try { bad.run(); fail("expected IllegalArgumentException"); } catch (IllegalArgumentException expected) { }
        }
    }
}

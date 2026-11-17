package net.kckern.daylight.core.kiosk;

import static org.junit.Assert.*;

import org.junit.Test;

public class AllowRulesTest {
    @Test public void aPackageRuleMatchesAnyActivityOfThatPackage() {
        AllowRules r = AllowRules.parse("com.example.app");
        assertTrue(r.matches("com.example.app", "com.example.app.Main"));
        assertTrue(r.matches("com.example.app", null));
        assertFalse(r.matches("com.example.application", null));
        assertFalse(r.matches("com.example", null));
    }

    @Test public void aSingleActivityRuleMatchesOnlyThatActivity() {
        AllowRules r = AllowRules.parse("com.android.settings/.bluetooth.BluetoothPairingDialog");
        assertTrue(r.matches("com.android.settings", "com.android.settings.bluetooth.BluetoothPairingDialog"));
        assertFalse(r.matches("com.android.settings", "com.android.settings.Settings"));
        assertFalse("an unknown activity never satisfies a single-activity rule",
                r.matches("com.android.settings", null));
    }

    @Test public void aFullClassNameWorksLikeTheShortForm() {
        AllowRules r = AllowRules.parse("com.a.b/com.a.b.ui.Pair");
        assertTrue(r.matches("com.a.b", "com.a.b.ui.Pair"));
    }

    @Test public void aWildcardMatchesAPackagePrefixOnSegmentBoundaries() {
        AllowRules r = AllowRules.parse("com.retroarch.*");
        assertTrue(r.matches("com.retroarch.aarch64", null));
        assertTrue(r.matches("com.retroarch.ra32", "x.Y"));
        assertFalse(r.matches("com.retroarch", null));
        assertFalse(r.matches("com.retroarchx.foo", null));
    }

    @Test public void severalRulesAreSeparatedByCommasAndWhitespace() {
        AllowRules r = AllowRules.parse(" com.a.b , com.c.d/.E ,, ");
        assertTrue(r.matches("com.a.b", null));
        assertTrue(r.matches("com.c.d", "com.c.d.E"));
        assertEquals(java.util.Arrays.asList("com.a.b", "com.c.d/com.c.d.E"), r.describe());
        assertEquals(new java.util.TreeSet<>(java.util.Arrays.asList("com.a.b", "com.c.d")), r.exactPackages());
    }

    @Test public void emptyMeansNothingIsAllowed() {
        AllowRules r = AllowRules.parse("");
        assertFalse(r.matches("com.a.b", null));
        assertTrue(AllowRules.parse(null).describe().isEmpty());
    }

    @Test public void rejectsRulesThatWouldAllowEverythingOrAreMalformed() {
        for (String bad : new String[] { "*", "com.*.x", "*.example", "com", "com.a.b/", "com.a.b/.X/.Y", "com.a b", "c.*" }) {
            try { AllowRules.parse(bad); fail("expected rejection of '" + bad + "'"); }
            catch (IllegalArgumentException expected) { }
        }
    }

    @Test public void lenientParsingFailsClosedToAnEmptyList() {
        assertFalse(AllowRules.parseOrEmpty("*").matches("com.a.b", null));
        assertNull(AllowRules.errorIn("com.a.b"));
        assertNotNull(AllowRules.errorIn("*"));
    }
}

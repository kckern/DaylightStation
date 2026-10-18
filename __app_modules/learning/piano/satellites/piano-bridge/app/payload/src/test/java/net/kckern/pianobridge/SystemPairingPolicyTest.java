package net.kckern.pianobridge;

import org.junit.Test;
import static org.junit.Assert.*;

public class SystemPairingPolicyTest {
    private static final String MAC = "12:34:56:78:9A:BC";

    @Test public void delegationRequiresBothExplicitOptInAndBoundHelper() {
        assertEquals("unsupported", SystemPairingPolicy.confirmationMode(false, false, false));
        assertEquals("unsupported", SystemPairingPolicy.confirmationMode(false, false, true));
        assertEquals("unsupported", SystemPairingPolicy.confirmationMode(false, true, false));
        assertEquals("system-dialog", SystemPairingPolicy.confirmationMode(false, true, true));
        assertEquals("native", SystemPairingPolicy.confirmationMode(true, false, false));
    }

    @Test public void dialogExceptionCannotOutliveOrChangeTheExplicitlyRequestedDevice() {
        assertTrue(SystemPairingPolicy.ownsDelegatedRequest(MAC, 2000L, MAC, 2000L, 1000L));
        assertFalse(SystemPairingPolicy.ownsDelegatedRequest(MAC, 2000L, null, 2000L, 1000L));
        assertFalse(SystemPairingPolicy.ownsDelegatedRequest(MAC, 2000L, "22:34:56:78:9A:BC", 2000L, 1000L));
        assertFalse(SystemPairingPolicy.ownsDelegatedRequest(MAC, 2000L, MAC, 0L, 1000L));
        assertFalse(SystemPairingPolicy.ownsDelegatedRequest(MAC, 2000L, MAC, 2000L, 2000L));
        assertFalse(SystemPairingPolicy.ownsDelegatedRequest(MAC, 2000L, MAC, 3000L, 1000L));
    }

    @Test public void activeRootMustProvePairingDialogPackageTitleDeviceAndPositiveButton() {
        assertTrue(matches("com.android.settings", "Bluetooth pairing request", "Pair with Studio Speaker?", true));
        assertFalse(matches("com.android.settings", "Settings", "Studio Speaker", true));
        assertFalse(matches("com.android.settings", "Bluetooth pairing request", "Other Speaker", true));
        assertFalse(matches("com.android.settings", "Bluetooth pairing request", "Studio Speaker", false));
        assertFalse(matches("another.app", "Bluetooth pairing request", "Studio Speaker", true));
        assertFalse(matches("com.android.settings", null, "Studio Speaker", true));
        assertTrue(SystemPairingPolicy.matchesDialog("com.android.settings", "Bluetooth pairing request",
                "Pair with " + MAC + "?", null, MAC, "Pair"));
        assertFalse(SystemPairingPolicy.matchesDialog("com.android.settings", "Bluetooth pairing request",
                "Pair with an unknown device?", null, MAC, "Pair"));
    }

    private boolean matches(String pkg, String title, String text, boolean positive) {
        return SystemPairingPolicy.matchesDialog(pkg, title, text, "Studio Speaker", MAC, positive ? "Pair" : null);
    }

    @Test public void unpairDialogAndDeviceNameSubstringsDoNotGrantSettingsException() {
        assertFalse(SystemPairingPolicy.matchesDialog("com.android.settings", "Unpair device?", "J2", "J2", MAC, "Pair"));
        assertFalse(SystemPairingPolicy.matchesDialog("com.android.settings", "Bluetooth pairing request", "J20", "J2", MAC, "Pair"));
        assertFalse(SystemPairingPolicy.matchesDialog("com.android.settings", "Bluetooth pairing request", "Pair with J20?", "J2", MAC, "Pair"));
        assertFalse(SystemPairingPolicy.matchesDialog("com.android.settings", "Bluetooth pairing request", "A new device is ready", "a", MAC, "Pair"));
        assertFalse(SystemPairingPolicy.matchesDialog("com.android.settings", "Bluetooth pairing request", "J2", "J2", MAC, "Unpair"));
        assertFalse(SystemPairingPolicy.matchesDialog("com.android.settings", "Bluetooth pairing request", "J2", "J2", MAC, "OK"));
        assertTrue(SystemPairingPolicy.matchesDialog("com.android.settings", "Bluetooth pairing request", "J2", "J2", MAC, "Pair"));
        assertTrue(SystemPairingPolicy.matchesDialog("com.android.settings", "Pair with J2?", "Confirm connection", "J2", MAC, "Pair"));
    }

    @Test public void normalizesBidiWhitespaceAndQuotedNamesWithoutJoiningDifferentNodes() {
        assertTrue(SystemPairingPolicy.matchesDialog("com.android.settings", "\u200ePair  with \u201cJ2\u201d?", "Confirm", "J2", MAC, " Pair "));
        assertFalse(SystemPairingPolicy.matchesDialog("com.android.settings", "Bluetooth pairing request", "Studio\nSpeaker", "Studio Speaker", MAC, "Pair"));
        assertTrue(SystemPairingPolicy.matchesDialog("com.android.settings", "Bluetooth pairing request", "Address: " + MAC, null, MAC, "Pair"));
        assertFalse(SystemPairingPolicy.matchesDialog("com.android.settings", "Bluetooth pairing request", MAC + "D", null, MAC, "Pair"));
        assertFalse(SystemPairingPolicy.matchesDialog("com.android.settings", "Bluetooth pairing request", "D" + MAC, null, MAC, "Pair"));
    }

    @Test public void controlsAndGenericHeadingCannotImpersonateRequestedDeviceIdentity() {
        assertFalse(SystemPairingPolicy.isIdentityText("android:id/button1", false, "android.widget.Button"));
        assertFalse(SystemPairingPolicy.isIdentityText("android:id/button2", false, "android.widget.TextView"));
        assertFalse(SystemPairingPolicy.isIdentityText(null, false, "android.widget.Button"));
        assertFalse(SystemPairingPolicy.isIdentityText("android:id/alertTitle", false, "android.widget.TextView"));
        assertFalse(SystemPairingPolicy.isIdentityText(null, true, "android.widget.TextView"));
        assertTrue(SystemPairingPolicy.isIdentityText("android:id/message", false, "android.widget.TextView"));
        for (String name : new String[]{"Pair", "Cancel", "Bluetooth pairing request"}) {
            assertFalse(SystemPairingPolicy.matchesDialog("com.android.settings", "Bluetooth pairing request", "",
                    name, MAC, "Pair"));
        }
        assertTrue(SystemPairingPolicy.matchesDialog("com.android.settings", "Pair with Pair?", "",
                "Pair", MAC, "Pair"));
        assertTrue(SystemPairingPolicy.matchesDialog("com.android.settings", "Bluetooth pairing request", "Pair",
                "Pair", MAC, "Pair"));
    }
}

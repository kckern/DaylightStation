package net.kckern.daylight.core;

import static org.junit.Assert.*;

import org.junit.Test;

public class UpdateConfirmRuleTest {
    private static final String OWN = "net.kckern.daylight.example";
    private static final String INSTALLER = "com.google.android.packageinstaller";
    private static final String TEXT = "Daylight Do you want to install an update to this existing application?";

    private static UpdateConfirmRule.Facts ok() {
        UpdateConfirmRule.Facts f = new UpdateConfirmRule.Facts();
        f.pending = true;
        f.nowMs = 1_000;
        f.deadlineMs = 2_000;
        f.dialogPackage = INSTALLER;
        f.dialogPackageIsSystemApp = true;
        f.dialogText = TEXT;
        f.appLabel = "Daylight";
        f.ownPackage = OWN;
        f.sessionFound = true;
        f.sessionInstallerPackage = OWN;
        f.sessionAppPackage = OWN;
        return f;
    }

    @Test public void approvesItsOwnPendingUpdateInTheSystemInstaller() {
        assertNull(UpdateConfirmRule.refusal(ok()));
        UpdateConfirmRule.Facts aosp = ok();
        aosp.dialogPackage = "com.android.packageinstaller";
        assertNull(UpdateConfirmRule.refusal(aosp));
    }

    @Test public void refusesWhenNoUpdateOfOursIsPending() {
        UpdateConfirmRule.Facts f = ok();
        f.pending = false;
        assertEquals("not_pending", UpdateConfirmRule.refusal(f));
        f = ok();
        f.nowMs = 2_001;
        assertEquals("expired", UpdateConfirmRule.refusal(f));
    }

    @Test public void refusesADialogThatIsNotTheSystemPackageInstaller() {
        UpdateConfirmRule.Facts f = ok();
        f.dialogPackage = "com.example.store";
        assertEquals("not_installer", UpdateConfirmRule.refusal(f));
        f = ok();
        f.dialogPackage = null;
        assertEquals("not_installer", UpdateConfirmRule.refusal(f));
        // An app that only carries the installer's package name on a build where that name is free.
        f = ok();
        f.dialogPackageIsSystemApp = false;
        assertEquals("not_system_app", UpdateConfirmRule.refusal(f));
    }

    @Test public void refusesADialogThatDoesNotNameThisAppsExactLabelAsAWord() {
        for (String text : new String[] {
                "Daylighter Do you want to install this application?",
                "MyDaylight Do you want to install this application?",
                "daylight Do you want to install this application?",
                "Day light Do you want to install this application?",
                "Do you want to install this application?",
        }) {
            UpdateConfirmRule.Facts f = ok();
            f.dialogText = text;
            assertEquals(text, "label_not_named", UpdateConfirmRule.refusal(f));
        }
        for (String text : new String[] {
                "Do you want to update Daylight?",
                "Install “Daylight”",
                "Daylight\nInstall",
        }) {
            UpdateConfirmRule.Facts f = ok();
            f.dialogText = text;
            assertNull(text, UpdateConfirmRule.refusal(f));
        }
        UpdateConfirmRule.Facts f = ok();
        f.appLabel = "";
        assertEquals("label_not_named", UpdateConfirmRule.refusal(f));
    }

    @Test public void aLabelOfSeveralWordsMustAppearWhole() {
        UpdateConfirmRule.Facts f = ok();
        f.appLabel = "Daylight Piano";
        f.dialogText = "Daylight Do you want to install this application?";
        assertEquals("label_not_named", UpdateConfirmRule.refusal(f));
        f.dialogText = "Daylight Piano Do you want to install this application?";
        assertNull(UpdateConfirmRule.refusal(f));
    }

    @Test public void refusesAnUninstallDialogAndOneThatAsksNothingAboutInstalling() {
        UpdateConfirmRule.Facts f = ok();
        f.dialogText = "Daylight Do you want to uninstall this app?";
        assertEquals("not_install_dialog", UpdateConfirmRule.refusal(f));
        f = ok();
        f.dialogText = "Daylight";
        assertEquals("not_install_dialog", UpdateConfirmRule.refusal(f));
    }

    @Test public void refusesWhenThePendingSessionIsNotThisPackages() {
        UpdateConfirmRule.Facts f = ok();
        f.sessionFound = false;
        assertEquals("no_session", UpdateConfirmRule.refusal(f));
        f = ok();
        f.sessionInstallerPackage = "com.example.other";
        assertEquals("session_not_ours", UpdateConfirmRule.refusal(f));
        f = ok();
        f.sessionInstallerPackage = null;
        assertEquals("session_not_ours", UpdateConfirmRule.refusal(f));
        // The session must install this package, not some other APK this app was handed.
        f = ok();
        f.sessionAppPackage = "com.example.other";
        assertEquals("session_targets_other_package", UpdateConfirmRule.refusal(f));
        f = ok();
        f.sessionAppPackage = null;
        assertEquals("session_targets_other_package", UpdateConfirmRule.refusal(f));
    }
}

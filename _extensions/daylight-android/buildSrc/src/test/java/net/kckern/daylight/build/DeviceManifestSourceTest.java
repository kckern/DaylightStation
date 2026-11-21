package net.kckern.daylight.build;

import static org.junit.Assert.*;

import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;

public class DeviceManifestSourceTest {
    private static DeviceSpec device(java.util.List<String> permissions, java.util.List<String> types) {
        return device(permissions, types, Arrays.asList("debug-tools"));
    }

    private static DeviceSpec device(java.util.List<String> permissions, java.util.List<String> types,
                                     java.util.List<String> capabilities) {
        return new DeviceSpec("shield", "net.kckern.daylight.shield", 30, 33, Collections.emptyList(),
                8780, 8781, 1, "0.1", capabilities, Collections.emptyMap(), permissions, types);
    }

    private static int count(String text, String needle) {
        int n = 0;
        for (int i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) n++;
        return n;
    }

    @Test public void aKioskBuildTakesTheLauncherIconAwayFromTheSetupActivity() {
        // One icon: the kiosk Activity (declared by webview-host's shell half) keeps LAUNCHER.
        String xml = DeviceManifestSource.render(device(Collections.emptyList(), Collections.emptyList(),
                Arrays.asList("debug-tools", "webview-host")));
        assertTrue(xml.contains("<activity android:name=\"net.kckern.daylight.shell.MainActivity\""));
        assertTrue(xml.contains("<intent-filter tools:node=\"removeAll\" />"));
    }

    @Test public void aBuildWithoutTheKioskLeavesTheSetupActivityItsLauncherIcon() {
        String xml = DeviceManifestSource.render(device(Collections.emptyList(), Arrays.asList("microphone")));
        assertFalse(xml.contains("MainActivity"));
        assertFalse(xml.contains("removeAll"));
    }

    @Test public void serviceTypesAndTheLauncherHandoffShareOneApplicationElement() {
        String xml = DeviceManifestSource.render(device(Collections.emptyList(), Arrays.asList("microphone"),
                Arrays.asList("webview-host")));
        assertEquals(1, count(xml, "<application>"));
        assertTrue(xml.contains("android:foregroundServiceType=\"microphone\""));
        assertTrue(xml.contains("MainActivity"));
    }

    @Test public void declaresExtraPermissionsAndTheServiceTypes() {
        String xml = DeviceManifestSource.render(device(
                Arrays.asList("android.permission.VIBRATE"), Arrays.asList("microphone", "location")));
        assertTrue(xml.contains("<uses-permission android:name=\"android.permission.VIBRATE\""));
        assertTrue(xml.contains("android:name=\"net.kckern.daylight.shell.ShellService\""));
        assertTrue(xml.contains("android:foregroundServiceType=\"microphone|location\""));
    }

    @Test public void aDeviceWithNeitherGetsAnEmptyManifest() {
        String xml = DeviceManifestSource.render(device(Collections.emptyList(), Collections.emptyList()));
        assertFalse(xml.contains("uses-permission"));
        assertFalse(xml.contains("<application>"));
    }

    // ── permissions only a kiosk needs ────────────────────────────────────────

    private static final String INSTALL = "android.permission.REQUEST_INSTALL_PACKAGES";
    private static final String SECURE = "android.permission.WRITE_SECURE_SETTINGS";

    @Test public void aKioskBuildDeclaresTheSelfUpdateAndSecureSettingsPermissions() {
        for (java.util.List<String> caps : Arrays.asList(
                Arrays.asList("webview-host", "accessibility", "lockdown"), Arrays.asList("webview-host", "debug-tools"))) {
            String xml = DeviceManifestSource.render(device(Collections.emptyList(), Collections.emptyList(), caps));
            assertEquals(String.valueOf(caps), 1, count(xml, INSTALL));
            assertEquals(1, count(xml, SECURE));
        }
    }

    @Test public void aPhoneBuildDeclaresNeither() {
        DeviceSpec phone = new DeviceSpec("phone", "net.kckern.daylight.phone", 26, 33, Collections.emptyList(),
                8780, 8781, 1, "0.1", Arrays.asList("webview-host", "notifications"), Collections.emptyMap(),
                Collections.emptyList(), Collections.emptyList(), "none", "");
        assertFalse(DeviceManifestSource.isKiosk(phone));
        String xml = DeviceManifestSource.render(phone);
        assertFalse(xml.contains(INSTALL));
        assertFalse(xml.contains(SECURE));
        // A build with no kiosk window is not a kiosk either, whatever its bind.
        assertFalse(DeviceManifestSource.isKiosk(device(Collections.emptyList(), Collections.emptyList())));
    }

    @Test public void aKioskPermissionADeviceFileAlsoStatesIsDeclaredOnce() {
        String xml = DeviceManifestSource.render(device(Arrays.asList(INSTALL, "android.permission.VIBRATE"), Collections.emptyList(),
                Arrays.asList("webview-host", "accessibility", "lockdown")));
        assertEquals(1, count(xml, INSTALL));
        assertEquals(1, count(xml, "android.permission.VIBRATE"));
    }

    // ── the HOME filter ───────────────────────────────────────────────────────

    private static final String KIOSK = "<activity android:name=\"net.kckern.daylight.cap.webviewhost.shell.KioskActivity\"";

    private static final String ALIAS = "<activity-alias android:name=\"net.kckern.daylight.cap.lockdown.shell.KioskHome\"";

    @Test public void aBuildWithLockdownCarriesTheHomeFilterOnADisabledAliasOnly() {
        String xml = DeviceManifestSource.render(device(Collections.emptyList(), Collections.emptyList(),
                Arrays.asList("webview-host", "accessibility", "lockdown")));
        assertEquals(1, count(xml, "<application>"));
        assertEquals("the HOME category appears once", 1, count(xml, "android.intent.category.HOME"));
        assertEquals(1, count(xml, ALIAS));
        int at = xml.indexOf(ALIAS);
        String alias = xml.substring(at, xml.indexOf("</activity-alias>", at));
        assertTrue(alias.contains("android:targetActivity=\"net.kckern.daylight.cap.webviewhost.shell.KioskActivity\""));
        assertTrue("installing must add no home candidate", alias.contains("android:enabled=\"false\""));
        assertTrue(alias.contains("android:exported=\"true\""));
        assertTrue(alias.contains("<action android:name=\"android.intent.action.MAIN\" />"));
        assertTrue(alias.contains("<category android:name=\"android.intent.category.HOME\" />"));
        assertTrue(alias.contains("<category android:name=\"android.intent.category.DEFAULT\" />"));
        assertFalse(alias.contains("LAUNCHER"));
    }

    @Test public void theKioskActivityItselfHasNoHomeFilterAndComesBeforeItsAlias() {
        String xml = DeviceManifestSource.render(device(Collections.emptyList(), Collections.emptyList(),
                Arrays.asList("webview-host", "accessibility", "lockdown")));
        assertEquals(1, count(xml, KIOSK));
        int activity = xml.indexOf(KIOSK), alias = xml.indexOf(ALIAS);
        // An alias whose target is declared after it is refused at install.
        assertTrue("the target is restated before the alias", activity > 0 && activity < alias);
        String restated = xml.substring(activity, alias);
        assertTrue(restated.contains("tools:node=\"merge\""));
        assertFalse("no filter of any kind is added to the Activity", restated.contains("intent-filter"));
        // Split screen and picture-in-picture are off for a kiosk that can be locked.
        assertTrue(restated.contains("android:resizeableActivity=\"false\""));
        assertTrue(restated.contains("android:supportsPictureInPicture=\"false\""));
        assertFalse(restated.contains("removeAll"));
    }

    @Test public void aKioskBuildWithoutLockdownIsNeverAHomeCandidate() {
        String xml = DeviceManifestSource.render(device(Collections.emptyList(), Collections.emptyList(),
                Arrays.asList("debug-tools", "webview-host")));
        assertFalse(xml.contains("category.HOME"));
        assertFalse(xml.contains("KioskActivity"));
        assertFalse(xml.contains("activity-alias"));
    }

    // ── https links of the household site ─────────────────────────────────────

    private static final String LINK_ACTIVITY = "net.kckern.daylight.cap.notifications.shell.LinkActivity";

    private static DeviceSpec phone(String appLinksHost) {
        return new DeviceSpec("phone", "net.kckern.daylight.phone", 26, 33, Collections.emptyList(),
                8780, 8781, 1, "0.1", Arrays.asList("webview-host", "notifications"), Collections.emptyMap(),
                Collections.emptyList(), Collections.emptyList(), "loopback", appLinksHost);
    }

    @Test public void phoneServiceWindowUsesItsOwnTask() {
        DeviceSpec personal = new DeviceSpec("phone", "net.kckern.daylight.phone", 26, 33, Collections.emptyList(),
                8780, 8781, 1, "0.1", Arrays.asList("webview-host", "widgets"), Collections.emptyMap(),
                Collections.emptyList(), Collections.emptyList(), "none", "");
        String xml = DeviceManifestSource.render(personal);
        assertTrue(xml, xml.contains("android:taskAffinity=\"net.kckern.daylight.phone.service\""));
    }

    private static Placeholders placeholders(String yaml) throws Exception {
        java.io.File f = java.io.File.createTempFile("private", ".yml");
        f.deleteOnExit();
        java.nio.file.Files.write(f.toPath(), yaml.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        return Placeholders.load(f);
    }

    @Test public void aDeviceWithAppLinksOffersTheLinkActivityForThatHostOverHttps() throws Exception {
        String xml = DeviceManifestSource.render(phone("{phone_link_host}"),
                placeholders("placeholders:\n  phone_link_host: kiosk.example\n"));
        int at = xml.indexOf("<activity android:name=\"" + LINK_ACTIVITY + "\"");
        assertTrue(xml, at > 0);
        String activity = xml.substring(at, xml.indexOf("</activity>", at));
        assertTrue(activity.contains("tools:node=\"merge\""));
        assertTrue(activity.contains("android:exported=\"true\""));
        assertTrue(activity.contains("<action android:name=\"android.intent.action.VIEW\" />"));
        assertTrue(activity.contains("<category android:name=\"android.intent.category.BROWSABLE\" />"));
        assertTrue(activity.contains("<data android:scheme=\"https\" android:host=\"kiosk.example\" />"));
        assertFalse("the filter is for one host; a scheme alone would claim every https link", activity.contains("<data android:scheme=\"https\" />"));
        assertFalse("http links are not claimed", activity.contains("android:scheme=\"http\""));
    }

    @Test public void aDeviceWithoutAppLinksClaimsNoWebLinks() throws Exception {
        String xml = DeviceManifestSource.render(phone(""), placeholders("placeholders: {}\n"));
        assertFalse(xml.contains(LINK_ACTIVITY));
        assertFalse(xml.contains("https"));
        assertEquals("the one-argument form is the same manifest", xml, DeviceManifestSource.render(phone("")));
    }

    @Test public void anAppLinksHostThatIsNotAHostNameFailsWithoutRepeatingIt() throws Exception {
        for (String bad : new String[] { "https://kiosk.example", "kiosk.example/path", "kiosk.example\\\" /><x", "*", "kiosk", "KIOSK.example", "" }) {
            try {
                DeviceManifestSource.render(phone("{phone_link_host}"),
                        placeholders("placeholders:\n  phone_link_host: '" + bad.replace("'", "''") + "'\n"));
                fail("accepted " + bad);
            } catch (CatalogException e) {
                assertTrue(e.getMessage(), e.getMessage().contains("appLinks.host"));
                if (!bad.isEmpty()) assertFalse(e.getMessage(), e.getMessage().contains(bad));
            }
        }
    }

    @Test public void anAppLinksPlaceholderWithNoValueNamesThePlaceholder() throws Exception {
        try {
            DeviceManifestSource.render(phone("{phone_link_host}"), placeholders("placeholders: {}\n"));
            fail("rendered without a value");
        } catch (CatalogException e) {
            assertTrue(e.getMessage(), e.getMessage().contains("phone_link_host"));
        }
    }
}

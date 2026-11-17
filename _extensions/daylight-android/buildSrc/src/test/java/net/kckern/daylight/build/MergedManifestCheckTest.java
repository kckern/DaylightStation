package net.kckern.daylight.build;

import static org.junit.Assert.*;

import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

public class MergedManifestCheckTest {
    private static final String KIOSK = "net.kckern.daylight.cap.webviewhost.shell.KioskActivity";
    private static final String ALIAS = "net.kckern.daylight.cap.lockdown.shell.KioskHome";
    private static final String HOME_FILTER = "<intent-filter><action android:name=\"android.intent.action.MAIN\" />"
            + "<category android:name=\"android.intent.category.HOME\" /><category android:name=\"android.intent.category.DEFAULT\" /></intent-filter>";

    private static DeviceSpec device(String... capabilities) {
        return new DeviceSpec("portal", "net.kckern.daylight.portal", 26, 28, Collections.emptyList(),
                8780, 8781, 1, "0.1", Arrays.asList(capabilities), Collections.emptyMap(),
                Collections.emptyList(), Collections.emptyList());
    }

    private static String manifest(String application) {
        return "<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\" package=\"net.kckern.daylight.portal\">"
                + "<application>" + application + "</application></manifest>";
    }

    private static String activity(String inner) { return activity(inner, "false", "false"); }

    private static String activity(String inner, String resizeable, String pip) {
        return "<activity android:name=\"" + KIOSK + "\" android:exported=\"true\""
                + (resizeable == null ? "" : " android:resizeableActivity=\"" + resizeable + "\"")
                + (pip == null ? "" : " android:supportsPictureInPicture=\"" + pip + "\"") + ">" + inner + "</activity>";
    }

    private static String alias(String enabled, String target) {
        return "<activity-alias android:name=\"" + ALIAS + "\" android:targetActivity=\"" + target + "\""
                + (enabled == null ? "" : " android:enabled=\"" + enabled + "\"") + " android:exported=\"true\">" + HOME_FILTER + "</activity-alias>";
    }

    private static final DeviceSpec KIOSK_DEVICE = device("webview-host", "accessibility", "lockdown");

    @Test public void theHomeFilterOnADisabledAliasAfterItsTargetIsSound() {
        assertEquals(Collections.emptyList(), MergedManifestCheck.failures(manifest(activity("") + alias("false", KIOSK)), KIOSK_DEVICE));
    }

    @Test public void aHomeFilterOnTheActivityItselfFails() {
        // What the build did before: installing made the app a second home candidate.
        List<String> f = MergedManifestCheck.failures(manifest(activity(HOME_FILTER)), KIOSK_DEVICE);
        assertFalse(f.isEmpty());
        assertTrue(f.toString(), f.get(0).contains("may only be on the disabled alias"));
    }

    @Test public void anAliasThatIsEnabledOrSaysNothingFails() {
        for (String enabled : new String[] { "true", null }) {
            List<String> f = MergedManifestCheck.failures(manifest(activity("") + alias(enabled, KIOSK)), KIOSK_DEVICE);
            assertTrue(String.valueOf(f), f.toString().contains("not declared android:enabled=\"false\""));
        }
    }

    @Test public void anAliasBeforeItsTargetOrWithAnotherTargetFails() {
        assertTrue(MergedManifestCheck.failures(manifest(alias("false", KIOSK) + activity("")), KIOSK_DEVICE).toString()
                .contains("declared before its target"));
        assertTrue(MergedManifestCheck.failures(manifest(activity("") + alias("false", "com.example.Other")), KIOSK_DEVICE).toString()
                .contains("does not target"));
    }

    @Test public void aLockdownBuildWhoseKioskCanBeResizedOrShownInPictureInPictureFails() {
        for (String[] attrs : new String[][] { { null, "false" }, { "true", "false" }, { "false", null }, { "false", "true" } }) {
            List<String> f = MergedManifestCheck.failures(manifest(activity("", attrs[0], attrs[1]) + alias("false", KIOSK)), KIOSK_DEVICE);
            assertEquals(String.valueOf(f), 1, f.size());
            assertTrue(f.get(0), f.get(0).contains(attrs[0] == null || "true".equals(attrs[0]) ? "resizeableActivity" : "supportsPictureInPicture"));
        }
        // The phone is not a kiosk: its window may be resized.
        assertEquals(Collections.emptyList(),
                MergedManifestCheck.failures(manifest(activity("", null, null)), device("webview-host", "notifications")));
    }

    @Test public void aLockdownBuildWithNoHomeFilterAtAllFails() {
        assertTrue(MergedManifestCheck.failures(manifest(activity("")), KIOSK_DEVICE).toString().contains("exactly one HOME filter"));
    }

    @Test public void aBuildWithoutLockdownMustHaveNone() {
        DeviceSpec phone = device("webview-host", "notifications");
        assertEquals(Collections.emptyList(), MergedManifestCheck.failures(manifest(activity("")), phone));
        assertTrue(MergedManifestCheck.failures(manifest(activity("") + alias("false", KIOSK)), phone).toString()
                .contains("must have no HOME filter"));
    }

    @Test public void theGeneratedFragmentPassesItsOwnCheck() {
        // The fragment is not the merged manifest, but its application element has the same shape.
        String xml = DeviceManifestSource.render(KIOSK_DEVICE);
        assertEquals(Collections.emptyList(), MergedManifestCheck.failures(xml, KIOSK_DEVICE));
    }

    // ── a device with control.bind none: its own exact list ──────────────────

    private static final String LINK = "net.kckern.daylight.cap.notifications.shell.LinkActivity";
    private static final String MAIN = "net.kckern.daylight.shell.MainActivity";
    private static final String BOOT = "net.kckern.daylight.shell.BootReceiver";
    private static final DeviceSpec PHONE = new DeviceSpec("phone", "com.example.app", 26, 33, Collections.emptyList(),
            8780, 8781, 1, "0.1", Arrays.asList("webview-host", "notifications"), Collections.emptyMap(),
            Collections.emptyList(), Collections.emptyList(), "none", "");
    private static final PersonalBuild.Expectation EXPECTED = new PersonalBuild.Expectation(
            Arrays.asList("android.permission.INTERNET", "android.permission.RECORD_AUDIO"), Arrays.asList(KIOSK, LINK, BOOT));

    private static String launcher(String extraCategory) {
        return "<intent-filter><action android:name=\"android.intent.action.MAIN\" /><category android:name=\"android.intent.category.LAUNCHER\" />"
                + (extraCategory == null ? "" : "<category android:name=\"" + extraCategory + "\" />") + "</intent-filter>";
    }

    private static String phoneManifest(String permissions, String applicationAttrs, String components) {
        return "<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\" package=\"com.example.app\">" + permissions
                + "<application " + applicationAttrs + ">" + components + "</application></manifest>";
    }

    private static final String PERMISSIONS = "<uses-permission android:name=\"android.permission.INTERNET\" />"
            + "<uses-permission android:name=\"android.permission.RECORD_AUDIO\" />";
    private static final String APP = "android:allowBackup=\"false\" android:usesCleartextTraffic=\"false\""
            + " android:dataExtractionRules=\"@xml/daylight_data_extraction_rules\" android:fullBackupContent=\"@xml/daylight_backup_rules\"";
    private static final String COMPONENTS =
            "<activity android:name=\"" + MAIN + "\" android:exported=\"false\" />"
            + "<activity android:name=\"" + KIOSK + "\" android:exported=\"true\">" + launcher(null) + "</activity>"
            + "<activity android:name=\"" + LINK + "\" android:exported=\"true\" />"
            + "<service android:name=\"net.kckern.daylight.shell.ShellService\" android:exported=\"false\" />"
            + "<receiver android:name=\"" + BOOT + "\" android:exported=\"true\" />";

    private static List<String> phone(String permissions, String app, String components) {
        return MergedManifestCheck.failures(phoneManifest(permissions, app, components), PHONE, EXPECTED);
    }

    @Test public void aPersonalBuildWithExactlyItsListPasses() {
        assertEquals(Collections.emptyList(), phone(PERMISSIONS, APP, COMPONENTS));
    }

    @Test public void aPermissionOutsideTheListOrMissingFromItFails() {
        List<String> extra = phone(PERMISSIONS + "<uses-permission android:name=\"android.permission.SYSTEM_ALERT_WINDOW\" />", APP, COMPONENTS);
        assertEquals(String.valueOf(extra), 1, extra.size());
        assertTrue(extra.get(0), extra.get(0).contains("SYSTEM_ALERT_WINDOW"));
        List<String> sdk23 = phone(PERMISSIONS + "<uses-permission-sdk-23 android:name=\"android.permission.CAMERA\" />", APP, COMPONENTS);
        assertTrue(String.valueOf(sdk23), sdk23.toString().contains("CAMERA"));
        List<String> missing = phone("<uses-permission android:name=\"android.permission.INTERNET\" />", APP, COMPONENTS);
        assertTrue(String.valueOf(missing), missing.toString().contains("RECORD_AUDIO"));
    }

    @Test public void anExportedComponentOutsideTheListFails() {
        // The setup activity, startable by any app to raise the battery screen and permission prompts.
        List<String> main = phone(PERMISSIONS, APP, COMPONENTS.replace("\"" + MAIN + "\" android:exported=\"false\"", "\"" + MAIN + "\" android:exported=\"true\""));
        assertEquals(String.valueOf(main), 1, main.size());
        assertTrue(main.get(0), main.get(0).contains(MAIN) && main.get(0).contains("exported"));
        // Exported by having a filter and not saying.
        List<String> unstated = phone(PERMISSIONS, APP, COMPONENTS + "<service android:name=\"com.example.Lib\"><intent-filter><action android:name=\"x\" /></intent-filter></service>");
        assertTrue(String.valueOf(unstated), unstated.toString().contains("com.example.Lib"));
        List<String> gone = phone(PERMISSIONS, APP, COMPONENTS.replace("<receiver android:name=\"" + BOOT + "\" android:exported=\"true\" />", ""));
        assertTrue(String.valueOf(gone), gone.toString().contains(BOOT));
    }

    @Test public void cleartextTheTvLauncherAndLockTaskAreNotInAPersonalBuild() {
        assertTrue(phone(PERMISSIONS, APP.replace("usesCleartextTraffic=\"false\"", "usesCleartextTraffic=\"true\""), COMPONENTS).toString().contains("usesCleartextTraffic"));
        assertTrue(phone(PERMISSIONS, APP.replace(" android:usesCleartextTraffic=\"false\"", ""), COMPONENTS).toString().contains("usesCleartextTraffic"));
        assertTrue(phone(PERMISSIONS, APP, COMPONENTS.replace(launcher(null), launcher("android.intent.category.LEANBACK_LAUNCHER"))).toString().contains("LEANBACK_LAUNCHER"));
        assertTrue(phone(PERMISSIONS, APP, COMPONENTS.replace("\"" + KIOSK + "\" android:exported=\"true\"",
                "\"" + KIOSK + "\" android:exported=\"true\" android:lockTaskMode=\"if_whitelisted\"")).toString().contains("lockTaskMode"));
    }

    /** A screen of a personal build (the site, a draft being typed) is behind the lock: no component declares otherwise. */
    @Test public void noComponentOfAPersonalBuildDeclaresItselfOverTheLockScreen() {
        String text = "<activity android:name=\"com.example.TextScreen\" android:exported=\"false\" />";
        assertEquals(Collections.emptyList(), phone(PERMISSIONS, APP, COMPONENTS + text));
        for (String attribute : new String[] { "showWhenLocked", "turnScreenOn", "showOnLockScreen" }) {
            List<String> f = phone(PERMISSIONS, APP, COMPONENTS + text.replace(" />", " android:" + attribute + "=\"true\" />"));
            assertEquals(String.valueOf(f), 1, f.size());
            assertTrue(f.get(0), f.get(0).contains("com.example.TextScreen") && f.get(0).contains(attribute));
        }
        assertEquals("said false is not a problem", Collections.emptyList(),
                phone(PERMISSIONS, APP, COMPONENTS + text.replace(" />", " android:showWhenLocked=\"false\" />")));
    }

    @Test public void nothingOfTheAppIsBackedUpOrTransferred() {
        for (String attr : new String[] { " android:dataExtractionRules=\"@xml/daylight_data_extraction_rules\"",
                " android:fullBackupContent=\"@xml/daylight_backup_rules\"" }) {
            List<String> f = phone(PERMISSIONS, APP.replace(attr, ""), COMPONENTS);
            assertEquals(String.valueOf(f), 1, f.size());
        }
        assertTrue(phone(PERMISSIONS, APP.replace("allowBackup=\"false\"", "allowBackup=\"true\""), COMPONENTS).toString().contains("allowBackup"));
        // The same holds for a kiosk: the link key and a queued memo are not the only private state.
        assertTrue(MergedManifestCheck.failures(manifest(activity("") + alias("false", KIOSK)), KIOSK_DEVICE, null, true)
                .toString().contains("dataExtractionRules"));
    }

    @Test public void theGeneratedFragmentOfAPersonalBuildRemovesWhatOnlyAKioskHas() {
        String xml = DeviceManifestSource.render(PHONE, Placeholders.load(null),
                Arrays.asList("android.permission.SYSTEM_ALERT_WINDOW", "android.permission.CAMERA"));
        assertTrue(xml, xml.contains("<uses-permission android:name=\"android.permission.SYSTEM_ALERT_WINDOW\" tools:node=\"remove\" />"));
        assertTrue(xml.contains("<uses-permission android:name=\"android.permission.CAMERA\" tools:node=\"remove\" />"));
        assertTrue(xml.contains("android:usesCleartextTraffic=\"false\""));
        assertTrue(xml.contains("tools:remove=\"android:lockTaskMode\""));
        assertFalse(xml.contains("LEANBACK_LAUNCHER"));
        int main = xml.indexOf("\"" + MAIN + "\"");
        assertTrue("the setup activity is not exported where the kiosk window is the launcher",
                xml.substring(main, xml.indexOf("</activity>", main)).contains("android:exported=\"false\""));
        // A kiosk's fragment has none of it.
        String kiosk = DeviceManifestSource.render(KIOSK_DEVICE, Placeholders.load(null),
                Arrays.asList("android.permission.SYSTEM_ALERT_WINDOW", "android.permission.CAMERA"));
        assertFalse(kiosk.contains("tools:node=\"remove\""));
        assertFalse(kiosk.contains("usesCleartextTraffic"));
        assertFalse(kiosk.contains("lockTaskMode"));
        assertEquals("a kiosk's fragment is what it was", DeviceManifestSource.render(KIOSK_DEVICE), kiosk);
    }
}

package net.kckern.daylight.build;

import static org.junit.Assert.*;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** The rules for a device with control.bind none: somebody's own phone. */
public class PersonalBuildTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    private static final String KIOSK = "net.kckern.daylight.cap.webviewhost.shell.KioskActivity";
    private static final String LINK = "net.kckern.daylight.cap.notifications.shell.LinkActivity";
    private static final String BOOT = "net.kckern.daylight.shell.BootReceiver";

    private static DeviceSpec phone(Map<String, Object> defaults) {
        return new DeviceSpec("phone", "com.example.app", 26, 33, Collections.emptyList(),
                8780, 8781, 1, "0.1", Arrays.asList("webview-host", "notifications"), defaults,
                Collections.emptyList(), Collections.emptyList(), "none", "");
    }

    private static void write(File f, String text) throws Exception {
        f.getParentFile().mkdirs();
        Files.write(f.toPath(), text.getBytes(StandardCharsets.UTF_8));
    }

    private DeviceCatalog catalog() throws Exception {
        File root = tmp.newFolder("da");
        write(new File(root, "capabilities/webview-host/capability.yml"),
                "entry: a.b.WebViewHostCapability\n"
                + "permissions:\n  - android.permission.RECORD_AUDIO\n"
                + "  - { name: android.permission.CAMERA, kioskOnly: true }\n"
                + "  - { name: android.permission.SYSTEM_ALERT_WINDOW, kioskOnly: true }\n"
                + "exported:\n  - " + KIOSK + "\n");
        write(new File(root, "capabilities/webview-host/payload/build.gradle"), "");
        write(new File(root, "capabilities/notifications/capability.yml"),
                "entry: a.b.NotificationsCapability\npermissions: []\nexported: [" + LINK + "]\n");
        write(new File(root, "capabilities/notifications/payload/build.gradle"), "");
        write(new File(root, "devices/phone.yml"), "id: phone\npackage: com.example.app\nandroid: { minSdk: 26, targetSdk: 33 }\n"
                + "control: { port: 8780, lifelinePort: 8781, bind: none }\nshell: { versionCode: 1, versionName: \"0.1\" }\n"
                + "permissions: [android.permission.VIBRATE]\ncapabilities: [webview-host, notifications]\n");
        write(new File(root, "devices/wall.yml"), "id: wall\npackage: com.example.wall\nandroid: { minSdk: 26, targetSdk: 33 }\n"
                + "control: { port: 8780, lifelinePort: 8781 }\nshell: { versionCode: 1, versionName: \"0.1\" }\n"
                + "capabilities: [webview-host, notifications]\n");
        return DeviceCatalog.load(root);
    }

    @Test public void appliesToADeviceWithNoControlApiOnly() throws Exception {
        DeviceCatalog c = catalog();
        assertTrue(PersonalBuild.applies(c.device("phone")));
        assertFalse(PersonalBuild.applies(c.device("wall")));
        assertNull("a kiosk is held to the verifier's tables, not to this list", PersonalBuild.expectation(c.device("wall"), c));
    }

    @Test public void theExpectedPermissionsAreTheBaseTheCapabilitiesAndTheDeviceFilesWithoutTheKioskOnlyOnes() throws Exception {
        DeviceCatalog c = catalog();
        PersonalBuild.Expectation e = PersonalBuild.expectation(c.device("phone"), c);
        assertTrue(e.permissions.containsAll(PersonalBuild.BASE_PERMISSIONS));
        assertTrue(e.permissions.contains("android.permission.RECORD_AUDIO"));
        assertTrue(e.permissions.contains("android.permission.VIBRATE"));
        assertFalse(e.permissions.contains("android.permission.CAMERA"));
        assertFalse(e.permissions.contains("android.permission.SYSTEM_ALERT_WINDOW"));
        assertEquals(PersonalBuild.BASE_PERMISSIONS.size() + 2, e.permissions.size());
        assertEquals(Arrays.asList("android.permission.CAMERA", "android.permission.SYSTEM_ALERT_WINDOW"),
                c.kioskOnlyPermissions(c.device("phone")));
    }

    @Test public void theExpectedExportedComponentsAreTheBootReceiverAndWhatEachCapabilityDeclares() throws Exception {
        DeviceCatalog c = catalog();
        PersonalBuild.Expectation e = PersonalBuild.expectation(c.device("phone"), c);
        assertEquals(new java.util.TreeSet<>(Arrays.asList(BOOT, KIOSK, LINK)), e.exported);
    }

    @Test public void aCapabilityFileWithAMalformedPermissionOrExportedEntryIsRefused() throws Exception {
        for (String bad : new String[] { "permissions:\n  - { kioskOnly: true }\n", "permissions:\n  - 7\n", "exported:\n  - 7\n", "exported: yes\n" }) {
            File root = tmp.newFolder();
            write(new File(root, "capabilities/x/capability.yml"), bad);
            try { DeviceCatalog.load(root); fail("accepted " + bad); } catch (CatalogException expected) { }
        }
    }

    // ── every address a personal device talks to is https ────────────────────

    private static Map<String, Object> defaults(String... pairs) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) m.put(pairs[i], pairs[i + 1]);
        return m;
    }

    @Test public void httpsAddressesPass() {
        assertEquals(Collections.emptyList(), PersonalBuild.urlFailures(phone(Collections.emptyMap()),
                defaults("webview.startUrl", "https://kiosk.example/", "backend.baseUrl", "https://kiosk.example",
                        "links.origins", "https://kiosk.example, https://home.example", "heartbeat.logStoreUrl", "")));
    }

    @Test public void aPlainHttpStartUrlOrBackendFailsTheBuildWithoutRepeatingTheValue() {
        for (String key : new String[] { "webview.startUrl", "backend.baseUrl", "heartbeat.logStoreUrl", "heartbeat.backendUrl" }) {
            List<String> f = PersonalBuild.urlFailures(phone(Collections.emptyMap()), defaults(key, "http://kiosk.example:3111/x"));
            assertEquals(key, 1, f.size());
            assertTrue(f.get(0), f.get(0).contains(key) && f.get(0).contains("https"));
            assertFalse("the value is private", f.get(0).contains("kiosk.example"));
        }
        assertEquals(1, PersonalBuild.urlFailures(phone(Collections.emptyMap()),
                defaults("links.origins", "https://kiosk.example, http://home.example")).size());
    }

    @Test public void aKioskMayUsePlainHttpOnItsLan() {
        DeviceSpec kiosk = new DeviceSpec("wall", "com.example.wall", 26, 33, Collections.emptyList(),
                8780, 8781, 1, "0.1", Arrays.asList("webview-host"), Collections.emptyMap(),
                Collections.emptyList(), Collections.emptyList());
        assertEquals(Collections.emptyList(), PersonalBuild.urlFailures(kiosk, defaults("heartbeat.logStoreUrl", "http://kiosk.example/insert")));
    }

    @Test public void renderingAPersonalDevicesConfigRefusesAPlainHttpAddress() throws Exception {
        DeviceCatalog c = catalog();
        File f = tmp.newFile("private.yml");
        Files.write(f.toPath(), "placeholders:\n  phone_start_url: http://kiosk.example/\n".getBytes(StandardCharsets.UTF_8));
        DeviceSpec d = new DeviceSpec("phone", "com.example.app", 26, 33, Collections.emptyList(),
                8780, 8781, 1, "0.1", Arrays.asList("webview-host", "notifications"), defaults("webview.startUrl", "{phone_start_url}"),
                Collections.emptyList(), Collections.emptyList(), "none", "");
        try {
            DeviceConfigSource.render(d, c, "p", Placeholders.load(f));
            fail("rendered a personal device with a plain http start URL");
        } catch (CatalogException e) {
            assertTrue(e.getMessage(), e.getMessage().contains("webview.startUrl"));
            assertFalse(e.getMessage(), e.getMessage().contains("kiosk.example"));
        }
    }
}

package net.kckern.daylight.build;

import static org.junit.Assert.*;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

public class DeviceCatalogTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    private static final String PORTAL =
        "id: portal\n" +
        "package: net.kckern.daylight.portal\n" +
        "android: { minSdk: 26, targetSdk: 28 }\n" +
        "control: { port: 8780, lifelinePort: 8781 }\n" +
        "shell: { versionCode: 1, versionName: \"0.1\" }\n" +
        "capabilities: [debug-tools]\n" +
        "defaults:\n  debug.execEnabled: false\n";

    private File root() throws Exception {
        File root = tmp.newFolder("da");
        write(new File(root, "capabilities/debug-tools/capability.yml"),
              "entry: net.kckern.daylight.cap.debugtools.DebugToolsCapability\n");
        write(new File(root, "capabilities/debug-tools/payload/build.gradle"), "");
        return root;
    }

    private static void write(File f, String text) throws Exception {
        f.getParentFile().mkdirs();
        Files.write(f.toPath(), text.getBytes(StandardCharsets.UTF_8));
    }

    private static String message(Runnable r) {
        try { r.run(); } catch (CatalogException e) { return e.getMessage(); }
        fail("expected CatalogException");
        return null;
    }

    @Test public void loadsADeviceAndItsCapabilities() throws Exception {
        File root = root();
        write(new File(root, "devices/portal.yml"), PORTAL);
        DeviceCatalog c = DeviceCatalog.load(root);
        DeviceSpec d = c.device("portal");
        assertEquals("net.kckern.daylight.portal", d.packageName);
        assertEquals(26, d.minSdk);
        assertEquals(28, d.targetSdk);
        assertEquals(8780, d.controlPort);
        assertEquals(8781, d.lifelinePort);
        assertEquals(1, d.shellVersionCode);
        assertEquals(java.util.Arrays.asList("debug-tools"), d.capabilities);
        assertEquals(Boolean.FALSE, d.defaults.get("debug.execEnabled"));
        assertTrue(c.capability("debug-tools").hasPayload);
        assertFalse(c.capability("debug-tools").hasShell);
        assertEquals(1, c.devices().size());
    }

    @Test public void emptyTreeLoadsAsEmptyCatalog() throws Exception {
        assertTrue(DeviceCatalog.load(tmp.newFolder("empty")).devices().isEmpty());
    }

    @Test public void filesStartingWithUnderscoreAreNotDevices() throws Exception {
        File root = root();
        write(new File(root, "devices/_example.yml"), PORTAL);
        assertTrue(DeviceCatalog.load(root).devices().isEmpty());
    }

    @Test public void rejectsAnUnknownCapability() throws Exception {
        File root = root();
        write(new File(root, "devices/portal.yml"), PORTAL.replace("[debug-tools]", "[debug-tools, synth]"));
        assertTrue(message(() -> DeviceCatalog.load(root)).contains("unknown capability 'synth'"));
    }

    @Test public void rejectsAnIdThatDoesNotMatchTheFileName() throws Exception {
        File root = root();
        write(new File(root, "devices/shield.yml"), PORTAL);
        assertTrue(message(() -> DeviceCatalog.load(root)).contains("id 'portal' must match file name 'shield'"));
    }

    @Test public void rejectsMinSdkAboveTargetSdk() throws Exception {
        File root = root();
        write(new File(root, "devices/portal.yml"), PORTAL.replace("minSdk: 26", "minSdk: 30"));
        assertTrue(message(() -> DeviceCatalog.load(root)).contains("minSdk 30 is above targetSdk 28"));
    }

    @Test public void rejectsEqualControlAndLifelinePorts() throws Exception {
        File root = root();
        write(new File(root, "devices/portal.yml"), PORTAL.replace("lifelinePort: 8781", "lifelinePort: 8780"));
        assertTrue(message(() -> DeviceCatalog.load(root)).contains("control.port and control.lifelinePort must differ"));
    }

    @Test public void rejectsAMissingRequiredKey() throws Exception {
        File root = root();
        write(new File(root, "devices/portal.yml"), PORTAL.replace("package: net.kckern.daylight.portal\n", ""));
        assertTrue(message(() -> DeviceCatalog.load(root)).contains("portal.yml: missing 'package'"));
    }

    @Test public void rejectsACapabilityWithAPayloadButNoEntry() throws Exception {
        File root = root();
        write(new File(root, "capabilities/debug-tools/capability.yml"), "notes: none\n");
        assertTrue(message(() -> DeviceCatalog.load(root)).contains("capability 'debug-tools' has a payload but no 'entry'"));
    }

    @Test public void rejectsANonScalarDefault() throws Exception {
        File root = root();
        write(new File(root, "devices/portal.yml"), PORTAL.replace("debug.execEnabled: false", "debug.execEnabled: [1]"));
        assertTrue(message(() -> DeviceCatalog.load(root)).contains("defaults 'debug.execEnabled' must be a string, boolean or integer"));
    }
}

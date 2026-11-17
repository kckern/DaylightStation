package net.kckern.daylight.cap.lockdown.shell;

import static org.junit.Assert.*;

import org.junit.Test;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import java.io.File;

import javax.xml.parsers.DocumentBuilderFactory;

public class LockdownShellContractTest {
    private static final String ANDROID = "http://schemas.android.com/apk/res/android";

    /** Gradle runs a module's unit tests with the module directory as the working directory. */
    private static Document xml(String path) throws Exception {
        DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
        f.setNamespaceAware(true);
        return f.newDocumentBuilder().parse(new File(path));
    }

    private static Element only(Document d, String tag) {
        NodeList list = d.getElementsByTagName(tag);
        assertEquals("exactly one <" + tag + ">", 1, list.getLength());
        return (Element) list.item(0);
    }

    @Test public void theClassNamesThePayloadAndTheAdbGrantsUseAreTheseClasses() {
        assertEquals("net.kckern.daylight.cap.lockdown.shell.DaylightAdminReceiver", DaylightAdminReceiver.class.getName());
        assertEquals("net.kckern.daylight.cap.lockdown.shell.DaylightOwnerService", DaylightOwnerService.class.getName());
        assertTrue(android.app.admin.DeviceAdminReceiver.class.isAssignableFrom(DaylightAdminReceiver.class));
        assertTrue(android.app.admin.DeviceAdminService.class.isAssignableFrom(DaylightOwnerService.class));
    }

    @Test public void theAdminReceiverAndOwnerServiceCanOnlyBeReachedByTheSystem() throws Exception {
        Document manifest = xml("src/main/AndroidManifest.xml");
        // Exported, because the system must reach them; guarded, so that nothing else can:
        // only the system holds BIND_DEVICE_ADMIN.
        for (String tag : new String[] { "receiver", "service" }) {
            Element e = only(manifest, tag);
            assertEquals(tag, "android.permission.BIND_DEVICE_ADMIN", e.getAttributeNS(ANDROID, "permission"));
            assertEquals(tag, "true", e.getAttributeNS(ANDROID, "exported"));
        }
        assertEquals(DaylightAdminReceiver.class.getName(), only(manifest, "receiver").getAttributeNS(ANDROID, "name"));
        assertEquals(DaylightOwnerService.class.getName(), only(manifest, "service").getAttributeNS(ANDROID, "name"));
    }

    @Test public void thisHalfDeclaresNoActivityAndNoAccessibilityService() throws Exception {
        Document manifest = xml("src/main/AndroidManifest.xml");
        // The kiosk Activity is webview-host's and gets its HOME filter from the device
        // manifest; the app's one accessibility service is the accessibility capability's.
        assertEquals(0, manifest.getElementsByTagName("activity").getLength());
        assertEquals(0, manifest.getElementsByTagName("activity-alias").getLength());
        assertEquals(0, manifest.getElementsByTagName("provider").getLength());
        String text = new String(java.nio.file.Files.readAllBytes(new File("src/main/AndroidManifest.xml").toPath()), "UTF-8");
        assertFalse(text.contains("BIND_ACCESSIBILITY_SERVICE"));
    }

    @Test public void theAdminAsksForForceLockAndCanReceiveOwnership() throws Exception {
        Document admin = xml("src/main/res/xml/daylight_device_admin.xml");
        Element root = admin.getDocumentElement();
        assertEquals("device-admin", root.getTagName());
        // transferOwnership() refuses a target admin that does not declare this.
        only(admin, "support-transfer-ownership");
        Element policies = only(admin, "uses-policies");
        assertEquals("force-lock is the only policy asked for", 1, policies.getElementsByTagName("*").getLength());
        only(admin, "force-lock");
    }
}

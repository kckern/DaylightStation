package net.kckern.daylight.cap.hidinput;

import static org.junit.Assert.*;

import android.accessibilityservice.AccessibilityService;
import android.view.accessibility.AccessibilityEvent;

import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.testing.TestCore;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class UsbPermissionAutomatorTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    private static final String UI = "com.android.systemui";

    // ── the rule ────────────────────────────────────────────────────────────

    @Test public void theSystemDialogNamingThisAppsLabelIsItsOwn() {
        assertTrue(UsbDialogRule.isOwnUsbDialog(UI, " Allow Daylight to access Example USB Keyboard? Cancel OK", "Daylight"));
        assertTrue(UsbDialogRule.isOwnUsbDialog(UI, "Open Daylight to handle USB Keyboard?", "Daylight"));
    }

    @Test public void theOldAppNameDoesNotMatch() {
        // What the dialog said when the app was called Portal Keys, and what the rule used to look for.
        assertFalse(UsbDialogRule.isOwnUsbDialog(UI, "Allow Portal Keys to access USB device? Cancel OK", "Daylight"));
    }

    @Test public void theLabelMustBeAWholeWord() {
        assertFalse(UsbDialogRule.isOwnUsbDialog(UI, "Allow Daylighter to access USB device?", "Daylight"));
        assertFalse(UsbDialogRule.isOwnUsbDialog(UI, "Allow MyDaylight to access USB device?", "Daylight"));
        assertFalse(UsbDialogRule.isOwnUsbDialog(UI, "Allow daylight to access USB device?", "Daylight"));
        assertTrue(UsbDialogRule.isOwnUsbDialog(UI, "Allow \"Daylight\" to access USB device?", "Daylight"));
    }

    @Test public void onlyTheSystemUiOwnsTheDialog() {
        String text = "Allow Daylight to access USB device?";
        assertFalse(UsbDialogRule.isOwnUsbDialog("com.android.packageinstaller", text, "Daylight"));
        assertFalse(UsbDialogRule.isOwnUsbDialog("com.example.lookalike", text, "Daylight"));
        assertFalse(UsbDialogRule.isOwnUsbDialog("", text, "Daylight"));
        assertFalse(UsbDialogRule.isOwnUsbDialog(null, text, "Daylight"));
    }

    @Test public void aDialogAboutSomethingElseOrAnUnknownLabelIsLeftAlone() {
        assertFalse(UsbDialogRule.isOwnUsbDialog(UI, "Daylight keeps stopping. Close app", "Daylight"));
        assertFalse(UsbDialogRule.isOwnUsbDialog(UI, "Allow Daylight to access USB device?", ""));
        assertFalse(UsbDialogRule.isOwnUsbDialog(UI, "Allow Daylight to access USB device?", null));
        assertFalse(UsbDialogRule.isOwnUsbDialog(UI, null, "Daylight"));
    }

    // ── the automator over a fake screen ────────────────────────────────────

    private static final class FakeWindow implements UsbPermissionAutomator.Window {
        final String pkg, text;
        int clicks;
        FakeWindow(String pkg, String text) { this.pkg = pkg; this.text = text; }
        @Override public String packageName() { return pkg; }
        @Override public String text() { return text; }
        @Override public boolean clickPositive() { clicks++; return true; }
    }

    private static final class FakeScreen implements UsbPermissionAutomator.Screen {
        FakeWindow window;
        String label = "";
        @Override public UsbPermissionAutomator.Window activeWindow() { return window; }
        @Override public String appLabel() { return label; }
    }

    @Test public void aServiceThatBindsAfterBeginIsUsedWhenItAppears() {
        FakeScreen screen = new FakeScreen();          // nothing bound: no window, no label
        UsbPermissionAutomator automator = new UsbPermissionAutomator(screen);
        automator.begin();
        assertFalse(automator.tick());
        assertTrue("still waiting for the dialog", automator.pending());

        screen.label = "Daylight";                     // the service binds; the dialog is on screen
        screen.window = new FakeWindow(UI, "Allow Daylight to access USB device? Cancel OK");
        assertTrue(automator.tick());
        assertEquals(1, screen.window.clicks);
        assertFalse(automator.pending());
        assertFalse("nothing is clicked twice", automator.tick());
        assertEquals(1, screen.window.clicks);
    }

    @Test public void anotherAppsDialogIsNeverClicked() {
        FakeScreen screen = new FakeScreen();
        screen.label = "Daylight";
        screen.window = new FakeWindow(UI, "Allow Portal Keys to access USB device? Cancel OK");
        UsbPermissionAutomator automator = new UsbPermissionAutomator(screen);
        automator.begin();
        assertFalse(automator.tick());
        assertEquals(0, screen.window.clicks);
        automator.finish();
        screen.window = new FakeWindow(UI, "Allow Daylight to access USB device? Cancel OK");
        assertFalse("nothing is clicked once the request is over", automator.tick());
        assertEquals(0, screen.window.clicks);
    }

    // ── what the capability hands the controller ────────────────────────────

    private static final class Service extends AccessibilityService {
        @Override public void onAccessibilityEvent(AccessibilityEvent event) { }
        @Override public void onInterrupt() { }
    }

    @Test public void theCapabilityResolvesTheServiceAtUseSoALateBindIsSeen() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        UsbPermissionAutomator.ServiceSource source = HidInputCapability.accessibilitySource(core);
        assertNull("nothing is bound when the payload starts", source.service());
        Service late = new Service();
        core.accessibility().bind(late);
        assertSame(late, source.service());
        core.accessibility().bind(null);
        assertNull(source.service());
    }
}

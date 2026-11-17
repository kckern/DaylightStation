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

    private static String activity(String inner) { return "<activity android:name=\"" + KIOSK + "\" android:exported=\"true\">" + inner + "</activity>"; }

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
}

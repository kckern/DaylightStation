package net.kckern.daylight.build;

import static org.junit.Assert.*;

import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;

public class DeviceManifestSourceTest {
    private static DeviceSpec device(java.util.List<String> permissions, java.util.List<String> types) {
        return new DeviceSpec("shield", "net.kckern.daylight.shield", 30, 33, Collections.emptyList(),
                8780, 8781, 1, "0.1", Arrays.asList("debug-tools"), Collections.emptyMap(), permissions, types);
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
}

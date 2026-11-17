package net.kckern.daylight.build;

import static org.junit.Assert.*;

import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

public class DeviceConfigSourceTest {
    private static DeviceSpec device(Map<String, Object> defaults) {
        return new DeviceSpec("portal", "net.kckern.daylight.portal", 26, 28, Collections.emptyList(),
                8780, 8781, 1, "0.1", Arrays.asList("debug-tools"), defaults);
    }

    @Test public void rendersIdentityPortAndEntries() {
        String src = DeviceConfigSource.render(device(Collections.emptyMap()),
                Arrays.asList("net.kckern.daylight.cap.debugtools.DebugToolsCapability"), "p1-foundation");
        assertTrue(src.contains("package net.kckern.daylight.generated;"));
        assertTrue(src.contains("DEVICE_ID = \"portal\";"));
        assertTrue(src.contains("PAYLOAD_VERSION = \"p1-foundation\";"));
        assertTrue(src.contains("CONTROL_PORT = 8780;"));
        assertTrue(src.contains("\"net.kckern.daylight.cap.debugtools.DebugToolsCapability\","));
        assertTrue(src.contains("DEFAULTS_JSON = \"{}\";"));
    }

    @Test public void rendersDefaultsAsEscapedJson() {
        Map<String, Object> defaults = new LinkedHashMap<>();
        defaults.put("a.flag", true);
        defaults.put("a.count", 30);
        defaults.put("a.text", "say \"hi\"\\now");
        assertEquals("{\"a.flag\":true,\"a.count\":30,\"a.text\":\"say \\\"hi\\\"\\\\now\"}",
                DeviceConfigSource.defaultsJson(defaults));
        // Embedded in Java source, the JSON is escaped a second time.
        assertTrue(DeviceConfigSource.render(device(defaults), Collections.emptyList(), "p1")
                .contains("DEFAULTS_JSON = \"{\\\"a.flag\\\":true,"));
    }
}

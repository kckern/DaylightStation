package net.kckern.daylight.build;

import java.util.List;
import java.util.Map;

/** Renders the per-device DeviceConfig.java that is compiled into that device's payload. */
public final class DeviceConfigSource {
    private DeviceConfigSource() { }

    public static String render(DeviceSpec device, DeviceCatalog catalog, String payloadVersion) {
        List<String> entries = new java.util.ArrayList<>();
        for (String name : device.capabilities) {
            CapabilitySpec c = catalog.capability(name);
            if (c.hasPayload) entries.add(c.entry);
        }
        return render(device, entries, payloadVersion);
    }

    /** As above, with every {placeholder} in a string default resolved from the private file. */
    public static String render(DeviceSpec device, DeviceCatalog catalog, String payloadVersion, Placeholders placeholders) {
        List<String> entries = new java.util.ArrayList<>();
        for (String name : device.capabilities) {
            CapabilitySpec c = catalog.capability(name);
            if (c.hasPayload) entries.add(c.entry);
        }
        return render(device, entries, payloadVersion, placeholders.resolveAll(device.defaults, device.id + ".yml"));
    }

    static String render(DeviceSpec device, List<String> entries, String payloadVersion) {
        return render(device, entries, payloadVersion, device.defaults);
    }

    private static String render(DeviceSpec device, List<String> entries, String payloadVersion, Map<String, Object> defaults) {
        StringBuilder s = new StringBuilder();
        s.append("// Generated from devices/").append(device.id).append(".yml. Do not edit.\n");
        s.append("package net.kckern.daylight.generated;\n\n");
        s.append("public final class DeviceConfig {\n");
        s.append("    private DeviceConfig() { }\n");
        s.append("    public static final String DEVICE_ID = ").append(javaString(device.id)).append(";\n");
        s.append("    public static final String PAYLOAD_VERSION = ").append(javaString(payloadVersion)).append(";\n");
        s.append("    public static final int CONTROL_PORT = ").append(device.controlPort).append(";\n");
        s.append("    public static final String CONTROL_BIND = ").append(javaString(device.controlBind)).append(";\n");
        s.append("    public static final String[] CAPABILITY_ENTRIES = {\n");
        for (String e : entries) s.append("        ").append(javaString(e)).append(",\n");
        s.append("    };\n");
        s.append("    public static final String DEFAULTS_JSON = ").append(javaString(defaultsJson(defaults))).append(";\n");
        s.append("}\n");
        return s.toString();
    }

    static String defaultsJson(Map<String, Object> defaults) {
        StringBuilder s = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, Object> e : defaults.entrySet()) {
            if (!first) s.append(',');
            first = false;
            s.append(quote(e.getKey())).append(':');
            Object v = e.getValue();
            s.append(v instanceof String ? quote((String) v) : String.valueOf(v));
        }
        return s.append('}').toString();
    }

    /** Escaping that is valid for both a JSON string and a Java string literal. */
    private static String quote(String raw) {
        StringBuilder s = new StringBuilder("\"");
        for (char c : raw.toCharArray()) {
            switch (c) {
                case '"': s.append("\\\""); break;
                case '\\': s.append("\\\\"); break;
                case '\n': s.append("\\n"); break;
                case '\r': s.append("\\r"); break;
                case '\t': s.append("\\t"); break;
                default:
                    if (c < 0x20) s.append(String.format("\\u%04x", (int) c)); else s.append(c);
            }
        }
        return s.append('"').toString();
    }

    private static String javaString(String raw) { return quote(raw); }
}

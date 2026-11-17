package net.kckern.daylight.build;

import org.yaml.snakeyaml.Yaml;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Pattern;

/** Reads devices/&lt;id&gt;.yml and capabilities/&lt;name&gt;/capability.yml and refuses anything inconsistent. */
public final class DeviceCatalog {
    private static final Pattern ID = Pattern.compile("[a-z][a-z0-9]*");
    private static final Pattern PACKAGE = Pattern.compile("[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+");
    private static final int LOWEST_SDK = 26;

    private final Map<String, CapabilitySpec> capabilities;
    private final Map<String, DeviceSpec> devices;

    private DeviceCatalog(Map<String, CapabilitySpec> capabilities, Map<String, DeviceSpec> devices) {
        this.capabilities = capabilities;
        this.devices = devices;
    }

    public Collection<DeviceSpec> devices() { return devices.values(); }
    public Collection<CapabilitySpec> capabilities() { return capabilities.values(); }

    public DeviceSpec device(String id) {
        DeviceSpec d = devices.get(id);
        if (d == null) throw new CatalogException("unknown device '" + id + "'");
        return d;
    }

    public CapabilitySpec capability(String name) {
        CapabilitySpec c = capabilities.get(name);
        if (c == null) throw new CatalogException("unknown capability '" + name + "'");
        return c;
    }

    public static DeviceCatalog load(File root) {
        Map<String, CapabilitySpec> caps = new TreeMap<>();
        File[] capDirs = new File(root, "capabilities").listFiles(File::isDirectory);
        if (capDirs != null) {
            for (File dir : capDirs) {
                File meta = new File(dir, "capability.yml");
                if (!meta.isFile()) continue;
                String name = dir.getName();
                boolean hasPayload = new File(dir, "payload/build.gradle").isFile();
                boolean hasShell = new File(dir, "shell/build.gradle").isFile();
                Object entry = asMap(new Yaml().load(read(meta)), "capability '" + name + "'").get("entry");
                if (entry != null && !(entry instanceof String)) {
                    throw new CatalogException("capability '" + name + "': 'entry' must be a string");
                }
                if (hasPayload && entry == null) {
                    throw new CatalogException("capability '" + name + "' has a payload but no 'entry'");
                }
                caps.put(name, new CapabilitySpec(name, (String) entry, hasPayload, hasShell));
            }
        }
        Map<String, DeviceSpec> devices = new TreeMap<>();
        File[] files = new File(root, "devices").listFiles((d, n) -> n.endsWith(".yml") && !n.startsWith("_"));
        if (files != null) {
            for (File f : files) {
                String fileId = f.getName().substring(0, f.getName().length() - ".yml".length());
                devices.put(fileId, parseDevice(fileId, read(f), caps));
            }
        }
        return new DeviceCatalog(caps, devices);
    }

    static DeviceSpec parseDevice(String fileId, String yaml, Map<String, CapabilitySpec> caps) {
        String where = fileId + ".yml";
        Map<String, Object> doc = asMap(new Yaml().load(yaml), where);

        String id = string(doc, "id", where);
        if (!ID.matcher(id).matches()) throw new CatalogException(where + ": id '" + id + "' must match [a-z][a-z0-9]*");
        if (!id.equals(fileId)) throw new CatalogException(where + ": id '" + id + "' must match file name '" + fileId + "'");

        String pkg = string(doc, "package", where);
        if (!PACKAGE.matcher(pkg).matches()) throw new CatalogException(where + ": package '" + pkg + "' is not a valid application id");

        Map<String, Object> android = asMap(required(doc, "android", where), where + " android");
        int minSdk = integer(android, "minSdk", where);
        int targetSdk = integer(android, "targetSdk", where);
        if (minSdk < LOWEST_SDK) throw new CatalogException(where + ": minSdk " + minSdk + " is below " + LOWEST_SDK);
        if (minSdk > targetSdk) throw new CatalogException(where + ": minSdk " + minSdk + " is above targetSdk " + targetSdk);

        Map<String, Object> control = asMap(required(doc, "control", where), where + " control");
        int port = integer(control, "port", where);
        int lifeline = integer(control, "lifelinePort", where);
        for (int p : new int[] { port, lifeline }) {
            if (p < 1024 || p > 65535) throw new CatalogException(where + ": port " + p + " is outside 1024-65535");
        }
        if (port == lifeline) throw new CatalogException(where + ": control.port and control.lifelinePort must differ");

        Map<String, Object> shell = asMap(required(doc, "shell", where), where + " shell");
        int versionCode = integer(shell, "versionCode", where);
        if (versionCode < 1) throw new CatalogException(where + ": shell.versionCode must be 1 or higher");
        String versionName = string(shell, "versionName", where);

        List<String> abis = strings(doc.get("abis"), where + " abis");
        List<String> capabilities = strings(required(doc, "capabilities", where), where + " capabilities");
        if (capabilities.isEmpty()) throw new CatalogException(where + ": capabilities must not be empty");
        if (new LinkedHashSet<>(capabilities).size() != capabilities.size()) {
            throw new CatalogException(where + ": capabilities lists a name twice");
        }
        for (String c : capabilities) {
            if (!caps.containsKey(c)) throw new CatalogException(where + ": unknown capability '" + c + "'");
        }

        Map<String, Object> defaults = new LinkedHashMap<>();
        Object rawDefaults = doc.get("defaults");
        if (rawDefaults != null) {
            for (Map.Entry<String, Object> e : asMap(rawDefaults, where + " defaults").entrySet()) {
                Object v = e.getValue();
                if (!(v instanceof String || v instanceof Boolean || v instanceof Integer)) {
                    throw new CatalogException(where + ": defaults '" + e.getKey() + "' must be a string, boolean or integer");
                }
                defaults.put(e.getKey(), v);
            }
        }

        return new DeviceSpec(id, pkg, minSdk, targetSdk, abis, port, lifeline, versionCode, versionName,
                Collections.unmodifiableList(capabilities), Collections.unmodifiableMap(defaults));
    }

    private static Object required(Map<String, Object> m, String key, String where) {
        Object v = m.get(key);
        if (v == null) throw new CatalogException(where + ": missing '" + key + "'");
        return v;
    }

    private static String string(Map<String, Object> m, String key, String where) {
        Object v = required(m, key, where);
        if (!(v instanceof String)) throw new CatalogException(where + ": '" + key + "' must be a string");
        return (String) v;
    }

    private static int integer(Map<String, Object> m, String key, String where) {
        Object v = required(m, key, where);
        if (!(v instanceof Integer)) throw new CatalogException(where + ": '" + key + "' must be an integer");
        return (Integer) v;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object o, String where) {
        if (o == null) return new LinkedHashMap<>();
        if (!(o instanceof Map)) throw new CatalogException(where + ": expected a mapping");
        return (Map<String, Object>) o;
    }

    private static List<String> strings(Object o, String where) {
        List<String> out = new ArrayList<>();
        if (o == null) return out;
        if (!(o instanceof List)) throw new CatalogException(where + ": expected a list");
        for (Object item : (List<?>) o) {
            if (!(item instanceof String)) throw new CatalogException(where + ": expected a list of strings");
            out.add((String) item);
        }
        return out;
    }

    private static String read(File f) {
        try {
            return new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new CatalogException("cannot read " + f + ": " + e.getMessage());
        }
    }
}

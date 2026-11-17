package net.kckern.daylight.build;

import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.constructor.SafeConstructor;
import org.yaml.snakeyaml.error.YAMLException;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Pattern;

/** Reads devices/&lt;id&gt;.yml and capabilities/&lt;name&gt;/capability.yml and refuses anything inconsistent. */
public final class DeviceCatalog {
    private static final Pattern ID = Pattern.compile("[a-z][a-z0-9]*");
    private static final Pattern PACKAGE = Pattern.compile("[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+");
    /** versionName is written into generated Java (BuildConfig), so it may not hold a quote or a backslash. */
    private static final Pattern VERSION_NAME = Pattern.compile("[A-Za-z0-9._-]+");
    /** The Android Gradle Plugin's own source-set names. A product flavor with one of these names collides. */
    static final Set<String> RESERVED_IDS = Collections.unmodifiableSet(
            new LinkedHashSet<>(Arrays.asList("debug", "release", "main", "test", "androidTest")));
    private static final int LOWEST_SDK = 26;
    /** Written into a generated manifest, so it may hold nothing but a dotted name. */
    private static final Pattern PERMISSION = Pattern.compile("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+");
    private static final Set<String> SERVICE_TYPES = Collections.unmodifiableSet(new LinkedHashSet<>(Arrays.asList(
            "dataSync", "mediaPlayback", "phoneCall", "location", "connectedDevice", "mediaProjection", "camera", "microphone")));

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
                Map<String, Object> doc = asMap(parseYaml(read(meta), "capability '" + name + "'"), "capability '" + name + "'");
                Object entry = doc.get("entry");
                if (entry != null && !(entry instanceof String)) {
                    throw new CatalogException("capability '" + name + "': 'entry' must be a string");
                }
                if (hasPayload && entry == null) {
                    throw new CatalogException("capability '" + name + "' has a payload but no 'entry'");
                }
                caps.put(name, new CapabilitySpec(name, (String) entry, hasPayload, hasShell,
                        Collections.unmodifiableList(strings(doc.get("requires"), "capability '" + name + "' requires")),
                        Boolean.TRUE.equals(doc.get("native")),
                        Collections.unmodifiableList(strings(doc.get("startsAfter"), "capability '" + name + "' startsAfter"))));
            }
        }
        for (CapabilitySpec c : caps.values()) {
            for (String needed : c.requires) {
                if (!caps.containsKey(needed)) {
                    throw new CatalogException("capability '" + c.name + "' requires unknown capability '" + needed + "'");
                }
            }
            for (String earlier : c.startsAfter) {
                if (!caps.containsKey(earlier)) {
                    throw new CatalogException("capability '" + c.name + "' startsAfter unknown capability '" + earlier + "'");
                }
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
        // Two APKs with one application id would replace each other on a device.
        Map<String, String> owners = new TreeMap<>();
        for (DeviceSpec d : devices.values()) {
            String other = owners.put(d.packageName, d.id);
            if (other != null) {
                throw new CatalogException("package '" + d.packageName + "' is used by both '" + other + "' and '" + d.id + "'");
            }
        }
        return new DeviceCatalog(caps, devices);
    }

    static DeviceSpec parseDevice(String fileId, String yaml, Map<String, CapabilitySpec> caps) {
        String where = fileId + ".yml";
        Map<String, Object> doc = asMap(parseYaml(yaml, where), where);

        String id = string(doc, "id", where);
        if (!ID.matcher(id).matches()) throw new CatalogException(where + ": id '" + id + "' must match [a-z][a-z0-9]*");
        if (RESERVED_IDS.contains(id)) {
            throw new CatalogException(where + ": id '" + id + "' is reserved (it is an Android source-set name)");
        }
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
        if (!VERSION_NAME.matcher(versionName).matches()) {
            throw new CatalogException(where + ": shell.versionName must match [A-Za-z0-9._-]+");
        }

        List<String> abis = strings(doc.get("abis"), where + " abis");
        List<String> capabilities = strings(required(doc, "capabilities", where), where + " capabilities");
        if (capabilities.isEmpty()) throw new CatalogException(where + ": capabilities must not be empty");
        if (new LinkedHashSet<>(capabilities).size() != capabilities.size()) {
            throw new CatalogException(where + ": capabilities lists a name twice");
        }
        for (String c : capabilities) {
            if (!caps.containsKey(c)) throw new CatalogException(where + ": unknown capability '" + c + "'");
        }
        for (String c : capabilities) {
            CapabilitySpec spec = caps.get(c);
            for (String needed : spec.requires) {
                if (!capabilities.contains(needed)) {
                    throw new CatalogException(where + ": capability '" + c + "' requires '" + needed + "'");
                }
            }
            // Capabilities start in the order listed. One that names another in startsAfter
            // uses at start what that one provides, so the device file must list it later.
            for (String earlier : spec.startsAfter) {
                int at = capabilities.indexOf(earlier);
                if (at > capabilities.indexOf(c)) {
                    throw new CatalogException(where + ": capability '" + earlier + "' must be listed before '" + c + "'");
                }
            }
            if (spec.nativeCode && abis.isEmpty()) {
                throw new CatalogException(where + ": capability '" + c + "' has native code; 'abis' must not be empty");
            }
        }
        List<String> extraPermissions = strings(doc.get("permissions"), where + " permissions");
        for (String p : extraPermissions) {
            if (!PERMISSION.matcher(p).matches()) throw new CatalogException(where + ": '" + p + "' is not a permission name");
        }
        List<String> serviceTypes = strings(doc.get("foregroundServiceTypes"), where + " foregroundServiceTypes");
        for (String t : serviceTypes) {
            if (!SERVICE_TYPES.contains(t)) throw new CatalogException(where + ": unknown foregroundServiceType '" + t + "'");
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
                Collections.unmodifiableList(capabilities), Collections.unmodifiableMap(defaults),
                Collections.unmodifiableList(extraPermissions), Collections.unmodifiableList(serviceTypes));
    }

    /** SafeConstructor builds only maps, lists and scalars; a tag naming a Java class is refused. */
    private static Object parseYaml(String text, String where) {
        try {
            return new Yaml(new SafeConstructor()).load(text);
        } catch (YAMLException e) {
            throw new CatalogException(where + ": not valid YAML for a device or capability file");
        }
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

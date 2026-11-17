package net.kckern.daylight.core;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Typed settings. Three layers: the capability's fallback, the device default,
 * and a runtime override persisted to overridesFile.
 */
public final class SettingsRegistry {
    public enum Type { STRING, BOOLEAN, INTEGER }

    public static final class UnknownSettingException extends RuntimeException {
        public UnknownSettingException(String key) { super("unknown setting '" + key + "'"); }
    }

    public static final class InvalidSettingException extends RuntimeException {
        public InvalidSettingException(String message) { super(message); }
    }

    private static final class Entry {
        final Type type;
        Object def;
        Entry(Type type, Object def) { this.type = type; this.def = def; }
    }

    private final Map<String, Entry> entries = new LinkedHashMap<>();
    private final File overridesFile;
    private final JSONObject overrides;

    public SettingsRegistry(File overridesFile) {
        this.overridesFile = overridesFile;
        this.overrides = readOverrides(overridesFile);
    }

    public synchronized void declare(String key, Type type, Object fallback) {
        if (entries.containsKey(key)) throw new IllegalStateException("setting declared twice: " + key);
        entries.put(key, new Entry(type, coerce(key, type, fallback)));
    }

    public synchronized void applyDefaults(JSONObject defaults) {
        for (Iterator<String> it = defaults.keys(); it.hasNext(); ) {
            String key = it.next();
            Entry e = entry(key);
            e.def = coerce(key, e.type, defaults.opt(key));
        }
    }

    public synchronized Object get(String key) {
        Entry e = entry(key);
        if (overrides.has(key)) {
            try {
                return coerce(key, e.type, overrides.opt(key));
            } catch (InvalidSettingException stale) {
                // The stored value no longer fits the declared type; use the default.
            }
        }
        return e.def;
    }

    public synchronized void set(String key, Object value) {
        Entry e = entry(key);
        Object coerced = coerce(key, e.type, value);
        try { overrides.put(key, coerced); } catch (JSONException ex) { throw new InvalidSettingException(ex.getMessage()); }
        persist();
    }

    public synchronized void reset(String key) {
        entry(key);
        overrides.remove(key);
        persist();
    }

    public synchronized JSONArray describe() {
        JSONArray out = new JSONArray();
        for (Map.Entry<String, Entry> e : entries.entrySet()) {
            try {
                out.put(new JSONObject()
                        .put("key", e.getKey())
                        .put("type", e.getValue().type.name())
                        .put("value", get(e.getKey()))
                        .put("default", e.getValue().def)
                        .put("overridden", overrides.has(e.getKey())));
            } catch (JSONException ex) {
                throw new IllegalStateException(ex);
            }
        }
        return out;
    }

    private Entry entry(String key) {
        Entry e = entries.get(key);
        if (e == null) throw new UnknownSettingException(key);
        return e;
    }

    private static Object coerce(String key, Type type, Object raw) {
        if (raw == null) throw new InvalidSettingException("setting '" + key + "' needs a value");
        switch (type) {
            case STRING:
                if (raw instanceof String) return raw;
                break;
            case BOOLEAN:
                if (raw instanceof Boolean) return raw;
                if ("true".equals(raw)) return Boolean.TRUE;
                if ("false".equals(raw)) return Boolean.FALSE;
                break;
            case INTEGER:
                if (raw instanceof Integer) return raw;
                if (raw instanceof String) {
                    try { return Integer.valueOf((String) raw); } catch (NumberFormatException ignored) { }
                }
                break;
        }
        throw new InvalidSettingException("setting '" + key + "' must be " + type.name().toLowerCase());
    }

    private static JSONObject readOverrides(File f) {
        try {
            if (f != null && f.isFile()) {
                return new JSONObject(new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8));
            }
        } catch (Exception unreadable) {
            // A corrupt overrides file must not stop the payload; defaults apply.
        }
        return new JSONObject();
    }

    private void persist() {
        try {
            File dir = overridesFile.getParentFile();
            if (dir != null) dir.mkdirs();
            File part = new File(overridesFile.getPath() + ".part");
            Files.write(part.toPath(), overrides.toString().getBytes(StandardCharsets.UTF_8));
            if (!part.renameTo(overridesFile)) throw new java.io.IOException("rename failed");
        } catch (Exception e) {
            throw new IllegalStateException("cannot persist settings: " + e.getMessage(), e);
        }
    }
}

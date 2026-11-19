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

    /**
     * What a value must satisfy beyond its type. A value that fails the rule is refused
     * when it is set and when it arrives as a device default, and a stored override
     * that fails it is ignored in favour of the default.
     */
    public interface Rule {
        /** Null when the value is acceptable, otherwise what is wrong with it. */
        String problem(Object value);
    }

    private static final class OneOf implements Rule {
        final String[] allowed;
        OneOf(String[] allowed) { this.allowed = allowed; }
        @Override public String problem(Object value) {
            for (String a : allowed) if (a.equals(value)) return null;
            return "must be one of " + java.util.Arrays.toString(allowed);
        }
    }

    private static final class Range implements Rule {
        final int min, max;
        Range(int min, int max) { this.min = min; this.max = max; }
        @Override public String problem(Object value) {
            if (value instanceof Integer && (Integer) value >= min && (Integer) value <= max) return null;
            return "must be between " + min + " and " + max;
        }
    }

    /** A string setting that takes one of a fixed set of values. */
    public static Rule oneOf(String... allowed) { return new OneOf(allowed.clone()); }

    /** An integer setting within min and max, both included. */
    public static Rule range(int min, int max) { return new Range(min, max); }

    private static final class Entry {
        final Type type;
        final Rule rule;
        Object def;
        Entry(Type type, Rule rule, Object def) { this.type = type; this.rule = rule; this.def = def; }
    }

    public interface Listener { void onSettingChanged(String key); }

    /** A reason to refuse one change to one key, beyond its type and rule. */
    public interface Guard {
        /** Null when the key may take this value, otherwise why not. The message goes to the caller. */
        String refusal(Object newValue);
    }

    private final Map<String, Entry> entries = new LinkedHashMap<>();
    private final File overridesFile;
    private final JSONObject overrides;
    private final java.util.Set<String> secrets = new java.util.HashSet<>();
    private final java.util.List<Listener> listeners = new java.util.concurrent.CopyOnWriteArrayList<>();
    /** Keys whose stored override was already reported as unusable, so each is logged once. */
    private final java.util.Set<String> reportedStale = new java.util.HashSet<>();
    /** Keys whose value comes from the device file alone: no override is stored or honored. */
    private final java.util.Set<String> compiledOnly = new java.util.HashSet<>();
    private final Map<String, Guard> guards = new LinkedHashMap<>();
    /** What was wrong with the stored overrides when they were read, or null. Never a value. */
    private final String loadProblem;

    public SettingsRegistry(File overridesFile) {
        this.overridesFile = overridesFile;
        Loaded loaded = readOverrides(overridesFile);
        this.overrides = loaded.overrides;
        this.loadProblem = loaded.problem;
    }

    /** The last good overrides, kept beside the file and read when the file itself cannot be. */
    public static File backupOf(File overridesFile) { return new File(overridesFile.getPath() + ".bak"); }

    /**
     * Why the stored overrides were not read as written, or null when they were (or there
     * were none). "unreadable; using the backup" or "unreadable; no backup, defaults apply".
     */
    public String loadProblem() { return loadProblem; }

    /**
     * A setting only the device file decides. POST /settings and DELETE /settings refuse
     * it, and a stored override for it is ignored, so nothing that happens to the stored
     * overrides (a reset, a corrupt file, a mistaken write) can change it.
     */
    public synchronized void declareCompiled(String key, Type type, Object fallback) {
        declare(key, type, fallback, null);
        compiledOnly.add(key);
    }

    /** Refuse some changes to a key. One guard per key; it sees the value the key would take. */
    public synchronized void guard(String key, Guard guard) {
        entry(key);
        guards.put(key, guard);
    }

    private void checkChange(String key, Object newValue) {
        if (compiledOnly.contains(key)) {
            throw new InvalidSettingException("setting '" + key + "' is decided by the device file and cannot be changed on the device");
        }
        Guard g = guards.get(key);
        String refusal = g == null ? null : g.refusal(newValue);
        if (refusal != null) throw new InvalidSettingException("setting '" + key + "' " + refusal);
    }

    public synchronized void declare(String key, Type type, Object fallback) {
        declare(key, type, fallback, null);
    }

    /** As above, with a rule (see {@link #oneOf} and {@link #range}) the value must also satisfy. Null for none. */
    public synchronized void declare(String key, Type type, Object fallback, Rule rule) {
        if (entries.containsKey(key)) throw new IllegalStateException("setting declared twice: " + key);
        entries.put(key, new Entry(type, rule, checked(key, type, rule, fallback)));
    }

    /** A string setting whose value is never returned by describe(). Its fallback is empty. */
    public synchronized void declareSecret(String key) {
        declare(key, Type.STRING, "");
        secrets.add(key);
    }

    public void onChange(Listener listener) { listeners.add(listener); }

    private void changed(String key) {
        for (Listener l : listeners) {
            try { l.onSettingChanged(key); } catch (Throwable ignored) { }
        }
    }

    public synchronized void applyDefaults(JSONObject defaults) {
        for (Iterator<String> it = defaults.keys(); it.hasNext(); ) {
            String key = it.next();
            // Defaults are compiled from a device file in a public repo.
            if (secrets.contains(key)) throw new InvalidSettingException("setting '" + key + "' is a secret and cannot have a compiled default");
            Entry e = entry(key);
            e.def = checked(key, e.type, e.rule, defaults.opt(key));
        }
    }

    public synchronized Object get(String key) {
        Entry e = entry(key);
        if (overrides.has(key) && !compiledOnly.contains(key)) {
            try {
                return checked(key, e.type, e.rule, overrides.opt(key));
            } catch (InvalidSettingException stale) {
                // The stored value no longer fits the declared type or rule; use the default.
                // The value itself is not logged: the key may be a secret.
                if (reportedStale.add(key)) {
                    Diag.log("Daylight-Settings", "stored override for '" + key + "' is no longer valid; using the default");
                }
            }
        }
        return e.def;
    }

    /** What a response may show for this key: the value, or for a secret only whether one is set. */
    public synchronized Object shown(String key) {
        Object value = get(key);
        if (!secrets.contains(key)) return value;
        return "".equals(value) ? "" : "(set)";
    }

    /** Listeners are called after the lock is released, and only when the write was persisted. */
    public void set(String key, Object value) {
        synchronized (this) {
            Entry e = entry(key);
            Object coerced = checked(key, e.type, e.rule, value);
            checkChange(key, coerced);
            Object previous = overrides.opt(key);
            try { overrides.put(key, coerced); } catch (JSONException ex) { throw new InvalidSettingException(ex.getMessage()); }
            try {
                persist();
            } catch (RuntimeException failed) {
                restore(key, previous);
                throw failed;
            }
        }
        changed(key);
    }

    /**
     * Several settings as one change: every value is checked first, then all are
     * stored with a single write. If any value is refused, or the write fails,
     * nothing is changed. Listeners hear each key afterwards, in the map's order.
     */
    public void setAll(Map<String, Object> values) {
        synchronized (this) {
            Map<String, Object> coerced = new LinkedHashMap<>();
            for (Map.Entry<String, Object> v : values.entrySet()) {
                Entry e = entry(v.getKey());
                coerced.put(v.getKey(), checked(v.getKey(), e.type, e.rule, v.getValue()));
                checkChange(v.getKey(), coerced.get(v.getKey()));
            }
            Map<String, Object> previous = new LinkedHashMap<>();
            for (String key : coerced.keySet()) previous.put(key, overrides.opt(key));
            try {
                for (Map.Entry<String, Object> v : coerced.entrySet()) overrides.put(v.getKey(), v.getValue());
                persist();
            } catch (JSONException | RuntimeException failed) {
                for (Map.Entry<String, Object> p : previous.entrySet()) restore(p.getKey(), p.getValue());
                if (failed instanceof RuntimeException) throw (RuntimeException) failed;
                throw new InvalidSettingException(failed.getMessage());
            }
        }
        for (String key : values.keySet()) changed(key);
    }

    public void reset(String key) {
        synchronized (this) {
            // A reset puts the default in effect, so it is a change to the default's value.
            checkChange(key, entry(key).def);
            Object previous = overrides.opt(key);
            overrides.remove(key);
            try {
                persist();
            } catch (RuntimeException failed) {
                restore(key, previous);
                throw failed;
            }
        }
        changed(key);
    }

    /** Put memory back the way it was when the new state could not be written to disk. */
    private void restore(String key, Object previous) {
        if (previous == null) {
            overrides.remove(key);
            return;
        }
        try { overrides.put(key, previous); } catch (JSONException ex) { throw new IllegalStateException(ex); }
    }

    /** True when a stored override exists and still fits the declared type and rule, so get() returns it. */
    private boolean overrideInEffect(String key, Entry e) {
        if (!overrides.has(key) || compiledOnly.contains(key)) return false;
        try {
            checked(key, e.type, e.rule, overrides.opt(key));
            return true;
        } catch (InvalidSettingException stale) {
            return false;
        }
    }

    public synchronized JSONArray describe() {
        JSONArray out = new JSONArray();
        for (Map.Entry<String, Entry> e : entries.entrySet()) {
            try {
                boolean secret = secrets.contains(e.getKey());
                JSONObject row = new JSONObject();
                Rule rule = e.getValue().rule;
                if (rule instanceof OneOf) row.put("allowed", new JSONArray(java.util.Arrays.asList(((OneOf) rule).allowed)));
                if (rule instanceof Range) row.put("min", ((Range) rule).min).put("max", ((Range) rule).max);
                out.put(row
                        .put("key", e.getKey())
                        .put("type", e.getValue().type.name())
                        .put("value", shown(e.getKey()))
                        .put("default", secret ? "" : e.getValue().def)
                        .put("secret", secret)
                        .put("overridden", overrideInEffect(e.getKey(), e.getValue())));
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

    /** The value coerced to the declared type and accepted by the rule, or InvalidSettingException. */
    private static Object checked(String key, Type type, Rule rule, Object raw) {
        Object value = coerce(key, type, raw);
        String problem = rule == null ? null : rule.problem(value);
        if (problem != null) throw new InvalidSettingException("setting '" + key + "' " + problem);
        return value;
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

    private static final class Loaded {
        final JSONObject overrides;
        final String problem;
        Loaded(JSONObject overrides, String problem) { this.overrides = overrides; this.problem = problem; }
    }

    /** The file's JSON object; null when the file is absent; an exception when it cannot be read as one. */
    private static JSONObject parse(File f) throws Exception {
        if (f == null || !f.isFile()) return null;
        return new JSONObject(new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8));
    }

    /**
     * A corrupt overrides file must not stop the payload, and must not pass unnoticed
     * either: a setting that exists only as an override (a device turned on at its
     * cutover) would be gone without a line anywhere. The file is read; when it cannot
     * be, the last good copy is; and what happened is logged once, without any value.
     */
    private static Loaded readOverrides(File f) {
        if (f == null) return new Loaded(new JSONObject(), null);
        File bak = backupOf(f);
        String problem = null;
        try {
            JSONObject main = parse(f);
            if (main != null) return new Loaded(main, null);
            // No file. After a write that was interrupted between its two renames the
            // backup is the newest good state; after a reset there is no backup either.
            if (!bak.isFile()) return new Loaded(new JSONObject(), null);
            problem = "the overrides file is missing but its backup exists";
        } catch (Exception unreadable) {
            problem = "the overrides file is unreadable (" + unreadable.getClass().getSimpleName() + ")";
        }
        try {
            JSONObject backup = parse(bak);
            if (backup != null) {
                problem += "; using the backup";
                Diag.log("Daylight-Settings", problem);
                return new Loaded(backup, problem);
            }
            problem += "; no backup, compiled defaults apply";
        } catch (Exception alsoUnreadable) {
            problem += "; the backup is unreadable too, compiled defaults apply";
        }
        Diag.log("Daylight-Settings", problem);
        return new Loaded(new JSONObject(), problem);
    }

    /**
     * Written to a temporary file and forced to disk before it replaces the overrides
     * file, so a power cut leaves either the old state or the new one, never a
     * half-written file. The state being replaced is kept as the backup.
     */
    private void persist() {
        try {
            File dir = overridesFile.getParentFile();
            if (dir != null) dir.mkdirs();
            File part = new File(overridesFile.getPath() + ".part");
            try (java.io.FileOutputStream out = new java.io.FileOutputStream(part)) {
                out.write(overrides.toString().getBytes(StandardCharsets.UTF_8));
                out.flush();
                out.getFD().sync();
            }
            if (overridesFile.isFile()) {
                try {
                    parse(overridesFile);     // only a readable file is worth keeping as the last good one
                    Files.move(overridesFile.toPath(), backupOf(overridesFile).toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                } catch (Exception notWorthKeeping) { /* the new file replaces it below */ }
            }
            Files.move(part.toPath(), overridesFile.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING,
                    java.nio.file.StandardCopyOption.ATOMIC_MOVE);
        } catch (Exception e) {
            throw new IllegalStateException("cannot persist settings: " + e.getMessage(), e);
        }
    }
}

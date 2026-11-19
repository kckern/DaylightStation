package net.kckern.daylight.build;

import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.constructor.SafeConstructor;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Values that must not be in the repo (addresses, device identities), read from the
 * `placeholders:` map of the private tokens file and substituted into string
 * defaults as {name}. Error messages never include a value.
 */
public final class Placeholders {
    private static final Pattern TOKEN = Pattern.compile("\\{([a-z][a-z0-9_]*)\\}");
    private final Map<String, String> values;

    private Placeholders(Map<String, String> values) { this.values = values; }

    public static Placeholders load(File file) {
        Map<String, String> out = new HashMap<>();
        if (file == null || !file.isFile()) return new Placeholders(out);
        Object doc;
        try {
            doc = new Yaml(new SafeConstructor()).load(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new CatalogException("cannot read the private file: " + e.getClass().getSimpleName());
        }
        if (doc instanceof Map) {
            Object map = ((Map<?, ?>) doc).get("placeholders");
            if (map instanceof Map) {
                for (Map.Entry<?, ?> e : ((Map<?, ?>) map).entrySet()) {
                    if (e.getValue() != null) out.put(String.valueOf(e.getKey()), String.valueOf(e.getValue()));
                }
            }
        }
        return new Placeholders(out);
    }

    /** The value of one placeholder, or null when the private file does not have it. */
    public String find(String name) { return values.get(name); }

    public String resolve(String raw, String where) {
        Matcher m = TOKEN.matcher(raw);
        StringBuffer out = new StringBuffer();
        while (m.find()) {
            String value = values.get(m.group(1));
            if (value == null) {
                throw new CatalogException("unknown placeholder '{" + m.group(1) + "}' in " + where
                        + "; add it under 'placeholders:' in the private file");
            }
            m.appendReplacement(out, Matcher.quoteReplacement(value));
        }
        m.appendTail(out);
        return out.toString();
    }

    public Map<String, Object> resolveAll(Map<String, Object> defaults, String file) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (Map.Entry<String, Object> e : defaults.entrySet()) {
            Object v = e.getValue();
            out.put(e.getKey(), v instanceof String
                    ? resolve((String) v, file + " defaults '" + e.getKey() + "'") : v);
        }
        return out;
    }
}

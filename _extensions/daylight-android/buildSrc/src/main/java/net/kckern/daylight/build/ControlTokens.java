package net.kckern.daylight.build;

import org.yaml.snakeyaml.Yaml;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Per-device control tokens, read from a private file outside the repo:
 *
 *   portal:
 *     host: <address>     # used by the CLI, ignored here
 *     token: <secret>
 *
 * Error messages never include a token.
 */
public final class ControlTokens {
    private static final Pattern SAFE = Pattern.compile("[A-Za-z0-9_-]+");
    private final Map<String, String> tokens;

    private ControlTokens(Map<String, String> tokens) { this.tokens = tokens; }

    public boolean has(String deviceId) { return tokens.containsKey(deviceId); }

    /** The token, or an empty string when the device has none. */
    public String tokenFor(String deviceId) {
        String t = tokens.get(deviceId);
        return t == null ? "" : t;
    }

    public static ControlTokens load(File file) {
        Map<String, String> out = new HashMap<>();
        if (file == null || !file.isFile()) return new ControlTokens(out);
        Object doc;
        try {
            doc = new Yaml().load(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new CatalogException("cannot read control tokens file: " + e.getClass().getSimpleName());
        }
        if (!(doc instanceof Map)) return new ControlTokens(out);
        for (Map.Entry<?, ?> e : ((Map<?, ?>) doc).entrySet()) {
            if (!(e.getValue() instanceof Map)) continue;
            Object token = ((Map<?, ?>) e.getValue()).get("token");
            if (token == null) continue;
            String id = String.valueOf(e.getKey());
            String value = String.valueOf(token);
            if (value.length() < 32) throw new CatalogException("token for '" + id + "' must be at least 32 characters");
            if (!SAFE.matcher(value).matches()) {
                throw new CatalogException("token for '" + id + "' may only contain letters, digits, '_' and '-'");
            }
            out.put(id, value);
        }
        return new ControlTokens(out);
    }
}

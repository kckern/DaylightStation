package net.kckern.daylight.cap.applauncher;

import org.json.JSONObject;

import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * A validated launch request. Pure Java.
 * Either {package, activity?, action?, extras?} or {intent:"intent:#Intent;…;end"}.
 */
final class LaunchRequest {
    private static final Pattern PACKAGE = Pattern.compile("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+");
    private static final Pattern CLASS = Pattern.compile("[A-Za-z_$][A-Za-z0-9_$]*(\\.[A-Za-z_$][A-Za-z0-9_$]*)*");
    private static final Pattern ACTION = Pattern.compile("[A-Za-z][A-Za-z0-9_.]*");
    /** As in frontend/src/lib/fkb.js: an extra key is ours, never user input. */
    private static final Pattern EXTRA_KEY = Pattern.compile("[A-Za-z_][A-Za-z0-9_.]*");

    final String pkg;
    final String activity;
    final String action;
    final String intentUri;
    final Map<String, String> extras;

    private LaunchRequest(String pkg, String activity, String action, String intentUri, Map<String, String> extras) {
        this.pkg = pkg;
        this.activity = activity;
        this.action = action;
        this.intentUri = intentUri;
        this.extras = extras;
    }

    /**
     * What can be told from the text of an intent: URI before Android parses it. It must
     * be a whole "intent:...#Intent;...;end" URI, it must not carry a file: or content:
     * URI (a way to hand another app a file or a provider's data), and it must not carry
     * a selector (a second intent the launch would be resolved through). The capability
     * checks the parsed intent again; this is the part a JVM test can prove.
     */
    static void checkIntentUri(String uri) {
        int hash = uri.indexOf("#Intent;");
        if (hash < 0 || !uri.endsWith(";end")) throw new IllegalArgumentException("'intent' must be an intent: URI ending in ;end");
        String data = uri.substring("intent:".length(), hash).trim().toLowerCase(java.util.Locale.ROOT);
        if (data.startsWith("file:") || data.startsWith("content:")) {
            throw new IllegalArgumentException("'intent' must not carry a file or content URI");
        }
        for (String part : uri.substring(hash + "#Intent;".length()).split(";")) {
            String p = part.trim();
            if (p.equals("SEL")) throw new IllegalArgumentException("'intent' must not carry a selector");
            if (p.toLowerCase(java.util.Locale.ROOT).startsWith("scheme=")) {
                String scheme = p.substring("scheme=".length()).trim().toLowerCase(java.util.Locale.ROOT);
                if (scheme.equals("file") || scheme.equals("content")) {
                    throw new IllegalArgumentException("'intent' must not carry a file or content URI");
                }
            }
        }
    }

    static LaunchRequest parse(JSONObject o) {
        if (o.has("intent")) {
            Object uri = o.opt("intent");
            if (!(uri instanceof String) || !((String) uri).startsWith("intent:") || ((String) uri).length() <= "intent:".length()) {
                throw new IllegalArgumentException("'intent' must be an intent: URI");
            }
            if (o.has("package") || o.has("activity") || o.has("action") || o.has("extras")) {
                throw new IllegalArgumentException("'intent' cannot be combined with other fields");
            }
            checkIntentUri((String) uri);
            return new LaunchRequest(null, null, null, (String) uri, Collections.emptyMap());
        }
        Object pkg = o.opt("package");
        if (!(pkg instanceof String) || !PACKAGE.matcher((String) pkg).matches()) {
            throw new IllegalArgumentException("'package' must be an Android package name");
        }
        String activity = null;
        if (o.has("activity") && !o.isNull("activity")) {
            Object a = o.opt("activity");
            if (!(a instanceof String)) throw new IllegalArgumentException("'activity' must be a class name");
            activity = ((String) a).startsWith(".") ? pkg + (String) a : (String) a;
            if (!CLASS.matcher(activity).matches()) throw new IllegalArgumentException("'activity' must be a class name");
        }
        String action = null;
        if (o.has("action") && !o.isNull("action")) {
            Object a = o.opt("action");
            if (!(a instanceof String) || !ACTION.matcher((String) a).matches()) throw new IllegalArgumentException("'action' is not valid");
            action = (String) a;
        }
        Map<String, String> extras = new LinkedHashMap<>();
        if (o.has("extras") && !o.isNull("extras")) {
            JSONObject e = o.optJSONObject("extras");
            if (e == null) throw new IllegalArgumentException("'extras' must be an object of strings");
            for (Iterator<String> it = e.keys(); it.hasNext(); ) {
                String key = it.next();
                Object value = e.opt(key);
                if (!EXTRA_KEY.matcher(key).matches()) throw new IllegalArgumentException("extra key '" + key + "' is not valid");
                if (!(value instanceof String)) throw new IllegalArgumentException("extra '" + key + "' must be a string");
                extras.put(key, (String) value);
            }
        }
        return new LaunchRequest((String) pkg, activity, action, null, Collections.unmodifiableMap(extras));
    }
}

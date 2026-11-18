package net.kckern.daylight.core.kiosk;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Pattern;

/**
 * Which apps may be in front of, or launched from, a locked kiosk.
 *
 *   com.example.app                the package, any activity
 *   com.example.*                  packages under that prefix
 *   com.example.app/.Activity      one activity (short or full class name)
 *
 * Pure Java. A rule that would allow everything is refused.
 */
public final class AllowRules {
    private static final Pattern PACKAGE = Pattern.compile("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+");
    private static final Pattern CLASS = Pattern.compile("[A-Za-z_$][A-Za-z0-9_$]*(\\.[A-Za-z_$][A-Za-z0-9_$]*)*");

    private static final class Rule {
        final String pkg;        // exact package, or the prefix (ending in '.') for a wildcard
        final boolean wildcard;
        final String activity;   // full class name, or null for any
        Rule(String pkg, boolean wildcard, String activity) { this.pkg = pkg; this.wildcard = wildcard; this.activity = activity; }
    }

    private final List<Rule> rules;

    private AllowRules(List<Rule> rules) { this.rules = rules; }

    public static AllowRules parse(String csv) {
        List<Rule> out = new ArrayList<>();
        if (csv != null) {
            for (String raw : csv.split(",")) {
                String s = raw.trim();
                if (!s.isEmpty()) out.add(rule(s));
            }
        }
        return new AllowRules(Collections.unmodifiableList(out));
    }

    /** Fail closed: a list that does not parse allows nothing. */
    public static AllowRules parseOrEmpty(String csv) {
        try { return parse(csv); } catch (IllegalArgumentException e) { return parse(""); }
    }

    /** The parse error, or null when the list is valid. */
    public static String errorIn(String csv) {
        try { parse(csv); return null; } catch (IllegalArgumentException e) { return e.getMessage(); }
    }

    private static Rule rule(String s) {
        int slash = s.indexOf('/');
        if (slash >= 0) {
            String pkg = s.substring(0, slash), cls = s.substring(slash + 1);
            if (!PACKAGE.matcher(pkg).matches()) throw bad(s, "package is not valid");
            if (cls.startsWith(".")) cls = pkg + cls;
            if (cls.isEmpty() || !CLASS.matcher(cls).matches()) throw bad(s, "activity is not valid");
            return new Rule(pkg, false, cls);
        }
        if (s.endsWith(".*")) {
            String prefix = s.substring(0, s.length() - 2);
            if (!PACKAGE.matcher(prefix).matches()) throw bad(s, "a wildcard needs at least two package segments before '.*'");
            return new Rule(prefix + ".", true, null);
        }
        if (!PACKAGE.matcher(s).matches()) throw bad(s, "not a package name");
        return new Rule(s, false, null);
    }

    private static IllegalArgumentException bad(String rule, String why) {
        return new IllegalArgumentException("allow rule '" + rule + "': " + why);
    }

    /** activity may be null when it is not known; single-activity rules then do not match. */
    public boolean matches(String pkg, String activity) {
        if (pkg == null) return false;
        for (Rule r : rules) {
            boolean pkgOk = r.wildcard ? pkg.startsWith(r.pkg) : pkg.equals(r.pkg);
            if (!pkgOk) continue;
            if (r.activity == null || r.activity.equals(activity)) return true;
        }
        return false;
    }

    /** Packages named exactly (with or without an activity). Lock task works per package. */
    public Set<String> exactPackages() {
        Set<String> out = new TreeSet<>();
        for (Rule r : rules) if (!r.wildcard) out.add(r.pkg);
        return out;
    }

    public List<String> describe() {
        List<String> out = new ArrayList<>();
        for (Rule r : rules) out.add(r.wildcard ? r.pkg + "*" : r.activity == null ? r.pkg : r.pkg + "/" + r.activity);
        return out;
    }
}

package net.kckern.pianobridge;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * KioskSettings — the DESIRED state of Fully Kiosk's kiosk-critical settings, and the
 * pure comparison that says which of them have drifted.
 *
 * <p>Why this exists: on 2026-07-21 the piano tablet was found with
 * {@code kioskMode=false}. It had been switched off during a debugging session and
 * never switched back, and nothing in the system was watching, so the kiosk sat
 * unlocked indefinitely. This class is the specification of "correct"; the acting half
 * is {@link KioskSettingsGuard}.
 *
 * <p>The desired set MIRRORS what {@code cli/fkb.cli.mjs} already applies via its
 * {@code keepawake} and {@code recovery} commands, so the host CLI and the on-device
 * guard cannot disagree about what a healthy kiosk looks like. {@code kioskMode} is
 * the one addition — it is the setting that started all this.
 *
 * <p>Two rules govern {@link #detect} and both exist to keep the guard from doing
 * harm:
 * <ol>
 *   <li><b>An empty live map means UNKNOWN, not "everything drifted."</b> That is the
 *       failure sentinel from {@link FkbRest#listSettings}; treating it as drift would
 *       let a network blip trigger a blind rewrite of every setting.</li>
 *   <li><b>A key absent from the live map is not drift.</b> FKB versions differ in
 *       which settings they expose. Writing a key FKB does not have would repeat
 *       forever, since FKB would never start reporting it back.</li>
 * </ol>
 * The guard only ever acts on a value it has positively observed to be wrong.
 */
public final class KioskSettings {

    /** How the value must be written back — mirrors fkb.cli.mjs's setter split. */
    public enum Type { BOOL, STRING }

    /** One entry of the desired set. */
    public static final class Desired {
        public final String value;
        public final Type type;
        Desired(String value, Type type) { this.value = value; this.type = type; }
    }

    /** One observed disagreement between FKB's live value and the desired one. */
    public static final class Drift {
        public final String key;
        public final String live;
        public final String desired;
        public final Type type;
        Drift(String key, String live, String desired, Type type) {
            this.key = key; this.live = live; this.desired = desired; this.type = type;
        }
        @Override public String toString() { return key + " " + live + " → " + desired; }
    }

    /**
     * The kiosk-critical set. Insertion-ordered so repair logs read consistently.
     *
     * <p>Sourced from {@code cli/fkb.cli.mjs} — {@code keepawake} (:214-219) and
     * {@code recovery} (:245-257) — plus {@code kioskMode}.
     */
    public static final Map<String, Desired> DESIRED;
    static {
        LinkedHashMap<String, Desired> m = new LinkedHashMap<>();

        // The trigger for this whole feature: the kiosk must actually be locked.
        m.put("kioskMode", bool("true"));

        // keepawake — stay lit and networked while plugged in.
        m.put("keepScreenOn", bool("true"));
        m.put("setWifiWakelock", bool("true"));
        m.put("preventSleepWhileScreenOff", bool("true"));
        m.put("reloadOnWifiOn", bool("true"));

        // recovery — a dead kiosk page heals itself instead of sitting on Chrome's
        // "Webpage not available" screen forever (which kills the piano SPA with it).
        m.put("reloadOnInternet", bool("true"));
        m.put("waitInternetOnReload", bool("true"));
        m.put("restartOnCrash", bool("true"));
        m.put("reloadPageFailure", str("30"));   // retry a FAILED page load after 30s

        // Asserted OFF ON PURPOSE — do not "fix" these to something non-zero.
        // Both reload a page that is working fine, which interrupts idle video
        // watching. Only reloadPageFailure (above) is wanted, because it fires solely
        // on an actual load failure. See cli/fkb.cli.mjs:248-249.
        m.put("reloadOnIdle", str("0"));
        m.put("reloadEachSeconds", str("0"));

        DESIRED = Collections.unmodifiableMap(m);
    }

    private KioskSettings() { }

    private static Desired bool(String v) { return new Desired(v, Type.BOOL); }
    private static Desired str(String v) { return new Desired(v, Type.STRING); }

    /**
     * Compare FKB's live settings against {@link #DESIRED} and return only the keys
     * that have positively drifted. Never null. See the class javadoc for the two
     * do-no-harm rules (empty map, absent key) that this deliberately does NOT report.
     */
    public static List<Drift> detect(Map<String, String> live) {
        List<Drift> out = new ArrayList<>();
        // Read failure / unknown state — say nothing rather than rewrite everything.
        if (live == null || live.isEmpty()) return out;

        for (Map.Entry<String, Desired> e : DESIRED.entrySet()) {
            String key = e.getKey();
            Desired want = e.getValue();
            String have = live.get(key);
            // This FKB build does not expose the knob — leave it alone.
            if (have == null) continue;
            if (!matches(have, want)) out.add(new Drift(key, have, want.value, want.type));
        }
        return out;
    }

    /** Value-based equality: booleans by truth value, strings by trimmed text. */
    private static boolean matches(String have, Desired want) {
        if (want.type == Type.BOOL) {
            Boolean h = asBool(have);
            Boolean w = asBool(want.value);
            // Unparseable live value (FKB reporting something we don't understand)
            // counts as drift only if we can still say what the desired value is.
            return w != null && w.equals(h);
        }
        return want.value.trim().equals(have.trim());
    }

    /** FKB emits {@code true}/{@code false}; tolerate case and the 1/0 spelling. */
    private static Boolean asBool(String s) {
        if (s == null) return null;
        String v = s.trim().toLowerCase(Locale.US);
        if (v.equals("true") || v.equals("1") || v.equals("yes")) return Boolean.TRUE;
        if (v.equals("false") || v.equals("0") || v.equals("no")) return Boolean.FALSE;
        return null;
    }
}

package net.kckern.daylight.cap.lockdown;

import net.kckern.daylight.core.kiosk.AllowRules;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;

/**
 * Temporary additions to the allowlist. Pure Java.
 *
 *   allowFor          a rule for a limited time, capped at one hour (pairing dialog, installer);
 *                     revoke ends it early
 *   allowWhileInFront a package until it has been in front and left (an app the kiosk launched)
 */
final class Exemptions {
    static final long MAX_MS = 60 * 60 * 1000L;
    /** A while-in-front grant whose package never reaches the foreground ends after this. */
    static final long UNSEEN_MS = 30_000L;

    private static final class Timed {
        final String text;
        final AllowRules rule;
        final long untilMs;
        Timed(String text, AllowRules rule, long untilMs) { this.text = text; this.rule = rule; this.untilMs = untilMs; }
    }

    /**
     * How many samples in a row must show another package in front before a
     * while-in-front grant ends. One sample is a permission prompt, a toast window or a
     * system dialog passing over the launched app; ending the grant on it had the
     * watcher recall the kiosk over a game that was still running.
     */
    static final int AWAY_SAMPLES = 3;

    private static final class WhileFront {
        final String pkg;
        /** The one activity the grant is for, or null for the whole package. */
        final String activity;
        final long grantedAtMs;
        boolean seen;
        int awaySamples;
        WhileFront(String pkg, String activity, long grantedAtMs) { this.pkg = pkg; this.activity = activity; this.grantedAtMs = grantedAtMs; }
    }

    private final List<Timed> timed = new ArrayList<>();
    private final List<WhileFront> fronts = new ArrayList<>();

    synchronized void allowFor(String rule, long nowMs, long durationMs) {
        AllowRules parsed = AllowRules.parse(rule);
        if (parsed.describe().size() != 1) throw new IllegalArgumentException("one rule per exemption");
        if (durationMs <= 0) throw new IllegalArgumentException("duration must be positive");
        timed.add(new Timed(parsed.describe().get(0), parsed, nowMs + Math.min(durationMs, MAX_MS)));
    }

    synchronized void allowWhileInFront(String packageName, long nowMs) { allowWhileInFront(packageName, null, nowMs); }

    /**
     * @param activity the one activity that may be in front, as a full class name, or null
     *                 for any activity of the package. A launch that was allowed by an
     *                 activity-level rule passes its activity, so the rest of the package
     *                 (its settings screen, say) is not let through with it.
     */
    synchronized void allowWhileInFront(String packageName, String activity, long nowMs) {
        AllowRules parsed = AllowRules.parse(packageName);
        if (parsed.exactPackages().size() != 1 || !parsed.describe().get(0).equals(packageName)) {
            throw new IllegalArgumentException("a plain package name is required");
        }
        for (Iterator<WhileFront> it = fronts.iterator(); it.hasNext(); ) if (it.next().pkg.equals(packageName)) it.remove();
        if (activity != null && activity.isEmpty()) throw new IllegalArgumentException("an activity must be a class name");
        fronts.add(new WhileFront(packageName, activity, nowMs));
    }

    /** Ends every timed exemption granted for exactly this rule. A rule that is not in force, or not a rule, is ignored. */
    synchronized void revoke(String rule) {
        if (rule == null) return;
        String text;
        try {
            AllowRules parsed = AllowRules.parse(rule);
            if (parsed.describe().size() != 1) return;
            text = parsed.describe().get(0);
        } catch (IllegalArgumentException notARule) {
            return;
        }
        for (Iterator<Timed> it = timed.iterator(); it.hasNext(); ) if (it.next().text.equals(text)) it.remove();
    }

    /** Feed the package in front (null when unknown) every tick. */
    synchronized void observeFront(String front, long nowMs) {
        for (Iterator<WhileFront> it = fronts.iterator(); it.hasNext(); ) {
            WhileFront w = it.next();
            if (w.pkg.equals(front)) { w.seen = true; w.awaySamples = 0; }
            else if (w.seen && front != null) { if (++w.awaySamples >= AWAY_SAMPLES) it.remove(); }
            else if (!w.seen && nowMs - w.grantedAtMs > UNSEEN_MS) it.remove();
        }
        for (Iterator<Timed> it = timed.iterator(); it.hasNext(); ) if (nowMs >= it.next().untilMs) it.remove();
    }

    synchronized boolean allows(String pkg, String activity, long nowMs) {
        if (pkg == null) return false;
        for (Timed t : timed) if (nowMs < t.untilMs && t.rule.matches(pkg, activity)) return true;
        // An activity-level grant matches that activity alone. An activity that is not
        // known (null) does not match it: unknown is not allowed.
        for (WhileFront w : fronts) if (w.pkg.equals(pkg) && (w.activity == null || w.activity.equals(activity))) return true;
        return false;
    }

    /** Exactly named packages in force, for the lock-task package list. */
    synchronized Set<String> packages(long nowMs) {
        Set<String> out = new TreeSet<>();
        for (Timed t : timed) if (nowMs < t.untilMs) out.addAll(t.rule.exactPackages());
        for (WhileFront w : fronts) out.add(w.pkg);
        return out;
    }

    synchronized List<String> describe(long nowMs) {
        List<String> out = new ArrayList<>();
        for (Timed t : timed) if (nowMs < t.untilMs) out.add(t.text + " until " + t.untilMs);
        for (WhileFront w : fronts) out.add((w.activity == null ? w.pkg : w.pkg + "/" + w.activity) + " while in front");
        return out;
    }
}

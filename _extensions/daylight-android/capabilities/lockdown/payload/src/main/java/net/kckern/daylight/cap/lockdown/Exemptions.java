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
 *   allowFor          a rule for a limited time, capped at one hour (pairing dialog, installer)
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

    private static final class WhileFront {
        final String pkg;
        final long grantedAtMs;
        boolean seen;
        WhileFront(String pkg, long grantedAtMs) { this.pkg = pkg; this.grantedAtMs = grantedAtMs; }
    }

    private final List<Timed> timed = new ArrayList<>();
    private final List<WhileFront> fronts = new ArrayList<>();

    synchronized void allowFor(String rule, long nowMs, long durationMs) {
        AllowRules parsed = AllowRules.parse(rule);
        if (parsed.describe().size() != 1) throw new IllegalArgumentException("one rule per exemption");
        if (durationMs <= 0) throw new IllegalArgumentException("duration must be positive");
        timed.add(new Timed(parsed.describe().get(0), parsed, nowMs + Math.min(durationMs, MAX_MS)));
    }

    synchronized void allowWhileInFront(String packageName, long nowMs) {
        AllowRules parsed = AllowRules.parse(packageName);
        if (parsed.exactPackages().size() != 1 || !parsed.describe().get(0).equals(packageName)) {
            throw new IllegalArgumentException("a plain package name is required");
        }
        for (Iterator<WhileFront> it = fronts.iterator(); it.hasNext(); ) if (it.next().pkg.equals(packageName)) it.remove();
        fronts.add(new WhileFront(packageName, nowMs));
    }

    /** Feed the package in front (null when unknown) every tick. */
    synchronized void observeFront(String front, long nowMs) {
        for (Iterator<WhileFront> it = fronts.iterator(); it.hasNext(); ) {
            WhileFront w = it.next();
            if (w.pkg.equals(front)) w.seen = true;
            else if (w.seen && front != null) it.remove();
            else if (!w.seen && nowMs - w.grantedAtMs > UNSEEN_MS) it.remove();
        }
        for (Iterator<Timed> it = timed.iterator(); it.hasNext(); ) if (nowMs >= it.next().untilMs) it.remove();
    }

    synchronized boolean allows(String pkg, String activity, long nowMs) {
        if (pkg == null) return false;
        for (Timed t : timed) if (nowMs < t.untilMs && t.rule.matches(pkg, activity)) return true;
        for (WhileFront w : fronts) if (w.pkg.equals(pkg)) return true;
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
        for (WhileFront w : fronts) out.add(w.pkg + " while in front");
        return out;
    }
}

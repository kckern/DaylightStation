package net.kckern.daylight.cap.applauncher;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;

import net.kckern.daylight.core.Capability;
import net.kckern.daylight.core.CoreContext;
import net.kckern.daylight.core.MainThread;
import net.kckern.daylight.core.Replies;
import net.kckern.daylight.core.Requests;
import net.kckern.daylight.core.Router;
import net.kckern.daylight.core.SettingsRegistry;
import net.kckern.daylight.core.SettingsRegistry.Type;
import net.kckern.daylight.core.kiosk.AllowRules;
import net.kckern.daylight.core.spi.AppLaunch;
import net.kckern.daylight.core.spi.KioskSurface;
import net.kckern.daylight.core.spi.LockdownControl;
import net.kckern.daylight.core.spi.PackageGate;

import org.json.JSONObject;

import java.util.Locale;
import java.util.Map;
import java.util.function.BooleanSupplier;

/**
 * POST /launch and the page's daylight.launch(): start another app from the kiosk.
 * Every request, from the route or from the page, is turned into one explicit activity,
 * and that activity is what launcher.allowed is asked about.
 */
public final class AppLauncherCapability implements Capability, AppLaunch {
    /** A request resolved to one concrete activity. */
    static final class Target {
        final String pkg, cls;
        /** The android.content.Intent to start; opaque here so a JVM test can stand in for it. */
        final Object intent;
        Target(String pkg, String cls, Object intent) { this.pkg = pkg; this.cls = cls; this.intent = intent; }
        String component() { return pkg + "/" + cls; }
    }

    /** What the launcher needs from Android. The real one is {@link Device}. */
    interface Platform {
        /** The one activity this request resolves to, or null. IllegalArgumentException for a request that cannot be built. */
        Target resolve(LaunchRequest request);
        /** False when the system refused the start. */
        boolean start(Target target);
    }

    private CoreContext core;
    private volatile Platform platform;
    private volatile BooleanSupplier observerForTest;
    void usePlatformForTest(Platform p) { platform = p; }
    void useObserverForTest(BooleanSupplier canObserve) { observerForTest = canObserve; }

    @Override public String name() { return "app-launcher"; }

    private void note(String m) { if (core.shell() != null) core.shell().note("LAUNCH", m); }

    @Override public void register(CoreContext core) {
        this.core = core;
        // Empty allows nothing. Same syntax as the lockdown allowlist; a list that does not parse allows nothing.
        core.settings().declare("launcher.allowed", Type.STRING, "");
        core.settings().declare("launcher.confirmMs", Type.INTEGER, 3000, SettingsRegistry.range(0, 30_000));
        core.services().provide(AppLaunch.class, this);
        core.router().route("POST", "/launch", req -> {
            JSONObject body = Requests.body(req);
            LaunchRequest.parse(body);                       // malformed → 400 before anything else
            return Router.Response.json(200, launch(body));
        });
    }

    @Override public void start() {
        Context ctx = (Context) core.shell().context();
        // JVM tests boot every capability with no Android context: there is nothing to launch.
        if (ctx == null) return;
        platform = new Device(ctx);
    }

    @Override public void stop() { platform = null; }

    /** The resolved target, or the reason there is none. Exactly one of the two fields is set. */
    private static final class Resolved {
        Target target;
        String error;
    }

    /** Turn the request into one explicit activity and decide whether it may be started. Starts nothing. */
    private Resolved resolve(JSONObject request) {
        Resolved out = new Resolved();
        final LaunchRequest parsed;
        try { parsed = LaunchRequest.parse(request); } catch (IllegalArgumentException e) { out.error = "bad_request"; return out; }
        Platform p = platform;
        if (p == null) { out.error = "not_installed"; return out; }
        Target t;
        try {
            t = p.resolve(parsed);
        } catch (IllegalArgumentException e) {
            out.error = "bad_request";
            return out;
        } catch (Exception e) {
            note("resolve failed: " + e);
            out.error = "not_installed";
            return out;
        }
        PackageGate gate = core.services().find(PackageGate.class);
        boolean closed = false;
        // A gate that cannot be read counts as closed.
        try { closed = t != null && gate != null && gate.isHidden(t.pkg); } catch (Throwable unreadable) { closed = true; }
        AllowRules allowed = AllowRules.parseOrEmpty((String) core.settings().get("launcher.allowed"));
        out.error = LaunchPolicy.refusal(t == null ? null : t.pkg, t == null ? null : t.cls, allowed, closed);
        if (out.error == null) out.target = t;
        return out;
    }

    @Override public String check(JSONObject request) { return resolve(request).error; }

    @Override public JSONObject launch(JSONObject request) {
        try {
            Resolved r = resolve(request);
            if (r.error != null) {
                if (!"bad_request".equals(r.error)) note("refused (" + r.error + ")" + (r.target == null ? "" : " " + r.target.component()));
                return Replies.err(r.error);
            }
            final String pkg = r.target.pkg;
            String component = r.target.component();
            Platform p = platform;
            if (p == null) return Replies.err("not_installed");

            // Before the start: under lock task the package must already be on the list,
            // and the watcher must not recall it in the second it takes to appear.
            final LockdownControl lockdown = core.services().find(LockdownControl.class);
            // When only an activity-level rule allows this launch, only that activity is
            // exempt; a rule for the whole package exempts the package.
            if (lockdown != null) {
                AllowRules rules = AllowRules.parseOrEmpty((String) core.settings().get("launcher.allowed"));
                lockdown.allowWhileInFront(pkg, LaunchPolicy.exemptActivity(pkg, r.target.cls, rules));
            }

            if (!p.start(r.target)) {
                note("start refused: " + component);
                return Replies.err("start_refused").put("component", component);
            }

            // Confirm when there is something to confirm with. Without the watcher the
            // answer says the start was issued and that it was not observed.
            JSONObject o;
            if (lockdown != null && canObserve()) {
                boolean seen = MainThread.waitFor(() -> pkg.equals(lockdown.front()), (Integer) core.settings().get("launcher.confirmMs"));
                if (!seen) {
                    note("launch not observed: " + component);
                    String front = lockdown.front();
                    return Replies.err("launch_not_observed").put("component", component)
                            .put("foreground", front == null ? JSONObject.NULL : front);
                }
                o = Replies.ok().put("observedInFront", true);
            } else {
                o = Replies.ok().put("observedInFront", JSONObject.NULL);
            }
            note("launched " + component);
            return o.put("launched", true).put("component", component);
        } catch (Exception e) {
            note("launch failed: " + e);
            return Replies.err("launch_failed");
        }
    }

    /** The foreground can be seen only through a bound accessibility service. */
    private boolean canObserve() {
        BooleanSupplier test = observerForTest;
        return test != null ? test.getAsBoolean() : core.accessibility().service() != null;
    }

    /** The real platform: the package manager resolves, the kiosk Activity (or the service) starts. */
    private final class Device implements Platform {
        private final Context context;

        Device(Context context) { this.context = context; }

        @Override public Target resolve(LaunchRequest req) {
            PackageManager pm = context.getPackageManager();
            if (pm == null) return null;
            Intent intent;
            if (req.intentUri != null) {
                try {
                    intent = Intent.parseUri(req.intentUri, Intent.URI_INTENT_SCHEME);
                } catch (Exception e) {
                    throw new IllegalArgumentException("'intent' is not a valid intent: URI");
                }
                intent.setSelector(null);            // a selector could redirect the launch
                intent.setClipData(null);
                Uri data = intent.getData();
                if (data != null) {
                    String scheme = data.getScheme();
                    String s = scheme == null ? "" : scheme.toLowerCase(Locale.ROOT);
                    // Checked on the parsed intent too, whatever the text looked like.
                    if (s.isEmpty() || s.equals("file") || s.equals("content")) {
                        throw new IllegalArgumentException("'intent' must not carry a file or content URI");
                    }
                }
            } else if (req.activity != null) {
                intent = new Intent(req.action != null ? req.action : Intent.ACTION_MAIN);
                intent.setClassName(req.pkg, req.activity);
            } else if (req.action != null) {
                intent = new Intent(req.action);
                intent.setPackage(req.pkg);
            } else {
                intent = pm.getLaunchIntentForPackage(req.pkg);
                if (intent == null) intent = pm.getLeanbackLaunchIntentForPackage(req.pkg);
                if (intent == null) return null;
            }
            for (Map.Entry<String, String> e : req.extras.entrySet()) intent.putExtra(e.getKey(), e.getValue());

            ResolveInfo info = pm.resolveActivity(intent, 0);
            if (info == null || info.activityInfo == null) return null;
            // Explicit from here on: what is started is exactly what was checked. And no flag
            // from the request survives: a URI-permission grant must not ride along.
            intent.setComponent(new ComponentName(info.activityInfo.packageName, info.activityInfo.name));
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            return new Target(info.activityInfo.packageName, info.activityInfo.name, intent);
        }

        @Override public boolean start(Target target) {
            Intent intent = (Intent) target.intent;
            KioskSurface surface = core.services().find(KioskSurface.class);
            if (surface != null) return surface.startActivity(intent);
            try {
                context.startActivity(intent);
                return true;
            } catch (Exception e) {
                return false;
            }
        }
    }
}

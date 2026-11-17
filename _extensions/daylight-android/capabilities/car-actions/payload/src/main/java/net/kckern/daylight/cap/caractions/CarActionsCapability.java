package net.kckern.daylight.cap.caractions;

import android.content.Context;

import net.kckern.daylight.api.PayloadPort;
import net.kckern.daylight.api.SurfaceKeys;
import net.kckern.daylight.core.Capability;
import net.kckern.daylight.core.CertificatePins;
import net.kckern.daylight.core.CoreContext;
import net.kckern.daylight.core.Replies;
import net.kckern.daylight.core.Router;
import net.kckern.daylight.core.SettingsRegistry;
import net.kckern.daylight.core.spi.ActionList;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * The car screen's list of household actions (Android Auto, projection). The list is
 * the setting car.actions; the installed car app service asks for it, and for a run,
 * over the "car" PayloadPort, in process. A run takes an id on the car list and goes
 * through ActionList.run, the path a keyed action link takes; no link and no key is
 * built for it, and an action that is not on the car list is not run from the car.
 *
 * Which car host may bind the screen is the setting car.hostPins, written into the
 * surface cache for the installed service: it may be bound before any payload loads.
 */
public final class CarActionsCapability implements Capability {
    /** The PayloadPort the installed car screen calls. The shell half spells the same name. */
    static final String PORT = "car";
    static final String ACTIONS = "car.actions";
    /** Also the key in the surface cache the installed service reads. */
    static final String HOST_PINS = "car.hostPins";
    /** Android Auto's host package, the one host the car screen serves. */
    static final String ANDROID_AUTO = "com.google.android.projection.gearhead";

    static final String NOT_ON_LIST = "That is not on the car list";

    /** Where the host pins go; the surface cache unless a test sets it. */
    interface PinCache { void write(String json); }

    private CoreContext core;
    volatile PinCache pinCache;
    private volatile boolean started;
    private final PayloadPort port = PayloadPort.named(PORT);
    private final PayloadPort.Handler onCall = this::answer;

    public CarActionsCapability() { }

    @Override public String name() { return "car-actions"; }

    @Override public void register(final CoreContext core) {
        this.core = core;
        core.settings().declare(ACTIONS, SettingsRegistry.Type.STRING, "",
                value -> CarList.settingProblem((String) value, lookup()));
        core.settings().declare(HOST_PINS, SettingsRegistry.Type.STRING, "", value -> hostPinProblem((String) value));
        core.settings().onChange(key -> { if (HOST_PINS.equals(key) && started) writePins(); });
        core.router().route("GET", "/car/actions", req -> {
            List<String> problems = new ArrayList<>();
            JSONArray out = new JSONArray();
            for (CarList.Entry e : entries(problems)) out.put(entry(e));
            return Router.Response.json(200, Replies.ok().put("actions", out).put("problems", new JSONArray(problems)));
        });
    }

    /**
     * Never throws on a setting: what cannot be shown is in GET /car/actions and noted.
     * With no Android context (a JVM test of the whole payload) there is no installed
     * car screen to serve, and nothing is attached.
     */
    @Override public void start() {
        if (pinCache == null) {
            final Object context = core.shell().context();
            if (context == null) return;
            pinCache = json -> {
                android.content.SharedPreferences prefs = ((Context) context).getSharedPreferences(SurfaceKeys.PREFS, Context.MODE_PRIVATE);
                if (prefs != null) prefs.edit().putString(HOST_PINS, json).apply();
            };
        }
        List<String> problems = new ArrayList<>();
        entries(problems);
        for (String problem : problems) core.shell().note("CAR", problem);
        started = true;
        writePins();
        port.attach(onCall);
    }

    /** May be called twice. Detaches only this payload's handler: a successor may already be attached. */
    @Override public void stop() {
        started = false;
        port.detach(onCall);
    }

    // ── the port ─────────────────────────────────────────────────────────────

    /** {op: list} answers the entries; {op: run, id} runs one entry and answers {message}. */
    private String answer(String request) throws Exception {
        JSONObject r = new JSONObject(request);
        String op = r.optString("op", "");
        if ("list".equals(op)) {
            JSONArray out = new JSONArray();
            for (CarList.Entry e : entries(new ArrayList<String>())) out.put(entry(e));
            return Replies.ok().put("entries", out).toString();
        }
        if ("run".equals(op)) return run(r.optString("id", "")).toString();
        return new JSONObject().put("ok", false).put("message", "Unknown request").toString();
    }

    private JSONObject run(String id) throws Exception {
        CarList.Entry entry = null;
        for (CarList.Entry e : entries(new ArrayList<String>())) if (e.id.equals(id)) entry = e;
        ActionList actions = core.services().find(ActionList.class);
        if (entry == null || actions == null || !CarList.RUN.equals(entry.kind)) {
            return new JSONObject().put("ok", false).put("message", NOT_ON_LIST);
        }
        core.shell().note("CAR", entry.id + " run");
        JSONObject effect = actions.run(entry.id);
        String message = effect.optString("message", "");
        return new JSONObject().put("ok", effect.optBoolean("ok", true)).put("message", message.isEmpty() ? entry.label + ": done" : message);
    }

    // ── the list ─────────────────────────────────────────────────────────────

    private CarList.Lookup lookup() {
        final CoreContext c = core;
        return id -> {
            ActionList actions = c == null ? null : c.services().find(ActionList.class);
            return actions == null ? null : actions.describe(id);
        };
    }

    private List<CarList.Entry> entries(List<String> problems) {
        return CarList.usable((String) core.settings().get(ACTIONS), lookup(), problems);
    }

    private static JSONObject entry(CarList.Entry e) throws Exception {
        return new JSONObject().put("id", e.id).put("label", e.label).put("icon", e.icon).put("kind", e.kind);
    }

    // ── the host pins ────────────────────────────────────────────────────────

    /** car.hostPins takes CertificatePins' form, and Android Auto's package alone. */
    static String hostPinProblem(String value) {
        String problem = CertificatePins.problem(value);
        if (problem != null) return problem;
        for (String pkg : CertificatePins.parse(value).keySet()) {
            if (!ANDROID_AUTO.equals(pkg)) return "only Android Auto's package can be pinned as the car host";
        }
        return null;
    }

    private void writePins() {
        try {
            PinCache c = pinCache;
            if (c != null) c.write(CertificatePins.cacheJson((String) core.settings().get(HOST_PINS)));
        } catch (RuntimeException e) {
            core.shell().note("CAR", "could not hand the host pins to the car screen: " + e.getClass().getSimpleName());
        }
    }
}

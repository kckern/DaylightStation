package net.kckern.daylight.cap.widgets;

import android.content.Context;

import net.kckern.daylight.api.SurfaceKeys;
import net.kckern.daylight.core.Capability;
import net.kckern.daylight.core.CoreContext;
import net.kckern.daylight.core.EventBus;
import net.kckern.daylight.core.Replies;
import net.kckern.daylight.core.Router;
import net.kckern.daylight.core.SettingsRegistry;
import net.kckern.daylight.core.UnsupportedException;
import net.kckern.daylight.core.spi.ActionList;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * The home-screen widget's content. The widget itself (provider, layout) is installed
 * code that draws from the surface cache; this capability decides which actions fill
 * its four slots and writes them there, at start and whenever the actions are
 * published again. It also writes every action under its own id, which is what a
 * one-action button widget and its chooser read.
 */
public final class WidgetsCapability implements Capability {
    private static final String ACTIONS = "widgets.actions";

    /** The Android side: persist the cache and ask the widget to redraw. */
    interface WidgetSink {
        /** The four-button widget's slots. */
        void apply(Map<String, String> cache);

        /** Every action under its id, for the one-action button widgets. */
        default void applyActions(Map<String, String> cache) { }

        /** What the cache holds for a key now; "" when nothing. */
        default String read(String key) { return ""; }
    }

    private CoreContext core;
    private WidgetSink sink;
    private volatile boolean listening;

    private final EventBus.Listener onPublished = (topic, detail) -> {
        if (!ActionList.PUBLISHED.equals(topic)) return;
        try {
            refresh(new ArrayList<String>());
        } catch (RuntimeException e) {
            core.shell().note("WIDGET", "could not refresh: " + e.getClass().getSimpleName());
        }
    };

    public WidgetsCapability() { }

    WidgetsCapability(WidgetSink sink) { this.sink = sink; }

    @Override public String name() { return "widgets"; }

    @Override public void register(final CoreContext core) {
        this.core = core;
        core.settings().declare(ACTIONS, SettingsRegistry.Type.STRING, "", value -> WidgetModel.listProblem((String) value));

        // What the slots hold, without the links: a link carries the install key.
        core.router().route("GET", "/widgets", req -> {
            List<String> problems = new ArrayList<>();
            return Router.Response.json(200, Replies.ok().put("slots", slots(problems)).put("problems", new JSONArray(problems)));
        });
        core.router().route("POST", "/widgets/refresh", req -> {
            if (sink == null) throw new UnsupportedException("the widget needs a running app");
            List<String> problems = new ArrayList<>();
            refresh(problems);
            return Router.Response.json(200, Replies.ok().put("slots", slots(new ArrayList<String>())).put("problems", new JSONArray(problems)));
        });
    }

    /** Never throws on a setting or on a launcher that misbehaves: both are noted. */
    @Override public void start() {
        if (sink == null) {
            Object context = core.shell().context();
            // A JVM test of the whole payload has no Android context: there is no widget.
            if (context == null) return;
            sink = new AndroidWidgetSink((Context) context);
        }
        core.events().subscribe(onPublished);
        listening = true;
        List<String> problems = new ArrayList<>();
        try {
            refresh(problems);
        } catch (RuntimeException e) {
            core.shell().note("WIDGET", "could not refresh: " + e.getClass().getSimpleName());
        }
        for (String problem : problems) core.shell().note("WIDGET", problem);
    }

    /** May be called twice. */
    @Override public void stop() {
        if (!listening) return;
        listening = false;
        try { core.events().unsubscribe(onPublished); } catch (Throwable ignored) { }
    }

    private JSONArray actions() {
        ActionList list = core.services().find(ActionList.class);
        JSONArray actions = list == null ? null : list.actions();
        return actions == null ? new JSONArray() : actions;
    }

    private void refresh(List<String> problems) {
        JSONArray actions = actions();
        sink.apply(WidgetModel.usable(actions, (String) core.settings().get(ACTIONS), problems));
        // The button widgets hold an action id each; they are redrawn with the link of
        // that action under the key in force now.
        sink.applyActions(WidgetModel.actionCache(actions, sink.read(SurfaceKeys.ACTION_IDS)));
    }

    private JSONArray slots(List<String> problems) throws Exception {
        JSONArray out = new JSONArray();
        for (JSONObject a : WidgetModel.chosen(actions(), (String) core.settings().get(ACTIONS), problems)) {
            out.put(new JSONObject().put("id", a.optString("id")).put("label", a.optString("label")));
        }
        return out;
    }
}

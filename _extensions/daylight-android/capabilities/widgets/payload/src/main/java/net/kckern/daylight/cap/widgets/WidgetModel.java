package net.kckern.daylight.cap.widgets;

import net.kckern.daylight.api.SurfaceKeys;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/** Which actions fill the widget's slots. Pure. */
final class WidgetModel {
    static final int SLOTS = SurfaceKeys.WIDGET_SLOTS;
    private static final Pattern ID = Pattern.compile("[a-z][a-z0-9-]{0,31}");

    private WidgetModel() { }

    /** What is wrong with the shape of widgets.actions, or null. Whether its ids exist is checked on refresh. */
    static String listProblem(String csv) {
        if (csv == null || csv.trim().isEmpty()) return null;
        String[] parts = csv.split(",", -1);
        if (parts.length > SLOTS) return "must list at most " + SLOTS + " action ids";
        for (String part : parts) {
            if (!part.trim().isEmpty() && !ID.matcher(part.trim()).matches()) return "must be a comma-separated list of action ids";
        }
        return null;
    }

    /**
     * @param actions objects with id, label, icon, uri (ActionList.actions())
     * @param idsCsv  the setting widgets.actions; empty means the first SLOTS actions
     * @return widget.<n>.label, .icon and .uri for every slot; empty strings clear a slot
     * @throws IllegalArgumentException at the first thing that cannot be placed
     */
    static Map<String, String> cache(JSONArray actions, String idsCsv) {
        List<String> problems = new ArrayList<>();
        Map<String, String> cache = usable(actions, idsCsv, problems);
        if (!problems.isEmpty()) throw new IllegalArgumentException(problems.get(0));
        return cache;
    }

    /** As cache(), but what cannot be placed is left out and its problem added to the list. */
    static Map<String, String> usable(JSONArray actions, String idsCsv, List<String> problems) {
        List<JSONObject> chosen = chosen(actions, idsCsv, problems);
        Map<String, String> cache = new LinkedHashMap<>();
        for (int slot = 1; slot <= SLOTS; slot++) {
            JSONObject a = slot <= chosen.size() ? chosen.get(slot - 1) : null;
            cache.put(SurfaceKeys.widget(slot, SurfaceKeys.LABEL), a == null ? "" : a.optString("label", ""));
            cache.put(SurfaceKeys.widget(slot, SurfaceKeys.ICON), a == null ? "" : a.optString("icon", ""));
            cache.put(SurfaceKeys.widget(slot, SurfaceKeys.URI), a == null ? "" : a.optString("uri", ""));
            cache.put(SurfaceKeys.widget(slot, SurfaceKeys.DIRECT), direct(a));
        }
        return cache;
    }

    /** The most actions written for the button widgets: twelve configured and twenty-four pinned fit. */
    static final int MAX_ACTIONS = 40;

    /**
     * Every action under its own id, for the one-action button widgets: action.ids (the
     * ids in order) and action.<id>.label, .icon and .uri. An id that was in the cache
     * before and is not an action any more has its fields emptied, so a button bound to
     * it reads as not set. Only the app's own links go in.
     *
     * @param previousIdsCsv action.ids as the cache holds it now
     */
    static Map<String, String> actionCache(JSONArray actions, String previousIdsCsv) {
        Map<String, String> cache = new LinkedHashMap<>();
        List<String> ids = new ArrayList<>();
        for (int i = 0; actions != null && i < actions.length() && ids.size() < MAX_ACTIONS; i++) {
            JSONObject a = actions.optJSONObject(i);
            if (a == null) continue;
            String id = a.optString("id", "");
            if (!SurfaceKeys.actionId(id) || ids.contains(id) || !SurfaceKeys.launchable(a.optString("uri", ""))) continue;
            ids.add(id);
            cache.put(SurfaceKeys.action(id, SurfaceKeys.LABEL), a.optString("label", ""));
            cache.put(SurfaceKeys.action(id, SurfaceKeys.ICON), a.optString("icon", ""));
            cache.put(SurfaceKeys.action(id, SurfaceKeys.URI), a.optString("uri", ""));
            cache.put(SurfaceKeys.action(id, SurfaceKeys.DIRECT), direct(a));
        }
        for (String raw : (previousIdsCsv == null ? "" : previousIdsCsv).split(",")) {
            String gone = raw.trim();
            if (!SurfaceKeys.actionId(gone) || ids.contains(gone)) continue;
            for (String field : new String[] { SurfaceKeys.LABEL, SurfaceKeys.ICON, SurfaceKeys.URI, SurfaceKeys.DIRECT }) {
                cache.put(SurfaceKeys.action(gone, field), "");
            }
        }
        StringBuilder csv = new StringBuilder();
        for (String id : ids) csv.append(csv.length() == 0 ? "" : ",").append(id);
        cache.put(SurfaceKeys.ACTION_IDS, csv.toString());
        return cache;
    }

    /**
     * The action's own id when it may be played with no window, else "". Only the id
     * the action already has is ever written: an entry whose direct field names content
     * or another action gets nothing, so the play service is only ever handed the id of
     * the button that was tapped.
     */
    static String direct(JSONObject a) {
        if (a == null) return "";
        String id = a.optString("id", "");
        String direct = a.optString("direct", "");
        return SurfaceKeys.actionId(id) && id.equals(direct) ? id : "";
    }

    /** The actions that fill the slots, in order, at most SLOTS. */
    static List<JSONObject> chosen(JSONArray actions, String idsCsv, List<String> problems) {
        List<JSONObject> usable = new ArrayList<>();
        for (int i = 0; actions != null && i < actions.length(); i++) {
            JSONObject a = actions.optJSONObject(i);
            if (a == null) continue;
            // The provider launches what the cache holds; only the app's own links go in.
            if (!SurfaceKeys.launchable(a.optString("uri", ""))) {
                problems.add("an action's link is not a daylight:// link; it is left off the widget");
                continue;
            }
            usable.add(a);
        }
        List<JSONObject> chosen = new ArrayList<>();
        if (idsCsv == null || idsCsv.trim().isEmpty()) {
            for (int i = 0; i < usable.size() && i < SLOTS; i++) chosen.add(usable.get(i));
            return chosen;
        }
        for (String raw : idsCsv.split(",")) {
            String id = raw.trim();
            if (id.isEmpty()) continue;
            JSONObject match = null;
            for (JSONObject a : usable) if (id.equals(a.optString("id"))) match = a;
            if (match == null) problems.add("widgets.actions names unknown action '" + (id.length() > 32 ? id.substring(0, 32) : id) + "'");
            else chosen.add(match);
        }
        if (chosen.size() > SLOTS) {
            problems.add("widgets.actions has " + chosen.size() + " entries; the widget has " + SLOTS + " slots");
            chosen = new ArrayList<>(chosen.subList(0, SLOTS));
        }
        return chosen;
    }
}

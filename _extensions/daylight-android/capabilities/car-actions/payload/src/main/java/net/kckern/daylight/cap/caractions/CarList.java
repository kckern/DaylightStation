package net.kckern.daylight.cap.caractions;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Which configured actions the car screen shows: the setting car.actions, a comma list
 * of action ids. Pure.
 *
 * Usable while driving: a household call (api:) and the "On my way" placeholder
 * (location:). Left out, each with a problem that names the action and never its
 * target: a web page (open:, bookmark:), household media (the car plays it through
 * Daylight's media app), and a text or photo input (they need the phone's keyboard or
 * camera). At most six: the template's own limit for this category is not known, so
 * the cap is ours.
 */
final class CarList {
    static final int MAX = 6;
    /** An entry the car runs through the action list. */
    static final String RUN = "run";

    private static final Pattern ID = Pattern.compile("[a-z][a-z0-9-]{0,31}");

    /** One action, as ActionList.describe gives it: {id, label, icon, kind, target}, or null. */
    interface Lookup { JSONObject describe(String id); }

    static final class Entry {
        final String id;
        final String label;
        final String icon;
        final String kind;

        Entry(String id, String label, String icon, String kind) {
            this.id = id;
            this.label = label;
            this.icon = icon;
            this.kind = kind;
        }
    }

    private CarList() { }

    /**
     * What is wrong with a value written to car.actions, or null. The shape is always
     * checked; an id that names an action the car cannot show is refused when the
     * action list knows it. An id that is no action at all is left to the status.
     */
    static String settingProblem(String value, Lookup lookup) {
        List<String> ids = ids(value);
        if (ids.size() > MAX) return "at most " + MAX + " actions";
        Set<String> seen = new HashSet<>();
        for (String id : ids) {
            if (!ID.matcher(id).matches()) return "an entry is not an action id";
            if (!seen.add(id)) return "action '" + id + "' is listed twice";
            JSONObject a = lookup == null ? null : lookup.describe(id);
            String refused = a == null ? null : refusal(a);
            if (refused != null) return "action '" + id + "' cannot be used in a car: " + refused;
        }
        return null;
    }

    /** The entries in order. Never throws: what cannot be shown is left out and its problem added. */
    static List<Entry> usable(String value, Lookup lookup, List<String> problems) {
        List<Entry> out = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (String id : ids(value)) {
            String where = "car.actions: ";
            if (!ID.matcher(id).matches()) { problems.add(where + "an entry is not an action id"); continue; }
            if (!seen.add(id)) { problems.add(where + "action '" + id + "' is listed twice"); continue; }
            JSONObject a = lookup == null ? null : lookup.describe(id);
            if (a == null) { problems.add(where + "no action '" + id + "'"); continue; }
            String refused = refusal(a);
            if (refused != null) { problems.add(where + "action '" + id + "' cannot be used in a car: " + refused); continue; }
            if (out.size() == MAX) { problems.add(where + "at most " + MAX + " actions are shown; '" + id + "' and later ones are left out"); break; }
            out.add(new Entry(id, a.optString("label", id), a.optString("icon", ""), RUN));
        }
        return out;
    }

    /** Why the car cannot show this action, or null when it can. Never names the target. */
    static String refusal(JSONObject action) {
        String kind = action.optString("kind", "");
        String target = action.optString("target", "");
        switch (kind) {
            case "api":
            case "location":
                return null;
            case "open":
            case "bookmark":
                return "it opens a web page, which is no use while driving";
            case "media":
                return "household media plays through Daylight's media app in the car";
            case "input":
                if (target.startsWith("text:")) return "a text input needs the phone's keyboard";
                if (target.startsWith("photo:")) return "a photo input needs the phone's camera";
                return "a voice input is not recorded in the car by this build";
            case "memo":
                return "a voice input is not recorded in the car by this build";
            default:
                return "the car does not know this kind of action";
        }
    }

    private static List<String> ids(String value) {
        List<String> out = new ArrayList<>();
        if (value == null) return out;
        for (String part : value.split(",")) {
            String id = part.trim();
            if (!id.isEmpty()) out.add(id);
        }
        return out;
    }
}

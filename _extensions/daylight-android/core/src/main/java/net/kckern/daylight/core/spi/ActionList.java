package net.kckern.daylight.core.spi;

import net.kckern.daylight.core.UnsupportedException;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Provided by `one-tap-actions`: the configured actions, for a capability that puts
 * them on a surface of its own (the widget, the car screen). In process only: each
 * entry's `uri` is the keyed link the surface launches, which no route returns.
 */
public interface ActionList {
    /** The event topic published after the surfaces were (re)built. */
    String PUBLISHED = "actions.published";

    /**
     * [{id, label, icon, uri, direct}] in configured order. `direct` is the action's own
     * id when the action plays household media (a surface may then start the play
     * service with that id and no window), and "" otherwise. No entry carries content.
     */
    JSONArray actions();

    /**
     * The content id a media action plays, or null for any other action or an id that
     * is not an action. The play service hands an action id to the payload, and this is
     * where the payload, and only the payload, turns it into content.
     */
    default String mediaContentId(String actionId) { return null; }

    /**
     * One action as GET /actions lists it, {id, label, icon, kind, target}, or null when
     * no action has this id. A surface of another capability decides from the kind
     * whether it can show the action (the car screen shows no web page).
     */
    default JSONObject describe(String actionId) { return null; }

    /**
     * Runs one action by its id, in process, through the same path a keyed action link
     * and POST /actions/run take. The answer is the action's link effect ({effect,
     * message?}). For a surface that is itself inside this app and has no link to
     * launch: the car screen. Throws IllegalArgumentException for an unknown id.
     */
    default JSONObject run(String actionId) throws Exception {
        throw new UnsupportedException("actions cannot be run in process by this build");
    }
}

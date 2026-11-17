package net.kckern.daylight.core.spi;

import org.json.JSONArray;

/**
 * Provided by `one-tap-actions`: the configured actions, for a capability that puts
 * them on a surface of its own (the widget). In process only: each entry's `uri` is
 * the keyed link the surface launches, which no route returns.
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
}

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

    /** [{id, label, icon, uri}] in configured order. */
    JSONArray actions();
}

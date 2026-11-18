package net.kckern.daylight.cap.onetap;

import net.kckern.daylight.api.SurfaceKeys;
import net.kckern.daylight.cap.onetap.ActionCatalog.Action;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Which actions go on which surface. Pure. */
final class SurfacePlan {
    static final int TILE_SLOTS = SurfaceKeys.TILE_SLOTS;

    interface Linker { String uri(Action action); }

    final List<Action> shortcuts;
    /** The action id of each tile slot, "" for an unassigned one. */
    final List<String> tiles;
    /** tile.<n>.label, .icon, .uri and .direct for every slot; empty strings for an unassigned slot. */
    final Map<String, String> tileCache;

    private SurfacePlan(List<Action> shortcuts, List<String> tiles, Map<String, String> tileCache) {
        this.shortcuts = shortcuts;
        this.tiles = tiles;
        this.tileCache = tileCache;
    }

    /** What is wrong with the shape of an id list setting, or null. Whether its ids exist is checked when publishing. */
    static String listProblem(String csv, int max) {
        if (csv == null || csv.trim().isEmpty()) return null;
        String[] parts = csv.split(",", -1);
        if (parts.length > max) return "must list at most " + max + " action ids";
        for (String part : parts) {
            if (!part.trim().isEmpty() && !ActionCatalog.ID.matcher(part.trim()).matches()) return "must be a comma-separated list of action ids";
        }
        return null;
    }

    /** Throws at the first thing that cannot be placed. */
    static SurfacePlan of(ActionCatalog catalog, String shortcutsCsv, String tilesCsv, int maxShortcuts, Linker linker) {
        List<String> problems = new ArrayList<>();
        SurfacePlan plan = usable(catalog, shortcutsCsv, tilesCsv, maxShortcuts, linker, problems);
        if (!problems.isEmpty()) throw new IllegalArgumentException(problems.get(0));
        return plan;
    }

    /** As of(), but what cannot be placed is left out and its problem added to the list. */
    static SurfacePlan usable(ActionCatalog catalog, String shortcutsCsv, String tilesCsv, int maxShortcuts,
                              Linker linker, List<String> problems) {
        List<Action> shortcuts = new ArrayList<>();
        if (shortcutsCsv == null || shortcutsCsv.trim().isEmpty()) {
            shortcuts.addAll(catalog.all());
        } else {
            for (String raw : shortcutsCsv.split(",")) {
                String id = raw.trim();
                if (id.isEmpty()) continue;
                Action a = catalog.find(id);
                if (a == null) problems.add("actions.shortcuts names unknown action '" + clip(id) + "'");
                else if (!shortcuts.contains(a)) shortcuts.add(a);
            }
        }
        if (shortcuts.size() > maxShortcuts) shortcuts = new ArrayList<>(shortcuts.subList(0, Math.max(maxShortcuts, 0)));

        String[] tileIds = tilesCsv == null || tilesCsv.trim().isEmpty() ? new String[0] : tilesCsv.split(",", -1);
        if (tileIds.length > TILE_SLOTS) {
            problems.add("actions.tiles has " + tileIds.length + " entries; there are " + TILE_SLOTS + " tile slots");
        }
        Map<String, String> cache = new LinkedHashMap<>();
        List<String> tiles = new ArrayList<>();
        for (int slot = 1; slot <= TILE_SLOTS; slot++) {
            String id = slot <= tileIds.length ? tileIds[slot - 1].trim() : "";
            Action a = id.isEmpty() ? null : catalog.find(id);
            if (a == null && !id.isEmpty()) problems.add("actions.tiles names unknown action '" + clip(id) + "'");
            tiles.add(a == null ? "" : a.id);
            cache.put(SurfaceKeys.tile(slot, SurfaceKeys.LABEL), a == null ? "" : a.label);
            cache.put(SurfaceKeys.tile(slot, SurfaceKeys.ICON), a == null ? "" : a.icon);
            cache.put(SurfaceKeys.tile(slot, SurfaceKeys.URI), a == null ? "" : linker.uri(a));
            // The tile may start the play service with this id and no window (DirectPlay).
            cache.put(SurfaceKeys.tile(slot, SurfaceKeys.DIRECT), a != null && a.kind == ActionCatalog.Kind.MEDIA ? a.id : "");
        }
        return new SurfacePlan(shortcuts, tiles, cache);
    }

    /** A pinned shortcut has an id of its own, apart from the launcher shortcut of the same action. */
    static final String PIN_PREFIX = "pin-";

    static String pinId(Action action) { return PIN_PREFIX + action.id; }

    /** What to do with the shortcuts the launcher holds as pinned. */
    static final class Pins {
        /** Shortcut id to the action it launches: rewritten with a link under the current key. */
        final Map<String, Action> update = new LinkedHashMap<>();
        /** Shortcut ids whose action is gone: nothing they could launch would be honoured. */
        final List<String> disable = new ArrayList<>();
        /**
         * Pinned media shortcuts the owner confirmed but the app did not record (shortcut
         * id to action id). Never disabled: rewritten under the current key so a tap
         * reaches the app, which says the shortcut was not saved.
         */
        final Map<String, String> unrecorded = new LinkedHashMap<>();
    }

    private static final java.util.regex.Pattern MEDIA_ID = java.util.regex.Pattern.compile("media-[0-9a-f]{12}");

    /** An id of the shape a pinned media action has (PinnedMedia.idFor). */
    static boolean unrecordedMediaId(String actionId) { return actionId != null && MEDIA_ID.matcher(actionId).matches(); }

    /**
     * A pinned shortcut is found by its shortcut id ("pin-<action>", or the action's own
     * id when it was pinned from the long-press menu) and given the action of that name.
     */
    static Pins pins(ActionCatalog catalog, List<String> pinnedIds) {
        Pins pins = new Pins();
        for (String id : pinnedIds) {
            String actionId = id.startsWith(PIN_PREFIX) ? id.substring(PIN_PREFIX.length()) : id;
            Action a = catalog.find(actionId);
            if (a != null) pins.update.put(id, a);
            else if (id.startsWith(PIN_PREFIX) && unrecordedMediaId(actionId)) pins.unrecorded.put(id, actionId);
            else pins.disable.add(id);
        }
        return pins;
    }

    private static String clip(String id) { return id.length() > 32 ? id.substring(0, 32) : id; }
}

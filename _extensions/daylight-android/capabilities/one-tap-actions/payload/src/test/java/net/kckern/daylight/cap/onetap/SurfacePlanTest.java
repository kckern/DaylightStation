package net.kckern.daylight.cap.onetap;

import static org.junit.Assert.*;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

public class SurfacePlanTest {
    private static final ActionCatalog CATALOG = ActionCatalog.parse(Arrays.asList(
            "memo|New memo|mic|memo:new", "media|Media|play|bookmark:media",
            "feed|Feed|open|bookmark:feed", "call|Call|open|bookmark:call", "lights|Lights off|bolt|api:/api/v1/x"));

    private static SurfacePlan plan(String shortcuts, String tiles, int max) {
        return SurfacePlan.of(CATALOG, shortcuts, tiles, max, a -> "daylight://action/" + a.id + "#k=KEY");
    }

    private static String message(String shortcuts, String tiles) {
        try { plan(shortcuts, tiles, 4); } catch (IllegalArgumentException e) { return e.getMessage(); }
        fail("expected IllegalArgumentException");
        return null;
    }

    @Test public void shortcutsFollowTheListedOrder() {
        SurfacePlan p = plan("lights, memo", "", 4);
        assertEquals(2, p.shortcuts.size());
        assertEquals("lights", p.shortcuts.get(0).id);
        assertEquals("memo", p.shortcuts.get(1).id);
    }

    @Test public void withNoListTheFirstActionsAreUsedUpToTheLauncherLimit() {
        SurfacePlan p = plan("", "", 3);
        assertEquals(3, p.shortcuts.size());
        assertEquals("memo", p.shortcuts.get(0).id);
        assertEquals("feed", p.shortcuts.get(2).id);
        assertEquals("a listed set is cut to the limit too", 2, plan("memo,media,feed", "", 2).shortcuts.size());
        assertEquals(0, plan("memo", "", 0).shortcuts.size());
    }

    @Test public void tilesAreAssignedBySlotAndEverySlotIsWritten() {
        Map<String, String> cache = plan("", "memo,,lights", 4).tileCache;
        assertEquals("New memo", cache.get("tile.1.label"));
        assertEquals("mic", cache.get("tile.1.icon"));
        assertEquals("daylight://action/memo#k=KEY", cache.get("tile.1.uri"));
        assertEquals("an unassigned slot is cleared, not left stale", "", cache.get("tile.2.uri"));
        assertEquals("Lights off", cache.get("tile.3.label"));
        assertEquals("", cache.get("tile.4.uri"));
        assertEquals(20, cache.size());
    }

    @Test public void namesAnUnknownActionOrTooManyTiles() {
        assertTrue(message("memo,nope", "").contains("actions.shortcuts names unknown action 'nope'"));
        assertTrue(message("", "nope").contains("actions.tiles names unknown action 'nope'"));
        assertTrue(message("", "memo,media,feed,call,lights").contains("actions.tiles has 5 entries; there are 4 tile slots"));
    }

    @Test public void theLenientPlanLeavesOutWhatItCannotPlaceAndReportsIt() {
        List<String> problems = new ArrayList<>();
        SurfacePlan p = SurfacePlan.usable(CATALOG, "memo,nope,feed", "nope,lights,,,memo", 4,
                a -> "daylight://action/" + a.id, problems);
        assertEquals("[memo, feed]", ids(p));
        assertEquals("", p.tileCache.get("tile.1.uri"));
        assertEquals("Lights off", p.tileCache.get("tile.2.label"));
        assertEquals(20, p.tileCache.size());
        assertEquals(3, problems.size());
    }

    @Test public void aListSettingIsCheckedForShapeWhenItIsSet() {
        assertNull(SurfacePlan.listProblem("", 4));
        assertNull(SurfacePlan.listProblem("memo, ,lights", 4));
        assertTrue(SurfacePlan.listProblem("memo,Not An Id", 4).contains("action ids"));
        assertTrue(SurfacePlan.listProblem("a,b,c,d,e", 4).contains("at most 4"));
    }

    private static String ids(SurfacePlan p) {
        List<String> out = new ArrayList<>();
        for (ActionCatalog.Action a : p.shortcuts) out.add(a.id);
        return out.toString();
    }

    // ── pinned shortcuts across a key rotation ───────────────────────────────

    @Test public void aPinnedShortcutHasItsOwnId() {
        assertEquals("pin-memo", SurfacePlan.pinId(CATALOG.find("memo")));
    }

    /**
     * The launcher keeps a pinned shortcut's intent. When the key rotates each one is
     * rewritten with a link under the new key, found by its shortcut id; one whose
     * action is gone is disabled, since nothing it could launch would be honoured.
     */
    @Test public void everyPinnedShortcutIsRewrittenForItsActionAndOneWithoutAnActionIsDisabled() {
        String known = CATALOG.all().get(0).id;
        SurfacePlan.Pins pins = SurfacePlan.pins(CATALOG, java.util.Arrays.asList("pin-" + known, known, "pin-gone", "gone", "someone-elses"));
        assertEquals(new java.util.HashSet<>(java.util.Arrays.asList("pin-" + known, known)), pins.update.keySet());
        assertEquals(known, pins.update.get("pin-" + known).id);
        assertEquals("pinned from the long-press menu, under the action's own id", known, pins.update.get(known).id);
        assertEquals(java.util.Arrays.asList("pin-gone", "gone", "someone-elses"), pins.disable);
        assertTrue(SurfacePlan.pins(CATALOG, java.util.Collections.<String>emptyList()).update.isEmpty());
    }

    /**
     * A pinned media shortcut the owner confirmed but the app did not record (the app
     * restarted while the dialog was open, a late confirmation) is left pinned: never
     * disabled, and kept under the current key so a tap reaches the app and says why.
     * Only the shape a pinned media action has (media- and twelve hex digits) is spared.
     */
    @Test public void anUnrecordedPinnedMediaShortcutIsKeptAndNotDisabled() {
        String orphan = "pin-media-0123456789ab";
        SurfacePlan.Pins pins = SurfacePlan.pins(CATALOG, java.util.Arrays.asList(orphan, "pin-media-notahash", "pin-gone"));
        assertEquals(java.util.Collections.singletonMap(orphan, "media-0123456789ab"), pins.unrecorded);
        assertFalse(pins.disable.contains(orphan));
        assertEquals(java.util.Arrays.asList("pin-media-notahash", "pin-gone"), pins.disable);
        assertTrue(SurfacePlan.unrecordedMediaId("media-0123456789ab"));
        assertFalse(SurfacePlan.unrecordedMediaId("media-0123456789aB"));
        assertFalse(SurfacePlan.unrecordedMediaId("memo"));
    }

    /** A tile whose action plays household media names that action for the play service; no other tile does. */
    @Test public void aTileOfAMediaActionIsMarkedForDirectPlay() {
        ActionCatalog withMedia = ActionCatalog.parse(Arrays.asList("memo|New memo|mic|memo:new", "radio|Radio|play|media:plex:12345"));
        SurfacePlan p = SurfacePlan.of(withMedia, "", "memo,radio", 4, a -> "daylight://action/" + a.id + "#k=KEY");
        assertEquals("", p.tileCache.get("tile.1.direct"));
        assertEquals("radio", p.tileCache.get("tile.2.direct"));
        assertEquals("", p.tileCache.get("tile.3.direct"));
        assertFalse("the content id is never in the cache", p.tileCache.values().toString().contains("12345"));
    }
}

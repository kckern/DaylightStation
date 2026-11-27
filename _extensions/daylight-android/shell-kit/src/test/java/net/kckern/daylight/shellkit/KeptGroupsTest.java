package net.kckern.daylight.shellkit;

import static org.junit.Assert.assertEquals;

import org.json.JSONObject;
import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** On this phone grouped (spec §3.11): one group row, its units under it, the rest as they are. */
public class KeptGroupsTest {
    private static JSONObject entry(String id, String title, long bytes, String group, int order, String state) throws Exception {
        JSONObject e = new JSONObject().put("contentId", id).put("title", title).put("bytes", bytes).put("state", state);
        if (group != null) {
            e.put("group", new JSONObject().put("id", group).put("title", "Shakespeare").put("kind", "author"));
            e.put("unitOrder", order);
        }
        return e;
    }

    private static List<String> keys(List<JSONObject> rows) {
        List<String> out = new ArrayList<>();
        for (JSONObject r : rows) out.add(r.optString("row") + ":" + KeptGroups.key(r));
        return out;
    }

    @Test public void aGroupIsOneBlockWithItsUnitsInKeptOrderLargestBlocksFirst() throws Exception {
        List<JSONObject> index = Arrays.asList(
                entry("plex:1", "Album", 500, null, 0, "ready"),
                entry("plex:11", "Macbeth", 300, "plex:100", 1, "downloading"),
                entry("plex:12", "Lear", 400, "plex:100", 0, "ready"),
                entry("plex:2", "Big playlist", 2000, null, 0, "ready"));
        List<JSONObject> rows = KeptGroups.rows(index);
        assertEquals(Arrays.asList("item:plex:2", "group:group:plex:100", "unit:plex:12", "unit:plex:11", "item:plex:1"), keys(rows));
        JSONObject g = rows.get(1);
        assertEquals(700, g.getLong("bytes"));
        assertEquals("2 books · under 1 MB · 1 of 2 ready", KeptGroups.line(g));
    }

    @Test public void theShortListKeepsWholeBlocksAndAFewUnits() throws Exception {
        List<JSONObject> index = new ArrayList<>();
        for (int i = 0; i < 5; i++) index.add(entry("plex:1" + i, "B" + i, 1_000_000L * (10 - i), "plex:100", i, "ready"));
        index.add(entry("plex:2", "Album", 1, null, 0, "ready"));
        index.add(entry("plex:3", "Album 2", 1, null, 0, "ready"));
        List<JSONObject> rows = KeptGroups.firstBlocks(KeptGroups.rows(index), 2, 3);
        assertEquals(5, rows.size());
        assertEquals("group", rows.get(0).getString("row"));
        assertEquals("item", rows.get(4).getString("row"));
        assertEquals("5 books · 40 MB", KeptGroups.line(KeptGroups.rows(index).get(0)));
    }
}

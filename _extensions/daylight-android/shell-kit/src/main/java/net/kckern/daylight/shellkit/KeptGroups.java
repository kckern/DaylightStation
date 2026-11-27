package net.kckern.daylight.shellkit;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * On this phone, grouped (lifecycle spec §3.11): a kept artist or author shows as one group
 * row ("Shakespeare · 12 books · 4.2 GB") with its units under it, each its own row; every
 * other kept item is a row of its own. Groups and items largest first; a group's units in
 * the order they were kept (the started book first, then the author's order; albums newest
 * first). Pure (index entries in, rows out), so the Play tab and On this phone show the same.
 */
public final class KeptGroups {
    private KeptGroups() { }

    public static final String ROW = "row", GROUP = "group", UNIT = "unit", ITEM = "item";

    /** The group an index entry is a unit of, or null. */
    public static JSONObject groupOf(JSONObject entry) {
        JSONObject g = entry == null ? null : entry.optJSONObject("group");
        return g == null || g.optString("id").isEmpty() ? null : g;
    }

    /**
     * Rows in order: {row:"group", key, group, units, ready, bytes, kind} then its units
     * ({row:"unit", ...entry}); {row:"item", ...entry} for the rest.
     */
    public static List<JSONObject> rows(List<JSONObject> index) {
        Map<String, List<JSONObject>> byGroup = new LinkedHashMap<>();
        Map<String, JSONObject> groups = new LinkedHashMap<>();
        List<Object[]> blocks = new ArrayList<>();   // {bytes, JSONObject item | String groupId}
        for (JSONObject e : index) {
            JSONObject g = groupOf(e);
            if (g == null) { blocks.add(new Object[] { e.optLong("bytes"), e }); continue; }
            String id = g.optString("id");
            if (!byGroup.containsKey(id)) {
                byGroup.put(id, new ArrayList<>());
                groups.put(id, g);
                blocks.add(new Object[] { 0L, id });
            }
            byGroup.get(id).add(e);
        }
        for (Object[] b : blocks) {
            if (!(b[1] instanceof String)) continue;
            long n = 0;
            for (JSONObject u : byGroup.get((String) b[1])) n += u.optLong("bytes");
            b[0] = n;
        }
        blocks.sort((a, b) -> Long.compare((Long) b[0], (Long) a[0]));
        List<JSONObject> out = new ArrayList<>();
        try {
            for (Object[] b : blocks) {
                if (b[1] instanceof JSONObject) {
                    out.add(new JSONObject(((JSONObject) b[1]).toString()).put(ROW, ITEM));
                    continue;
                }
                String id = (String) b[1];
                List<JSONObject> units = byGroup.get(id);
                units.sort((x, y) -> {
                    int o = Integer.compare(x.optInt("unitOrder", Integer.MAX_VALUE), y.optInt("unitOrder", Integer.MAX_VALUE));
                    return o != 0 ? o : x.optString("title").compareToIgnoreCase(y.optString("title"));
                });
                int ready = 0;
                for (JSONObject u : units) if (KeptIndex.ready(u)) ready++;
                JSONObject g = groups.get(id);
                out.add(new JSONObject().put(ROW, GROUP).put("key", "group:" + id).put("group", g).put("units", units.size())
                        .put("ready", ready).put("bytes", (Long) b[0]).put("title", g.optString("title"))
                        .put("kind", g.optString("kind")).put("art", g.optString("art", "")));
                for (JSONObject u : units) out.add(new JSONObject(u.toString()).put(ROW, UNIT));
            }
        } catch (Exception never) { /* rows built from valid JSON */ }
        return out;
    }

    /** The key a row is kept under (a group's own key; a unit or item's content id). */
    public static String key(JSONObject row) {
        return GROUP.equals(row.optString(ROW)) ? row.optString("key") : row.optString("contentId");
    }

    /** "12 books · 4.2 GB", with "3 of 12 ready" while some are not. */
    public static String line(JSONObject groupRow) {
        int n = groupRow.optInt("units"), ready = groupRow.optInt("ready");
        boolean books = "author".equals(groupRow.optString("kind"));
        String noun = n + " " + (books ? (n == 1 ? "book" : "books") : (n == 1 ? "album" : "albums"));
        String line = noun + " · " + KeptIndex.size(groupRow.optLong("bytes"));
        return ready < n ? line + " · " + ready + " of " + n + " ready" : line;
    }

    /** Rows for a short list (the Play tab): the first {@code blocks} items or groups, a group with at most {@code units} of its units. */
    public static List<JSONObject> firstBlocks(List<JSONObject> rows, int blocks, int units) {
        List<JSONObject> out = new ArrayList<>();
        int seen = 0, inGroup = 0;
        for (JSONObject r : rows) {
            String kind = r.optString(ROW);
            if (UNIT.equals(kind)) {
                if (inGroup < units) out.add(r);
                inGroup++;
                continue;
            }
            if (seen >= blocks) break;
            seen++;
            inGroup = 0;
            out.add(r);
        }
        return out;
    }
}

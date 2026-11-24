package net.kckern.daylight.shellkit;

import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.Assert.assertEquals;

public class PlaylistSearchTest {
    private static PlaylistEntry e(String id, String title) { return new PlaylistEntry(id, title, ""); }

    @Test public void rememberedComeFirstAndNoIdRepeats() {
        List<PlaylistEntry> merged = PlaylistSearch.merge(
                Arrays.asList(e("b", "Beta"), e("a", "Alpha")),
                Arrays.asList(e("a", "Alpha"), e("c", "Gamma"), e("b", "Beta")));
        assertEquals(Arrays.asList("b", "a", "c"), ids(merged));
    }

    @Test public void everyWordMustMatchInAnyOrderIgnoringCase() {
        List<PlaylistEntry> all = Arrays.asList(e("1", "103.5 The Arrow"), e("2", "107.5 The End"), e("3", "Kids Movies"));
        assertEquals(Arrays.asList("1", "2"), ids(PlaylistSearch.filter(all, "the")));
        assertEquals(Collections.singletonList("1"), ids(PlaylistSearch.filter(all, "arrow 103")));
        assertEquals(Collections.singletonList("3"), ids(PlaylistSearch.filter(all, "  KIDS  ")));
        assertEquals(Collections.emptyList(), ids(PlaylistSearch.filter(all, "nothing here")));
    }

    @Test public void anEmptyQueryKeepsEverything() {
        List<PlaylistEntry> all = Arrays.asList(e("1", "A"), e("2", "B"));
        assertEquals(Arrays.asList("1", "2"), ids(PlaylistSearch.filter(all, "")));
        assertEquals(Arrays.asList("1", "2"), ids(PlaylistSearch.filter(all, null)));
    }

    private static PlaylistEntry e(String id, String title, String source) { return new PlaylistEntry(id, title, "", source); }

    @Test public void sourcesAreDistinctInFirstSeenOrderAndFilterKeepsOne() {
        List<PlaylistEntry> all = Arrays.asList(e("1", "A", "Radio"), e("2", "B", "Lists"), e("3", "C", "Radio"), e("4", "D", ""));
        assertEquals(Arrays.asList("Radio", "Lists"), PlaylistSearch.sources(all));
        assertEquals(Arrays.asList("1", "3"), ids(PlaylistSearch.bySource(all, "Radio")));
        assertEquals(Arrays.asList("1", "2", "3", "4"), ids(PlaylistSearch.bySource(all, "")));
    }

    @Test public void sortAzIgnoresCaseAndSourceOrderIsUntouched() {
        List<PlaylistEntry> all = Arrays.asList(e("1", "banana"), e("2", "Apple"), e("3", "cherry"));
        assertEquals(Arrays.asList("2", "1", "3"), ids(PlaylistSearch.sort(all, PlaylistSearch.Sort.AZ, id -> 0)));
        assertEquals(Arrays.asList("1", "2", "3"), ids(PlaylistSearch.sort(all, PlaylistSearch.Sort.SOURCE, id -> 0)));
    }

    @Test public void recentPutsLatestFirstAndNeverUsedLastAlphabetically() {
        List<PlaylistEntry> all = Arrays.asList(e("1", "Delta"), e("2", "Alpha"), e("3", "Charlie"), e("4", "Bravo"));
        java.util.Map<String, Long> times = new java.util.HashMap<>();
        times.put("3", 500L);
        times.put("1", 900L);
        assertEquals(Arrays.asList("1", "3", "2", "4"),
                ids(PlaylistSearch.sort(all, PlaylistSearch.Sort.RECENT, id -> times.getOrDefault(id, 0L))));
    }

    @Test public void sortCyclesThroughAllThree() {
        assertEquals(PlaylistSearch.Sort.RECENT, PlaylistSearch.Sort.AZ.next());
        assertEquals(PlaylistSearch.Sort.SOURCE, PlaylistSearch.Sort.RECENT.next());
        assertEquals(PlaylistSearch.Sort.AZ, PlaylistSearch.Sort.SOURCE.next());
    }

    private static List<String> ids(List<PlaylistEntry> entries) {
        java.util.ArrayList<String> out = new java.util.ArrayList<>();
        for (PlaylistEntry entry : entries) out.add(entry.id);
        return out;
    }
}

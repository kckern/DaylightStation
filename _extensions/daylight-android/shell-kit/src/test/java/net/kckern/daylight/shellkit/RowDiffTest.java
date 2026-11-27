package net.kckern.daylight.shellkit;

import static org.junit.Assert.*;

import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.junit.Test;

public class RowDiffTest {
    private static Map<String, String> sigs(String... kv) {
        Map<String, String> m = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put(kv[i], kv[i + 1]);
        return m;
    }

    @Test public void theSameAnswerChangesNothing() {
        List<String> keys = Arrays.asList("a", "b");
        assertTrue(RowDiff.of(keys, sigs("a", "1", "b", "2"), keys, sigs("a", "1", "b", "2")).same());
    }

    @Test public void progressOnOneRowUpdatesOnlyThatRow() {
        List<String> keys = Arrays.asList("a", "b", "c");
        RowDiff d = RowDiff.of(keys, sigs("a", "1", "b", "40%", "c", "3"), keys, sigs("a", "1", "b", "41%", "c", "3"));
        assertEquals(Arrays.asList("b"), d.changed);
        assertTrue(d.added.isEmpty());
        assertTrue(d.removed.isEmpty());
        assertFalse(d.reordered);
    }

    @Test public void comeAndGoAreAddedAndRemoved() {
        RowDiff d = RowDiff.of(Arrays.asList("a", "b"), sigs("a", "1", "b", "2"),
                Arrays.asList("b", "c"), sigs("b", "2", "c", "3"));
        assertEquals(Arrays.asList("a"), d.removed);
        assertEquals(Arrays.asList("c"), d.added);
        assertTrue(d.changed.isEmpty());
        assertFalse("b keeps its place relative to the rows that stay", d.reordered);
    }

    @Test public void aMoveIsAReorder() {
        RowDiff d = RowDiff.of(Arrays.asList("a", "b"), sigs("a", "1", "b", "2"),
                Arrays.asList("b", "a"), sigs("a", "1", "b", "2"));
        assertTrue(d.reordered);
        assertFalse(d.same());
    }
}

package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;

/** "Keep all…" (spec §3.11): checks, totals, what fits, the words, and what a Remove really frees. */
public class GroupKeepRulesTest {
    private static final long MB = 1_000_000L;

    private static GroupKeepRules.Unit u(String id, long needMb, boolean finished, boolean held) {
        return new GroupKeepRules.Unit(id, id, needMb * MB, needMb * MB, 3, finished, false, held, false);
    }

    @Test public void finishedBooksStartUncheckedAndIncludeFinishedChecksThem() {
        List<GroupKeepRules.Unit> units = Arrays.asList(u("a", 100, false, false), u("b", 200, true, false), u("c", 300, false, false));
        GroupKeepRules.defaultChecks(units, false);
        assertEquals(2, GroupKeepRules.checkedCount(units));
        assertEquals(400 * MB, GroupKeepRules.checkedNeed(units));
        assertEquals(1, GroupKeepRules.finishedCount(units));
        assertEquals("Include finished (1)", GroupKeepRules.includeFinishedLabel(1));
        GroupKeepRules.includeFinished(units, true);
        assertEquals(3, GroupKeepRules.checkedCount(units));
    }

    @Test public void chooseReopensWithWhatTheGroupHolds() {
        List<GroupKeepRules.Unit> units = Arrays.asList(u("a", 100, false, true), u("b", 200, false, false));
        GroupKeepRules.defaultChecks(units, true);
        assertTrue(units.get(0).checked);
        assertFalse(units.get(1).checked);
        assertEquals("what the group already holds needs nothing", 0, GroupKeepRules.checkedNeed(units));
    }

    @Test public void pastTheCapStartsUnchecked() {
        GroupKeepRules.Unit over = new GroupKeepRules.Unit("z", "z", MB, MB, 4000, false, false, false, true);
        List<GroupKeepRules.Unit> units = Arrays.asList(u("a", 1, false, false), over);
        GroupKeepRules.defaultChecks(units, false);
        assertFalse(over.checked);
        assertEquals("Over 5000 tracks (5003): the first 1 book can be kept (3 tracks)",
                GroupKeepRules.capLine("author", 5003, 5000, 1, 3));
        assertEquals("", GroupKeepRules.capLine("author", 400, 5000, 2, 400));
    }

    @Test public void keepTheOnesThatFitGoesInOrderAndSkipsOneTooLarge() {
        List<GroupKeepRules.Unit> units = new ArrayList<>(Arrays.asList(u("a", 300, false, false), u("b", 900, false, false),
                u("c", 400, false, false), u("d", 500, false, false)));
        GroupKeepRules.defaultChecks(units, false);
        assertEquals(2, GroupKeepRules.wouldFit(units, 1000 * MB));
        assertEquals(4, GroupKeepRules.checkedCount(units));
        assertEquals(2, GroupKeepRules.keepThoseThatFit(units, 1000 * MB));
        assertTrue(units.get(0).checked);
        assertFalse(units.get(1).checked);
        assertTrue(units.get(2).checked);
        assertFalse(units.get(3).checked);
        assertEquals("Keep the 2 that fit", GroupKeepRules.fitButton("author", 2));
    }

    @Test public void theWords() {
        assertEquals("Keep 12 books · 4.2 GB", GroupKeepRules.button("author", 12, 4_200 * MB));
        assertEquals("Keep 1 album · 230 MB", GroupKeepRules.button("artist", 1, 230 * MB));
        assertEquals("4.2 GB · 9.8 GB left · on Wi-Fi", GroupKeepRules.totalLine(4_200 * MB, 9_800 * MB, true));
        assertEquals("1.2 GB more than there is room for", GroupKeepRules.overLine(1_200 * MB));
        assertEquals("12 books · 4.2 GB", GroupKeepRules.groupLine("author", 12, 4_200 * MB));
        GroupKeepRules.Unit started = new GroupKeepRules.Unit("s", "s", 230 * MB, 230 * MB, 1, false, true, false, false);
        assertEquals("230 MB · Started", GroupKeepRules.unitLine(started));
        assertEquals("200 MB · On this phone · Finished", GroupKeepRules.unitLine(u("f", 200, true, true)));
        GroupKeepRules.Unit unknown = new GroupKeepRules.Unit("w", "w", -1, 0, 1, false, false, false, false);
        assertEquals("Size when on Wi-Fi", GroupKeepRules.unitLine(unknown));
    }

    @Test public void aRemoveFreesOnlyWhatNoOtherKeepHolds() {
        Map<String, Long> bytes = new HashMap<>();
        bytes.put("t1", 100 * MB);
        bytes.put("t2", 50 * MB);
        bytes.put("t3", 20 * MB);
        // t2 is also in a kept playlist.
        assertEquals(120 * MB, GroupKeepRules.freedBytes(Arrays.asList("t1", "t2", "t3", "t1"), new HashSet<>(Arrays.asList("t2")), bytes));
        assertEquals(0, GroupKeepRules.freedBytes(Arrays.asList("t2"), new HashSet<>(Arrays.asList("t2")), bytes));
        assertEquals("120 MB is freed on this phone. Tracks other keeps hold stay.", GroupKeepRules.freedLine(120 * MB, true));
        assertEquals("Its audio stays: other keeps hold it.", GroupKeepRules.freedLine(0, true));
    }

    @Test public void aFinishedUnitGoesAfterTheGrace() {
        assertFalse(GroupKeepRules.finishedRemovalDue(0, 10, 5));
        assertFalse(GroupKeepRules.finishedRemovalDue(10, 14, 5));
        assertTrue(GroupKeepRules.finishedRemovalDue(10, 15, 5));
    }
}

package net.kckern.daylight.cap.mediaservice.shell;

import net.kckern.daylight.cap.mediaservice.shell.QueueModel.End;
import net.kckern.daylight.cap.mediaservice.shell.QueueModel.Region;
import net.kckern.daylight.cap.mediaservice.shell.QueueModel.Repeat;

import org.junit.Before;
import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Random;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

/** Every rule of the phone queue spec §2, §4 and §5, on a player that applies the same calls. */
public class QueueModelTest {
    /** The player: a flat list changed only by the calls the model makes, and a count of each kind. */
    static final class Player implements QueueModel.Sink<String> {
        final List<String> items = new ArrayList<>();
        int current = -1;
        long position = -1;
        int adds, moves, removes, replaces;
        boolean repeatOne;

        @Override public void add(int index, List<String> add) { adds++; items.addAll(index, add); if (current < 0) current = 0; else if (index <= current) current += add.size(); }
        @Override public void move(int from, int to) { moves++; String s = items.remove(from); items.add(to, s); }
        @Override public void remove(int from, int to) {
            removes++;
            for (int i = from; i < to; i++) items.remove(from);
            if (current >= to) current -= to - from;
        }
        @Override public void replace(List<String> all, int nowIndex, long pos) { replaces++; items.clear(); items.addAll(all); current = all.isEmpty() ? -1 : nowIndex; position = pos; }
        @Override public void seek(int index) { current = index; }
        @Override public void repeatOne(boolean on) { repeatOne = on; }
    }

    private Player player;
    private QueueModel<String> q;

    @Before public void setUp() {
        player = new Player();
        q = new QueueModel<>(s -> s, s -> s.startsWith("book"), new Random(7));
        q.attach(player);
    }

    private static List<String> album(String name, int n) {
        List<String> out = new ArrayList<>();
        for (int i = 1; i <= n; i++) out.add(name + i);
        return out;
    }

    /** The model and the player agree, and the player's current item is the model's now. */
    private void same() {
        assertEquals(player.items, q.items());
        assertEquals(player.current, q.nowIndex());
    }

    /** The player moves to the next item on its own, as at a track's end. */
    private void advance() {
        player.current++;
        q.onTransition(player.current);
        same();
    }

    private List<String> region(Region r) {
        List<String> out = new ArrayList<>();
        for (int i = 0; i < q.size(); i++) if (q.at(i).region == r) out.add(q.at(i).id);
        return out;
    }

    private void playAlbum(String name, int n) {
        q.replace(album(name, n), 0, -1, 0, name, "c:" + name, null, false);
        same();
    }

    // ── §2 verbs ────────────────────────────────────────────────────────────

    @Test public void tappingARowPlaysItAndTheRestOfTheListFollows() {
        q.replace(album("a", 5), 2, -1, 0, "Album", "c:a", null, false);
        same();
        assertEquals("a3", q.nowEntry().id);
        assertEquals(Arrays.asList("a4", "a5"), region(Region.SOURCE));
        assertEquals("Album", q.label());
    }

    @Test public void tappingTrackOneAndPressingPlayBuildTheSameQueue() {
        q.replace(album("a", 4), 0, -1, 0, "A", "c:a", null, false);
        List<String> tapped = q.items();
        setUp();
        playAlbum("a", 4);
        assertEquals(tapped, q.items());
    }

    @Test public void playNextTapsPlayInTheOrderTappedThenTheAlbumContinues() {
        playAlbum("a", 4);
        q.add(Arrays.asList("A"), true, "");
        q.add(Arrays.asList("B"), true, "");
        q.add(Arrays.asList("C"), true, "");
        same();
        assertEquals(Arrays.asList("a1", "A", "B", "C", "a2", "a3", "a4"), q.items());
        assertEquals(0, player.replaces - 1);   // the adds never replaced the list
    }

    @Test public void theNextBlockResetsOnceAPlayNextItemHasPlayed() {
        playAlbum("a", 3);
        q.add(Arrays.asList("A"), true, "");
        q.add(Arrays.asList("B"), true, "");
        advance();                               // A plays
        q.add(Arrays.asList("D"), true, "");
        same();
        assertEquals(Arrays.asList("a1", "A", "D", "B", "a2", "a3"), q.items());
    }

    /** Every item at most once across Now playing and Queued by you (2026-11-27 real phone: "Spindrift" twice). */
    private void nowNeverQueued() {
        List<String> queued = region(Region.QUEUED);
        assertFalse("now playing " + q.nowEntry().id + " is also queued " + queued, queued.contains(q.nowEntry().id));
        List<QueueRows.Row> rows = QueueRows.build(q, true, java.util.Collections.emptySet());
        int nowRows = 0;
        for (QueueRows.Row r : rows) if (r.kind == QueueRows.Kind.ITEM && r.index == q.nowIndex()) nowRows++;
        assertEquals(1, nowRows);
    }

    @Test public void threePlayNextItemsPlayedThroughEachLeaveTheQueuedRegion() {
        playAlbum("a", 4);
        q.add(Arrays.asList("A"), true, "");
        q.add(Arrays.asList("B"), true, "");
        q.add(Arrays.asList("C"), true, "");
        assertEquals(Arrays.asList("A", "B", "C"), region(Region.QUEUED));
        advance();
        assertEquals("A", q.nowEntry().id);
        assertEquals(Arrays.asList("B", "C"), region(Region.QUEUED));
        nowNeverQueued();
        advance();
        assertEquals("B", q.nowEntry().id);
        assertEquals(Arrays.asList("C"), region(Region.QUEUED));
        nowNeverQueued();
        advance();
        assertEquals("C", q.nowEntry().id);
        assertTrue(region(Region.QUEUED).isEmpty());
        nowNeverQueued();
        advance();
        assertEquals("a2", q.nowEntry().id);
        assertEquals(Arrays.asList("a1", "A", "B", "C"), region(Region.HISTORY));
        assertEquals(Arrays.asList("a3", "a4"), region(Region.SOURCE));
    }

    @Test public void tappingAQueuedTrackInItsAlbumPlaysItOnceAndUndoPutsTheRowBack() {
        // The real phone: Far Cry playing, Play next on Spindrift and The Larger Bowl, then
        // Spindrift tapped in the album: it played and also stayed first in Queued by you.
        playAlbum("a", 6);
        q.add(Arrays.asList("a5"), true, "");
        q.add(Arrays.asList("a4"), true, "");
        QueueModel.Undo undo = q.replace(album("a", 6), 4, -1, 30_000, "a", "c:a", null, false);
        same();
        assertEquals("a5", q.nowEntry().id);
        assertEquals(Arrays.asList("a4"), region(Region.QUEUED));
        assertEquals(Arrays.asList("a6"), region(Region.SOURCE));
        nowNeverQueued();
        undo.undo();
        same();
        assertEquals("a1", q.nowEntry().id);
        assertEquals(Arrays.asList("a5", "a4"), region(Region.QUEUED));
    }

    @Test public void addToQueueGoesAfterPlayNextAndBeforeTheSource() {
        q.replace(album("p", 900), 0, -1, 0, "Big playlist", "c:p", null, false);
        q.add(Arrays.asList("N"), true, "");
        QueueModel.Added added = q.add(Arrays.asList("E"), false, "");
        same();
        assertEquals(Arrays.asList("p1", "N", "E", "p2"), q.items().subList(0, 4));
        assertEquals(2, added.position);
    }

    @Test public void repeatedAddsKeepTheirOrderAtTheEndOfYourRegion() {
        playAlbum("a", 3);
        assertEquals(1, q.add(Arrays.asList("X"), false, "").position);
        assertEquals(2, q.add(Arrays.asList("Y"), false, "").position);
        assertEquals(Arrays.asList("X", "Y"), region(Region.QUEUED));
    }

    @Test public void aContainerIsAddedInOrderAsOneGroup() {
        playAlbum("a", 2);
        q.add(album("s", 3), false, "Snakes & Arrows");
        same();
        assertEquals(Arrays.asList("s1", "s2", "s3"), region(Region.QUEUED));
        long group = q.at(1).group;
        assertTrue(group > 0);
        assertEquals(group, q.at(3).group);
        assertEquals(0, q.at(4).group);
        assertEquals("Snakes & Arrows", q.at(3).groupLabel);
    }

    @Test public void addingToAnEmptyQueueStartsWithIt() {
        QueueModel.Added a = q.add(Arrays.asList("X", "Y"), false, "");
        same();
        assertTrue(a.started);
        assertEquals("X", q.nowEntry().id);
    }

    @Test public void aNewSourceKeepsYourQueuedAndUndoPutsTheOldOneBackAtItsPlace() {
        playAlbum("a", 5);
        advance();                                // a2 now
        q.add(Arrays.asList("Q1", "Q2"), false, "");
        q.add(Arrays.asList("Q3"), false, "");
        QueueModel.Undo undo = q.replace(album("b", 3), 0, -1, 61_000, "B", "c:b", null, false);
        same();
        assertEquals("b1", q.nowEntry().id);
        assertEquals(Arrays.asList("Q1", "Q2", "Q3"), region(Region.QUEUED));
        assertEquals(Arrays.asList("b2", "b3"), region(Region.SOURCE));
        assertEquals(Arrays.asList("a1", "a2"), region(Region.HISTORY));
        assertNotNull(undo);
        undo.undo();
        same();
        assertEquals("a2", q.nowEntry().id);
        assertEquals(61_000, player.position);
        assertEquals(Arrays.asList("a3", "a4", "a5"), region(Region.SOURCE));
        assertEquals(Arrays.asList("Q1", "Q2", "Q3"), region(Region.QUEUED));
        assertEquals("a", q.label());
    }

    @Test public void aBookStartingWhileMusicIsQueuedPlaysToItsEndBeforeTheQueue() {
        playAlbum("a", 2);
        q.add(Arrays.asList("Q1"), false, "");
        q.replace(Arrays.asList("book1", "book2", "book3"), 0, -1, 0, "Book", "c:book", null, false);
        same();
        assertEquals(Arrays.asList("book1", "book2", "book3", "Q1"),
                q.items().subList(q.nowIndex(), q.size()));
        int lastPart = q.nowIndex() + 2;
        assertTrue(q.pausesAt(lastPart, lastPart + 1, End.STOP));
        assertFalse(q.pausesAt(lastPart, lastPart + 1, End.KEEP_PLAYING));
        assertFalse(q.pausesAt(q.nowIndex(), q.nowIndex() + 1, End.STOP));
    }

    @Test public void theFirstTapsListArrivesAroundThePlayingTrack() {
        q.replace(Arrays.asList("a3"), 0, -1, 0, "A", "c:a", null, false);
        q.add(Arrays.asList("Q"), false, "");
        assertTrue(q.spliceSource(album("a", 5), 2));
        same();
        assertEquals(Arrays.asList("a3", "Q", "a4", "a5"), q.items());
        assertFalse(q.spliceSource(album("a", 5), 2));   // only once
    }

    // ── §4 the queue screen ────────────────────────────────────────────────

    @Test public void removeAndUndoPutsTheRowBackInItsPlace() {
        playAlbum("a", 3);
        q.add(Arrays.asList("X", "Y"), false, "");
        q.add(Arrays.asList("Z"), false, "");
        QueueModel.Undo undo = q.remove(2);
        same();
        assertEquals(Arrays.asList("X", "Z"), region(Region.QUEUED));
        undo.undo();
        same();
        assertEquals(Arrays.asList("X", "Y", "Z"), region(Region.QUEUED));
        assertNull(q.remove(q.nowIndex()));      // never the playing row
    }

    @Test public void editsAreSmallCallsNeverANewList() {
        playAlbum("a", 6);
        int replaced = player.replaces;
        q.add(Arrays.asList("X"), true, "");
        q.move(3, 5, null);
        q.remove(4);
        q.setShuffle(true);
        q.setShuffle(false);
        q.clearQueued();
        same();
        assertEquals(replaced, player.replaces);
    }

    @Test public void dragWithinARegionAndASourceItemDroppedInYoursBecomesYours() {
        playAlbum("a", 4);
        q.add(Arrays.asList("X", "Y"), false, "");
        same();
        // a1 | X Y | a2 a3 a4 ; drag a3 (index 4) to index 1 in Queued by you
        assertTrue(q.move(4, 1, Region.QUEUED));
        same();
        assertEquals(Arrays.asList("a3", "X", "Y"), region(Region.QUEUED));
        assertEquals(Arrays.asList("a2", "a4"), region(Region.SOURCE));
        // reorder within the source
        assertTrue(q.move(5, 4, Region.SOURCE));
        same();
        assertEquals(Arrays.asList("a4", "a2"), region(Region.SOURCE));
        // your item dragged into the source leaves your region
        assertTrue(q.move(1, 3, Region.SOURCE));
        same();
        assertEquals(Arrays.asList("X", "Y"), region(Region.QUEUED));
        assertEquals(3, region(Region.SOURCE).size());
    }

    @Test public void historyRowsAndTheNowRowCannotBeDragged() {
        playAlbum("a", 4);
        advance();
        assertFalse(q.move(0, 3, null));
        assertFalse(q.move(1, 3, null));
    }

    @Test public void clearQueuedTakesOnlyYourRegionAndUndoes() {
        playAlbum("a", 3);
        q.add(Arrays.asList("X", "Y"), false, "");
        QueueModel.Undo undo = q.clearQueued();
        same();
        assertEquals(0, q.count(Region.QUEUED));
        assertEquals(2, q.count(Region.SOURCE));
        undo.undo();
        same();
        assertEquals(Arrays.asList("X", "Y"), region(Region.QUEUED));
    }

    @Test public void aSnapshotBringsBackTheWholeQueueAfterClearAll() {
        q.replace(album("a", 5), 2, -1, 0, "Album", "c:a", null, false);
        q.add(Arrays.asList("X", "Y"), false, "");
        List<String> items = new ArrayList<>(q.items());
        int now = q.nowIndex();
        assertEquals("a3", q.nowEntry().id);
        List<String> history = region(Region.HISTORY), queued = region(Region.QUEUED), source = region(Region.SOURCE);
        QueueModel.QueueSnapshot<String> snap = q.queueSnapshot();
        player.items.clear();
        q.clearAll();
        assertEquals(0, q.size());
        assertTrue(q.restoreQueueSnapshot(snap, 41_000));
        assertEquals(items, q.items());
        assertEquals(now, q.nowIndex());
        assertEquals(items, player.items);
        assertEquals(now, player.current);
        assertEquals(41_000, player.position);
        assertEquals(history, region(Region.HISTORY));
        assertEquals(queued, region(Region.QUEUED));
        assertEquals(source, region(Region.SOURCE));
        assertEquals("Album", q.label());
        assertEquals("c:a", q.sourceId());
    }

    @Test public void aSnapshotKeepsShuffleRepeatAndTheSourceOrder() {
        playAlbum("a", 4);
        q.setRepeat(Repeat.ALL);
        List<String> all = new ArrayList<>(q.sourceAll());
        QueueModel.QueueSnapshot<String> snap = q.queueSnapshot();
        q.clearAll();
        assertTrue(q.restoreQueueSnapshot(snap, 0));
        assertEquals(Repeat.ALL, q.repeat());
        assertEquals(all, q.sourceAll());
    }

    @Test public void aSnapshotDoesNotRestoreOverANewQueue() {
        playAlbum("a", 3);
        QueueModel.QueueSnapshot<String> snap = q.queueSnapshot();
        q.clearAll();
        playAlbum("b", 2);
        assertFalse(q.restoreQueueSnapshot(snap, 0));
        assertEquals(2, q.size());
    }

    @Test public void clearAllButNowPlayingKeepsTheItemAndBlocksRadio() {
        playAlbum("a", 3);
        q.add(Arrays.asList("X"), false, "");
        QueueModel.Undo undo = q.clearUpcoming();
        same();
        assertEquals(1, q.size());
        assertTrue(q.radioBlocked());
        assertFalse(q.wantsRadio(End.KEEP_PLAYING));
        undo.undo();
        same();
        assertEquals(4, q.size());
    }

    @Test public void tappingAPastItemPlaysItAloneAndTheQueueAfterIsUnchanged() {
        playAlbum("a", 8);
        for (int i = 0; i < 5; i++) advance();   // a6 now, a1..a5 history
        List<String> after = new ArrayList<>(q.items().subList(q.nowIndex() + 1, q.size()));
        assertTrue(q.playAgain(0));
        q.onTransition(player.current);
        same();
        assertEquals("a1", q.nowEntry().id);
        assertEquals(after, q.items().subList(q.nowIndex() + 1, q.size()));
    }

    @Test public void historyIsCappedAtAHundred() {
        q.replace(album("p", 130), 0, -1, 0, "P", "c:p", null, false);
        for (int i = 0; i < 120; i++) advance();
        assertEquals(QueueModel.HISTORY_CAP, q.historyCount());
        same();
    }

    @Test public void previousGoesBackAndTheRowsReturnToTheirRegions() {
        playAlbum("a", 4);
        q.add(Arrays.asList("X"), false, "");
        advance(); // X
        advance(); // a2
        player.current = q.nowIndex() - 1;
        q.onTransition(player.current);
        same();
        assertEquals("X", q.nowEntry().id);
        assertEquals(Arrays.asList("a2", "a3", "a4"), region(Region.SOURCE));
    }

    // ── §5 shuffle and repeat ──────────────────────────────────────────────

    @Test public void shuffleNeverTouchesYourQueuedAndOffRestoresTheOrderFromNow() {
        playAlbum("a", 10);
        q.add(Arrays.asList("X", "Y"), false, "");
        assertTrue(q.setShuffle(true));
        same();
        assertEquals(Arrays.asList("a1", "X", "Y"), q.items().subList(0, 3));
        assertEquals(9, region(Region.SOURCE).size());
        assertFalse(album("a", 10).subList(1, 10).equals(region(Region.SOURCE)));
        advance(); advance(); advance(); // X, Y, then a shuffled source item
        String playing = q.nowEntry().id;
        int n = Integer.parseInt(playing.substring(1));
        assertTrue(q.setShuffle(false));
        same();
        List<String> want = new ArrayList<>();
        for (int i = n + 1; i <= 10; i++) want.add("a" + i);
        assertEquals(want, region(Region.SOURCE));
    }

    @Test public void shuffleStaysAvailableAfterYouAddAndAddsAreNotShuffled() {
        playAlbum("a", 5);
        q.add(Arrays.asList("X"), false, "");
        assertTrue(q.setShuffle(true));
        q.add(Arrays.asList("Y"), false, "");
        same();
        assertEquals(Arrays.asList("X", "Y"), region(Region.QUEUED));
        assertEquals(q.start(Region.QUEUED) + 2, q.start(Region.SOURCE));
    }

    @Test public void repeatAllRepeatsTheSourceButYourQueuedPlayOnce() {
        playAlbum("a", 2);
        q.add(Arrays.asList("X"), false, "");
        q.setRepeat(Repeat.ALL);
        advance(); // X
        advance(); // a2
        assertTrue(q.wantsAnotherPass(End.STOP));
        q.appendPass();
        same();
        assertEquals(Arrays.asList("a1", "a2"), region(Region.SOURCE));
        assertEquals(0, q.count(Region.QUEUED));
    }

    @Test public void repeatOneIsThePlayersAndAManualSkipTurnsItBack() {
        playAlbum("a", 3);
        q.setRepeat(Repeat.ALL);
        q.setRepeat(Repeat.ONE);
        assertTrue(player.repeatOne);
        assertTrue(q.manualSkip());
        assertEquals(Repeat.ALL, q.repeat());
        assertFalse(player.repeatOne);
        assertFalse(q.manualSkip());
    }

    @Test public void aBookHasNoShuffleOrRepeat() {
        q.replace(Arrays.asList("book1", "book2"), 0, -1, 0, "Book", "c:book", null, false);
        assertTrue(q.sourceLong());
        assertFalse(q.setShuffle(true));
        assertFalse(q.setRepeat(Repeat.ALL));
        assertEquals("spoken", q.kind());
    }

    @Test public void aBookStartingTurnsRepeatOff() {
        playAlbum("a", 2);
        q.setRepeat(Repeat.ONE);
        q.replace(Arrays.asList("book1"), 0, -1, 0, "Book", "c:book", null, false);
        assertEquals(Repeat.OFF, q.repeat());
        assertFalse(player.repeatOne);
    }

    // ── §6 the end ─────────────────────────────────────────────────────────

    @Test public void keepPlayingRadioGoesBehindYourPicks() {
        playAlbum("a", 1);
        assertTrue(q.wantsRadio(End.KEEP_PLAYING));
        assertFalse(q.wantsRadio(End.STOP));
        q.appendRadio(Arrays.asList("r1", "r2"));
        q.add(Arrays.asList("X"), false, "");
        same();
        assertEquals(Arrays.asList("a1", "X", "r1", "r2"), q.items());
        assertEquals(Arrays.asList("r1", "r2"), region(Region.RADIO));
    }

    @Test public void aNewSourceDropsRadio() {
        playAlbum("a", 1);
        q.appendRadio(Arrays.asList("r1"));
        q.replace(Arrays.asList("book1"), 0, -1, 0, "Book", "c:book", null, false);
        assertEquals(0, q.count(Region.RADIO));
    }

    @Test public void theEndCardsDefaultsAndMemory() {
        assertEquals(End.STOP, QueueModel.endFor("spoken", null, true));
        assertEquals(End.STOP, QueueModel.endFor("music", null, false));
        assertEquals(End.KEEP_PLAYING, QueueModel.endFor("music", null, true));
        assertEquals(End.REPEAT, QueueModel.endFor("music", "REPEAT", false));
        assertEquals(End.STOP, QueueModel.endFor("spoken", "REPEAT", false));
        assertEquals(End.KEEP_PLAYING, QueueModel.endFor("spoken", "KEEP_PLAYING", false));
    }

    @Test public void theEndCardsRepeatQueuesTheSourceAgainAtTheLastItem() {
        playAlbum("a", 2);
        assertFalse(q.wantsAnotherPass(End.REPEAT));
        advance();
        assertTrue(q.wantsAnotherPass(End.REPEAT));
    }

    // ── §7 persistence ─────────────────────────────────────────────────────

    @Test public void aRestoredQueueHasItsRegionsAndPlace() {
        playAlbum("a", 3);
        q.add(Arrays.asList("X"), false, "");
        advance();
        List<QueueModel.Entry<String>> saved = new ArrayList<>();
        for (int i = 0; i < q.size(); i++) {
            QueueModel.Entry<String> e = q.at(i);
            saved.add(q.savedEntry(e.uid, e.item, e.region, e.was, e.next, e.order, e.group, e.groupLabel));
        }
        Player fresh = new Player();
        QueueModel<String> back = new QueueModel<>(s -> s, s -> s.startsWith("book"), new Random(1));
        back.attach(fresh);
        back.restore(saved, q.nowIndex(), 42_000, "a", "c:a", false, false, Repeat.ALL, album("a", 3));
        assertEquals(q.items(), fresh.items);
        assertEquals(1, fresh.current);
        assertEquals(42_000, fresh.position);
        assertEquals(Repeat.ALL, back.repeat());
        assertEquals("X", back.nowEntry().id);
        assertEquals(Arrays.asList("a2", "a3"), backRegion(back, Region.SOURCE));
        // a new add after restore keeps unique ids
        back.add(Arrays.asList("Y"), false, "");
        java.util.Set<Long> ids = new java.util.HashSet<>();
        for (int i = 0; i < back.size(); i++) assertTrue(ids.add(back.at(i).uid));
    }

    private static List<String> backRegion(QueueModel<String> m, Region r) {
        List<String> out = new ArrayList<>();
        for (int i = 0; i < m.size(); i++) if (m.at(i).region == r) out.add(m.at(i).id);
        return out;
    }

    @Test public void aListChangedBehindTheModelIsRebuilt() {
        q.resync(album("a", 4), 1);
        assertEquals(1, q.historyCount());
        assertEquals(2, q.count(Region.SOURCE));
    }
}

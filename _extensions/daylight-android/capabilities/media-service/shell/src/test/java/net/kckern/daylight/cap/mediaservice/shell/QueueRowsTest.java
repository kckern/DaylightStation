package net.kckern.daylight.cap.mediaservice.shell;

import net.kckern.daylight.cap.mediaservice.shell.QueueModel.Region;
import net.kckern.daylight.cap.mediaservice.shell.QueueRows.Kind;
import net.kckern.daylight.cap.mediaservice.shell.QueueRows.Row;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Random;
import java.util.Set;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

/** The queue screen's sections (spec §4). */
public class QueueRowsTest {
    private final QueueModelTest.Player player = new QueueModelTest.Player();
    private final QueueModel<String> q = new QueueModel<>(s -> s, s -> s.startsWith("book"), new Random(1));
    { q.attach(player); }

    private static List<String> album(String n, int count) {
        List<String> out = new ArrayList<>();
        for (int i = 1; i <= count; i++) out.add(n + i);
        return out;
    }

    private List<String> headers(List<Row> rows) {
        List<String> out = new ArrayList<>();
        for (Row r : rows) if (r.kind == Kind.HEADER) out.add(r.text);
        return out;
    }

    @Test public void sectionsInPlayOrderWithHistoryCollapsed() {
        q.replace(album("a", 4), 0, -1, 0, "Snakes & Arrows", "c:a", null, false);
        q.add(Arrays.asList("X"), false, "");
        player.current = 1; q.onTransition(1);
        player.current = 2; q.onTransition(2);
        List<Row> rows = QueueRows.build(q, false, Collections.emptySet());
        assertEquals(Arrays.asList("History · 2", "Now playing", "Next from Snakes & Arrows"), headers(rows));
        assertEquals(Kind.END, rows.get(rows.size() - 1).kind);
        for (Row r : rows) assertTrue(r.region != Region.HISTORY || r.kind == Kind.HEADER);
        List<Row> open = QueueRows.build(q, true, Collections.emptySet());
        assertEquals(rows.size() + 2, open.size());
    }

    @Test public void queuedByYouShowsOnlyWhenNotEmptyAndAGroupIsOneRowUntilOpened() {
        q.replace(album("a", 3), 0, -1, 0, "A", "c:a", null, false);
        assertEquals(Arrays.asList("Now playing", "Next from A"), headers(QueueRows.build(q, false, Collections.emptySet())));
        q.add(album("s", 13), false, "Snakes & Arrows");
        List<Row> rows = QueueRows.build(q, false, Collections.emptySet());
        assertEquals(Arrays.asList("Now playing", "Queued by you", "Next from A"), headers(rows));
        Row group = null;
        for (Row r : rows) if (r.kind == Kind.GROUP) group = r;
        assertEquals("Snakes & Arrows · 13 tracks", group.text);
        Set<Long> opened = new HashSet<>(Collections.singletonList(group.group));
        int items = 0;
        for (Row r : QueueRows.build(q, false, opened)) if (r.kind == Kind.ITEM && r.region == Region.QUEUED) items++;
        assertEquals(13, items);
    }

    @Test public void aBookIsOneRowAndYourQueuedFollowIt() {
        q.add(Arrays.asList("m1"), false, "");
        q.add(Arrays.asList("m2"), false, "");
        q.replace(Arrays.asList("book1", "book2", "book3"), 0, -1, 0, "Consolation", "c:book", null, false);
        List<Row> rows = QueueRows.build(q, false, Collections.emptySet());
        int books = 0;
        for (Row r : rows) if (r.kind == Kind.BOOK) { books++; assertEquals(3, r.count); }
        assertEquals(1, books);
        assertEquals(Arrays.asList("History · 1", "Now playing", "Queued by you"), headers(rows));
    }

    @Test public void words() {
        assertEquals("Plays next", QueueRows.added(true, 1, 1, false));
        assertEquals("Added to the queue · 3rd", QueueRows.added(false, 3, 1, false));
        assertEquals("Added to the queue · 11th", QueueRows.added(false, 11, 1, false));
        assertEquals("Playing Snakes & Arrows · your 4 queued stay", QueueRows.playing("Snakes & Arrows", 4));
        assertEquals("Playing Snakes & Arrows", QueueRows.playing("Snakes & Arrows", 0));
        assertEquals("4 h 48 min left", QueueRows.left((4 * 60 + 48) * 60_000L));
        java.util.Calendar c = java.util.Calendar.getInstance();
        c.set(2026, java.util.Calendar.NOVEMBER, 26);
        assertEquals("Queue 2026-11-26", QueueRows.playlistName(c));
    }
}

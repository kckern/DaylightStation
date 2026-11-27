package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.*;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class ChaptersTest {
    private static JSONObject reply(long... edges) throws Exception {
        JSONArray list = new JSONArray();
        for (int i = 0; i + 1 < edges.length; i++) {
            list.put(new JSONObject().put("startMs", edges[i]).put("endMs", edges[i + 1]).put("title", "Chapter " + (i + 1)));
        }
        return new JSONObject().put("chapters", new JSONObject().put("chapters", list).put("durationMs", edges[edges.length - 1]));
    }

    @Test public void theLineSaysWhichChapterAndHowLongIsLeft() throws Exception {
        Chapters c = Chapters.parse(reply(0, 600_000, 1_200_000, 1_800_000), 1_800_000);
        assertEquals(3, c.count());
        assertEquals("Chapter 2 of 3 · 9 min left in chapter", c.line(660_000, 1f));
        assertEquals("Chapter 2 of 3 · 6 min left in chapter", c.line(660_000, 1.5f));
        assertEquals("Chapter 3 of 3 · under a minute left in chapter", c.line(1_770_000, 1f));
        assertEquals("Chapter 2 of 3", c.subtitle(660_000));
    }

    @Test public void aNamedChapterShowsItsName() throws Exception {
        JSONObject r = reply(0, 600_000, 1_200_000);
        r.getJSONObject("chapters").getJSONArray("chapters").getJSONObject(1).put("title", "The Return");
        Chapters c = Chapters.parse(r, 0);
        assertEquals("2/2 · The Return · 3 min left", c.line(1_020_000, 1f));
        assertEquals("Chapter 2 of 2 · The Return", c.subtitle(1_020_000));
        assertEquals("", c.nameOf(0));
    }

    @Test public void nextAndPreviousGoByChapter() throws Exception {
        Chapters c = Chapters.parse(reply(0, 600_000, 1_200_000, 1_800_000), 1_800_000);
        assertEquals(1_200_000, c.nextStart(700_000));
        assertEquals(-1, c.nextStart(1_300_000));
        assertEquals(600_000, c.previousTarget(700_000));     // well into chapter 2: its start
        assertEquals(0, c.previousTarget(601_000));           // just started: the one before
        assertEquals(0, c.previousTarget(1_000));              // the first: its start
        assertEquals(1_200_000, c.endAt(700_000));
    }

    @Test public void marksSitAtEachChapterStartAfterTheFirst() throws Exception {
        float[] m = Chapters.parse(reply(0, 500, 1000), 1000).marks(1000);
        assertArrayEquals(new float[] { 0.5f }, m, 0.0001f);
    }

    @Test public void aListThatDoesNotFitTheFileIsNoList() throws Exception {
        assertTrue(Chapters.parse(reply(0, 600_000, 1_200_000), 1_300_000).isEmpty()); // 100 s short
        assertFalse(Chapters.parse(reply(0, 600_000, 1_200_000), 1_201_500).isEmpty()); // within 2 s
        assertTrue(Chapters.parse(reply(0, 600_000), 0).isEmpty());                       // one chapter
        assertTrue(Chapters.parse(new JSONObject(), 0).isEmpty());
        assertTrue(Chapters.parse(null, 0).isEmpty());
    }

    /** The notification leads with the chapter, then the author; anything else is left alone. */
    @org.junit.Test public void notificationLineLeadsWithTheChapter() {
        org.junit.Assert.assertEquals("Chapter 4 of 12 · The Return · Boethius",
                String.valueOf(Chapters.notificationLine("Chapter 4 of 12 · The Return", "Boethius")));
        org.junit.Assert.assertEquals("Chapter 1 of 3", String.valueOf(Chapters.notificationLine("Chapter 1 of 3", null)));
        org.junit.Assert.assertNull(Chapters.notificationLine("Some album", "Artist"));
        org.junit.Assert.assertNull(Chapters.notificationLine(null, "Artist"));
    }
}

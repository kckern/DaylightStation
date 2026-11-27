package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.*;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class RowLineTest {
    private static JSONObject row() throws Exception { return new JSONObject().put("subtitle", "Boethius"); }

    /** Under an author: never the author's name again. */
    @Test public void underAnAuthorTheYearAndProgress() throws Exception {
        JSONObject book = new JSONObject().put("seconds", 34_800).put("playedSec", 27_000).put("started", true);
        assertEquals("1998 · 2 h 10 min left", RowLine.of("author", row().put("year", "1998"), "", book));
        assertEquals("1998", RowLine.of("author", row().put("year", "1998"), "", new JSONObject().put("seconds", 100)));
        assertEquals("9 h 40 min", RowLine.of("author", row(), "", new JSONObject().put("seconds", 34_800)));
        assertEquals("524 · Finished", RowLine.of("author", row().put("year", "524"), "",
                new JSONObject().put("seconds", 100).put("started", true).put("finished", true)));
        assertFalse(RowLine.of("author", row().put("year", "1998"), "", null).contains("Boethius"));
    }

    @Test public void underAnArtistTheYearAndTracks() throws Exception {
        assertEquals("2007 · 13 tracks", RowLine.of("artist", row().put("year", "2007").put("trackCount", 13), "", null));
    }

    /** On an album: the length, and the artist only when it is not the album's. */
    @Test public void onAnAlbumTheLengthAndAGuestArtist() throws Exception {
        JSONObject track = new JSONObject().put("artist", "Radiohead").put("durationSec", 225);
        assertEquals("3:45", RowLine.of("album", track, "Radiohead", null));
        assertEquals("3:45 · Björk", RowLine.of("album", new JSONObject().put("artist", "Björk").put("durationSec", 225), "Radiohead", null));
    }

    @Test public void searchKeepsTheByLine() throws Exception {
        assertEquals("Boethius", RowLine.of("", row(), "", null));
        assertEquals("Boethius", RowLine.of("library-books", row(), "", null));
    }

    @Test public void theFactsLine() throws Exception {
        JSONObject author = new JSONObject().put("countries", new JSONArray().put("United Kingdom")).put("children", 12).put("totalSec", 96 * 3600);
        assertEquals("United Kingdom · 12\u00A0books · 96\u00A0h", RowLine.facts("author", author, 0));
        JSONObject artist = new JSONObject().put("countries", new JSONArray().put("Iceland")).put("styles", new JSONArray().put("Art Pop"));
        assertEquals("Iceland · Art Pop · 9\u00A0albums", RowLine.facts("artist", artist, 9));
        assertEquals("1\u00A0book", RowLine.facts("author", new JSONObject().put("children", 1), 0));
    }

    /** One source for the count: nothing before home's answer, never the rows (they said 36 where home said 29). */
    @Test public void theFactsCountWaitsForHomesAnswer() throws Exception {
        assertEquals("", RowLine.facts("author", null, 36));
        assertEquals("", RowLine.facts("artist", null, 9));
        assertEquals("United Kingdom · 36\u00A0books", RowLine.facts("author",
                new JSONObject().put("countries", new JSONArray().put("United Kingdom")).put("children", 36), 29));
        // An artist home gave no count for: the rows, once home answered.
        assertEquals("9\u00A0albums", RowLine.facts("artist", new JSONObject(), 9));
    }

    /** An album's header: "Rush · 2007" (2026-11-27 it said nothing under "Snakes & Arrows"). */
    @Test public void anAlbumsByLineIsItsArtistAndYear() throws Exception {
        assertEquals("Rush · 2007", RowLine.albumBy("", new JSONObject().put("byline", "Rush").put("year", 2007)));
        assertEquals("Rush", RowLine.albumBy("Rush", null));
        assertEquals("2007", RowLine.albumBy("", new JSONObject().put("year", 2007)));
        assertEquals("Rush · 2007", RowLine.albumBy("Rush", new JSONObject().put("year", 2007)));
        assertEquals("", RowLine.albumBy(null, null));
    }

    /** A book's parts: one format, minutes rounded, never "8:47". */
    @Test public void aBookPartsLengthIsAlwaysMinutes() throws Exception {
        assertEquals("9 min", RowLine.of("book", new JSONObject().put("durationSec", 527), "", null));
        assertEquals("58 min", RowLine.of("book", new JSONObject().put("durationSec", 3480), "", null));
        assertEquals("1 h 12 min", RowLine.of("books", new JSONObject().put("durationSec", 4320), "", null));
        assertEquals("2 h", RowLine.of("series", new JSONObject().put("durationSec", 7200), "", null));
        assertEquals("1 min", RowLine.spokenLength(20));
    }

    @Test public void aPartsNumberIsItsPlaceAmongThePlayableRows() throws Exception {
        java.util.List<JSONObject> rows = java.util.Arrays.asList(
                new JSONObject().put("id", "c:plex:1"),
                new JSONObject().put("id", "p:plex:2"),
                new JSONObject().put("id", "p:plex:3"));
        assertEquals(1, RowLine.partNumber(rows, "p:plex:2"));
        assertEquals(2, RowLine.partNumber(rows, "p:plex:3"));
        assertEquals(0, RowLine.partNumber(rows, "c:plex:1"));
    }

    /** A compact row's sheet header says what its second line used to. */
    @Test public void theSheetHeaderLine() throws Exception {
        JSONObject guest = new JSONObject().put("title", "Track").put("artist", "Alex Lifeson");
        assertEquals("Alex Lifeson", RowLine.sheetLine("album", guest, "Rush", null));
        assertEquals("Rush", RowLine.sheetLine("album", new JSONObject().put("artist", "Rush"), "Rush", null));
        JSONObject part = new JSONObject().put("durationSec", 1800);
        assertEquals("30 min", RowLine.sheetLine("book", part, "", null));
        assertEquals("Finished", RowLine.sheetLine("book", part, "", new JSONObject().put("playhead", 1790)));
        assertTrue(RowLine.sheetLine("book", part, "", new JSONObject().put("playhead", 600)).endsWith("left"));
        assertEquals("Boethius", RowLine.sheetLine("", row(), "", null));
    }
}

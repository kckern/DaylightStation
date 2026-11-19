package net.kckern.daylight.cap.caractions.shell;

import static org.junit.Assert.*;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.util.List;

public class CarAnswersTest {
    private static String list(int n, String label) throws Exception {
        JSONArray entries = new JSONArray();
        for (int i = 0; i < n; i++) entries.put(new JSONObject().put("id", "a" + i).put("label", label).put("kind", "run"));
        return new JSONObject().put("ok", true).put("entries", entries).toString();
    }

    @Test public void readsTheEntriesInOrder() throws Exception {
        List<CarAnswers.Entry> rows = CarAnswers.entries(list(2, "Lights off"));
        assertEquals(2, rows.size());
        assertEquals("a0", rows.get(0).id);
        assertEquals("Lights off", rows.get(0).label);
        assertEquals("run", rows.get(0).kind);
    }

    @Test public void atMostSixRowsAndShortLabels() throws Exception {
        List<CarAnswers.Entry> rows = CarAnswers.entries(list(9, "A label that is a good deal longer than any car row"));
        assertEquals(CarAnswers.MAX_ROWS, rows.size());
        assertEquals(6, CarAnswers.MAX_ROWS);
        assertEquals(CarAnswers.MAX_LABEL, rows.get(0).label.length());
    }

    @Test public void aBrokenAnswerIsNoRows() throws Exception {
        assertTrue(CarAnswers.entries("not json").isEmpty());
        assertTrue(CarAnswers.entries("{\"ok\":true}").isEmpty());
        assertTrue("an entry with no id is left out",
                CarAnswers.entries("{\"entries\":[{\"label\":\"x\"},{\"id\":\"b\",\"label\":\"B\",\"kind\":\"run\"}]}").size() == 1);
    }

    @Test public void aVoiceEntryCarriesItsDestinationAndWhyItCannotRecord() throws Exception {
        String answer = new JSONObject().put("entries", new JSONArray()
                .put(new JSONObject().put("id", "journal").put("label", "Journal").put("kind", "voice").put("dest", "journal").put("why", ""))
                .put(new JSONObject().put("id", "meal").put("label", "Meal").put("kind", "voice").put("dest", "Not A Dest").put("why", ""))
                .put(new JSONObject().put("id", "j2").put("label", "Journal").put("kind", "voice").put("dest", "journal")
                        .put("why", "Daylight is not set up for quick inputs"))).toString();
        List<CarAnswers.Entry> rows = CarAnswers.entries(answer);
        assertEquals(CarAnswers.VOICE, rows.get(0).kind);
        assertEquals("journal", rows.get(0).dest);
        assertEquals("", rows.get(0).why);
        assertNull("a destination that is not an id is no destination: the entry cannot record", rows.get(1).dest);
        assertEquals("Daylight is not set up for quick inputs", rows.get(2).why);
    }

    @Test public void theStartingFallbackIsOneRowThatDoesNothing() {
        List<CarAnswers.Entry> rows = CarAnswers.starting();
        assertEquals(1, rows.size());
        assertEquals("Daylight is starting", rows.get(0).label);
        assertEquals(CarAnswers.NONE, rows.get(0).kind);
    }

    @Test public void aRunAnswerIsItsMessage() throws Exception {
        assertEquals("Location sharing is not built yet",
                CarAnswers.message(new JSONObject().put("ok", true).put("message", "Location sharing is not built yet").toString()));
        assertEquals(CarAnswers.NO_ANSWER, CarAnswers.message("nope"));
        assertEquals(CarAnswers.NO_ANSWER, CarAnswers.message("{}"));
    }
}

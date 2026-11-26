package net.kckern.daylight.shellkit;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class TelemetryStoreTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    private static JSONObject ev(int i) throws Exception {
        return new JSONObject().put("id", "e" + i).put("event", "ui.tap").put("data", new JSONObject().put("n", i));
    }

    @Test public void eventsWaitOnDiskInOrderUntilAcked() throws Exception {
        TelemetryStore s = new TelemetryStore(tmp.newFolder("t"));
        for (int i = 0; i < 3; i++) s.append(ev(i));
        assertNull("an open batch is not sent until sealed", s.next());
        s.seal();
        for (int i = 3; i < 5; i++) s.append(ev(i));
        s.seal();
        TelemetryStore.Batch first = s.next();
        assertEquals(3, first.events.length());
        assertEquals("e0", first.events.getJSONObject(0).getString("id"));
        // Not acknowledged (offline): the same batch comes again.
        assertEquals("e0", s.next().events.getJSONObject(0).getString("id"));
        s.ack(first);
        assertEquals("e3", s.next().events.getJSONObject(0).getString("id"));
    }

    @Test public void aFullBatchSealsItself() throws Exception {
        TelemetryStore s = new TelemetryStore(tmp.newFolder("t"));
        for (int i = 0; i < TelemetryStore.BATCH_EVENTS; i++) s.append(ev(i));
        assertEquals(1, s.waiting());
    }

    @Test public void itSurvivesARestartAndKeepsTheOrder() throws Exception {
        java.io.File dir = tmp.newFolder("t");
        TelemetryStore s = new TelemetryStore(dir);
        s.append(ev(1));
        s.seal();
        s.append(ev(2));
        // The process dies here; a new one opens the same directory.
        TelemetryStore again = new TelemetryStore(dir);
        again.seal();
        assertEquals(2, again.waiting());
        assertEquals("e1", again.next().events.getJSONObject(0).getString("id"));
    }

    @Test public void overTheCapTheOldestGoAndTheLossIsReported() throws Exception {
        TelemetryStore s = new TelemetryStore(tmp.newFolder("t"));
        String pad = new String(new char[20_000]).replace('\0', 'x');
        for (int b = 0; b < 60; b++) {
            s.append(new JSONObject().put("id", "b" + b).put("event", "ui.tap").put("pad", pad));
            s.seal();
        }
        assertTrue(s.waiting() < 60);
        s.append(ev(99));
        s.seal();
        // Drain to the last batch: it carries the count of what was lost.
        TelemetryStore.Batch last = null;
        for (TelemetryStore.Batch b = s.next(); b != null; b = s.next()) { last = b; s.ack(b); }
        JSONObject note = last.events.getJSONObject(last.events.length() - 1);
        assertEquals("telemetry.dropped", note.getString("event"));
        assertTrue(note.getJSONObject("data").getLong("count") > 0);
    }

    @Test public void aTornLineIsSkipped() throws Exception {
        java.io.File dir = tmp.newFolder("t");
        TelemetryStore s = new TelemetryStore(dir);
        s.append(ev(1));
        java.nio.file.Files.write(new java.io.File(dir, "open.jsonl").toPath(), "{\"id\":\"half".getBytes(),
                java.nio.file.StandardOpenOption.APPEND);
        s.seal();
        assertEquals(1, s.next().events.length());
    }
}

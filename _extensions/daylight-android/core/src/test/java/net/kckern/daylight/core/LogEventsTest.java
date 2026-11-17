package net.kckern.daylight.core;

import static org.junit.Assert.*;

import net.kckern.daylight.core.testing.TestCore;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public class LogEventsTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private final LogEvents.Poster real = LogEvents.poster;

    @After public void restore() { LogEvents.poster = real; }

    private static boolean eventsThreadAlive() {
        for (Thread t : Thread.getAllStackTraces().keySet()) {
            if (t.isAlive() && "PianoBridge-events".equals(t.getName())) return true;
        }
        return false;
    }

    private static void awaitNoEventsThread() throws Exception {
        long deadline = System.currentTimeMillis() + 3000;
        while (eventsThreadAlive() && System.currentTimeMillis() < deadline) Thread.sleep(20);
    }

    private CoreRuntime shipping() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        core.prepare(new JSONObject("{\"heartbeat.logStoreUrl\":\"http://192.0.2.1/insert\"}"));
        return core;
    }

    @Test(timeout = 20000) public void aLogStoreThatStopsAnsweringCostsTheOldestEventsAndTheyAreCounted() throws Exception {
        CoreRuntime core = shipping();
        final CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        final List<String> posted = new CopyOnWriteArrayList<>();
        LogEvents.poster = (url, line) -> {
            entered.countDown();
            try { release.await(); } catch (InterruptedException ignored) { }
            try { posted.add(new JSONObject(line).optString("_msg")); } catch (Exception e) { posted.add("unparsed"); }
        };
        long before = LogEvents.dropped();
        try {
            LogEvents.emit("event.first", "info", new JSONObject());
            assertTrue(entered.await(5, TimeUnit.SECONDS));       // the one post in flight, stuck
            int extra = 25;
            for (int i = 0; i < LogEvents.MAX_QUEUED + extra; i++) LogEvents.emit("event." + i, "info", new JSONObject());
            assertEquals("each event past the queue's size dropped one", before + extra, LogEvents.dropped());

            release.countDown();
            long deadline = System.currentTimeMillis() + 5000;
            while (posted.size() < LogEvents.MAX_QUEUED + 1 && System.currentTimeMillis() < deadline) Thread.sleep(10);
            assertEquals(LogEvents.MAX_QUEUED + 1, posted.size());
            assertEquals("event.first", posted.get(0));
            assertEquals("the oldest waiting events were the ones dropped", "event." + extra, posted.get(1));
            assertEquals("event." + (LogEvents.MAX_QUEUED + extra - 1), posted.get(posted.size() - 1));
        } finally {
            release.countDown();
            core.stop();
        }
    }

    @Test(timeout = 20000) public void stoppingThePayloadEndsThePostingThreadAndANewPayloadGetsItsOwn() throws Exception {
        awaitNoEventsThread();
        CoreRuntime first = shipping();
        final CountDownLatch posted = new CountDownLatch(1);
        LogEvents.poster = (url, line) -> posted.countDown();
        LogEvents.emit("event.a", "info", new JSONObject());
        assertTrue(posted.await(5, TimeUnit.SECONDS));
        assertTrue(eventsThreadAlive());

        first.stop();
        awaitNoEventsThread();
        assertFalse("the thread does not outlive the payload", eventsThreadAlive());
        LogEvents.emit("event.after-stop", "info", new JSONObject());
        assertFalse("an event after stop starts nothing", eventsThreadAlive());

        CoreRuntime second = shipping();
        final CountDownLatch again = new CountDownLatch(1);
        LogEvents.poster = (url, line) -> again.countDown();
        LogEvents.emit("event.b", "info", new JSONObject());
        assertTrue("the next payload ships events", again.await(5, TimeUnit.SECONDS));

        first.stop();                                             // a late second stop of the old payload
        final CountDownLatch still = new CountDownLatch(1);
        LogEvents.poster = (url, line) -> still.countDown();
        LogEvents.emit("event.c", "info", new JSONObject());
        assertTrue("does not silence the new one", still.await(5, TimeUnit.SECONDS));
        second.stop();
        awaitNoEventsThread();
        assertFalse(eventsThreadAlive());
    }
}

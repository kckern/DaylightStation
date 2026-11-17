package net.kckern.daylight.api;

import static org.junit.Assert.*;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

public class PayloadPortTest {
    private static PayloadPort fresh() { return PayloadPort.named("test-" + UUID.randomUUID()); }

    @Test public void aNameAlwaysGivesTheSamePort() {
        String name = "test-" + UUID.randomUUID();
        assertSame(PayloadPort.named(name), PayloadPort.named(name));
        assertNotSame(PayloadPort.named(name), fresh());
    }

    @Test public void callsTheAttachedHandlerAndReturnsItsAnswer() throws Exception {
        PayloadPort port = fresh();
        port.attach(request -> "got " + request);
        assertTrue(port.ready());
        assertEquals("got {}", port.call("{}", 0));
    }

    @Test public void waitsWhileNoPayloadHasAttachedYet() throws Exception {
        final PayloadPort port = fresh();
        Thread payload = new Thread(() -> {
            try { Thread.sleep(150); } catch (InterruptedException ignored) { }
            port.attach(request -> "late");
        });
        payload.start();
        long began = System.currentTimeMillis();
        assertEquals("late", port.call("{}", 5000));
        assertTrue("it returned as soon as the handler arrived", System.currentTimeMillis() - began < 4000);
        payload.join();
    }

    @Test public void givesUpWhenTheWaitRunsOut() throws Exception {
        PayloadPort port = fresh();
        long began = System.currentTimeMillis();
        try {
            port.call("{}", 200);
            fail("expected NotReadyException");
        } catch (PayloadPort.NotReadyException expected) {
            long waited = System.currentTimeMillis() - began;
            assertTrue("waited " + waited, waited >= 150 && waited < 3000);
        }
    }

    @Test public void neverRepeatsARequestThatWasDelivered() throws Exception {
        PayloadPort port = fresh();
        final List<String> seen = Collections.synchronizedList(new ArrayList<String>());
        port.attach(request -> { seen.add(request); throw new IllegalStateException("handler failed"); });
        try {
            port.call("{\"uri\":\"daylight://action/x\"}", 5000);
            fail("expected the handler's exception");
        } catch (IllegalStateException e) {
            assertEquals("handler failed", e.getMessage());
        }
        assertEquals("a failed action must not run twice", 1, seen.size());
    }

    @Test public void aPayloadThatStopsDetachesOnlyItself() throws Exception {
        PayloadPort port = fresh();
        PayloadPort.Handler old = request -> "old";
        PayloadPort.Handler next = request -> "new";
        port.attach(old);
        port.attach(next);                 // a swap: the new payload starts before the old one stops
        assertFalse(port.detach(old));
        assertEquals("new", port.call("{}", 0));
        assertTrue(port.detach(next));
        assertFalse(port.ready());
        try { port.call("{}", 0); fail("expected NotReadyException"); } catch (PayloadPort.NotReadyException expected) { }
    }

    @Test public void anInterruptedWaitIsNotReadyAndKeepsTheInterrupt() throws Exception {
        PayloadPort port = fresh();
        Thread.currentThread().interrupt();
        try {
            port.call("{}", 5000);
            fail("expected NotReadyException");
        } catch (PayloadPort.NotReadyException expected) {
            assertTrue(Thread.interrupted());
        }
    }
}

package net.kckern.daylight.api;

import static org.junit.Assert.*;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

public class CrashRelayTest {
    private Thread.UncaughtExceptionHandler original;
    private final List<String> heard = new ArrayList<>();

    @Before public void setUp() {
        original = Thread.getDefaultUncaughtExceptionHandler();
        CrashRelay.resetForTest();
        Thread.setDefaultUncaughtExceptionHandler((t, e) -> heard.add("system:" + e.getMessage()));
    }

    @After public void tearDown() {
        CrashRelay.resetForTest();
        Thread.setDefaultUncaughtExceptionHandler(original);
    }

    @Test public void manySinksInstallOneHandlerAndOnlyTheCurrentSinkHears() {
        CrashRelay.Sink first = (t, e) -> heard.add("first:" + e.getMessage());
        CrashRelay.Sink second = (t, e) -> heard.add("second:" + e.getMessage());
        CrashRelay.set(first);
        Thread.UncaughtExceptionHandler installed = Thread.getDefaultUncaughtExceptionHandler();
        CrashRelay.set(second);
        CrashRelay.set(second);
        assertSame("a later payload start adds no handler", installed, Thread.getDefaultUncaughtExceptionHandler());

        installed.uncaughtException(Thread.currentThread(), new RuntimeException("boom"));
        // The sink of the payload that is running, then the handler that was there before, once.
        assertEquals(java.util.Arrays.asList("second:boom", "system:boom"), heard);
    }

    @Test public void aClearedSinkIsDroppedAndTheSystemHandlerStillRuns() {
        CrashRelay.Sink sink = (t, e) -> heard.add("sink:" + e.getMessage());
        CrashRelay.set(sink);
        CrashRelay.clear(sink);
        assertNull("nothing of a stopped payload stays reachable", CrashRelay.current());
        Thread.getDefaultUncaughtExceptionHandler().uncaughtException(Thread.currentThread(), new RuntimeException("boom"));
        assertEquals(java.util.Collections.singletonList("system:boom"), heard);
    }

    @Test public void clearingAnOlderSinkLeavesTheNewerOneInPlace() {
        CrashRelay.Sink older = (t, e) -> heard.add("older");
        CrashRelay.Sink newer = (t, e) -> heard.add("newer");
        CrashRelay.set(older);
        CrashRelay.set(newer);
        // A swapped-out payload stops after its successor started.
        CrashRelay.clear(older);
        assertSame(newer, CrashRelay.current());
    }

    @Test public void aSinkThatThrowsDoesNotStopTheSystemHandler() {
        CrashRelay.set((t, e) -> { throw new IllegalStateException("sink broke"); });
        Thread.getDefaultUncaughtExceptionHandler().uncaughtException(Thread.currentThread(), new RuntimeException("boom"));
        assertEquals(java.util.Collections.singletonList("system:boom"), heard);
    }
}

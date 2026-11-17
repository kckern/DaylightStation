package net.kckern.daylight.core;

import static org.junit.Assert.*;

import net.kckern.daylight.api.CrashRelay;

import org.junit.After;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

public class CrashLogInstallTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    // The relay's handler stays installed for the life of the test JVM, as it does for the
    // life of an app process; it forwards to whatever handler was there before it.
    @After public void tearDown() { CrashLog.markCleanShutdown(); }

    @Test public void repeatedPayloadStartsLeaveOneHandlerInTheProcess() throws Exception {
        CrashLog.installAt(tmp.newFolder());
        Thread.UncaughtExceptionHandler afterFirst = Thread.getDefaultUncaughtExceptionHandler();
        assertNotNull(afterFirst);
        for (int i = 0; i < 5; i++) {
            CrashLog.markCleanShutdown();
            CrashLog.installAt(tmp.newFolder());
        }
        assertSame("a hot swap must not chain another handler", afterFirst, Thread.getDefaultUncaughtExceptionHandler());
    }

    @Test public void stopClearsTheSinkSoTheStoppedPayloadIsNotHeld() throws Exception {
        CrashLog.installAt(tmp.newFolder());
        assertNotNull(CrashRelay.current());
        CrashLog.markCleanShutdown();
        assertNull(CrashRelay.current());
    }

    @Test public void anUncaughtExceptionIsWrittenByTheCurrentSink() throws Exception {
        File dir = tmp.newFolder();
        CrashLog.installAt(dir);
        CrashRelay.current().uncaught(Thread.currentThread(), new IllegalStateException("boom-for-test"));
        String events = new String(Files.readAllBytes(new File(dir, "events.log").toPath()), StandardCharsets.UTF_8);
        assertTrue(events, events.contains("[CRASH]"));
        assertTrue(events, events.contains("boom-for-test"));
    }
}

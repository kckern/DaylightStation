package net.kckern.daylight.cap.debugtools;

import static org.junit.Assert.*;

import org.junit.Test;

public class LogFilterTest {
    private static final String LOG = "11-16 10:00:00 I/Daylight-Kiosk: attached\n11-16 10:00:01 W/chromium: slow\n11-16 10:00:02 I/Daylight-Loader: ok\n";

    @Test public void keepsLinesContainingTheNeedleIgnoringCase() {
        assertEquals("11-16 10:00:00 I/Daylight-Kiosk: attached\n11-16 10:00:02 I/Daylight-Loader: ok\n",
                LogFilter.apply(LOG, "daylight"));
    }

    @Test public void noNeedleKeepsEverything() {
        assertEquals(LOG, LogFilter.apply(LOG, null));
        assertEquals(LOG, LogFilter.apply(LOG, ""));
    }

    @Test public void theNeedleIsPlainTextNotAPattern() {
        assertEquals("", LogFilter.apply(LOG, ".*"));
        assertEquals("", LogFilter.apply(LOG, "; rm -rf /"));
    }

    // ── beyond the plan: validation ───────────────────────────────────────────

    @Test public void aFilterIsShortPrintableText() {
        assertNull(LogFilter.problem(null));
        assertNull(LogFilter.problem(""));
        assertNull(LogFilter.problem("Daylight-Kiosk: page"));
        StringBuilder longOne = new StringBuilder();
        for (int i = 0; i <= LogFilter.MAX_FILTER_CHARS; i++) longOne.append('a');
        assertNotNull(LogFilter.problem(longOne.toString()));
        assertNull(LogFilter.problem(longOne.substring(1)));
        assertNotNull("no line break can ever match one line", LogFilter.problem("a\nb"));
        assertNotNull(LogFilter.problem("a\u0000b"));
    }

    @Test public void theLineCountIsAWholeNumberInRange() {
        assertEquals(500, LogFilter.lines(null));
        assertEquals(1, LogFilter.lines("1"));
        assertEquals(LogFilter.MAX_LINES, LogFilter.lines(String.valueOf(LogFilter.MAX_LINES)));
        for (String bad : new String[] { "0", "-5", String.valueOf(LogFilter.MAX_LINES + 1), "ten", "5; id", "", "1e3", " 5" }) {
            try { LogFilter.lines(bad); fail("expected IllegalArgumentException for '" + bad + "'"); }
            catch (IllegalArgumentException expected) { }
        }
    }

    @Test public void theCommandIsAnArgumentListWithNoShellAndNothingOfTheCallersButTheCount() {
        assertArrayEquals(new String[] { "logcat", "-d", "-v", "time", "-t", "200" }, LogFilter.command(200));
    }
}

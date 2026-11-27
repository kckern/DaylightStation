package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.*;

import java.util.List;

import org.junit.Test;

import net.kckern.daylight.cap.mediaservice.shell.TimeScale.Style;

public class TimeScaleTest {
    /**
     * Density 1 (a px is a dp) and a 10 sp label's widths: a digit or letter 0.56 em, a
     * colon or space 0.28 em.
     */
    private static final TimeScale.Width W = s -> {
        float w = 0;
        for (char c : s.toCharArray()) w += c == ':' || c == ' ' ? 2.8f : 5.6f;
        return w;
    };
    private static final long MIN = 60_000, H = 3_600_000;
    /** The seek bar on a 392 dp phone, between its two times. */
    private static final float PHONE = 300;

    private static long step(long span, float px) { return TimeScale.labelStep(0, span, span, px, W, Style.TOUCH); }

    @Test public void touchedTheWholeBarSaysRoundPointsInWords() {
        assertEquals(H, step(5 * H, PHONE));
        TimeScale.Scale s = TimeScale.of(0, 5 * H, 5 * H, PHONE, 1f, W, Style.TOUCH);
        assertEquals("1 h", s.labels.get(0).label);
        assertEquals(10 * MIN, step(45 * MIN, PHONE));
        assertEquals("10 m", TimeScale.of(0, 45 * MIN, 45 * MIN, PHONE, 1f, W, Style.TOUCH).labels.get(0).label);
        // Never "1:00:00": words, with minutes only when they are not round.
        assertEquals("2 h 30", TimeScale.label(150 * MIN, 5 * H, Style.TOUCH));
        assertEquals("45 m", TimeScale.label(45 * MIN, 5 * H, Style.TOUCH));
        assertEquals("2 h", TimeScale.label(2 * H, 5 * H, Style.TOUCH));
    }

    @Test public void theZoomIsClockTimeAndTheReadoutHasSeconds() {
        long start = H + 38 * MIN;
        TimeScale.Scale s = TimeScale.of(start, start + 10 * MIN, 5 * H, PHONE, 1f, W, Style.ZOOM);
        assertTrue(s.labels.size() >= 2 && s.labels.size() <= 4);
        assertEquals("1:40", s.labels.get(0).label);
        assertEquals("1:42:30 · +0:30", TimeScale.readout(H + 42 * MIN + 30_000, H + 42 * MIN, 5 * H));
        assertEquals("−0:45", TimeScale.offset(-45_000));
        assertEquals("1:42", TimeScale.windowEnd(H + 42 * MIN + 10_000, 5 * H));
    }

    @Test public void songsHaveNoScale() {
        assertTrue(TimeScale.of(0, 4 * MIN, 4 * MIN, PHONE, 1f, W, Style.TOUCH).isEmpty());
        assertFalse(TimeScale.of(0, 10 * MIN, 10 * MIN, PHONE, 1f, W, Style.TOUCH).isEmpty());
    }

    @Test public void twoToFourLabelsThreeWidthsApartForEveryLengthAndWidth() {
        for (float px = 250; px <= 1200; px += 50) {
            for (long d = 10 * MIN; d <= 40 * H; d += d < 2 * H ? MIN : d < 10 * H ? 5 * MIN : 20 * MIN) {
                TimeScale.Scale s = TimeScale.of(0, d, d, px, 1f, W, Style.TOUCH);
                int n = s.labels.size();
                assertTrue("labels " + n + " for " + d / MIN + " min at " + px + " px", n >= 2 && n <= 4);
                assertSpaced(s, px, d);
            }
        }
    }

    @Test public void theZoomWindowsToo() {
        for (float px = 250; px <= 1200; px += 50) {
            for (long d : new long[] { 45 * MIN, 5 * H, 30 * H }) {
                long w = FineScrub.windowMs(d);
                for (long start = 0; start + w <= d; start += w / 3 + 7_000) {
                    TimeScale.Scale s = TimeScale.of(start, start + w, d, px, 1f, W, Style.ZOOM);
                    assertTrue("zoom " + w / 1000 + " s at " + start + ", " + px + " px: " + s.labels.size(),
                            s.labels.size() >= 2 && s.labels.size() <= 4);
                    assertSpaced(s, px, w);
                }
            }
        }
    }

    /** Ticks only between the labels, one row, at least 12 dp apart. */
    @Test public void ticksOnlyBetweenLabels() {
        TimeScale.Scale s = TimeScale.of(0, 5 * H, 5 * H, PHONE, 1f, W, Style.TOUCH);
        long first = s.labels.get(0).ms, last = s.labels.get(s.labels.size() - 1).ms;
        for (TimeScale.Mark t : s.ticks) assertTrue(t.ms > first && t.ms < last);
    }

    /** At rest (§12c): by length only. A 3 h book has 5 ticks, an 8 h book 7, a 45 min talk 4; under 20 min none. */
    @Test public void atRestTicksByLength() {
        assertEquals(5, TimeScale.restTicks(3 * H).size());
        assertEquals(7, TimeScale.restTicks(8 * H).size());
        assertEquals(4, TimeScale.restTicks(45 * MIN).size());
        assertEquals(0, TimeScale.restTicks(19 * MIN).size());
        // 1 to 6 h: each 30 min, the hours a little taller.
        List<TimeScale.Tick> three = TimeScale.restTicks(3 * H);
        assertFalse(three.get(0).hour);
        assertTrue(three.get(1).hour);
        // 6 h and more: each hour, all alike.
        assertEquals(29, TimeScale.restTicks(30 * H).size());
        for (TimeScale.Tick t : TimeScale.restTicks(8 * H)) assertFalse(t.hour);
    }

    @Test public void crossingALabelledMarkIsTold() {
        TimeScale.Scale s = TimeScale.of(0, 5 * H, 5 * H, PHONE, 1f, W, Style.TOUCH);
        assertEquals(H, TimeScale.crossed(s, H - 1000, H + 1000));
        assertEquals(-1, TimeScale.crossed(s, H + 1000, H + 5000));
    }

    private static void assertSpaced(TimeScale.Scale s, float px, long span) {
        float widest = 0;
        for (TimeScale.Mark m : s.labels) widest = Math.max(widest, W.of(m.label));
        for (int i = 1; i < s.labels.size(); i++) {
            float apart = (s.labels.get(i).x - s.labels.get(i - 1).x) * px;
            assertTrue("labels " + apart + " px apart, " + widest + " wide", apart >= 3 * widest - 0.01f);
        }
        for (int i = 1; i < s.ticks.size(); i++) assertTrue((s.ticks.get(i).x - s.ticks.get(i - 1).x) * px >= 12f - 0.01f);
        List<TimeScale.Mark> shown = TimeScale.drawable(s.labels, px, 1f, W, 0, 0, null);
        assertTrue(shown.size() >= s.labels.size() - 1);
    }
}

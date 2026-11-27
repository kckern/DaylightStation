package net.kckern.daylight.cap.mediaservice.shell;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class QueueChromeTest {
    @Test public void theQueueTakesTheWholeStageAndTheDeckComesBackWhenItCloses() {
        QueueChrome open = QueueChrome.of(true);
        assertFalse(open.deck);
        assertTrue(open.strip);
        QueueChrome closed = QueueChrome.of(false);
        assertTrue(closed.deck);
        assertFalse(closed.strip);
    }

    @Test public void theStripsLinesDropABylineThatRepeatsTheTitle() {
        QueueChrome.Line l = QueueChrome.line("Spindrift", "Rush");
        assertEquals("Spindrift", l.title);
        assertEquals("Rush", l.by);
        assertEquals("", QueueChrome.line("Henry VI", "henry vi").by.toString());
        assertEquals("", QueueChrome.line(null, null).title.toString());
    }

    @Test public void progressIsInThousandthsAndClamped() {
        assertEquals(0, QueueChrome.permille(5_000, 0));
        assertEquals(500, QueueChrome.permille(60_000, 120_000));
        assertEquals(1000, QueueChrome.permille(200_000, 120_000));
        assertEquals(0, QueueChrome.permille(-5, 120_000));
    }
}

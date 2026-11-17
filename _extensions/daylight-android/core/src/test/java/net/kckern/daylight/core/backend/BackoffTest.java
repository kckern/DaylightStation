package net.kckern.daylight.core.backend;

import static org.junit.Assert.*;

import org.junit.Test;

public class BackoffTest {
    @Test public void doublesFromTheBase() {
        assertEquals(5_000, Backoff.delayMs(1, 5_000, 3_600_000));
        assertEquals(10_000, Backoff.delayMs(2, 5_000, 3_600_000));
        assertEquals(40_000, Backoff.delayMs(4, 5_000, 3_600_000));
    }

    @Test public void stopsAtTheCap() {
        assertEquals(3_600_000, Backoff.delayMs(12, 5_000, 3_600_000));
        assertEquals(3_600_000, Backoff.delayMs(500, 5_000, 3_600_000));
    }

    @Test public void treatsAttemptsBelowOneAsTheFirst() {
        assertEquals(5_000, Backoff.delayMs(0, 5_000, 3_600_000));
    }
}

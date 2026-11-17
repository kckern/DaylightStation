package net.kckern.daylight.cap.lockdown;

import static org.junit.Assert.*;

import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;

public class ControlCenterTest {
    private static ControlCenter.Window system(int w, int h) { return new ControlCenter.Window(ForegroundTrail.TYPE_SYSTEM, w, h); }
    private static ControlCenter.Window app(int w, int h) { return new ControlCenter.Window(ForegroundTrail.TYPE_APPLICATION, w, h); }

    @Test public void aSystemWindowCoveringMostOfTheDisplayIsThePanel() {
        assertTrue(ControlCenter.isOpen(Arrays.asList(app(1280, 800), system(1280, 800)), 1280, 800));
        assertTrue("80% of each axis is enough", ControlCenter.isOpen(Collections.singletonList(system(1024, 640)), 1280, 800));
    }

    @Test public void theParkedGestureStripAndApplicationWindowsAreNotThePanel() {
        assertFalse(ControlCenter.isOpen(Arrays.asList(app(1280, 800), system(984, 25)), 1280, 800));
        assertFalse(ControlCenter.isOpen(Collections.singletonList(system(1280, 600)), 1280, 800));
        assertFalse(ControlCenter.isOpen(Collections.singletonList(app(1280, 800)), 1280, 800));
    }

    @Test public void anUnknownDisplaySizeOrWindowListIsNotThePanel() {
        assertFalse(ControlCenter.isOpen(Collections.singletonList(system(1280, 800)), 0, 800));
        assertFalse(ControlCenter.isOpen(null, 1280, 800));
    }

    @Test public void windowEventsDuringTheOpenAnimationStartOneDismissal() {
        ControlCenter c = new ControlCenter();
        assertTrue(c.shouldStart(10_000));
        assertFalse(c.shouldStart(10_300));
        assertFalse(c.shouldStart(10_000 + ControlCenter.DEBOUNCE_MS - 1));
        assertTrue(c.shouldStart(10_000 + ControlCenter.DEBOUNCE_MS));
    }

    @Test public void aSwipeRestartsTheDebounceAndAttemptsAreBounded() {
        ControlCenter c = new ControlCenter();
        assertTrue(c.shouldStart(10_000));
        c.swiped(10_400);
        assertFalse(c.shouldStart(10_400 + ControlCenter.DEBOUNCE_MS - 1));
        for (int attempt = 1; attempt <= ControlCenter.MAX_ATTEMPTS; attempt++) assertTrue(ControlCenter.mayAttempt(attempt));
        assertFalse(ControlCenter.mayAttempt(ControlCenter.MAX_ATTEMPTS + 1));
    }
}

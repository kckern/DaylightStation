package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Deque;
import java.util.List;

/** Acceptance 212: a Media3 controller merge assertion killed the process; only that one is contained, and not forever. */
public class MainLoopGuardTest {
    private static IllegalStateException merge() {
        IllegalStateException e = new IllegalStateException();
        e.setStackTrace(new StackTraceElement[] {
                new StackTraceElement("androidx.media3.common.util.Assertions", "checkState", "A.java", 1),
                new StackTraceElement("androidx.media3.session.PlayerInfo$Builder", "build", "P.java", 1),
                new StackTraceElement("androidx.media3.session.PlayerInfo", "copyWithTimeline", "P.java", 2),
                new StackTraceElement("androidx.media3.session.MediaUtils", "mergePlayerInfo", "M.java", 1),
                new StackTraceElement("androidx.media3.session.MediaControllerImplBase", "onPlayerInfoChanged", "C.java", 1) });
        return e;
    }

    @Test public void theControllerMergeAssertionIsContained() {
        assertTrue(MainLoopGuard.containable(merge()));
    }

    @Test public void anyOtherFailureStillCrashesAsBefore() {
        assertFalse(MainLoopGuard.containable(new IllegalStateException()));
        assertFalse(MainLoopGuard.containable(new NullPointerException()));
        assertFalse(MainLoopGuard.containable(null));
    }

    // A fake main loop: runs queued messages; a throwing one aborts loop() with its exception, as Looper.loop does.
    private static final class FakeLoop {
        final Deque<Runnable> queue = new ArrayDeque<>();
        void loop() {
            while (!queue.isEmpty()) queue.poll().run();
        }
    }

    @Test public void aContainedThrowEndsOnlyThatMessageAndTheNextOneRuns() {
        FakeLoop loop = new FakeLoop();
        List<String> ran = new ArrayList<>();
        loop.queue.add(() -> ran.add("first"));
        loop.queue.add(() -> { throw merge(); });
        loop.queue.add(() -> ran.add("after"));
        List<Throwable> contained = new ArrayList<>();
        MainLoopGuard.drive(loop::loop, new MainLoopGuard.Policy(() -> 0L), contained::add);
        assertEquals(Arrays.asList("first", "after"), ran);
        assertEquals(1, contained.size());
    }

    @Test public void anUncontainableThrowIsRethrownAndTheProcessCrashesAsBefore() {
        FakeLoop loop = new FakeLoop();
        loop.queue.add(() -> { throw new NullPointerException("x"); });
        try {
            MainLoopGuard.drive(loop::loop, new MainLoopGuard.Policy(() -> 0L), t -> { });
            org.junit.Assert.fail("rethrown");
        } catch (NullPointerException expected) { /* crashes as before */ }
    }

    @Test public void moreThanThreeInTenSecondsCrashesCleanInsteadOfStayingStale() {
        long[] now = { 1_000 };
        MainLoopGuard.Policy policy = new MainLoopGuard.Policy(() -> now[0]);
        assertTrue(policy.allow());
        now[0] += 1_000; assertTrue(policy.allow());
        now[0] += 1_000; assertTrue(policy.allow());
        now[0] += 1_000; assertFalse("the fourth within 10 s", policy.allow());
        now[0] += 20_000;
        assertTrue("old ones age out", policy.allow());

        FakeLoop loop = new FakeLoop();
        for (int i = 0; i < 5; i++) loop.queue.add(() -> { throw merge(); });
        List<Throwable> contained = new ArrayList<>();
        try {
            MainLoopGuard.drive(loop::loop, new MainLoopGuard.Policy(() -> 5L), contained::add);
            org.junit.Assert.fail("rethrown at the fourth");
        } catch (IllegalStateException expected) { assertEquals(3, contained.size()); }
    }

    @Test public void installIsClaimedOnce() {
        MainLoopGuard.resetForTest();
        assertTrue(MainLoopGuard.claimInstall());
        assertFalse(MainLoopGuard.claimInstall());
    }

    @Test public void hooksRunInRegistrationOrderOneFailingNeverStopsTheRestAndUnregisterWorks() {
        MainLoopGuard.Hooks hooks = new MainLoopGuard.Hooks();
        List<String> ran = new ArrayList<>();
        Runnable offA = hooks.add(() -> ran.add("a"));
        hooks.add(() -> { throw new RuntimeException("bad hook"); });
        hooks.add(() -> ran.add("c"));
        hooks.fire();
        assertEquals(Arrays.asList("a", "c"), ran);
        offA.run();
        ran.clear();
        hooks.fire();
        assertEquals(Arrays.asList("c"), ran);
    }
}

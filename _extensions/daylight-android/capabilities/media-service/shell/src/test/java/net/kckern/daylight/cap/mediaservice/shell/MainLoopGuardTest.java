package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Acceptance 212: a Media3 controller merge assertion killed the process; only that one is contained. */
public class MainLoopGuardTest {
    private static Throwable thrown(String... frames) {
        IllegalStateException e = new IllegalStateException();
        StackTraceElement[] st = new StackTraceElement[frames.length];
        for (int i = 0; i < frames.length; i++) {
            int dot = frames[i].lastIndexOf('.');
            st[i] = new StackTraceElement(frames[i].substring(0, dot), frames[i].substring(dot + 1), "X.java", 1);
        }
        e.setStackTrace(st);
        return e;
    }

    @Test public void theControllerMergeAssertionIsContained() {
        assertTrue(MainLoopGuard.containable(thrown(
                "androidx.media3.common.util.Assertions.checkState",
                "androidx.media3.session.PlayerInfo$Builder.build",
                "androidx.media3.session.PlayerInfo.copyWithTimeline",
                "androidx.media3.session.MediaUtils.mergePlayerInfo",
                "androidx.media3.session.MediaControllerImplBase.onPlayerInfoChanged")));
    }

    @Test public void anyOtherFailureStillCrashesAsBefore() {
        assertFalse(MainLoopGuard.containable(new IllegalStateException()));
        assertFalse(MainLoopGuard.containable(new NullPointerException()));
        assertFalse(MainLoopGuard.containable(thrown("androidx.media3.session.PlayerInfo$Builder.build")));
        assertFalse(MainLoopGuard.containable(thrown("androidx.media3.session.MediaUtils.mergePlayerInfo")));
        assertFalse(MainLoopGuard.containable(null));
    }
}

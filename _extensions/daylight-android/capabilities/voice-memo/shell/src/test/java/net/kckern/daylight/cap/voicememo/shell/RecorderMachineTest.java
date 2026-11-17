package net.kckern.daylight.cap.voicememo.shell;

import static org.junit.Assert.*;

import net.kckern.daylight.cap.voicememo.shell.RecorderMachine.Action;
import net.kckern.daylight.cap.voicememo.shell.RecorderMachine.Event;

import org.junit.Test;

public class RecorderMachineTest {
    private final RecorderMachine machine = new RecorderMachine();

    @Test public void startBeginsOnceAndASecondStartChangesNothing() {
        assertFalse(machine.recording());
        assertEquals(Action.BEGIN, machine.on(Event.START, 1000));
        assertEquals("the recorder is not running until it said so", Action.NONE, machine.on(Event.START, 1001));
        machine.began(1002);
        assertTrue(machine.recording());
        assertEquals(1002, machine.startedAtMs());
        assertEquals(Action.NONE, machine.on(Event.START, 2000));
    }

    @Test public void aRecorderThatCouldNotBeginLeavesNothingBehind() {
        machine.on(Event.START, 1000);
        assertEquals(Action.DISCARD_AND_STOP, machine.failedToBegin());
        assertFalse(machine.recording());
        assertEquals("it can be tried again", Action.BEGIN, machine.on(Event.START, 2000));
    }

    /** Everything that ends a recording ends it the same way: the recorder is stopped and the file decided on. */
    @Test public void everyEndFinishesTheRecording() {
        for (Event end : new Event[] { Event.STOP, Event.CAP_REACHED, Event.FOCUS_LOST, Event.RECORDER_ERROR, Event.SERVICE_DESTROYED }) {
            RecorderMachine m = new RecorderMachine();
            m.on(Event.START, 1000);
            m.began(1000);
            assertEquals(end.name(), Action.FINISH, m.on(end, 60_000));
            assertFalse(m.recording());
            assertEquals("a second end has nothing to finish", Action.STOP_SERVICE, m.on(end, 60_001));
        }
    }

    @Test public void anEndWithNothingRecordingOnlyStopsTheService() {
        assertEquals(Action.STOP_SERVICE, machine.on(Event.STOP, 1000));
        assertEquals(Action.STOP_SERVICE, machine.on(Event.FOCUS_LOST, 1000));
    }

    @Test public void anEndWhileTheRecorderIsStillBeingSetUpIsRememberedAsAFailure() {
        machine.on(Event.START, 1000);
        assertEquals(Action.DISCARD_AND_STOP, machine.on(Event.STOP, 1001));
        assertFalse(machine.recording());
    }

    @Test public void whatWasRecordedIsKeptUnlessTheRecorderFailedOrCapturedNothing() {
        assertTrue(RecorderMachine.keep(true, 5_000, 20_000));
        assertTrue("a call that cut it off still leaves a memo", RecorderMachine.keep(true, 1_000, 3_000));
        assertFalse("the recorder's stop failed: the file has no index", RecorderMachine.keep(false, 60_000, 500_000));
        assertFalse("under a second is a slip of the finger", RecorderMachine.keep(true, 999, 3_000));
        assertFalse("an empty file is not a memo", RecorderMachine.keep(true, 5_000, 0));
    }

    @Test public void theCapIsThirtyMinutesAndUnderTheIntakesSizeLimit() {
        assertEquals(30 * 60_000, RecorderMachine.MAX_DURATION_MS);
        assertTrue(RecorderMachine.MAX_FILE_BYTES < 26_214_400L);
        long worst = 0;
        for (RecorderMachine.Profile p : RecorderMachine.PROFILES) worst = Math.max(worst, p.bitRate / 8L * (RecorderMachine.MAX_DURATION_MS / 1000));
        assertTrue("thirty minutes at the highest bit rate fits", worst < RecorderMachine.MAX_FILE_BYTES);
        for (RecorderMachine.Profile p : RecorderMachine.PROFILES) {
            assertEquals("mono", 1, p.channels);
            assertTrue("a speech bit rate", p.bitRate >= 24_000 && p.bitRate <= 64_000);
        }
    }

    /** The memo action on a tile or the widget starts a memo, and tapped again stops it. */
    @Test public void aTapStartsOrStopsAndADoubleTapDoesNotStopWhatItJustStarted() {
        assertEquals(RecorderMachine.Tap.START, RecorderMachine.tap(0, 10_000, false));
        assertEquals(RecorderMachine.Tap.SHOW, RecorderMachine.tap(9_000, 10_000, false));
        assertEquals(RecorderMachine.Tap.STOP, RecorderMachine.tap(5_000, 10_000, false));
        assertEquals("opened from the recording's notification, the screen is shown", RecorderMachine.Tap.SHOW,
                RecorderMachine.tap(5_000, 10_000, true));
        assertEquals("with nothing recording, the notification's screen has nothing to show and starts nothing",
                RecorderMachine.Tap.CLOSE, RecorderMachine.tap(0, 10_000, true));
    }

    // ── the screen rebuilt by Android is not the owner tapping again ─────────

    @Test public void aRebuiltScreenNeverStopsTheRecordingItsIntentStarted() {
        long started = 1_000_000;
        // A rotation three seconds in: read as a tap, the same intent would stop and save the memo.
        assertEquals(RecorderMachine.Tap.STOP, RecorderMachine.open(false, started, started + 3000, false, false));
        assertEquals(RecorderMachine.Tap.SHOW, RecorderMachine.open(true, started, started + 3000, false, false));
        assertEquals(RecorderMachine.Tap.SHOW, RecorderMachine.open(true, started, started + 600_000, true, false));
    }

    @Test public void aRebuiltScreenWithNothingRecordingStartsNothing() {
        assertEquals("the first open starts a recording", RecorderMachine.Tap.START, RecorderMachine.open(false, 0, 5000, false, false));
        assertEquals("a rebuild does not start a second one", RecorderMachine.Tap.CLOSE, RecorderMachine.open(true, 0, 5000, false, false));
        assertEquals("the permission dialog is still up: wait for its answer", RecorderMachine.Tap.SHOW,
                RecorderMachine.open(true, 0, 5000, false, true));
    }

    // ── the container ────────────────────────────────────────────────────────

    @Test public void aRecordingIsOneOggFileWhereThePhoneCanWriteOne() {
        assertEquals(RecorderMachine.Format.OGG_OPUS, RecorderMachine.format(29));
        assertEquals(RecorderMachine.Format.OGG_OPUS, RecorderMachine.format(34));
        assertEquals(RecorderMachine.Format.MP4_SEGMENTS, RecorderMachine.format(28));
        assertEquals(RecorderMachine.Format.MP4_SEGMENTS, RecorderMachine.format(26));
    }

    @Test public void anOggRecordingIsAMemoEvenWhenTheRecordersStopFailed() {
        assertTrue(RecorderMachine.keep(RecorderMachine.Format.OGG_OPUS, false, 60_000, 500_000));
        assertFalse(RecorderMachine.keep(RecorderMachine.Format.OGG_OPUS, true, 999, 3_000));
        assertFalse(RecorderMachine.keep(RecorderMachine.Format.OGG_OPUS, true, 5_000, 0));
        assertFalse("an MP4 without its index is not", RecorderMachine.keep(RecorderMachine.Format.MP4_SEGMENTS, false, 60_000, 500_000));
    }

    @Test public void anMp4RecordingIsWrittenInFiveMinuteSegments() {
        assertEquals(5 * 60_000, RecorderMachine.SEGMENT_MS);
        // Thirty minutes is six segments: six of the sixty memos a day, not thirty.
        assertEquals(6, RecorderMachine.MAX_DURATION_MS / RecorderMachine.SEGMENT_MS);
        assertEquals(1_260_000L, RecorderMachine.segmentBytes(32_000));
        assertTrue(RecorderMachine.segmentBytes(64_000) < RecorderMachine.MAX_FILE_BYTES);
    }
}

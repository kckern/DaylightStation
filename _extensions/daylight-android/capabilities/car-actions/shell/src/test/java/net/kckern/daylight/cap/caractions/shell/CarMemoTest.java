package net.kckern.daylight.cap.caractions.shell;

import static org.junit.Assert.*;

import net.kckern.daylight.cap.quickinput.shell.RecorderMachine;
import net.kckern.daylight.cap.quickinput.shell.RecorderMachine.Action;

import org.junit.Test;

public class CarMemoTest {
    private final CarMemo memo = new CarMemo();

    /** Showing, refreshing or connecting the car screen never starts a recording. Only a tap does. */
    @Test public void nothingButATapStartsARecording() {
        for (CarMemo.Screen e : new CarMemo.Screen[] { CarMemo.Screen.SHOWN, CarMemo.Screen.REFRESHED, CarMemo.Screen.CONNECTED,
                CarMemo.Screen.SHOWN, CarMemo.Screen.REFRESHED }) {
            assertEquals(e.name(), Action.NONE, memo.on(e, 1000));
            assertFalse(memo.recording());
        }
        assertEquals(Action.BEGIN, memo.on(CarMemo.Screen.TAP_ENTRY, 2000));
        assertEquals("a second tap on the entry while starting is the same tap", Action.NONE, memo.on(CarMemo.Screen.TAP_ENTRY, 2100));
    }

    @Test public void aRefreshWhileRecordingChangesNothing() {
        memo.on(CarMemo.Screen.TAP_ENTRY, 1000);
        memo.began(1000);
        assertEquals(Action.NONE, memo.on(CarMemo.Screen.REFRESHED, 5000));
        assertEquals(Action.NONE, memo.on(CarMemo.Screen.CONNECTED, 6000));
        assertTrue(memo.recording());
    }

    @Test public void stopTheCapAnErrorOrTheScreenGoingAwayEndsAndSaves() {
        for (CarMemo.Screen end : new CarMemo.Screen[] { CarMemo.Screen.TAP_STOP, CarMemo.Screen.GONE }) {
            CarMemo m = new CarMemo();
            m.on(CarMemo.Screen.TAP_ENTRY, 1000);
            m.began(1000);
            assertEquals(end.name(), Action.FINISH, m.on(end, 60_000));
            assertFalse(m.recording());
        }
        CarMemo capped = new CarMemo();
        capped.on(CarMemo.Screen.TAP_ENTRY, 1000);
        capped.began(1000);
        assertEquals(Action.FINISH, capped.ended(RecorderMachine.Event.CAP_REACHED, 1_801_000));
        CarMemo broken = new CarMemo();
        broken.on(CarMemo.Screen.TAP_ENTRY, 1000);
        broken.began(1000);
        assertEquals(Action.FINISH, broken.ended(RecorderMachine.Event.RECORDER_ERROR, 5000));
    }

    @Test public void aRecordingIsRefusedBeforeItStartsWhenItCannotBeMade() {
        assertNull(CarMemo.refusal(5, true, "", false));
        assertEquals(CarMemo.CAR_TOO_OLD, CarMemo.refusal(4, true, "", false));
        assertEquals("Allow the microphone on the phone first", CarMemo.refusal(6, false, "", false));
        assertEquals("Daylight is not set up for quick inputs", CarMemo.refusal(6, true, "Daylight is not set up for quick inputs", false));
        assertEquals(CarMemo.BUSY, CarMemo.refusal(6, true, "", true));
        assertEquals(5, CarMemo.MIN_CAR_API);
    }

    /** The car delivers 16 kHz, 16-bit mono PCM: the clock is the number of bytes read. */
    @Test public void theClockAndTheTimestampsComeFromTheBytesRead() {
        assertEquals(16_000, CarMemo.SAMPLE_RATE);
        assertEquals(1000, CarMemo.durationMs(32_000));
        assertEquals(500_000, CarMemo.ptsUs(16_000));
        assertEquals(0, CarMemo.ptsUs(0));
        assertEquals("Recording 0:00", CarMemo.clock(0));
        assertEquals("Recording 1:05", CarMemo.clock(65_400));
        assertEquals("Recording 30:00", CarMemo.clock(1_800_000));
    }

    @Test public void thirtyMinutesOrTheFileLimitEndsIt() {
        long thirty = 30L * 60 * 32_000;
        assertFalse(CarMemo.capReached(thirty - 2, 1000));
        assertTrue(CarMemo.capReached(thirty, 1000));
        assertTrue(CarMemo.capReached(32_000, RecorderMachine.MAX_FILE_BYTES));
    }

    /** Ogg/Opus where the phone has an Opus encoder and an Ogg writer (Android 10 and later); else AAC in MP4 segments. */
    @Test public void theContainerIsTheRecordersRule() {
        assertEquals(RecorderMachine.Format.OGG_OPUS, CarMemo.format(29, true));
        assertEquals(RecorderMachine.Format.MP4_SEGMENTS, CarMemo.format(29, false));
        assertEquals(RecorderMachine.Format.MP4_SEGMENTS, CarMemo.format(28, true));
    }

    @Test public void anMp4SegmentEndsAtFiveMinutes() {
        assertFalse(CarMemo.segmentDone(0, 299_999_999L));
        assertTrue(CarMemo.segmentDone(0, 300_000_000L));
        assertTrue(CarMemo.segmentDone(300_000_000L, 600_000_000L));
    }

    @Test public void whatTheDriverIsToldAtTheEnd() {
        assertEquals("Saved for Journal", CarMemo.outcome(true, "Journal"));
        assertEquals("Not saved: too short or nothing was heard", CarMemo.outcome(false, "Journal"));
    }
}

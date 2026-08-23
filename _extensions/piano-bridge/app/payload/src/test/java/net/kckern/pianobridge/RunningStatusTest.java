package net.kckern.pianobridge;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

/**
 * Pins the MIDI parsing rule that was missing: running status. A chunk that
 * starts with a data byte is NOT stray if a channel status was seen before — it
 * is the same message type repeated with the status byte omitted. Dropping it
 * silently lost every such message (the piano's echo, and some real notes).
 *
 * This mirrors the receiver's loop exactly so the rule is testable on the JVM
 * without a MidiReceiver; if BridgeCore's parser diverges, update BOTH.
 */
public class RunningStatusTest {

    /** Reference implementation of the receiver's status handling. */
    static List<int[]> parse(int[]... chunks) {
        List<int[]> msgs = new ArrayList<>();
        int runningStatus = 0;
        for (int[] data : chunks) {
            int i = 0, end = data.length;
            while (i < end) {
                int status = data[i] & 0xFF;
                int d; // index of the first DATA byte — the same rule as BridgeCore
                if (status < 0x80) {
                    if (runningStatus >= 0x80 && runningStatus < 0xF0) { status = runningStatus; d = i; }
                    else { i++; continue; }
                } else if (status < 0xF0) { runningStatus = status; d = i + 1; }
                else if (status >= 0xF8) { i++; continue; }
                else { runningStatus = 0; d = i + 1; }
                int type = status & 0xF0;
                if ((type == 0x90 || type == 0x80 || type == 0xB0) && d + 1 < end) {
                    msgs.add(new int[] { status, data[d] & 0x7F, data[d + 1] & 0x7F });
                    i = d + 2;
                } else if (type == 0xC0 && d < end) {
                    msgs.add(new int[] { status, data[d] & 0x7F });
                    i = d + 1;
                } else { i++; }
            }
        }
        return msgs;
    }

    @Test public void explicitStatusStillWorks() {
        List<int[]> m = parse(new int[] { 0x90, 60, 100, 0x80, 60, 0 });
        assertEquals(2, m.size());
        assertEquals(0x90, m.get(0)[0]);
        assertEquals(0x80, m.get(1)[0]);
    }

    @Test public void runningStatusWithinOneChunk() {
        // 90 3C 64 3E 64 40 64 = three note-ons, status sent once.
        List<int[]> m = parse(new int[] { 0x90, 60, 100, 62, 100, 64, 100 });
        assertEquals(3, m.size());
        assertEquals(62, m.get(1)[1]);
        assertEquals(64, m.get(2)[1]);
    }

    @Test public void runningStatusAcrossChunks() {
        // The BLE-MIDI case: the status byte was in the PREVIOUS packet. Before the
        // fix this second chunk was thrown away byte by byte as "stray".
        List<int[]> m = parse(new int[] { 0x9F, 1, 1 }, new int[] { 1, 0 });
        assertEquals(2, m.size());
        assertEquals("channel 16 note-on (vel 0 = off) must survive", 0x9F, m.get(1)[0]);
        assertEquals(1, m.get(1)[1]);
        assertEquals(0, m.get(1)[2]);
    }

    @Test public void runningStatusAtChunkStartReadsTheRightBytes() {
        // The bug the first draft had: faking a status position with i-- reads
        // data[i+1]/data[i+2] = the SECOND and THIRD bytes, skipping the real note.
        // Here the chunk is exactly "3C 64" after a 90 in the prior chunk: the note
        // must be 60 (0x3C), not 100.
        List<int[]> m = parse(new int[] { 0x90, 1, 1 }, new int[] { 0x3C, 0x64 });
        assertEquals(2, m.size());
        assertEquals(0x3C, m.get(1)[1]);
        assertEquals(0x64, m.get(1)[2]);
    }

    @Test public void realtimeBytesDoNotBreakRunningStatus() {
        // F8 (clock) / FE (active sense) are interleaved by real hardware and must be
        // transparent: the running status survives them.
        List<int[]> m = parse(new int[] { 0x90, 60, 100, 0xFE, 62, 100 });
        assertEquals(2, m.size());
        assertEquals(62, m.get(1)[1]);
    }

    @Test public void sysExClearsRunningStatus() {
        // After F0…F7 a bare data byte IS stray — there is no channel status to apply.
        List<int[]> m = parse(new int[] { 0x90, 60, 100, 0xF0, 0x7E, 0xF7, 62, 100 });
        assertEquals(1, m.size());
    }

    @Test public void trulyStrayBytesAreSkippedWhenNoStatusIsKnown() {
        List<int[]> m = parse(new int[] { 60, 100, 0x90, 64, 100 });
        assertEquals(1, m.size());
        assertEquals(64, m.get(0)[1]);
    }
}

package net.kckern.pianobridge;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.fail;
import org.junit.Test;

/**
 * Cover for the /midi/send + midi.raw hex parser. This is the only gate between a
 * hand-typed byte string and the piano's MIDI input, and a truncated SysEx is worse
 * than a rejected one — an unterminated F0 can leave the synth waiting for its F7.
 */
public class ControlServerHexTest {

    @Test public void parsesSpacedHex() {
        // GS reverb type = Hall2, straight out of piano/config.yml.
        byte[] b = ControlServer.parseHexBytes("F0 41 10 42 12 40 01 30 04 15 F7");
        assertEquals(11, b.length);
        assertEquals((byte) 0xF0, b[0]);
        assertEquals((byte) 0xF7, b[10]);
    }

    @Test public void toleratesSeparatorsAndCasingAnd0xPrefixes() {
        byte[] expected = { (byte) 0xC0, 0x18 };
        assertArrayEquals(expected, ControlServer.parseHexBytes("c0 18"));
        assertArrayEquals(expected, ControlServer.parseHexBytes("C0,18"));
        assertArrayEquals(expected, ControlServer.parseHexBytes("0xC0 0x18"));
        assertArrayEquals(expected, ControlServer.parseHexBytes("C018"));
    }

    @Test public void emptyInputYieldsNoBytesRatherThanThrowing() {
        assertEquals(0, ControlServer.parseHexBytes("   ").length);
    }

    @Test public void rejectsOddDigitCountInsteadOfTruncating() {
        try {
            ControlServer.parseHexBytes("F0 41 1");
            fail("expected an odd-length rejection, not a silently truncated SysEx");
        } catch (IllegalArgumentException expected) {
            // Message names the problem so a mistyped byte string is obvious over HTTP.
            assertEquals(true, expected.getMessage().contains("odd"));
        }
    }

    @Test public void ignoresNonHexNoiseRatherThanMisreadingIt() {
        // A pasted "0xF0, 0x7F" style list still parses to the intended bytes.
        assertArrayEquals(new byte[] { (byte) 0xF0, 0x7F },
                ControlServer.parseHexBytes("[0xF0, 0x7F]"));
    }
}

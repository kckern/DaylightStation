package net.kckern.portalkeys.payload;

import org.junit.Test;
import java.util.List;
import static org.junit.Assert.*;

public class BootKeyboardDecoderTest {
    @Test public void emitsPressAndRelease() {
        BootKeyboardDecoder d = new BootKeyboardDecoder();
        List<HidKeyEvent> down = d.accept(report(0, 4));
        assertEquals(1, down.size());
        assertEquals("a", down.get(0).key);
        assertEquals("KeyA", down.get(0).code);
        assertEquals("down", down.get(0).action);
        List<HidKeyEvent> up = d.accept(report(0));
        assertEquals(1, up.size());
        assertEquals("a", up.get(0).key);
        assertEquals("up", up.get(0).action);
    }

    @Test public void appliesShiftAndCapsLock() {
        BootKeyboardDecoder d = new BootKeyboardDecoder();
        List<HidKeyEvent> shifted = d.accept(report(0x02, 4));
        assertEquals("Shift", shifted.get(0).key);
        assertEquals("A", shifted.get(1).key);
        d.accept(report(0));
        d.accept(report(0, 57));
        d.accept(report(0));
        assertEquals("A", d.accept(report(0, 4)).get(0).key);
    }

    @Test public void ignoresIdenticalReports() {
        BootKeyboardDecoder d = new BootKeyboardDecoder();
        d.accept(report(0, 40));
        assertTrue(d.accept(report(0, 40)).isEmpty());
    }

    private static byte[] report(int modifiers, int... usages) {
        byte[] r = new byte[8];
        r[0] = (byte) modifiers;
        for (int i = 0; i < usages.length && i < 6; i++) r[i + 2] = (byte) usages[i];
        return r;
    }
}

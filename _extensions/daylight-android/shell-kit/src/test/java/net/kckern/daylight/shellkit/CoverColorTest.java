package net.kckern.daylight.shellkit;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import org.junit.Test;

public class CoverColorTest {
    private static int[] fill(int n, int color) {
        int[] p = new int[n];
        Arrays.fill(p, color);
        return p;
    }

    @Test public void greyscaleArtHasNoColor() {
        int[] p = new int[1024];
        for (int i = 0; i < p.length; i++) { int v = i % 256; p[i] = 0xff000000 | v << 16 | v << 8 | v; }
        assertEquals(CoverColor.NONE, CoverColor.of(p));
        assertEquals(CoverColor.NONE, CoverColor.of(new int[0]));
    }

    @Test public void theDominantLivelyHueWins() {
        int[] p = new int[1024];
        Arrays.fill(p, 0xff111111);                 // a mostly black sleeve
        for (int i = 0; i < 300; i++) p[i] = 0xffc0501a;   // a big orange sun
        for (int i = 300; i < 340; i++) p[i] = 0xff2050c0; // a small blue sign
        int c = CoverColor.of(p);
        assertTrue(Integer.toHexString(c), ((c >> 16) & 0xff) > 0xa0 && (c & 0xff) < 0x40);
    }

    @Test public void aSpeckIsNotAColor() {
        int[] p = fill(1024, 0xff808080);
        p[0] = 0xffff0000;
        assertEquals(CoverColor.NONE, CoverColor.of(p));
    }

    @Test public void transparentPixelsAreIgnored() {
        assertEquals(CoverColor.NONE, CoverColor.of(fill(64, 0x00ff0000)));
    }
}

package net.kckern.daylight.shellkit;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ThemeColorsTest {
    private static ThemeColors light() {
        return new ThemeColors(false, 0xfff4f7f4, 0xffffffff, 0xff14382f, 0xff125b47, 0xff17465a, 0xffb3261e, 0xff9a4a00);
    }

    private static ThemeColors dark() {
        return new ThemeColors(true, 0xff0f1916, 0xff18241f, 0xffe6f2ec, 0xff4fc99a, 0xff8cc3dc, 0xfff2b8b5, 0xffffb870);
    }

    @Test public void textOnFillsIsReadable() {
        for (ThemeColors c : new ThemeColors[] { light(), dark() }) {
            assertTrue(ThemeColors.contrast(c.onPrimary, c.primary) >= 4.5);
            assertTrue(ThemeColors.contrast(c.onSecondary, c.secondary) >= 4.5);
            assertTrue("muted text on the page", ThemeColors.contrast(c.inkMuted, c.background) >= 4.5);
            assertTrue("ink on a chip", ThemeColors.contrast(c.ink, c.surfaceVariant) >= 7);
        }
    }

    @Test public void lightPrimaryCarriesWhiteText() {
        assertEquals(0xffffffff, light().onPrimary);
        assertEquals(0xff10201a, dark().onPrimary);
    }

    @Test public void anyCoverColorEndsLegible() {
        int[] covers = { 0xffffff00, 0xff000080, 0xff202020, 0xffffeedd, 0xff7a3b1f, 0xff00ff00 };
        for (int cover : covers) {
            for (ThemeColors base : new ThemeColors[] { light(), dark() }) {
                ThemeColors c = base.withAccent(cover);
                assertTrue(Integer.toHexString(cover), ThemeColors.contrast(c.primary, c.background) >= 3.0);
                // A mid-tone accent caps what white or near-black can reach (about 4.1:1);
                // the play glyph on it is large, where WCAG asks 3:1.
                assertTrue(ThemeColors.contrast(c.onPrimary, c.primary) >= 4.0);
                assertTrue(ThemeColors.contrast(c.ink, c.background) >= 7);
                assertEquals(base.danger, c.danger);
            }
        }
    }

    @Test public void mixEnds() {
        assertEquals(0xff000000, ThemeColors.mix(0xff000000, 0xffffffff, 0));
        assertEquals(0xffffffff, ThemeColors.mix(0xff000000, 0xffffffff, 1));
        assertEquals(0x80123456, ThemeColors.alpha(0xff123456, 0x80));
    }

    @Test public void nightModeParsing() {
        assertEquals(0, DaylightTheme.nightMode("system"));
        assertEquals(0, DaylightTheme.nightMode(null));
        assertEquals(android.content.res.Configuration.UI_MODE_NIGHT_YES, DaylightTheme.nightMode("dark"));
    }
}

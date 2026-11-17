package net.kckern.daylight.cap.widgets.shell;

import static org.junit.Assert.*;

import org.junit.Test;

import java.util.List;

public class WidgetButtonsTest {
    @Test public void oneButtonPerAssignedSlotInOrder() {
        List<WidgetButtons.Button> b = WidgetButtons.of(
                new String[] { "New memo", "", "Feed", "" },
                new String[] { "daylight://action/memo?k=a", "", "daylight://action/feed?k=a", "" });
        assertEquals(2, b.size());
        assertEquals(1, b.get(0).slot);
        assertEquals("New memo", b.get(0).label);
        assertEquals("daylight://action/memo?k=a", b.get(0).link);
        assertEquals(3, b.get(1).slot);
    }

    @Test public void anEmptyCacheIsOneButtonThatOpensTheApp() {
        List<WidgetButtons.Button> b = WidgetButtons.of(new String[] { "", "", "", "" }, new String[] { "", "", "", "" });
        assertEquals(1, b.size());
        assertEquals(1, b.get(0).slot);
        assertEquals("Daylight", b.get(0).label);
        assertEquals("no link: the provider opens the app's own launcher activity", "", b.get(0).link);
    }

    @Test public void aSlotWithALinkButNoLabelStillGetsAName() {
        assertEquals("Daylight", WidgetButtons.of(new String[] { "", "", "", "" },
                new String[] { "daylight://action/x", "", "", "" }).get(0).label);
    }

    @Test public void aLabelWithNoLinkIsNotAButton() {
        List<WidgetButtons.Button> b = WidgetButtons.of(new String[] { "Stale", "", "", "" }, new String[] { "", "", "", "" });
        assertEquals("Daylight", b.get(0).label);
        assertEquals("", b.get(0).link);
    }
}

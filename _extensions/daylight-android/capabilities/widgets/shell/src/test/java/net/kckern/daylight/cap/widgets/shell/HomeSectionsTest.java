package net.kckern.daylight.cap.widgets.shell;

import static org.junit.Assert.*;

import org.junit.Test;

public class HomeSectionsTest {
    @Test public void playFirstThenCaptureConnectServices() {
        assertEquals(HomeSections.PLAY, HomeSections.first());
        assertEquals(HomeSections.PLAY, HomeSections.ORDER[0]);
        assertEquals(HomeSections.SERVICES, HomeSections.ORDER[3]);
        assertEquals(1, HomeSections.position(HomeSections.CAPTURE));
    }

    @Test public void aFlickGoesToTheNeighbourInTheBarAndStopsAtTheEnds() {
        assertEquals(HomeSections.CAPTURE, HomeSections.step(HomeSections.PLAY, 1));
        assertEquals(HomeSections.PLAY, HomeSections.step(HomeSections.PLAY, -1));
        assertEquals(HomeSections.SERVICES, HomeSections.step(HomeSections.CONNECT, 1));
        assertEquals(HomeSections.SERVICES, HomeSections.step(HomeSections.SERVICES, 1));
    }

    @Test public void restoredAndSpoken() {
        assertEquals(HomeSections.CONNECT, HomeSections.restored(HomeSections.CONNECT));
        assertEquals(HomeSections.PLAY, HomeSections.restored(-1));
        assertEquals("Play, tab 1 of 4, selected", HomeSections.spoken(HomeSections.PLAY, true));
        assertEquals("Services, tab 4 of 4", HomeSections.spoken(HomeSections.SERVICES, false));
    }
}

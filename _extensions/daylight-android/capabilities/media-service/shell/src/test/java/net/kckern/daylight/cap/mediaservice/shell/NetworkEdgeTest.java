package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.*;

import org.junit.Test;

public class NetworkEdgeTest {
    @Test public void theFirstValidatedReportAfterRegisteringIsBack() {
        assertTrue(new NetworkEdge().onCapabilities(true));
    }

    @Test public void anUnvalidatedReportIsNotBack() {
        assertFalse(new NetworkEdge().onCapabilities(false));
    }

    @Test public void signalAndBandwidthChangesOnAValidatedNetworkAreNotBack() {
        NetworkEdge e = new NetworkEdge();
        assertTrue(e.onCapabilities(true));
        for (int i = 0; i < 10; i++) assertFalse(e.onCapabilities(true));
    }

    @Test public void lostOrUnvalidatedThenValidatedIsBackOnce() {
        NetworkEdge e = new NetworkEdge();
        e.onCapabilities(true);
        e.onLost();
        assertTrue(e.onCapabilities(true));
        assertFalse(e.onCapabilities(true));
        e.onCapabilities(false);
        assertTrue(e.onCapabilities(true));
    }
}

package net.kckern.daylight.cap.caractions.shell;

import static org.junit.Assert.*;

import net.kckern.daylight.api.PayloadPort;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

public class PayloadCarTest {
    private final List<String> seen = new ArrayList<>();
    private PayloadPort.Handler handler;

    @After public void tearDown() {
        if (handler != null) PayloadPort.named(PayloadCar.PORT).detach(handler);
    }

    /** The payload's capability attaches to a port of this name (CarActionsCapability.PORT). */
    @Test public void thePortIsTheOneThePayloadServes() {
        assertEquals("car", PayloadCar.PORT);
    }

    @Test public void theTwoRequestsAreWhatThePayloadReads() throws Exception {
        handler = request -> { seen.add(request); return "{}"; };
        PayloadPort.named(PayloadCar.PORT).attach(handler);
        PayloadCar car = new PayloadCar();
        assertTrue(car.awaitReady(0));
        car.list(0);
        car.run("omw", 0);
        assertEquals("list", new JSONObject(seen.get(0)).getString("op"));
        JSONObject run = new JSONObject(seen.get(1));
        assertEquals("run", run.getString("op"));
        assertEquals("omw", run.getString("id"));
        assertEquals("an id and nothing else", 2, run.length());
    }

    @Test public void withNoPayloadACallIsNotReady() throws Exception {
        try { new PayloadCar().list(0); fail(); } catch (PayloadPort.NotReadyException expected) { }
        assertFalse(new PayloadCar().awaitReady(50));
    }
}

package net.kckern.daylight.api;

import static org.junit.Assert.*;

import org.junit.Test;

public class ControlBindTest {
    @Test public void loopbackIsTheLoopbackAddressAndLanIsEveryInterface() {
        assertEquals("127.0.0.1", ControlBind.host("loopback"));
        assertNull("null tells NanoHTTPD to listen on every interface", ControlBind.host("lan"));
    }

    @Test public void onlyLanAndLoopbackListen() {
        assertTrue(ControlBind.listens("lan"));
        assertTrue(ControlBind.listens("loopback"));
        assertFalse("a personal phone: no control server and no lifeline", ControlBind.listens("none"));
    }

    @Test public void anUnknownValueIsTreatedAsNoneSoATypoNeverOpensAPort() {
        for (String odd : new String[] { null, "", "LAN", "everywhere", "0.0.0.0", "Loopback" }) {
            assertFalse(String.valueOf(odd), ControlBind.listens(odd));
            assertEquals("and even its host is the narrowest there is", "127.0.0.1", ControlBind.host(odd));
        }
    }
}

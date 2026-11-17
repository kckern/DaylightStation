package net.kckern.daylight.api;

import static org.junit.Assert.*;

import org.junit.Test;

public class ControlBindTest {
    @Test public void loopbackIsTheLoopbackAddressAndLanIsEveryInterface() {
        assertEquals("127.0.0.1", ControlBind.host("loopback"));
        assertNull("null tells NanoHTTPD to listen on every interface", ControlBind.host("lan"));
    }

    @Test public void anythingElseIsLoopbackSoATypoNeverOpensThePort() {
        for (String odd : new String[] { null, "", "LAN", "everywhere", "0.0.0.0" }) {
            assertEquals(String.valueOf(odd), "127.0.0.1", ControlBind.host(odd));
        }
    }
}

package net.kckern.daylight.cap.onetap.shell;

import static org.junit.Assert.*;

import org.junit.Test;

public class PinConfirmationTest {
    private static final String TOKEN = "0123456789abcdef0123456789abcdef";

    /** The payload attaches to a port of this name (OneTapActionsCapability.PIN_PORT). */
    @Test public void thePortAndTheExtraAreTheOnesThePayloadUses() {
        assertEquals("pins", PinConfirmation.PORT);
        assertEquals("token", PinConfirmation.EXTRA_TOKEN);
    }

    @Test public void onlyATokenOfTheShapeThePayloadMintsIsPassedOn() {
        assertEquals("{\"op\":\"confirmed\",\"token\":\"" + TOKEN + "\"}", PinConfirmation.request(TOKEN));
        for (String bad : new String[] { null, "", "abc", TOKEN.toUpperCase(java.util.Locale.ROOT), TOKEN + "0", TOKEN.replace('0', 'g'),
                "\"},\"op\":\"x" }) {
            assertNull(bad, PinConfirmation.request(bad));
        }
    }
}

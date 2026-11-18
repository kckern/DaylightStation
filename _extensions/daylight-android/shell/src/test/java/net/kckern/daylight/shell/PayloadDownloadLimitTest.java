package net.kckern.daylight.shell;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;

public class PayloadDownloadLimitTest {

    @Test public void thePushedPayloadLimitIs64MiB() {
        assertEquals(64L * 1024 * 1024, PayloadLoader.MAX_PAYLOAD_BYTES);
    }

    @Test public void aDownloadWithinTheLimitIsCopiedWhole() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        assertEquals(100, PayloadLoader.copyCapped(new ByteArrayInputStream(new byte[100]), out, 100));
        assertEquals(100, out.size());
    }

    @Test public void aDownloadOverTheLimitIsAbandoned() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try {
            PayloadLoader.copyCapped(new ByteArrayInputStream(new byte[200_000]), out, 100_000);
            fail("expected IOException");
        } catch (IOException e) {
            assertTrue(e.getMessage(), e.getMessage().contains("larger than 100000 bytes"));
        }
        assertTrue("nothing past the limit is written", out.size() <= 100_000);
    }

    @Test public void aDeclaredLengthOverTheLimitIsRefusedBeforeAnyByteIsRead() throws Exception {
        try {
            PayloadLoader.checkDeclaredLength(100_001, 100_000);
            fail("expected IOException");
        } catch (IOException e) {
            assertTrue(e.getMessage(), e.getMessage().contains("larger than 100000 bytes"));
        }
        PayloadLoader.checkDeclaredLength(-1, 100_000);
        PayloadLoader.checkDeclaredLength(100_000, 100_000);
    }
}

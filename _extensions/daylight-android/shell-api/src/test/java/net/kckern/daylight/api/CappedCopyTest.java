package net.kckern.daylight.api;

import static org.junit.Assert.*;

import org.junit.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;

public class CappedCopyTest {
    @Test public void aStreamWithinTheLimitIsCopiedWhole() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        assertEquals(100, CappedCopy.copy(new ByteArrayInputStream(new byte[100]), out, 100, "apk"));
        assertEquals(100, out.size());
    }

    @Test public void aStreamOverTheLimitIsAbandonedAndNamesWhatItWas() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try {
            CappedCopy.copy(new ByteArrayInputStream(new byte[200_000]), out, 100_000, "apk");
            fail("expected IOException");
        } catch (IOException e) {
            assertEquals("apk is larger than 100000 bytes", e.getMessage());
        }
        assertTrue("nothing past the limit is written", out.size() <= 100_000);
    }

    @Test public void aDeclaredLengthOverTheLimitIsRefused() throws Exception {
        try {
            CappedCopy.checkDeclaredLength(100_001, 100_000, "apk");
            fail("expected IOException");
        } catch (IOException e) {
            assertEquals("apk is larger than 100000 bytes", e.getMessage());
        }
        CappedCopy.checkDeclaredLength(-1, 100_000, "apk");
        CappedCopy.checkDeclaredLength(100_000, 100_000, "apk");
    }
}

package net.kckern.daylight.build;

import static org.junit.Assert.*;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

public class ControlTokensTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private static final String GOOD = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    private File file(String text) throws Exception {
        File f = tmp.newFile("tokens.yml");
        Files.write(f.toPath(), text.getBytes(StandardCharsets.UTF_8));
        return f;
    }

    @Test public void readsATokenPerDevice() throws Exception {
        ControlTokens t = ControlTokens.load(file("portal:\n  host: example\n  token: " + GOOD + "\n"));
        assertTrue(t.has("portal"));
        assertEquals(GOOD, t.tokenFor("portal"));
        assertFalse(t.has("piano"));
    }

    @Test public void aMissingFileMeansNoTokens() {
        assertFalse(ControlTokens.load(null).has("portal"));
        assertFalse(ControlTokens.load(new File("/nonexistent/tokens.yml")).has("portal"));
    }

    @Test public void rejectsAShortToken() throws Exception {
        File f = file("portal:\n  token: abc123\n");
        try { ControlTokens.load(f); fail("expected CatalogException"); }
        catch (CatalogException e) {
            assertTrue(e.getMessage().contains("token for 'portal' must be at least 32 characters"));
            assertFalse("the message must not contain the token", e.getMessage().contains("abc123"));
        }
    }

    @Test public void rejectsCharactersThatWouldBreakAJavaString() throws Exception {
        File f = file("portal:\n  token: \"" + GOOD.substring(1) + "\\\"\"\n");
        try { ControlTokens.load(f); fail("expected CatalogException"); }
        catch (CatalogException e) { assertTrue(e.getMessage().contains("may only contain")); }
    }
}

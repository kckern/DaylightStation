package net.kckern.daylight.build;

import static org.junit.Assert.*;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.LinkedHashMap;
import java.util.Map;

public class PlaceholdersTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    private Placeholders load(String text) throws Exception {
        File f = tmp.newFile("private.yml");
        Files.write(f.toPath(), text.getBytes(StandardCharsets.UTF_8));
        return Placeholders.load(f);
    }

    @Test public void resolvesStringDefaultsAndLeavesOtherTypesAlone() throws Exception {
        Placeholders p = load("portal:\n  token: x\nplaceholders:\n  log_store_insert_url: http://example/insert\n");
        Map<String, Object> defaults = new LinkedHashMap<>();
        defaults.put("heartbeat.logStoreUrl", "{log_store_insert_url}?a=1");
        defaults.put("heartbeat.enabled", true);
        Map<String, Object> out = p.resolveAll(defaults, "piano.yml");
        assertEquals("http://example/insert?a=1", out.get("heartbeat.logStoreUrl"));
        assertEquals(Boolean.TRUE, out.get("heartbeat.enabled"));
    }

    @Test public void anUnknownPlaceholderNamesItselfAndTheKeyButNoValues() throws Exception {
        Placeholders p = load("placeholders:\n  known: secret-ish\n");
        Map<String, Object> defaults = new LinkedHashMap<>();
        defaults.put("midi.targetMac", "{piano_midi_mac}");
        try { p.resolveAll(defaults, "piano.yml"); fail("expected CatalogException"); }
        catch (CatalogException e) {
            assertTrue(e.getMessage().contains("unknown placeholder '{piano_midi_mac}' in piano.yml defaults 'midi.targetMac'"));
            assertFalse(e.getMessage().contains("secret-ish"));
        }
    }

    @Test public void aMissingFileMeansNoPlaceholders() {
        assertEquals("plain", Placeholders.load(null).resolve("plain", "x"));
    }
}

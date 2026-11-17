package net.kckern.daylight.shell;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.concurrent.TimeUnit;

/** A pushed payload is stored under its content hash, whatever its URL looks like. */
public class PayloadLoaderNamingTest {

    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    private String stored(String url) throws Exception {
        LoaderHarness h = new LoaderHarness(tmp.newFolder());
        PayloadLoader loader = h.loader("1");
        loader.boot().get(5, TimeUnit.SECONDS);
        String sha = h.offer(url, "good:pushed");
        assertTrue(loader.requestSwap(url, sha).startsWith("accepted: "));
        loader.awaitIdle(5000);
        assertEquals("p-" + sha.substring(0, 12) + ".jar", loader.activeJar());
        assertTrue(new File(h.dir, loader.activeJar()).isFile());
        // The baked fallback still holds what came out of the APK.
        assertEquals("good:baked", new String(Files.readAllBytes(new File(h.dir, loader.bakedName()).toPath()), StandardCharsets.UTF_8));
        return loader.activeJar();
    }

    @Test public void theUrlBasenameIsNotTheStoredName() throws Exception {
        String name = stored("http://192.0.2.10:8899/p2-midi-write.jar");
        assertFalse(name.contains("midi"));
    }

    @Test public void aUrlEndingInTheBakedNameCannotReplaceTheFallback() throws Exception {
        stored("http://192.0.2.10:8899/p0-baked-v1.jar");
        stored("http://192.0.2.10:8899/p0-baked.jar");
    }

    @Test public void queryStringsAndOddCharactersDoNotReachTheFileName() throws Exception {
        assertTrue(stored("http://192.0.2.10:8899/we ird$name.jar?token=abc").matches("p-[0-9a-f]{12}\\.jar"));
        assertTrue(stored("http://192.0.2.10:8899/download?id=7").matches("p-[0-9a-f]{12}\\.jar"));
    }

    @Test public void twoPushesOfDifferentPayloadsUnderOneUrlGetTwoFiles() throws Exception {
        LoaderHarness h = new LoaderHarness(tmp.newFolder());
        PayloadLoader loader = h.loader("1");
        loader.boot().get(5, TimeUnit.SECONDS);
        String url = "http://192.0.2.10:8899/payload.jar";
        loader.requestSwap(url, h.offer(url, "good:one"));
        loader.awaitIdle(5000);
        String first = loader.activeJar();
        loader.requestSwap(url, h.offer(url, "good:two"));
        loader.awaitIdle(5000);
        assertFalse(first.equals(loader.activeJar()));
        assertEquals("the first push is still on disk, intact, as the rollback target",
                "good:one", new String(Files.readAllBytes(new File(h.dir, first).toPath()), StandardCharsets.UTF_8));
        assertEquals(first, loader.store().previous());
    }
}

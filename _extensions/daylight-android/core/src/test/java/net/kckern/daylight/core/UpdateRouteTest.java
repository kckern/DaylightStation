package net.kckern.daylight.core;

import static org.junit.Assert.*;

import fi.iki.elonen.NanoHTTPD;

import net.kckern.daylight.core.testing.TestCore;

import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.IOException;
import java.io.ByteArrayInputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

public class UpdateRouteTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    private static final String BODY = "{\"url\":\"http://192.0.2.1/a.apk\"}";

    @Test public void aSecondUpdateWhileOneIsInFlightAnswers409() throws Exception {
        final CoreRuntime core = TestCore.create(tmp.newFolder());
        core.prepare(new JSONObject("{}"));
        final CountDownLatch entered = new CountDownLatch(1);
        final CountDownLatch release = new CountDownLatch(1);
        final AtomicInteger runs = new AtomicInteger();
        core.useUpdateInstallerForTest(url -> {
            runs.incrementAndGet();
            entered.countDown();
            if (!release.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("never released");
            return 42L;
        });

        final AtomicReference<JSONObject> first = new AtomicReference<>();
        Thread t = new Thread(() -> {
            try { first.set(TestCore.call(core, "POST", "/update", null, BODY)); } catch (Exception ignored) { }
        });
        t.start();
        assertTrue(entered.await(10, TimeUnit.SECONDS));

        JSONObject second = TestCore.call(core, "POST", "/update", null, BODY);
        assertEquals(409, second.getInt("_status"));
        assertFalse(second.getBoolean("ok"));
        assertEquals("update_in_progress", second.getString("error"));
        assertEquals("the state is the first call's", "downloading", TestCore.get(core, "/update").getString("state"));

        release.countDown();
        t.join(10_000);
        assertEquals(200, first.get().getInt("_status"));
        assertEquals(42, first.get().getInt("bytes"));
        assertEquals("only the first call ran", 1, runs.get());

        // Once it finished, the next request runs.
        assertEquals(200, TestCore.call(core, "POST", "/update", null, BODY).getInt("_status"));
        assertEquals(2, runs.get());
    }

    @Test public void aFailedUpdateReleasesTheGuard() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        core.prepare(new JSONObject("{}"));
        core.useUpdateInstallerForTest(url -> { throw new IOException("apk is larger than 5 bytes"); });
        JSONObject failed = TestCore.call(core, "POST", "/update", null, BODY);
        assertEquals("IOException: apk is larger than 5 bytes", failed.getString("error"));
        assertEquals("failed", failed.getString("state"));
        assertEquals("IOException: apk is larger than 5 bytes", TestCore.call(core, "POST", "/update", null, BODY).getString("error"));
    }

    @Test public void theApkDownloadLimitIs256MiB() {
        assertEquals(256L * 1024 * 1024, Downloads.MAX_UPDATE_BYTES);
    }

    @Test public void aDownloadOverItsLimitIsAbandoned() throws Exception {
        final byte[] big = new byte[300_000];
        NanoHTTPD server = new NanoHTTPD("127.0.0.1", 0) {
            @Override public Response serve(IHTTPSession session) {
                // One answer declares its length, the other streams without one.
                return session.getUri().equals("/declared")
                        ? newFixedLengthResponse(Response.Status.OK, "application/octet-stream", new ByteArrayInputStream(big), big.length)
                        : newChunkedResponse(Response.Status.OK, "application/octet-stream", new ByteArrayInputStream(big));
            }
        };
        server.start(NanoHTTPD.SOCKET_READ_TIMEOUT, true);
        try {
            String base = "http://127.0.0.1:" + server.getListeningPort();
            File dest = new File(tmp.newFolder(), "update.apk");
            for (String path : new String[] { "/declared", "/chunked" }) {
                try {
                    Downloads.to(base + path, dest, 100_000, "apk");
                    fail("expected IOException for " + path);
                } catch (IOException e) {
                    assertEquals(path, "apk is larger than 100000 bytes", e.getMessage());
                }
                assertTrue(path + ": nothing past the limit is written", dest.length() <= 100_000);
            }
            assertEquals(300_000, Downloads.to(base + "/declared", dest, 300_000, "apk"));
            assertEquals(300_000, dest.length());
        } finally {
            server.stop();
        }
    }
}

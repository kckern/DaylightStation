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
        core.useUpdateInstallerForTest((url, sha) -> {
            runs.incrementAndGet();
            entered.countDown();
            if (!release.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("never released");
            return new UpdateFlow.Result(42L, false);
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
        core.useUpdateInstallerForTest((url, sha) -> { throw new IOException("apk is larger than 5 bytes"); });
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

    // ── what is installed, and what is confirmed for the user ───────────────

    private static final String OWN = "net.kckern.daylight.example";
    private static final String SHA_OF_APK = "c2c0d5b0e5e4a2e8f3d5b6f7e8c9d0a1b2c3d4e5f60718293a4b5c6d7e8f9012";

    /** The Android side of an update, as a recorder. */
    private static final class FakeDevice implements UpdateFlow.Device {
        UpdateFlow.ApkInfo apk = new UpdateFlow.ApkInfo(OWN, 8);
        long installed = 7;
        boolean autoConfirm = true;
        final java.util.List<String> calls = new java.util.ArrayList<>();
        @Override public UpdateFlow.ApkInfo inspect(File f) { calls.add("inspect"); return apk; }
        @Override public String ownPackage() { return OWN; }
        @Override public long installedVersionCode() { return installed; }
        @Override public int commit(File f) { calls.add("commit exists=" + f.isFile()); return 31; }
        @Override public boolean autoConfirmSetting() { return autoConfirm; }
        @Override public void confirm(int sessionId) { calls.add("confirm " + sessionId); }
    }

    private static final UpdateFlow.Fetcher APK_BYTES = (url, dest) -> {
        java.nio.file.Files.write(dest.toPath(), "not really an apk".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        return dest.length();
    };

    private String refusalOf(String sha, FakeDevice device, File staged) throws Exception {
        try {
            UpdateFlow.run("http://192.0.2.1/a.apk", sha, staged, APK_BYTES, device);
            return null;
        } catch (UpdateFlow.Refused refused) {
            return refused.getMessage();
        }
    }

    @Test public void anApkOfAnotherPackageIsRefusedBeforeAnySessionAndTheStagedFileIsDeleted() throws Exception {
        File staged = new File(tmp.newFolder(), "update.apk");
        FakeDevice device = new FakeDevice();
        device.apk = new UpdateFlow.ApkInfo("com.example.other", 99);
        String refusal = refusalOf(null, device, staged);
        assertTrue(refusal, refusal.startsWith("wrong_package"));
        assertEquals(java.util.Collections.singletonList("inspect"), device.calls);
        assertFalse(staged.exists());
    }

    @Test public void anOlderVersionOrAFileThatIsNotAnApkIsRefused() throws Exception {
        File staged = new File(tmp.newFolder(), "update.apk");
        FakeDevice older = new FakeDevice();
        older.apk = new UpdateFlow.ApkInfo(OWN, 6);
        assertTrue(refusalOf(null, older, staged).startsWith("older_version"));
        assertFalse(staged.exists());
        FakeDevice junk = new FakeDevice();
        junk.apk = null;
        assertTrue(refusalOf(null, junk, staged).startsWith("not_an_apk"));
        FakeDevice same = new FakeDevice();
        same.apk = new UpdateFlow.ApkInfo(OWN, 7);
        assertNull("the same version may be installed again", refusalOf(null, same, staged));
    }

    @Test public void aHashThatDoesNotMatchIsRefusedBeforeTheApkIsEvenInspected() throws Exception {
        File staged = new File(tmp.newFolder(), "update.apk");
        FakeDevice device = new FakeDevice();
        String refusal = refusalOf(SHA_OF_APK, device, staged);
        assertTrue(refusal, refusal.startsWith("sha256_mismatch"));
        assertTrue("nothing was inspected, committed or confirmed", device.calls.isEmpty());
        assertFalse(staged.exists());
    }

    @Test public void aMatchingHashCommitsAndArmsTheConfirmation() throws Exception {
        File dir = tmp.newFolder();
        File probe = new File(dir, "probe");
        APK_BYTES.fetch("", probe);
        String sha = UpdateFlow.sha256Of(probe);
        FakeDevice device = new FakeDevice();
        File staged = new File(dir, "update.apk");
        UpdateFlow.Result r = UpdateFlow.run("http://192.0.2.1/a.apk", sha.toUpperCase(), staged, APK_BYTES, device);
        assertTrue(r.confirming);
        assertEquals(java.util.Arrays.asList("inspect", "commit exists=true", "confirm 31"), device.calls);
        assertFalse("the staged file is not kept after the commit", staged.exists());
    }

    @Test public void withoutAHashTheInstallIsCommittedAndNeverConfirmedForTheUser() throws Exception {
        FakeDevice device = new FakeDevice();     // update.autoConfirm is on
        UpdateFlow.Result r = UpdateFlow.run("http://192.0.2.1/a.apk", null, new File(tmp.newFolder(), "update.apk"), APK_BYTES, device);
        assertFalse(r.confirming);
        assertEquals(java.util.Arrays.asList("inspect", "commit exists=true"), device.calls);
    }

    @Test public void theDecisionsOnTheirOwn() {
        assertNull(UpdatePolicy.apkRefusal(OWN, 8, OWN, 7));
        assertNull(UpdatePolicy.apkRefusal(OWN, 7, OWN, 7));
        assertNotNull(UpdatePolicy.apkRefusal(OWN, 6, OWN, 7));
        assertNotNull(UpdatePolicy.apkRefusal(OWN + ".other", 8, OWN, 7));
        assertNotNull(UpdatePolicy.apkRefusal(null, 8, OWN, 7));
        assertNull(UpdatePolicy.shaRefusal(null, "abc"));
        assertNull(UpdatePolicy.shaRefusal("ABC", "abc"));
        assertNotNull(UpdatePolicy.shaRefusal("abc", "abd"));
        assertNotNull(UpdatePolicy.shaRefusal("abc", null));
        assertTrue(UpdatePolicy.mayAutoConfirm(true, true));
        assertFalse(UpdatePolicy.mayAutoConfirm(true, false));
        assertFalse(UpdatePolicy.mayAutoConfirm(false, true));
        assertTrue(UpdatePolicy.wellFormedSha256(SHA_OF_APK));
        assertFalse(UpdatePolicy.wellFormedSha256("abc123"));
        assertFalse(UpdatePolicy.confirmationExpired(1000, 1000 + 90_000));
        assertTrue(UpdatePolicy.confirmationExpired(1000, 1000 + 90_001));
    }

    @Test public void theRouteTakesSha256FromTheBodyOrTheQueryAndRefusesAMalformedOne() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        core.prepare(new JSONObject("{}"));
        final java.util.List<String> seen = new java.util.ArrayList<>();
        core.useUpdateInstallerForTest((url, sha) -> { seen.add(url + " " + sha); return new UpdateFlow.Result(5, sha != null); });

        JSONObject withSha = TestCore.call(core, "POST", "/update", null,
                "{\"url\":\"http://192.0.2.1/a.apk\",\"sha256\":\"" + SHA_OF_APK + "\"}");
        assertTrue(withSha.getBoolean("sha256Verified"));
        assertTrue(withSha.getBoolean("confirming"));
        java.util.Map<String, String> query = new java.util.HashMap<>();
        query.put("url", "http://192.0.2.1/b.apk");
        query.put("sha256", SHA_OF_APK);
        TestCore.call(core, "POST", "/update", query, null);
        JSONObject plain = TestCore.call(core, "POST", "/update", null, BODY);
        assertFalse(plain.getBoolean("sha256Verified"));
        assertFalse(plain.getBoolean("confirming"));
        assertEquals(java.util.Arrays.asList("http://192.0.2.1/a.apk " + SHA_OF_APK, "http://192.0.2.1/b.apk " + SHA_OF_APK,
                "http://192.0.2.1/a.apk null"), seen);

        JSONObject bad = TestCore.call(core, "POST", "/update", null, "{\"url\":\"http://192.0.2.1/a.apk\",\"sha256\":\"abc123\"}");
        assertEquals(400, bad.getInt("_status"));
        assertEquals("nothing was downloaded for it", 3, seen.size());
    }

    @Test public void aRefusalIsTheRoutesErrorAndLeavesTheStateFailed() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        core.prepare(new JSONObject("{}"));
        core.useUpdateInstallerForTest((url, sha) -> { throw new UpdateFlow.Refused("wrong_package: the APK is a, this app is b"); });
        JSONObject refused = TestCore.call(core, "POST", "/update", null, BODY);
        assertFalse(refused.getBoolean("ok"));
        assertEquals("wrong_package: the APK is a, this app is b", refused.getString("error"));
        JSONObject state = TestCore.get(core, "/update");
        assertEquals("failed", state.getString("state"));
        assertEquals("wrong_package: the APK is a, this app is b", state.getString("lastError"));
    }

    @Test public void anInstallNobodyConfirmedStopsAwaitingAfterTheWindow() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        core.prepare(new JSONObject("{}"));
        final long[] now = { 1_000_000L };
        core.useUpdateClockForTest(() -> now[0]);
        core.useUpdateInstallerForTest((url, sha) -> new UpdateFlow.Result(5, false));
        assertEquals("awaiting_confirmation", TestCore.call(core, "POST", "/update", null, BODY).getString("state"));

        now[0] += 90_000L;
        JSONObject waiting = TestCore.get(core, "/update");
        assertEquals("awaiting_confirmation", waiting.getString("state"));
        assertTrue(waiting.isNull("lastError"));

        now[0] += 1;
        JSONObject expired = TestCore.get(core, "/update");
        assertEquals("failed", expired.getString("state"));
        assertTrue(expired.getString("lastError"), expired.getString("lastError").startsWith("not_confirmed"));
        assertEquals("it stays failed", "failed", TestCore.get(core, "/update").getString("state"));

        // The next request starts over.
        assertEquals("awaiting_confirmation", TestCore.call(core, "POST", "/update", null, BODY).getString("state"));
        assertTrue(TestCore.get(core, "/update").isNull("lastError"));
    }

    // ── an update under lockdown ──────────────────────────────────────────────

    @Test public void theInstallersDialogIsExemptFromRecallWhileAnUpdateWaitsForIt() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        core.prepare(new JSONObject("{}"));
        final java.util.List<String> grants = new java.util.ArrayList<>();
        final java.util.List<String> atInstall = new java.util.ArrayList<>();
        core.services().provide(net.kckern.daylight.core.spi.LockdownControl.class, new net.kckern.daylight.core.spi.LockdownControl() {
            @Override public boolean locked() { return true; }
            @Override public String front() { return null; }
            @Override public String frontActivity() { return null; }
            @Override public String lastAway() { return null; }
            @Override public void allowWhileInFront(String packageName) { }
            @Override public void allowFor(String rule, long durationMs) { grants.add(rule + " " + durationMs); }
            @Override public boolean recall(long waitMs) { return true; }
        });
        core.useUpdateInstallerForTest((url, sha) -> { atInstall.addAll(grants); return new UpdateFlow.Result(5, false); });
        assertEquals("awaiting_confirmation", TestCore.call(core, "POST", "/update", null, BODY).getString("state"));
        // In place before the session is committed: the dialog appears at the commit, and
        // a watcher that recalled the kiosk over it would leave the install unconfirmed.
        assertTrue(atInstall.contains("com.android.packageinstaller " + UpdatePolicy.INSTALLER_EXEMPT_MS));
        assertTrue(atInstall.contains("com.google.android.packageinstaller " + UpdatePolicy.INSTALLER_EXEMPT_MS));
        assertEquals("nothing but the two installer packages", 2, new java.util.HashSet<>(grants).size());
        assertTrue("timed: the exemption ends by itself", UpdatePolicy.INSTALLER_EXEMPT_MS <= 10 * 60_000L);
    }

    @Test public void anUpdateWithNoLockdownInTheBuildNeedsNoExemption() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        core.prepare(new JSONObject("{}"));
        core.useUpdateInstallerForTest((url, sha) -> new UpdateFlow.Result(5, false));
        assertEquals("awaiting_confirmation", TestCore.call(core, "POST", "/update", null, BODY).getString("state"));
    }
}

package net.kckern.daylight.shell;

import net.kckern.daylight.api.Payload;
import net.kckern.daylight.api.ShellServices;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * A PayloadLoader over fake payloads. A fake jar is a text file whose content says
 * how its payload behaves: "good:&lt;version&gt;", "throw" or "hang".
 */
final class LoaderHarness {
    static final long DEADLINE_MS = 300L;

    static final class FakePayload implements Payload {
        final String jar;
        final String behavior;
        final AtomicInteger starts = new AtomicInteger();
        final AtomicInteger stops = new AtomicInteger();
        final CountDownLatch entered = new CountDownLatch(1);
        final CountDownLatch release = new CountDownLatch(1);

        FakePayload(String jar, String behavior) { this.jar = jar; this.behavior = behavior; }

        /** Whether the settings overrides file existed each time this payload started. */
        final List<Boolean> overridesSeenAtStart = Collections.synchronizedList(new ArrayList<>());

        @Override public void start(ShellServices shell) {
            starts.incrementAndGet();
            if (shell.payloadDir() != null) {
                overridesSeenAtStart.add(net.kckern.daylight.api.PayloadState.settingsOverrides(shell.payloadDir()).isFile());
            }
            // A payload that cannot run with the stored settings, as bluetooth-controls once could not.
            if (behavior.equals("needs-clean-settings") && shell.payloadDir() != null
                    && net.kckern.daylight.api.PayloadState.settingsOverrides(shell.payloadDir()).isFile()) {
                throw new IllegalStateException("bad stored setting");
            }
            entered.countDown();
            if (behavior.equals("throw")) throw new IllegalStateException("cannot run");
            if (behavior.equals("hang")) {
                // Ignores interruption, like a payload stuck in a native call.
                boolean waiting = true;
                while (waiting) {
                    try { release.await(); waiting = false; } catch (InterruptedException stillStuck) { }
                }
            }
        }

        @Override public void stop() { stops.incrementAndGet(); }
        @Override public String version() { return behavior.startsWith("good:") ? behavior.substring(5) : behavior; }
        @Override public void onShellComponent(String name, Object instance) { }
    }

    static final class Shell implements ShellServices {
        /** The real shell answers with the payload store's directory. */
        File payloadDir;
        final List<String> notes = Collections.synchronizedList(new ArrayList<>());
        @Override public Object context() { return null; }
        @Override public String deviceId() { return "test"; }
        @Override public int shellVersionCode() { return 1; }
        @Override public String controlToken() { return "0123456789abcdef0123456789abcdef"; }
        @Override public File payloadDir() { return payloadDir; }
        @Override public Object component(String name) { return null; }
        @Override public void updateNotification(String text) { }
        @Override public String requestPayloadSwap(String url, String sha256) { return "refused: test"; }
        @Override public String requestPayloadRollback() { return "refused: test"; }
        @Override public String requestPayloadRestart() { return "refused: test"; }
        @Override public String payloadStatusJson() { return "{}"; }
        @Override public void note(String kind, String message) { notes.add(kind + " " + message); }
    }

    final File dir;
    final Shell shell = new Shell();
    /** Every payload instance the loader opened, in order. */
    final List<FakePayload> opened = Collections.synchronizedList(new ArrayList<>());
    /** What a download of each URL returns. */
    final Map<String, String> remote = new HashMap<>();
    /** Content of the payload baked into the "APK". Null means the APK has none. */
    String baked = "good:baked";

    LoaderHarness(File dir) { this.dir = dir; shell.payloadDir = dir; }

    PayloadLoader loader(String shellStamp) {
        return new PayloadLoader(dir, shell,
                jar -> {
                    FakePayload p = new FakePayload(jar.getName(), new String(Files.readAllBytes(jar.toPath()), StandardCharsets.UTF_8));
                    opened.add(p);
                    return p;
                },
                dst -> {
                    if (baked == null) throw new java.io.FileNotFoundException("no baked asset");
                    Files.write(dst.toPath(), baked.getBytes(StandardCharsets.UTF_8));
                },
                (url, dst) -> {
                    String body = remote.get(url);
                    if (body == null) throw new java.io.IOException("404 " + url);
                    Files.write(dst.toPath(), body.getBytes(StandardCharsets.UTF_8));
                },
                shellStamp, DEADLINE_MS);
    }

    /** Put a fake jar in the store directory. */
    File jar(String name, String behavior) throws Exception {
        dir.mkdirs();
        File f = new File(dir, name);
        Files.write(f.toPath(), behavior.getBytes(StandardCharsets.UTF_8));
        return f;
    }

    /** Offer a payload for download and return its sha256. */
    String offer(String url, String behavior) throws Exception {
        remote.put(url, behavior);
        File tmp = File.createTempFile("offer", ".bin");
        try {
            Files.write(tmp.toPath(), behavior.getBytes(StandardCharsets.UTF_8));
            return PayloadStore.sha256(tmp);
        } finally {
            tmp.delete();
        }
    }

    FakePayload last(String jar) {
        synchronized (opened) {
            for (int i = opened.size() - 1; i >= 0; i--) if (opened.get(i).jar.equals(jar)) return opened.get(i);
        }
        return null;
    }
}

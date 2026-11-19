package net.kckern.daylight.core.testing;

import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.Router;

import org.json.JSONObject;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Map;

/** A real CoreRuntime over a fake shell. shell().context() is null, as in any JVM test. */
public final class TestCore {
    private TestCore() { }

    public static CoreRuntime create(File dir) {
        return new CoreRuntime(new FakeShell(dir), "test", "p-test", new File(dir, "state"));
    }

    /**
     * A runtime whose shell has an Android context: a capability's start() then runs
     * past its "no context" return. Work posted to the main thread runs at once, on the
     * caller's thread, until {@link #releaseMainThread()}.
     */
    public static CoreRuntime createWithContext(File dir, FakeContext context) {
        FakeShell shell = new FakeShell(dir);
        shell.context = context;
        net.kckern.daylight.core.MainThread.runInlineForTest(true);
        return new CoreRuntime(shell, "test", "p-test", new File(dir, "state"));
    }

    public static void releaseMainThread() { net.kckern.daylight.core.MainThread.runInlineForTest(false); }

    /** Dispatches with the test token. The HTTP status is added to the body as "_status". */
    public static JSONObject call(CoreRuntime core, String method, String path,
                                  Map<String, String> query, String body) throws Exception {
        Router.Response r = core.router().dispatch(method, path, FakeShell.TOKEN,
                query == null ? Collections.emptyMap() : query, body);
        JSONObject o = new JSONObject(new String(r.body, StandardCharsets.UTF_8));
        o.put("_status", r.status);
        return o;
    }

    public static JSONObject get(CoreRuntime core, String path) throws Exception {
        return call(core, "GET", path, null, null);
    }

    public static JSONObject post(CoreRuntime core, String path) throws Exception {
        return call(core, "POST", path, null, null);
    }
}

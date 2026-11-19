package net.kckern.daylight.cap.mediaservice;

import static org.junit.Assert.*;

import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.backend.Backend;
import net.kckern.daylight.core.backend.Http;
import net.kckern.daylight.core.testing.TestCore;

import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public class BackendMediaApiTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private final List<String> gets = new ArrayList<>();
    private int status = 200;
    private BackendMediaApi api;

    @Before public void setUp() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        Backend backend = Backend.from(core);
        core.settings().set(Backend.BASE_URL, "https://kiosk.example");
        api = new BackendMediaApi(backend, new Http() {
            @Override public Reply get(String url) { gets.add(url); return new Reply(status, "{\"items\":[]}"); }
            @Override public Reply postJson(String url, String json) { throw new AssertionError("search is a GET"); }
            @Override public Reply postFile(String url, String contentType, File file, Map<String, String> headers) {
                throw new AssertionError("search is a GET");
            }
        });
    }

    /** The route read from the backend: GET /api/v1/content/query/search with text and take. */
    @Test public void aSearchIsOneEncodedQueryParameterOnTheContentQueryRoute() throws Exception {
        api.search("miles & davis/../x?y=1#z", 50);
        assertEquals("https://kiosk.example/api/v1/content/query/search?text=miles+%26+davis%2F..%2Fx%3Fy%3D1%23z&take=50", gets.get(0));
    }

    @Test public void thePlayRequestDisablesResumeOnlyWhenAsked() throws Exception {
        api.play("plex:99", true);
        api.play("plex:99", false);
        assertEquals("https://kiosk.example/api/v1/play/plex/99", gets.get(0));
        assertEquals("https://kiosk.example/api/v1/play/plex/99?resume=false", gets.get(1));
    }

    @Test public void aRefusedSearchIsRefused() {
        status = 501;
        try {
            api.search("x", 10);
            fail();
        } catch (Exception e) {
            assertTrue(e instanceof MediaApi.Refused);
            assertFalse("the message names the route, never the query", e.getMessage().contains("x "));
        }
    }
}

package net.kckern.daylight.core;

import static org.junit.Assert.*;

import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.util.Collections;

public class RouterTest {
    private static final String TOKEN = "0123456789abcdef0123456789abcdef";
    private Router router;

    @Before public void setUp() {
        router = new Router(new Auth(TOKEN));
        router.route("GET", "/status", req -> Router.Response.json(200, new JSONObject().put("ok", true)));
        router.route("POST", "/reboot", req -> { throw new UnsupportedException("device owner required"); });
        router.route("GET", "/boom", req -> { throw new IllegalStateException("kaput"); });
        router.route("GET", "/setting", req -> { throw new SettingsRegistry.UnknownSettingException("x"); });
        router.route("POST", "/setting", req -> { throw new SettingsRegistry.InvalidSettingException("bad value"); });
    }

    private Router.Response call(String method, String path, String token) {
        return router.dispatch(method, path, token, Collections.emptyMap(), null);
    }

    private static JSONObject body(Router.Response r) throws Exception {
        return new JSONObject(new String(r.body, StandardCharsets.UTF_8));
    }

    @Test public void servesARouteWithTheToken() throws Exception {
        Router.Response r = call("GET", "/status", TOKEN);
        assertEquals(200, r.status);
        assertEquals("application/json", r.contentType);
        assertTrue(body(r).getBoolean("ok"));
    }

    @Test public void aMissingOrWrongTokenIs401BeforeAnythingElse() throws Exception {
        assertEquals(401, call("GET", "/status", null).status);
        assertEquals(401, call("GET", "/status", "wrong").status);
        Router.Response unknown = call("GET", "/nope", "wrong");
        assertEquals("a bad token must not reveal which routes exist", 401, unknown.status);
        assertEquals("unauthorized", body(unknown).getString("error"));
    }

    @Test public void anUnknownRouteIs404() throws Exception {
        Router.Response r = call("GET", "/nope", TOKEN);
        assertEquals(404, r.status);
        assertEquals("unknown_route", body(r).getString("error"));
    }

    @Test public void aKnownPathWithTheWrongMethodIs405() {
        assertEquals(405, call("POST", "/status", TOKEN).status);
    }

    @Test public void anUnsupportedCommandIs501WithTheReason() throws Exception {
        Router.Response r = call("POST", "/reboot", TOKEN);
        assertEquals(501, r.status);
        assertEquals("unsupported", body(r).getString("error"));
        assertEquals("device owner required", body(r).getString("reason"));
    }

    @Test public void settingErrorsMapTo404And400() throws Exception {
        assertEquals(404, call("GET", "/setting", TOKEN).status);
        assertEquals("unknown_setting", body(call("GET", "/setting", TOKEN)).getString("error"));
        assertEquals(400, call("POST", "/setting", TOKEN).status);
    }

    @Test public void aHandlerFailureIs500AndNeverPropagates() throws Exception {
        Router.Response r = call("GET", "/boom", TOKEN);
        assertEquals(500, r.status);
        assertEquals("internal", body(r).getString("error"));
    }

    @Test(expected = IllegalStateException.class)
    public void registeringARouteTwiceIsAProgrammingError() {
        router.route("GET", "/status", req -> null);
    }

    @Test public void listsItsRoutes() {
        assertTrue(router.routes().contains("GET /status"));
    }
}

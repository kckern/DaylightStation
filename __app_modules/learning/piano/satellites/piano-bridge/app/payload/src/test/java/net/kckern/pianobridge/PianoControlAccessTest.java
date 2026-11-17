package net.kckern.pianobridge;
import org.junit.Test;
import static org.junit.Assert.*;
import java.lang.reflect.Proxy;
import java.util.Collections;
import fi.iki.elonen.NanoHTTPD;
import net.kckern.pianobridge.api.ShellServices;
import net.kckern.pianobridge.api.AdminAccess;

public class PianoControlAccessTest {
    private ControlServer server() {
        ShellServices shell=(ShellServices)Proxy.newProxyInstance(getClass().getClassLoader(), new Class[]{ShellServices.class},
            (p,m,a) -> m.getName().equals("adminToken") ? "private-test-token" : m.getName().equals("nativeSafety") ? ShellServices.SafetyState.UNKNOWN : null);
        return new ControlServer(new BridgeCore(shell));
    }
    private NanoHTTPD.IHTTPSession request(String path, String token) {
        return (NanoHTTPD.IHTTPSession)Proxy.newProxyInstance(getClass().getClassLoader(), new Class[]{NanoHTTPD.IHTTPSession.class},
            (p,m,a) -> m.getName().equals("getUri") ? path : m.getName().equals("getMethod") ? NanoHTTPD.Method.GET
                : m.getName().equals("getHeaders") ? (token==null ? Collections.emptyMap() : Collections.singletonMap("x-admin-token",token))
                : m.getName().equals("getParameters") ? Collections.emptyMap() : null);
    }
    @Test public void legacyGetMutationAndConfigRequireAuthentication() {
        for (String path:new String[]{"/exec","/config","/kiosk/settings/disarm","/bluetooth/pair","/update","/setsetting"})
            assertEquals(path, 403, server().serveHttp(request(path,null)).getStatus().getRequestStatus());
    }
    @Test public void tokenDoesNotGrantUnknownNativeAuthority() {
        assertEquals(409, server().serveHttp(request("/exec","private-test-token")).getStatus().getRequestStatus());
    }
    @Test public void preflightCannotExecuteLegacyGetMutations() {
        assertFalse(ControlServer.requiresAdmin("/exec", "OPTIONS"));
        // The server returns before dispatching any route on OPTIONS.
        NanoHTTPD.IHTTPSession req=(NanoHTTPD.IHTTPSession)Proxy.newProxyInstance(getClass().getClassLoader(), new Class[]{NanoHTTPD.IHTTPSession.class},
            (p,m,a) -> m.getName().equals("getUri") ? "/exec" : m.getName().equals("getMethod") ? NanoHTTPD.Method.OPTIONS : null);
        assertEquals(200, server().serveHttp(req).getStatus().getRequestStatus());
    }
    @Test public void oldShellRefusedBeforePayloadStarts() {
        ShellServices old=(ShellServices)Proxy.newProxyInstance(getClass().getClassLoader(), new Class[]{ShellServices.class},
            (p,m,a) -> m.getName().equals("shellVersionCode") ? 31 : null);
        try { new net.kckern.pianobridge.payload.Main().start(old); fail("old shell accepted"); }
        catch (IllegalStateException expected) { assertTrue(expected.getMessage().contains("full shell v32")); }
    }
    @Test public void missingLegacyTokenNeverAuthenticates() {
        assertFalse(AdminAccess.accepts("", ""));
        assertFalse(AdminAccess.accepts("secret", null));
        assertFalse(AdminAccess.accepts("secret", "wrong"));
        assertTrue(AdminAccess.accepts("secret", "secret"));
    }
    @Test public void stoppedStaleOrUnknownSafetyCannotGrantRun() {
        assertFalse(ShellServices.SafetyState.UNKNOWN.allowsRun(0));
        assertFalse(new ShellServices.SafetyState(true,true,9,100).allowsRun(1));
        assertFalse(new ShellServices.SafetyState(true,false,9,100).allowsRun(100));
        assertTrue(new ShellServices.SafetyState(true,false,9,100).allowsRun(99));
    }
}

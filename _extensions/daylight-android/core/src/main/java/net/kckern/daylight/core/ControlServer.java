package net.kckern.daylight.core;

import java.io.ByteArrayInputStream;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import fi.iki.elonen.NanoHTTPD;

/** The NanoHTTPD adapter. All behavior lives in Router. */
public final class ControlServer extends NanoHTTPD {
    private final Router router;

    public ControlServer(int port, Router router) {
        super(port);
        this.router = router;
    }

    @Override
    public Response serve(IHTTPSession session) {
        String body = null;
        Method method = session.getMethod();
        if (method == Method.POST || method == Method.PUT) {
            Map<String, String> files = new HashMap<>();
            try {
                session.parseBody(files);
            } catch (Exception e) {
                return respond(Router.Response.error(400, "bad_request", "message", "unreadable body"));
            }
            body = files.get("postData");
        }
        Map<String, String> query = new HashMap<>();
        for (Map.Entry<String, List<String>> e : session.getParameters().entrySet()) {
            if (!e.getValue().isEmpty()) query.put(e.getKey(), e.getValue().get(0));
        }
        return respond(router.dispatch(method.name(), session.getUri(),
                session.getHeaders().get(Auth.HEADER), query, body));
    }

    private static Response respond(Router.Response r) {
        Response.IStatus status = Response.Status.lookup(r.status);
        if (status == null) status = Response.Status.INTERNAL_ERROR;
        return newFixedLengthResponse(status, r.contentType, new ByteArrayInputStream(r.body), r.body.length);
    }
}

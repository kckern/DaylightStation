package net.kckern.audiobridge;

import fi.iki.elonen.NanoHTTPD;
import org.json.JSONObject;

/** Bounded HTTP ingress, independent of the microphone WebSocket. */
public final class ControlServer extends NanoHTTPD {
    private final BluetoothController controller;
    public ControlServer(int port, BluetoothController controller) { super(port); this.controller = controller; }
    @Override public Response serve(IHTTPSession session) {
        String uri = session.getUri();
        if (!uri.equals("/bluetooth") && !uri.startsWith("/bluetooth/")) return json(Response.Status.NOT_FOUND, BluetoothController.error("not_found", "Unknown route"));
        String action = uri.equals("/bluetooth") ? "" : uri.substring(11);
        if ((action.isEmpty() && session.getMethod() != Method.GET) || (!action.isEmpty() && session.getMethod() != Method.POST))
            return json(Response.Status.METHOD_NOT_ALLOWED, BluetoothController.error("invalid_request", "Use GET for status and POST for actions"));
        String body = null;
        if (!action.isEmpty()) {
            try {
                int length = Integer.parseInt(session.getHeaders().getOrDefault("content-length", "0"));
                if (length <= 0 || length > 8192) return json(Response.Status.BAD_REQUEST, BluetoothController.error("invalid_request", "JSON body must contain 1–8192 bytes"));
                if (!session.getHeaders().getOrDefault("content-type", "").toLowerCase(java.util.Locale.US).startsWith("application/json"))
                    return json(Response.Status.BAD_REQUEST, BluetoothController.error("invalid_request", "Use application/json"));
                byte[] data = new byte[length]; int offset = 0;
                while (offset < length) { int n = session.getInputStream().read(data, offset, length-offset); if(n < 0) throw new java.io.EOFException(); offset += n; }
                body = new String(data, java.nio.charset.StandardCharsets.UTF_8);
            } catch (Exception e) { return json(Response.Status.BAD_REQUEST, BluetoothController.error("invalid_request", "A bounded JSON body is required")); }
        }
        JSONObject result = controller.request(session.getMethod().name(), action, body);
        return json(result.optBoolean("ok") ? action.isEmpty() ? Response.Status.OK : Response.Status.ACCEPTED
                : "invalid_request".equals(result.optString("code")) ? Response.Status.BAD_REQUEST : Response.Status.CONFLICT, result);
    }
    private Response json(Response.Status status, JSONObject body) {
        Response response = newFixedLengthResponse(status, "application/json", body.toString());
        response.addHeader("Cache-Control", "no-store");
        return response;
    }
}

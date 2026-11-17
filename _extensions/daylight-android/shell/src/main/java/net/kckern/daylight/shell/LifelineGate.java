package net.kckern.daylight.shell;

/**
 * LifelineGate decides whether a lifeline request is refused before it reaches the
 * payload loader, and with which HTTP status. It holds no Android or NanoHTTPD
 * types so the decision is unit-tested on the JVM.
 */
final class LifelineGate {

    static final class Refusal {
        final int status;
        final String error;

        Refusal(int status, String error) {
            this.status = status;
            this.error = error;
        }
    }

    private LifelineGate() { }

    /**
     * Returns the refusal for this request, or null when the route may run.
     * Routes that do not touch the loader (status, log, unknown paths) are never
     * refused here.
     */
    static Refusal check(String uri, boolean loaderReady, String method, boolean hasUrl, boolean hasSha256) {
        boolean post = "POST".equals(method);
        switch (uri) {
            case "/payload":
                if (!loaderReady) return new Refusal(503, "loader not ready");
                if (post && !(hasUrl && hasSha256)) return new Refusal(400, "url and sha256 required");
                return null;
            case "/payload/rollback":
            case "/restart":
                if (!loaderReady) return new Refusal(503, "loader not ready");
                if (!post) return new Refusal(405, "POST only");
                return null;
            default:
                return null;
        }
    }
}

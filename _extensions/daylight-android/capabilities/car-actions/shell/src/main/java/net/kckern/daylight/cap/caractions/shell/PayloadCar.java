package net.kckern.daylight.cap.caractions.shell;

import net.kckern.daylight.api.PayloadPort;

import org.json.JSONObject;

/**
 * The car screen's questions to the payload, over the "car" PayloadPort: in process,
 * as JSON text. What is on the list and what a run does are the payload's answers.
 */
final class PayloadCar {
    /** The payload's car-actions capability attaches to a port of this name. */
    static final String PORT = "car";

    private final PayloadPort port = PayloadPort.named(PORT);

    /** @throws PayloadPort.NotReadyException when no payload attached within the wait */
    String list(long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "list").toString(), waitMs);
    }

    /** Runs one entry of the car list by its id. Delivered at most once. */
    String run(String id, long waitMs) throws Exception {
        return port.call(new JSONObject().put("op", "run").put("id", id).toString(), waitMs);
    }

    boolean awaitReady(long waitMs) { return port.awaitReady(waitMs); }
}

package net.kckern.audiobridge;
import org.json.JSONObject;

/** A reply answers a prompt; only bond termination or expiry ends ownership. */
final class PairingSession {
    private String address;
    private long expiresAt;
    private JSONObject prompt;
    void begin(String selected, long now) { address = selected; expiresAt = now + 60000; prompt = null; }
    String address() { return address; }
    long expiresAt() { return expiresAt; }
    JSONObject prompt() { return prompt; }
    boolean owns(String candidate, long now) { return BluetoothController.ownsPairingRequest(address, expiresAt, candidate, now); }
    void showPrompt(JSONObject value) { prompt = value; }
    void replyAccepted() { prompt = null; }
    void clear() { address = null; expiresAt = 0; prompt = null; }
}

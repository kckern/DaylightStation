package net.kckern.daylight.cap.bluetoothcontrols;

import org.json.JSONObject;
import org.json.JSONTokener;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.function.LongSupplier;

/** Pure validation boundary. An accepted command never manufactures connection state. */
public final class BluetoothController {
    public interface Port {
        JSONObject snapshot() throws Exception;
        boolean scan(int durationMs) throws Exception;
        boolean stopScan() throws Exception;
        boolean pair(String address) throws Exception;
        boolean unpair(String address) throws Exception;
        boolean connect(String address, String profile) throws Exception;
        boolean disconnect(String address, String profile) throws Exception;
        /** The adapter's power switch. A port whose policy has no `power` action never sees this call. */
        default boolean setEnabled(boolean enabled) throws Exception { return false; }
        default Policy policy() { return Policy.ROLES; }
        boolean reply(String address, boolean accept, String pin) throws Exception;
    }

    /** The three places where the instrument-and-speaker panel and the gamepad panel differ. */
    public static final class Policy {
        public static final Policy ROLES = new Policy(
                java.util.Arrays.asList("audio", "midi"), "profile must be audio or midi", false, true);
        public static final Policy GAMEPAD = new Policy(
                java.util.Collections.singletonList("input"), "profile must be input", true, false);

        final java.util.List<String> profiles;
        final String profileError;
        /** Refuse any address the port does not list as a manageable device. */
        final boolean manageableOnly;
        /** Whether the `power` action exists. */
        final boolean power;

        private Policy(java.util.List<String> profiles, String profileError, boolean manageableOnly, boolean power) {
            this.profiles = profiles;
            this.profileError = profileError;
            this.manageableOnly = manageableOnly;
            this.power = power;
        }
    }

    private final Port port;
    private final LongSupplier clock;

    public BluetoothController(Port port, LongSupplier clock) {
        this.port = port;
        this.clock = clock;
    }

    public JSONObject snapshot() {
        try { return port.snapshot(); }
        catch (Exception e) { return error("action_failed", "Bluetooth state is unavailable"); }
    }

    /** Method and JSON validation also stays JVM-testable. Empty action denotes /bluetooth. */
    public JSONObject request(String method, String action, String body) {
        if ("".equals(action)) {
            return "GET".equals(method) ? snapshot() : invalid("Use GET for Bluetooth state");
        }
        if (!"POST".equals(method)) return invalid("Bluetooth actions require POST");
        try {
            if (body == null || body.isEmpty() || body.getBytes(StandardCharsets.UTF_8).length > 8192)
                return invalid("JSON body must contain 1–8192 bytes");
            JSONTokener tokens = new JSONTokener(body);
            Object value = tokens.nextValue();
            if (!(value instanceof JSONObject) || tokens.nextClean() != 0)
                return invalid("A valid JSON object is required");
            return command(action, (JSONObject) value);
        } catch (Exception e) { return invalid("A valid JSON object is required"); }
    }

    public JSONObject command(String action, JSONObject body) {
        try {
            if (body == null) return invalid("A JSON object is required");
            boolean accepted;
            switch (action) {
                case "scan": {
                    Object raw = body.has("durationMs") ? body.get("durationMs") : 12000;
                    if (!(raw instanceof Number)) return invalid("durationMs must be an integer");
                    double value = ((Number) raw).doubleValue();
                    if (value < 1000 || value > 30000 || value != Math.rint(value))
                        return invalid("durationMs must be between 1000 and 30000");
                    accepted = port.scan((int) value);
                    break;
                }
                case "scan/stop": accepted = port.stopScan(); break;
                case "power":
                    if (!port.policy().power) return invalid("Unknown Bluetooth action");
                    if (!(body.opt("enabled") instanceof Boolean)) return invalid("enabled must be a boolean");
                    accepted = port.setEnabled(body.getBoolean("enabled"));
                    break;
                case "pair": case "unpair": case "connect": case "disconnect": case "pairing": {
                    Object rawAddress = body.opt("address");
                    if (!(rawAddress instanceof String)
                            || !((String) rawAddress).matches("(?i)[0-9a-f]{2}(:[0-9a-f]{2}){5}"))
                        return invalid("A valid Bluetooth address is required");
                    String address = ((String) rawAddress).toUpperCase(Locale.US);
                    if (port.policy().manageableOnly && !manageable(address))
                        return error("unsupported_device", "Select a discovered game controller");
                    if ("pair".equals(action)) accepted = port.pair(address);
                    else if ("unpair".equals(action)) accepted = port.unpair(address);
                    else if ("pairing".equals(action)) {
                        if (!(body.opt("accept") instanceof Boolean)) return invalid("accept must be a boolean");
                        JSONObject pairing = port.snapshot().optJSONObject("pairing");
                        if (pairing == null || !address.equals(pairing.optString("address"))
                                || pairing.optLong("expiresAtMs", 0) <= clock.getAsLong())
                            return error("pairing_expired", "No active pairing request for this device");
                        boolean accept = body.getBoolean("accept");
                        String pin = null;
                        if (body.has("pin")) {
                            if (!(body.opt("pin") instanceof String)) return invalid("PIN must be text");
                            pin = body.getString("pin");
                            if (pin.isEmpty() || pin.getBytes(StandardCharsets.UTF_8).length > 16
                                    || pin.codePoints().anyMatch(Character::isISOControl))
                                return invalid("PIN must contain 1–16 bytes without control characters");
                        }
                        if (accept && "pin".equals(pairing.optString("variant")) && pin == null)
                            return invalid("A PIN is required");
                        accepted = port.reply(address, accept, pin);
                    } else {
                        String profile = body.optString("profile", "");
                        if (!port.policy().profiles.contains(profile)) return invalid(port.policy().profileError);
                        accepted = "connect".equals(action) ? port.connect(address, profile) : port.disconnect(address, profile);
                    }
                    break;
                }
                default: return invalid("Unknown Bluetooth action");
            }
            return accepted ? new JSONObject().put("ok", true).put("accepted", true)
                    : error("action_rejected", "Bluetooth did not accept the action; check current state and lastError");
        } catch (Exception e) {
            // Android/reflective exceptions can include arguments. Never echo them (especially a PIN).
            return error("action_failed", "Bluetooth action could not be completed");
        }
    }

    /** Is this address one the port lists as manageable? The loop audio-bridge had inline. */
    private boolean manageable(String address) throws Exception {
        org.json.JSONArray devices = port.snapshot().optJSONArray("devices");
        if (devices != null) for (int i = 0; i < devices.length(); i++) {
            JSONObject device = devices.getJSONObject(i);
            if (address.equals(device.optString("address")) && device.optBoolean("manageable")) return true;
        }
        return false;
    }

    private static JSONObject invalid(String message) { return error("invalid_request", message); }

    /** Shared scope check for consuming Android's pairing prompt without claiming unsolicited requests. */
    static boolean ownsPairingRequest(String requestedAddress, long expiresAtMs, String eventAddress, long nowMs) {
        return requestedAddress != null && requestedAddress.equals(eventAddress) && expiresAtMs > nowMs;
    }

    public static JSONObject error(String code, String message) {
        JSONObject result = new JSONObject();
        try { result.put("ok", false).put("code", code).put("error", message); }
        catch (Exception ignored) { }
        return result;
    }
}

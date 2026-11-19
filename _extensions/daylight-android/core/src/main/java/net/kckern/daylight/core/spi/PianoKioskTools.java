package net.kckern.daylight.core.spi;

import org.json.JSONObject;

/** Operations used by the piano kiosk. Each capable module supplies only its own service. */
public final class PianoKioskTools {
    private PianoKioskTools() {}
    public interface Bluetooth { JSONObject request(String action, String body); }
    public interface MidiTap { JSONObject snapshot(); }
    public interface Volume { JSONObject check() throws org.json.JSONException; }
    public interface Wifi { JSONObject snapshot(); }
}

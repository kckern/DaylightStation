package net.kckern.daylight.cap.webviewhost;

import net.kckern.daylight.core.ServiceRegistry;
import net.kckern.daylight.core.spi.PianoKioskTools;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class PianoToolCalls {
    private PianoToolCalls() {}
    static boolean supports(String method) {
        switch (method) {
            case "pianoBluetoothState": case "pianoBluetoothCommand": case "pianoCheckVolume":
            case "pianoMidiTap": case "pianoWifi": return true;
            default: return false;
        }
    }
    private static JSONObject pick(JSONObject source, String... keys) throws JSONException {
        JSONObject result = new JSONObject();
        for (String key : keys) if (source.has(key)) result.put(key, source.get(key));
        return result;
    }
    static String call(ServiceRegistry services, String method, String arg) throws JSONException {
        JSONObject result = new JSONObject().put("ok", true);
        switch (method) {
            case "pianoBluetoothState": case "pianoBluetoothCommand": {
                PianoKioskTools.Bluetooth bt = services.find(PianoKioskTools.Bluetooth.class);
                if (bt == null) return "";
                if (method.equals("pianoBluetoothState")) return bt.request("", null).toString();
                if (arg.length() > 8192) return "";
                JSONObject command = new JSONObject(arg);
                String action = command.getString("action");
                switch (action) {
                    case "scan": case "scan/stop": case "pair": case "unpair": case "power":
                    case "pairing": case "connect": case "disconnect":
                        return bt.request(action, command.getJSONObject("body").toString()).toString();
                    default: return "";
                }
            }
            case "pianoMidiTap": {
                PianoKioskTools.MidiTap midi = services.find(PianoKioskTools.MidiTap.class);
                JSONObject tap = midi == null ? null : midi.snapshot();
                if (tap == null) return "";
                return result.put("tap", pick(tap, "chunks", "recent")).toString();
            }
            case "pianoCheckVolume": {
                PianoKioskTools.Volume volume = services.find(PianoKioskTools.Volume.class);
                JSONObject guard = volume == null ? null : volume.check();
                if (guard == null) return "";
                return result.put("guard", pick(guard, "routeOk", "musicIndex", "musicMax", "raised")).toString();
            }
            case "pianoWifi": {
                PianoKioskTools.Wifi wifi = services.find(PianoKioskTools.Wifi.class);
                JSONObject snapshot = wifi == null ? null : wifi.snapshot();
                if (snapshot == null) return "";
                JSONObject current = snapshot.optJSONObject("current");
                if (current != null) result.put("current", pick(current, "rssi", "linkSpeedMbps", "rxLinkSpeedMbps",
                        "freqMhz", "band", "rxKbps", "degraded", "degradedReason", "ageMs", "bssid"));
                JSONArray recent = snapshot.optJSONArray("recent"), tail = new JSONArray();
                if (recent != null) for (int i = Math.max(0, recent.length() - 6); i < recent.length(); i++)
                    tail.put(pick(recent.getJSONObject(i), "rxKbps", "rssi"));
                return result.put("recent", tail).put("roams", snapshot.opt("roams")).toString();
            }
            default: return "";
        }
    }
}

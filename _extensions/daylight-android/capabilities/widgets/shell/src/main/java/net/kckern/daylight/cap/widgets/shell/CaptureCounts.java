package net.kckern.daylight.cap.widgets.shell;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The Capture tab's status line (audit H16), from the payload's capture rows: what needs the
 * person first, then what is still on its way, then what home has. Pure.
 */
final class CaptureCounts {
    private CaptureCounts() { }

    static String line(JSONArray rows) {
        int attention = 0, waiting = 0, sent = 0;
        for (int i = 0; rows != null && i < rows.length(); i++) {
            JSONObject r = rows.optJSONObject(i);
            if (r == null) continue;
            switch (r.optString("state")) {
                case "DELIVERED": case "ACCEPTED": sent++; break;
                case "UNUSABLE": case "REJECTED": case "DENIED": case "LOST": attention++; break;
                default: waiting++;
            }
        }
        if (attention + waiting + sent == 0) return "Nothing captured yet";
        StringBuilder out = new StringBuilder();
        if (attention > 0) out.append(attention).append(attention == 1 ? " needs" : " need").append(" attention");
        if (waiting > 0) out.append(out.length() > 0 ? " · " : "").append(waiting).append(" waiting to send");
        if (sent > 0) out.append(out.length() > 0 ? " · " : "").append(sent).append(" sent");
        return out.toString();
    }
}

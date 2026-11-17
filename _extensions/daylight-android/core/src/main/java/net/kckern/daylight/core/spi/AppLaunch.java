package net.kckern.daylight.core.spi;

import org.json.JSONObject;

/** Provided by `app-launcher`. */
public interface AppLaunch {
    /** Null when the request would be accepted, else "bad_request", "not_installed" or "not_allowed". */
    String check(JSONObject request);

    /** {ok:true, launched:true, component} or {ok:false, error}. */
    JSONObject launch(JSONObject request);
}

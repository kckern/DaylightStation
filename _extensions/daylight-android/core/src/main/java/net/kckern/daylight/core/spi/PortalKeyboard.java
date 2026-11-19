package net.kckern.daylight.core.spi;

import org.json.JSONObject;

/** One decoded report from the kiosk's configured USB keyboard, for its focused page. */
public interface PortalKeyboard { java.util.function.Consumer<JSONObject> currentTarget(); }

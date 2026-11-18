package net.kckern.daylight.core.spi;

/** Hand bytes to the instrument port or its native scheduler. */
public interface PianoOutput {
    default org.json.JSONObject repair() { return null; }
    boolean send(byte[] bytes, long delayMs);
}

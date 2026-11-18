package net.kckern.daylight.core.spi;

import org.json.JSONObject;

/** Provided by `volume`. */
public interface VolumeControl {
    /** {stream, level, index, maxIndex} */
    JSONObject read(int stream);

    JSONObject set(int stream, int level);
}

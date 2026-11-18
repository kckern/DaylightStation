package net.kckern.daylight.core.spi;

/** Hand bytes to the instrument port or its native scheduler. */
public interface PianoOutput {
    boolean send(byte[] bytes, long delayMs);
}

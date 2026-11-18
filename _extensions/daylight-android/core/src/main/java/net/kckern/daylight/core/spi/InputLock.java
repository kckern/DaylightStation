package net.kckern.daylight.core.spi;

/** Provided by `lockdown` (phase 3): the server-commanded shutdown that suppresses input. */
public interface InputLock {
    boolean active();
    long revision();
}

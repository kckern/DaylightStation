package net.kckern.daylight.core.spi;

/** Provided by `synth`. `audio-guard` closes it whenever sound would leave by the wrong speaker. */
public interface OutputGate {
    void setOpen(boolean open);
}

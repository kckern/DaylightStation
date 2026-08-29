package net.kckern.portalkeys.api;

public interface Payload {
    void start(ShellServices shell);
    void stop();
    String version();
}

package net.kckern.daylight.api;

/** Implemented by the shell's accessibility service. Pass null to detach. */
public interface AccessibilityHost {
    void setDelegate(AccessibilityDelegate delegate);
}

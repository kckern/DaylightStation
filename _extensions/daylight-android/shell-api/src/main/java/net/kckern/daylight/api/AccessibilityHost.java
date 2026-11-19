package net.kckern.daylight.api;

/** Implemented by the shell's accessibility service. Pass null to detach. */
public interface AccessibilityHost {
    void setDelegate(AccessibilityDelegate delegate);

    /**
     * Detach `expected`, and only it: when another delegate has been set since, nothing
     * changes and the answer is false. This is how a payload detaches when it stops.
     */
    boolean clearDelegate(AccessibilityDelegate expected);
}

package net.kckern.daylight.shellkit;

import android.os.Bundle;
import android.view.View;
import android.view.accessibility.AccessibilityNodeInfo;

/**
 * TalkBack's way to a long-press: "More options for <title>" in the actions menu, running
 * the same thing the long-press does. Every long-press surface adds it.
 */
public final class MoreOptions {
    private MoreOptions() { }

    public static String label(String title) {
        return "More options for " + (title == null || title.trim().isEmpty() ? "this item" : title.trim());
    }

    public static void attach(View host, String title, Runnable run) { attach(host, () -> title, run); }

    /** For a view whose item changes (the mini player): the title is read each time TalkBack asks. */
    public static void attach(View host, java.util.function.Supplier<String> title, Runnable run) {
        host.setAccessibilityDelegate(new View.AccessibilityDelegate() {
            @Override public void onInitializeAccessibilityNodeInfo(View v, AccessibilityNodeInfo info) {
                super.onInitializeAccessibilityNodeInfo(v, info);
                info.addAction(new AccessibilityNodeInfo.AccessibilityAction(R.id.daylight_more_options, label(title.get())));
            }

            @Override public boolean performAccessibilityAction(View v, int action, Bundle args) {
                if (action == R.id.daylight_more_options) { run.run(); return true; }
                return super.performAccessibilityAction(v, action, args);
            }
        });
    }
}

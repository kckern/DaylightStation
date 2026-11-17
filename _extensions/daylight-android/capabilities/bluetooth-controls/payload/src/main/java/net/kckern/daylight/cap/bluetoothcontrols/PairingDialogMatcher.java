package net.kckern.daylight.cap.bluetoothcontrols;

import android.accessibilityservice.AccessibilityService;
import android.view.accessibility.AccessibilityNodeInfo;

/**
 * Is Android's own pairing dialog, for this exact device, on screen right now?
 * Copied from the piano bridge's A11y. Two edits: the service is a parameter, and
 * isHeading() (API 28) is read only where it exists.
 */
final class PairingDialogMatcher {
    private PairingDialogMatcher() { }

    /** Evidence from the ACTIVE root only; Settings screens behind/alongside it grant no exemption. */
    static boolean matches(AccessibilityService service, String expectedName, String expectedAddress) {
        if (service == null) return false;
        AccessibilityNodeInfo root = null;
        try {
            root = service.getRootInActiveWindow();
            if (root == null) return false;
            String packageName = String.valueOf(root.getPackageName());
            if (!"com.android.settings".equals(packageName)) return false;
            PairingEvidence evidence = new PairingEvidence();
            collectPairingEvidence(root, evidence, 0, true);
            android.view.accessibility.AccessibilityWindowInfo window = root.getWindow();
            if (window != null) {
                try {
                    if (window.isActive() && window.getTitle() != null)
                        evidence.title.append('\n').append(window.getTitle());
                } finally { window.recycle(); }
            }
            return SystemPairingPolicy.matchesDialog(packageName, evidence.title.toString(),
                    evidence.text.toString(), expectedName, expectedAddress, evidence.positiveLabel);
        } catch (Exception e) { return false; }
        finally { if (root != null) root.recycle(); }
    }

    private static final class PairingEvidence {
        final StringBuilder title = new StringBuilder();
        final StringBuilder text = new StringBuilder();
        String positiveLabel;
        int nodes;
    }

    private static void collectPairingEvidence(AccessibilityNodeInfo node, PairingEvidence out, int depth, boolean identityContainer) {
        if (node == null || !node.isVisibleToUser() || depth > 32 || out.nodes++ > 400) return;
        CharSequence text = node.getText();
        String id = node.getViewIdResourceName();
        boolean heading = android.os.Build.VERSION.SDK_INT >= 28 && node.isHeading();
        boolean identityNode = identityContainer && SystemPairingPolicy.isIdentityText(id, heading,
                node.getClassName() == null ? null : node.getClassName().toString());
        if (text != null) {
            if (identityNode) out.text.append('\n').append(text);
            if (heading || id != null && (id.endsWith("/alertTitle") || id.endsWith("/title")))
                out.title.append('\n').append(text);
        }
        if (("android:id/button1".equals(id) || "com.android.settings:id/button1".equals(id))
                && node.isEnabled() && node.isClickable() && text != null) out.positiveLabel = text.toString();
        for (int index = 0; index < node.getChildCount(); index++) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (child == null) continue;
            try { collectPairingEvidence(child, out, depth + 1, identityNode); }
            finally { child.recycle(); }
        }
    }
}

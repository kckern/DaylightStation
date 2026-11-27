package net.kckern.daylight.cap.widgets.shell;

import java.util.ArrayList;
import java.util.List;

/** Which buttons the widget shows, from what the surface cache holds. Pure. */
final class WidgetButtons {
    /** The one button of a widget with nothing assigned: it opens the app. */
    static final String OPEN = "Open";

    static final class Button {
        /** 1 to 4: the view the button is drawn in. */
        final int slot;
        final String label;
        /** A daylight:// link, or empty for the button that opens the app. */
        final String link;

        Button(int slot, String label, String link) {
            this.slot = slot;
            this.label = label;
            this.link = link;
        }
    }

    private WidgetButtons() { }

    /**
     * @param labels the cached label of each slot
     * @param links  the cached link of each slot, already checked to be the app's own scheme, or empty
     * @return one button per assigned slot; with none (a fresh install, a payload that
     *         never ran) one button in the first slot that opens the app
     */
    static List<Button> of(String[] labels, String[] links) {
        List<Button> out = new ArrayList<>();
        for (int i = 0; i < links.length; i++) {
            String link = links[i] == null ? "" : links[i];
            if (link.isEmpty()) continue;
            String label = i < labels.length && labels[i] != null && !labels[i].isEmpty() ? labels[i] : "Action " + (i + 1);
            out.add(new Button(i + 1, label, link));
        }
        if (out.isEmpty()) out.add(new Button(1, OPEN, ""));
        return out;
    }
}

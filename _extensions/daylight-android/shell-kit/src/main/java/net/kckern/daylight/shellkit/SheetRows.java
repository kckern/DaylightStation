package net.kckern.daylight.shellkit;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * The rows of an item sheet in the order they are drawn (design sweep D17): the ordinary
 * rows in the order they were added, then a divider, then the destructive ones ("Remove
 * from Continue listening", "Remove from this phone"). No divider when one group is empty.
 * Pure.
 */
public final class SheetRows {
    /** One row: an icon, a label, an optional second line, whether it destroys something. */
    public static final class Row {
        public final int icon;
        public final String label, detail;
        public final boolean destructive;
        public final Runnable run;
        public Row(int icon, String label, String detail, boolean destructive, Runnable run) {
            this.icon = icon;
            this.label = label;
            this.detail = detail == null ? "" : detail;
            this.destructive = destructive;
            this.run = run;
        }
    }

    /** What is drawn: a row, or the divider between the two groups. */
    public static final class Slot {
        public final Row row;   // null for the divider
        Slot(Row row) { this.row = row; }
        public boolean divider() { return row == null; }
    }

    private SheetRows() { }

    public static List<Slot> layout(List<Row> rows) {
        if (rows == null || rows.isEmpty()) return Collections.emptyList();
        List<Slot> out = new ArrayList<>();
        List<Row> danger = new ArrayList<>();
        for (Row r : rows) {
            if (r == null) continue;
            if (r.destructive) danger.add(r); else out.add(new Slot(r));
        }
        if (!out.isEmpty() && !danger.isEmpty()) out.add(new Slot(null));
        for (Row r : danger) out.add(new Slot(r));
        return out;
    }
}

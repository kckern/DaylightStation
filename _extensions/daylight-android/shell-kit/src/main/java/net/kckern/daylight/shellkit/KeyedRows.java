package net.kckern.daylight.shellkit;

import android.view.View;
import android.view.ViewGroup;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A list of rows that a refresh updates in place instead of rebuilding: rows are keyed
 * (a content id), a row whose answer did not change is left alone, a changed one has its
 * text and state updated in its own view, and only rows that came or went are added or
 * removed. An answer equal to what is shown changes nothing. A row never leaves its
 * parent unless it moved, so a press or a long-press in progress survives the refresh,
 * and the covers already drawn stay drawn.
 *
 * The rows sit in {@code parent} starting at child {@code offset} (a heading may come
 * before them); nothing else may be added after them.
 */
public final class KeyedRows<T> {
    public interface Rows<T> {
        String key(T item);
        /** What the row shows: equal signatures, no update. */
        String signature(T item);
        View create(T item);
        /** Updates {@code row} to show {@code item}; may answer a new view to put in its place. */
        View update(View row, T item);
    }

    private final ViewGroup parent;
    private final Rows<T> rows;
    private final LinkedHashMap<String, View> views = new LinkedHashMap<>();
    private final Map<String, String> signatures = new HashMap<>();
    private int offset;

    public KeyedRows(ViewGroup parent, Rows<T> rows) {
        this.parent = parent;
        this.rows = rows;
    }

    /** Where the rows start among the parent's children. */
    public void offset(int first) { offset = Math.max(0, first); }

    /** Forgets every row (the parent was cleared by someone else). */
    public void reset() {
        views.clear();
        signatures.clear();
    }

    /** The row views, in order. */
    public List<View> views() { return new ArrayList<>(views.values()); }

    public boolean isEmpty() { return views.isEmpty(); }

    /** Shows {@code items}. False when nothing changed (nothing was touched). */
    public boolean show(List<T> items) {
        List<String> keys = new ArrayList<>();
        Map<String, String> sigs = new HashMap<>();
        Map<String, T> byKey = new HashMap<>();
        for (T item : items) {
            String k = rows.key(item);
            if (k == null || byKey.containsKey(k)) continue;   // a repeated key shows once
            keys.add(k);
            sigs.put(k, rows.signature(item));
            byKey.put(k, item);
        }
        RowDiff diff = RowDiff.of(new ArrayList<>(views.keySet()), signatures, keys, sigs);
        if (diff.same()) return false;
        for (String k : diff.removed) {
            View v = views.remove(k);
            signatures.remove(k);
            if (v != null) parent.removeView(v);
        }
        LinkedHashMap<String, View> next = new LinkedHashMap<>();
        for (String k : keys) {
            View v = views.get(k);
            if (v == null) v = rows.create(byKey.get(k));
            else if (diff.changed.contains(k)) {
                View updated = rows.update(v, byKey.get(k));
                if (updated != null && updated != v) {
                    int at = parent.indexOfChild(v);
                    parent.removeView(v);
                    if (at >= 0) parent.addView(updated, at);
                    v = updated;
                }
            }
            next.put(k, v);
            signatures.put(k, sigs.get(k));
        }
        views.clear();
        views.putAll(next);
        // Children in order; a row already in its place is not touched.
        int i = offset;
        for (View v : next.values()) {
            if (parent.getChildAt(i) != v) {
                if (v.getParent() == parent) parent.removeView(v);
                else if (v.getParent() instanceof ViewGroup) ((ViewGroup) v.getParent()).removeView(v);
                parent.addView(v, Math.min(i, parent.getChildCount()));
            }
            i++;
        }
        return true;
    }
}

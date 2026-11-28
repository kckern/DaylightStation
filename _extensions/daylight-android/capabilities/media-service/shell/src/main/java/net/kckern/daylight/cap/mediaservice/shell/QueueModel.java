package net.kckern.daylight.cap.mediaservice.shell;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Random;
import java.util.function.Function;
import java.util.function.Predicate;

/**
 * The phone's queue in regions (ops:docs/superpowers/specs/2026-11-26-phone-queue.md §1–§6),
 * kept on Media3's one flat timeline. Pure: no Android types. The item type is the
 * caller's (a MediaItem in the service, a string in tests).
 *
 * <pre>
 *   music:  [history…][now][queued by you: next block, then the rest][source…][radio…]
 *   a book: [history…][now][source (the book's parts)…][queued by you…][radio…]
 * </pre>
 *
 * Everything before {@code now} is history. Every verb changes this list and makes the
 * same small change to the player through {@link Sink}: an add, a move or a remove,
 * never a whole new list, so playback never restarts for an edit. Only a new source
 * (a tap, Play, Shuffle) and its Undo replace the list, because the item playing
 * changes anyway.
 *
 * Main thread only (the player's).
 */
final class QueueModel<T> {
    enum Region { HISTORY, NOW, QUEUED, SOURCE, RADIO }

    enum Repeat { OFF, ALL, ONE }

    /** What happens after the last item (§6). For a book, KEEP_PLAYING means "then your queued". */
    enum End { STOP, KEEP_PLAYING, REPEAT }

    static final int HISTORY_CAP = 100;

    /** The player side of every change. Indices are the timeline's. */
    interface Sink<T> {
        void add(int index, List<T> items);
        /** Player.moveMediaItem: the item ends at {@code to}. */
        void move(int from, int to);
        void remove(int fromIndex, int toIndexExclusive);
        /** A new source: the whole list, the item to play and its place (C.TIME_UNSET for its start: pass -1). */
        void replace(List<T> all, int nowIndex, long positionMs);
        void seek(int index);
        void repeatOne(boolean on);
    }

    static final class Entry<T> {
        final long uid;
        final T item;
        final String id;
        final boolean longForm;
        Region region;
        /** The region it had before it played (what it goes back to on Previous). */
        Region was;
        /** Play next's block: the front of Queued by you, in the order tapped. */
        boolean next;
        /** Its place in the source's own order (shuffle off restores it); -1 when not a source item. */
        int order = -1;
        /** Which source it belongs to (a new source is a new generation). */
        int generation;
        /** Items added together as one container ("Snakes & Arrows · 13 tracks"): same group, same label. */
        long group;
        String groupLabel = "";

        Entry(long uid, T item, String id, boolean longForm, Region region) {
            this.uid = uid;
            this.item = item;
            this.id = id;
            this.longForm = longForm;
            this.region = region;
            this.was = region;
        }
    }

    /** An edit that can be taken back (the snackbar's Undo). */
    interface Undo { boolean undo(); }

    private final Function<T, String> idOf;
    private final Predicate<T> longOf;
    private final Random random;
    private Sink<T> sink = new NoSink<>();

    private final List<Entry<T>> list = new ArrayList<>();
    private int now = -1;
    private long uids;
    private long groups;
    private int generation;
    private int rev;

    private String label = "";
    private String sourceId = "";
    private Object sourceTag;
    private boolean sourceLong;
    private boolean shuffled;
    /** The whole source in its own order, for another pass (Repeat). */
    private final List<T> sourceAll = new ArrayList<>();
    private Repeat repeat = Repeat.OFF;
    private Repeat beforeOne = Repeat.OFF;
    /** A Clear never brings radio back (§6): set by Clear all, reset by a new source. */
    private boolean radioBlocked;

    QueueModel(Function<T, String> idOf, Predicate<T> longOf, Random random) {
        this.idOf = idOf;
        this.longOf = longOf;
        this.random = random;
    }

    void attach(Sink<T> s) { sink = s == null ? new NoSink<>() : s; }

    // ── reading ─────────────────────────────────────────────────────────────

    int size() { return list.size(); }
    Entry<T> at(int i) { return list.get(i); }
    int nowIndex() { return now; }
    Entry<T> nowEntry() { return now < 0 ? null : list.get(now); }
    int rev() { return rev; }
    String label() { return label; }
    String sourceId() { return sourceId; }
    Object sourceTag() { return sourceTag; }
    boolean sourceLong() { return sourceLong; }
    boolean shuffled() { return shuffled; }
    Repeat repeat() { return repeat; }
    boolean radioBlocked() { return radioBlocked; }
    List<T> sourceAll() { return Collections.unmodifiableList(sourceAll); }
    String kind() { return sourceLong ? "spoken" : "music"; }

    int historyCount() { return Math.max(0, now); }

    int count(Region r) {
        int n = 0;
        for (int i = now + 1; i < list.size(); i++) if (list.get(i).region == r) n++;
        return n;
    }

    /** Play next items not played yet: the front of Queued by you. */
    int nextBlock() {
        int n = 0;
        for (int i = now + 1; i < list.size(); i++) if (list.get(i).region == Region.QUEUED && list.get(i).next) n++;
        return n;
    }

    /** Where a region starts in the timeline (its first index, or where it would be). */
    int start(Region r) {
        if (r == Region.HISTORY) return 0;
        if (r == Region.NOW) return Math.max(0, now);
        int at = now + 1;
        for (Region each : upcomingOrder()) {
            if (each == r) return at;
            at += count(each);
        }
        return at;
    }

    int end(Region r) {
        if (r == Region.HISTORY) return historyCount();
        if (r == Region.NOW) return now + 1;
        return start(r) + count(r);
    }

    private Region[] upcomingOrder() {
        return sourceLong
                ? new Region[] { Region.SOURCE, Region.QUEUED, Region.RADIO }
                : new Region[] { Region.QUEUED, Region.SOURCE, Region.RADIO };
    }

    /** Whether nothing is left after the item playing. */
    boolean atLast() { return now >= 0 && now == list.size() - 1; }

    /** Whether no source item is left to play (for Repeat's next pass). */
    boolean sourceDone() { return count(Region.SOURCE) == 0; }

    // ── verbs ───────────────────────────────────────────────────────────────

    /** What an add did: where the items went, for the snackbar ("Added to the queue · 3rd"). */
    static final class Added implements Undo {
        final int position;     // 1-based within Queued by you
        final int count;
        final boolean started;  // the queue was empty: the first item is now playing (paused)
        private final Runnable undo;
        Added(int position, int count, boolean started, Runnable undo) {
            this.position = position; this.count = count; this.started = started; this.undo = undo;
        }
        @Override public boolean undo() { undo.run(); return true; }
    }

    /**
     * Play next (to the end of the next block) or Add to queue (to the end of Queued by you,
     * before the source). Several items are one group.
     */
    Added add(List<T> items, boolean next, String groupLabel) {
        if (items == null || items.isEmpty()) return null;
        List<Entry<T>> made = new ArrayList<>();
        long group = items.size() > 1 ? ++groups : 0;
        for (T item : items) {
            Entry<T> e = entry(item, Region.QUEUED);
            e.next = next;
            e.group = group;
            e.groupLabel = group == 0 ? "" : (groupLabel == null ? "" : groupLabel);
            made.add(e);
        }
        if (list.isEmpty()) {
            made.get(0).region = Region.NOW;
            made.get(0).was = Region.QUEUED;
            list.addAll(made);
            now = 0;
            sink.add(0, items(made));
            changed();
            final List<Entry<T>> mine = made;
            return new Added(0, made.size(), true, () -> removeEntries(mine));
        }
        int index = next ? start(Region.QUEUED) + nextBlock() : end(Region.QUEUED);
        list.addAll(index, made);
        sink.add(index, items(made));
        changed();
        int position = index - start(Region.QUEUED) + 1;
        final List<Entry<T>> mine = made;
        return new Added(position, made.size(), false, () -> removeEntries(mine));
    }

    /** The player moved to {@code index} (a track ended, a skip, a tap). Returns whether it moved. */
    boolean onTransition(int index) {
        if (index < 0 || index >= list.size() || index == now) return false;
        if (now < 0) {
            for (int i = 0; i < index; i++) toHistory(list.get(i));
        } else if (index > now) {
            for (int i = now; i < index; i++) toHistory(list.get(i));
        } else {
            for (int i = index + 1; i <= now; i++) {
                Entry<T> e = list.get(i);
                e.region = e.was == Region.HISTORY || e.was == Region.NOW ? Region.SOURCE : e.was;
            }
        }
        Entry<T> current = list.get(index);
        if (current.region == Region.QUEUED && current.next) {
            // The block resets once a Play-next item has played: a new Play next goes to the front again.
            for (Entry<T> e : list) e.next = false;
        }
        if (current.region != Region.HISTORY) current.was = current.region;
        current.region = Region.NOW;
        now = index;
        trimHistory();
        changed();
        return true;
    }

    private void toHistory(Entry<T> e) {
        if (e.region != Region.HISTORY) e.was = e.region == Region.NOW ? e.was : e.region;
        e.region = Region.HISTORY;
        e.next = false;
    }

    private void trimHistory() {
        int over = now - HISTORY_CAP;
        if (over <= 0) return;
        list.subList(0, over).clear();
        now -= over;
        sink.remove(0, over);
    }

    /** Swipe or Remove: any row but the one playing. */
    Undo remove(int index) {
        if (index < 0 || index >= list.size() || index == now) return null;
        Entry<T> e = list.remove(index);
        if (index < now) now--;
        sink.remove(index, index + 1);
        changed();
        final int at = index;
        return () -> reinsert(at, Collections.singletonList(e));
    }

    /** "Clear queued": only Queued by you. */
    Undo clearQueued() {
        int s = start(Region.QUEUED), e = end(Region.QUEUED);
        return clearRange(s, e);
    }

    /** "Clear all but now playing": everything after it. Radio does not come back. */
    Undo clearUpcoming() {
        radioBlocked = true;
        return clearRange(now + 1, list.size());
    }

    private Undo clearRange(int s, int e) {
        if (s >= e || s <= now) return null;
        List<Entry<T>> gone = new ArrayList<>(list.subList(s, e));
        list.subList(s, e).clear();
        sink.remove(s, e);
        changed();
        return () -> reinsert(s, gone);
    }

    private boolean reinsert(int at, List<Entry<T>> entries) {
        if (entries.isEmpty()) return false;
        Region r = entries.get(0).region;
        int index;
        if (r == Region.HISTORY) index = Math.min(at, Math.max(0, now));
        else index = Math.max(now + 1, Math.min(at, list.size()));
        if (list.isEmpty()) index = 0;
        list.addAll(index, entries);
        if (index <= now && r == Region.HISTORY) now += entries.size();
        sink.add(index, items(entries));
        changed();
        return true;
    }

    private void removeEntries(List<Entry<T>> entries) {
        for (Entry<T> e : entries) {
            int i = list.indexOf(e);
            if (i < 0 || i == now) continue;
            list.remove(i);
            if (i < now) now--;
            sink.remove(i, i + 1);
        }
        changed();
    }

    /**
     * Drag to reorder. {@code target} is the section it was dropped in (null: by its
     * neighbours). A source item dropped in Queued by you becomes yours.
     */
    boolean move(int from, int to, Region target) {
        if (from <= now || from >= list.size()) return false;
        to = Math.max(now + 1, Math.min(to, list.size() - 1));
        if (to == from && target == null) return false;
        Entry<T> e = list.remove(from);
        list.add(to, e);
        Region prev = to - 1 > now ? list.get(to - 1).region : null;
        Region nextR = to + 1 < list.size() ? list.get(to + 1).region : null;
        Region chosen;
        if (target != null && (target == prev || target == nextR || (prev == null && nextR == null)
                || (prev == null && allowedFirst(target, nextR)) || (nextR == null && allowedAfter(prev, target)))) {
            chosen = target;
        } else if (prev != null) chosen = prev;
        else if (nextR != null) chosen = nextR;
        else chosen = e.region;
        if (chosen == Region.HISTORY || chosen == Region.NOW) chosen = e.region;
        Region old = e.region;
        e.region = chosen;
        e.was = chosen;
        if (chosen != Region.QUEUED) e.next = false;
        if (chosen == Region.SOURCE && old != Region.SOURCE) e.generation = generation;
        if (chosen == Region.SOURCE && !shuffled) renumberSource();
        if (to != from) sink.move(from, to);
        changed();
        return true;
    }

    /** Whether a region may come right after the now item, with {@code next} following. */
    private boolean allowedFirst(Region r, Region next) {
        Region[] order = upcomingOrder();
        return rank(order, r) <= rank(order, next);
    }

    private boolean allowedAfter(Region prev, Region r) {
        Region[] order = upcomingOrder();
        return rank(order, prev) <= rank(order, r);
    }

    private static int rank(Region[] order, Region r) {
        for (int i = 0; i < order.length; i++) if (order[i] == r) return i;
        return -1;
    }

    /** Source items in their places get the source's order values in place order (shuffle off keeps a hand move). */
    private void renumberSource() {
        List<Entry<T>> src = new ArrayList<>();
        List<Integer> orders = new ArrayList<>();
        int max = -1;
        for (int i = now + 1; i < list.size(); i++) {
            Entry<T> e = list.get(i);
            if (e.region != Region.SOURCE) continue;
            src.add(e);
            if (e.order >= 0) orders.add(e.order);
            max = Math.max(max, e.order);
        }
        while (orders.size() < src.size()) orders.add(++max);
        Collections.sort(orders);
        for (int i = 0; i < src.size(); i++) src.get(i).order = orders.get(i);
    }

    /** Tap a past item: it plays again alone; the queue after it is unchanged (§4 History). */
    boolean playAgain(int historyIndex) {
        if (historyIndex < 0 || historyIndex >= now) return false;
        Entry<T> h = list.get(historyIndex);
        Entry<T> copy = entry(h.item, Region.QUEUED);
        copy.was = Region.QUEUED;
        list.add(now + 1, copy);
        sink.add(now + 1, Collections.singletonList(h.item));
        sink.seek(now + 1);
        changed();
        return true;
    }

    /** Tap an upcoming row: it plays; the rows before it go to history. */
    boolean jump(int index) {
        if (index <= now || index >= list.size()) return false;
        sink.seek(index);
        return true;
    }

    /**
     * A new source (§2): it replaces Now playing and Next from &lt;source&gt;; Queued by you
     * stays. The rows before {@code start} are not queued (the list's rest is what follows).
     * Returns the Undo that puts the previous source back at its place.
     */
    Undo replace(List<T> items, int start, long positionMs, long previousPositionMs, String newLabel,
                 String newSourceId, Object tag, boolean shuffledByHome) {
        if (items == null || items.isEmpty()) return null;
        start = Math.max(0, Math.min(start, items.size() - 1));
        final Snapshot<T> before = snapshot(previousPositionMs);
        List<Entry<T>> history = new ArrayList<>(list.subList(0, Math.max(0, now)));
        Entry<T> oldNow = nowEntry();
        if (oldNow != null) { toHistory(oldNow); history.add(oldNow); }
        List<Entry<T>> queued = new ArrayList<>();
        for (int i = now + 1; i < list.size() && now >= 0; i++) if (list.get(i).region == Region.QUEUED) queued.add(list.get(i));
        // The new item playing leaves Queued by you: tapping a track you had queued (Play
        // next "Spindrift", then "Spindrift" in its album) plays it once, not now and again
        // as the first queued row (2026-11-27, the phone's queue on shell 190).
        String startId = idOf.apply(items.get(start));
        for (int i = 0; i < queued.size(); i++) {
            if (queued.get(i).id.equals(startId)) { before.dropped = queued.remove(i); before.droppedAt = i; break; }
        }
        generation++;
        sourceAll.clear();
        sourceAll.addAll(items);
        sourceLong = longOf.test(items.get(start));
        shuffled = shuffledByHome && !sourceLong;
        label = newLabel == null ? "" : newLabel;
        sourceId = newSourceId == null ? "" : newSourceId;
        sourceTag = tag;
        radioBlocked = false;
        if (sourceLong && repeat != Repeat.OFF) setRepeatQuiet(Repeat.OFF);
        Entry<T> first = entry(items.get(start), Region.NOW);
        first.was = Region.SOURCE;
        first.order = start;
        List<Entry<T>> source = new ArrayList<>();
        for (int i = start + 1; i < items.size(); i++) {
            Entry<T> e = entry(items.get(i), Region.SOURCE);
            e.order = i;
            source.add(e);
        }
        list.clear();
        list.addAll(history);
        list.add(first);
        if (sourceLong) { list.addAll(source); list.addAll(queued); }
        else { list.addAll(queued); list.addAll(source); }
        now = history.size();
        int over = now - HISTORY_CAP;
        if (over > 0) { list.subList(0, over).clear(); now -= over; }
        sink.replace(items(list), now, positionMs);
        changed();
        return () -> restoreSource(before);
    }

    /** The first tap played the track alone; its list arrived: the rest of it becomes the source. */
    boolean spliceSource(List<T> listItems, int at) {
        Entry<T> current = nowEntry();
        if (current == null || at < 0 || at >= listItems.size() || current.generation != generation
                || !current.id.equals(idOf.apply(listItems.get(at))) || count(Region.SOURCE) > 0) return false;
        sourceAll.clear();
        sourceAll.addAll(listItems);
        current.order = at;
        List<Entry<T>> made = new ArrayList<>();
        for (int i = at + 1; i < listItems.size(); i++) {
            Entry<T> e = entry(listItems.get(i), Region.SOURCE);
            e.order = i;
            made.add(e);
        }
        if (made.isEmpty()) return true;
        int index = start(Region.SOURCE);
        list.addAll(index, made);
        sink.add(index, items(made));
        changed();
        return true;
    }

    /** Shuffle only Next from &lt;source&gt; (§5). Off restores the source's order from the item now playing. */
    boolean setShuffle(boolean on) {
        if (sourceLong || on == shuffled) return false;
        shuffled = on;
        int s = start(Region.SOURCE), e = end(Region.SOURCE);
        List<Entry<T>> src = new ArrayList<>(list.subList(s, e));
        List<Entry<T>> order = new ArrayList<>(src);
        if (on) {
            Collections.shuffle(order, random);
        } else {
            order.sort((a, b) -> Integer.compare(a.order, b.order));
            int anchor = anchorOrder();
            if (anchor >= 0) {
                List<Entry<T>> after = new ArrayList<>();
                for (Entry<T> x : order) if (x.order > anchor) after.add(x);
                order = after;
            }
        }
        if (!order.equals(src)) {
            list.subList(s, e).clear();
            list.addAll(s, order);
            if (e > s) sink.remove(s, e);
            if (!order.isEmpty()) sink.add(s, items(order));
        }
        changed();
        return true;
    }

    /** The source's place now: the playing item's order if it is the source's, else the last source item heard. */
    private int anchorOrder() {
        for (int i = now; i >= 0; i--) {
            Entry<T> e = list.get(i);
            if (e.generation == generation && e.order >= 0 && (e.was == Region.SOURCE || e.region == Region.SOURCE)) return e.order;
        }
        return -1;
    }

    /** Off → All (the source repeats; your queued play once) → One. Not for a book. */
    boolean setRepeat(Repeat mode) {
        if (mode == null || mode == repeat) return false;
        if (sourceLong && mode != Repeat.OFF) return false;
        setRepeatQuiet(mode);
        changed();
        return true;
    }

    private void setRepeatQuiet(Repeat mode) {
        Repeat old = repeat;
        if (mode == Repeat.ONE && old != Repeat.ONE) beforeOne = old;
        repeat = mode;
        if ((mode == Repeat.ONE) != (old == Repeat.ONE)) sink.repeatOne(mode == Repeat.ONE);
    }

    /** A manual skip turns Repeat One back to the mode before it (§5). */
    boolean manualSkip() {
        if (repeat != Repeat.ONE) return false;
        setRepeatQuiet(beforeOne);
        changed();
        return true;
    }

    /** Whether the source should be queued again now: Repeat All (or the end card's Repeat) and none of it is left. */
    boolean wantsAnotherPass(End end) {
        if (sourceLong || sourceAll.isEmpty() || now < 0) return false;
        boolean repeating = repeat == Repeat.ALL || (end == End.REPEAT && atLast());
        return repeating && sourceDone() && count(Region.RADIO) == 0;
    }

    /** Queues the whole source again behind what is left (shuffled again when shuffle is on). */
    void appendPass() {
        List<T> pass = new ArrayList<>(sourceAll);
        List<Entry<T>> made = new ArrayList<>();
        for (int i = 0; i < pass.size(); i++) {
            Entry<T> e = entry(pass.get(i), Region.SOURCE);
            e.order = i;
            made.add(e);
        }
        if (shuffled) Collections.shuffle(made, random);
        int index = end(Region.SOURCE);
        list.addAll(index, made);
        sink.add(index, items(made));
        changed();
    }

    /** Whether Keep playing should fetch radio now: the last item is playing, music, and no Clear stopped it. */
    boolean wantsRadio(End end) {
        return end == End.KEEP_PLAYING && !sourceLong && !radioBlocked && atLast() && repeat == Repeat.OFF;
    }

    /** Keep playing's items: marked Radio, always at the very end (never in front of your picks). */
    void appendRadio(List<T> items) {
        if (items == null || items.isEmpty()) return;
        List<Entry<T>> made = new ArrayList<>();
        for (T item : items) made.add(entry(item, Region.RADIO));
        int index = list.size();
        list.addAll(made);
        sink.add(index, items(made));
        changed();
    }

    /**
     * A book's end: playback moving on its own from the book into what you queued pauses
     * there when the end choice for books is Stop (§2: "the queue continues only if you choose").
     */
    boolean pausesAt(int from, int to, End endForBooks) {
        if (from < 0 || to <= from || to >= list.size() || from >= list.size()) return false;
        Entry<T> a = list.get(from), b = list.get(to);
        boolean leavingBook = a.longForm && (a.was == Region.SOURCE || a.region == Region.SOURCE) && a.generation == generation;
        boolean intoQueue = b.region == Region.QUEUED || b.region == Region.RADIO || b.was == Region.QUEUED || b.was == Region.RADIO;
        return leavingBook && intoQueue && endForBooks != End.KEEP_PLAYING;
    }

    /**
     * The end choice for a kind: what was chosen last, else Stop for books and talks, and for
     * music Keep playing in the car (Driving Radio's old behaviour) or Stop.
     */
    static End endFor(String kind, String remembered, boolean car) {
        if (remembered != null) {
            try {
                End e = End.valueOf(remembered);
                if (!"spoken".equals(kind) || e != End.REPEAT) return e;
            } catch (IllegalArgumentException unknown) { /* the default */ }
        }
        if ("spoken".equals(kind)) return End.STOP;
        return car ? End.KEEP_PLAYING : End.STOP;
    }

    /** The player's list changed behind the model's back: rebuild it (history before, source after). */
    void resync(List<T> items, int current) {
        list.clear();
        generation++;
        for (int i = 0; i < items.size(); i++) {
            Entry<T> e = entry(items.get(i), i < current ? Region.HISTORY : i == current ? Region.NOW : Region.SOURCE);
            e.was = Region.SOURCE;
            e.order = i;
            list.add(e);
        }
        now = items.isEmpty() ? -1 : Math.max(0, Math.min(current, items.size() - 1));
        sourceAll.clear();
        sourceAll.addAll(items);
        sourceLong = now >= 0 && longOf.test(items.get(now));
        shuffled = false;
        changed();
    }

    // ── undo of a new source ────────────────────────────────────────────────

    static final class Snapshot<T> {
        final List<Entry<T>> history = new ArrayList<>();
        Entry<T> now;
        long positionMs;
        final List<Entry<T>> source = new ArrayList<>(); // source and radio, in place order
        final List<T> sourceAll = new ArrayList<>();
        String label, sourceId;
        Object tag;
        boolean sourceLong, shuffled;
        int generation;
        /** The queued row the new source's first item replaced (Undo puts it back at its place). */
        Entry<T> dropped;
        int droppedAt = -1;
    }

    private Snapshot<T> snapshot(long positionMs) {
        Snapshot<T> s = new Snapshot<>();
        if (now >= 0) {
            s.history.addAll(list.subList(0, now));
            s.now = list.get(now);
            for (int i = now + 1; i < list.size(); i++) {
                Region r = list.get(i).region;
                if (r == Region.SOURCE || r == Region.RADIO) s.source.add(list.get(i));
            }
        }
        s.positionMs = positionMs;
        s.sourceAll.addAll(sourceAll);
        s.label = label;
        s.sourceId = sourceId;
        s.tag = sourceTag;
        s.sourceLong = sourceLong;
        s.shuffled = shuffled;
        s.generation = generation;
        return s;
    }

    private boolean restoreSource(Snapshot<T> s) {
        if (s.now == null) {
            // Nothing played before: undo leaves only what you queued.
            List<Entry<T>> queued = new ArrayList<>();
            for (int i = now + 1; i < list.size(); i++) if (list.get(i).region == Region.QUEUED) queued.add(list.get(i));
            list.subList(Math.max(0, now), list.size()).clear();
            if (queued.isEmpty()) {
                list.clear();
                now = -1;
                sink.replace(new ArrayList<>(), 0, -1);
                changed();
                return true;
            }
            Entry<T> first = queued.remove(0);
            first.region = Region.NOW;
            int keep = list.size();
            list.add(first);
            list.addAll(queued);
            now = keep;
            sink.replace(items(list), now, -1);
            changed();
            return true;
        }
        List<Entry<T>> queued = new ArrayList<>();
        for (int i = now + 1; i < list.size(); i++) if (list.get(i).region == Region.QUEUED) queued.add(list.get(i));
        if (s.dropped != null) queued.add(Math.min(Math.max(0, s.droppedAt), queued.size()), s.dropped);
        List<Entry<T>> history = new ArrayList<>(s.history);
        Entry<T> back = s.now;
        back.region = Region.NOW;
        sourceAll.clear();
        sourceAll.addAll(s.sourceAll);
        label = s.label;
        sourceId = s.sourceId;
        sourceTag = s.tag;
        sourceLong = s.sourceLong;
        shuffled = s.shuffled;
        generation = s.generation;
        list.clear();
        list.addAll(history);
        list.add(back);
        List<Entry<T>> radio = new ArrayList<>(), src = new ArrayList<>();
        for (Entry<T> e : s.source) (e.region == Region.RADIO ? radio : src).add(e);
        if (sourceLong) { list.addAll(src); list.addAll(queued); }
        else { list.addAll(queued); list.addAll(src); }
        list.addAll(radio);
        now = history.size();
        sink.replace(items(list), now, s.positionMs);
        changed();
        return true;
    }

    // ── persistence ─────────────────────────────────────────────────────────

    /** Puts a saved queue back (the player gets the list, paused at the place). */
    void restore(List<Entry<T>> entries, int nowIndex, long positionMs, String savedLabel, String savedSourceId,
                 boolean savedLong, boolean savedShuffled, Repeat savedRepeat, List<T> savedAll) {
        list.clear();
        list.addAll(entries);
        now = entries.isEmpty() ? -1 : Math.max(0, Math.min(nowIndex, entries.size() - 1));
        for (Entry<T> e : entries) { uids = Math.max(uids, e.uid); groups = Math.max(groups, e.group); }
        for (Entry<T> e : entries) e.generation = generation;
        label = savedLabel == null ? "" : savedLabel;
        sourceId = savedSourceId == null ? "" : savedSourceId;
        sourceLong = savedLong;
        shuffled = savedShuffled && !savedLong;
        sourceAll.clear();
        if (savedAll != null) sourceAll.addAll(savedAll);
        repeat = savedLong ? Repeat.OFF : (savedRepeat == null ? Repeat.OFF : savedRepeat);
        if (!entries.isEmpty()) sink.replace(items(list), now, positionMs);
        if (repeat == Repeat.ONE) sink.repeatOne(true);
        changed();
    }

    /** A saved entry (persistence); uids stay unique after a restore. */
    Entry<T> savedEntry(long uid, T item, Region region, Region was, boolean next, int order, long group, String groupLabel) {
        Entry<T> e = new Entry<>(uid, item, idOf.apply(item), longOf.test(item), region);
        e.was = was;
        e.next = next;
        e.order = order;
        e.group = group;
        e.groupLabel = groupLabel == null ? "" : groupLabel;
        return e;
    }

    /** The whole queue as it stands, for putting back after a Clear all (Stop and clear's Undo). */
    static final class QueueSnapshot<T> {
        private final List<Entry<T>> entries;
        private final int now;
        private final String label, sourceId;
        private final Object sourceTag;
        private final boolean sourceLong, shuffled, radioBlocked;
        private final Repeat repeat, beforeOne;
        private final List<T> all;

        int size() { return entries.size(); }

        private QueueSnapshot(QueueModel<T> m) {
            entries = new ArrayList<>(m.list);
            now = m.now;
            label = m.label;
            sourceId = m.sourceId;
            sourceTag = m.sourceTag;
            sourceLong = m.sourceLong;
            shuffled = m.shuffled;
            radioBlocked = m.radioBlocked;
            repeat = m.repeat;
            beforeOne = m.beforeOne;
            all = new ArrayList<>(m.sourceAll);
        }
    }

    QueueSnapshot<T> queueSnapshot() { return new QueueSnapshot<>(this); }

    /** Puts a snapshot back; only into an empty queue (false once anything else was loaded). */
    boolean restoreQueueSnapshot(QueueSnapshot<T> s, long positionMs) {
        if (s == null || s.entries.isEmpty() || !list.isEmpty()) return false;
        restore(new ArrayList<>(s.entries), s.now, positionMs, s.label, s.sourceId, s.sourceLong, s.shuffled, s.repeat, s.all);
        sourceTag = s.sourceTag;
        beforeOne = s.beforeOne;
        radioBlocked = s.radioBlocked;
        return true;
    }

    /** Clear all, the queue gone (player cleared elsewhere). */
    void clearAll() {
        list.clear();
        now = -1;
        sourceAll.clear();
        label = "";
        sourceId = "";
        sourceTag = null;
        sourceLong = false;
        shuffled = false;
        changed();
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private Entry<T> entry(T item, Region region) {
        Entry<T> e = new Entry<>(++uids, item, idOf.apply(item), longOf.test(item), region);
        e.generation = generation;
        return e;
    }

    private static <T> List<T> items(List<Entry<T>> entries) {
        List<T> out = new ArrayList<>(entries.size());
        for (Entry<T> e : entries) out.add(e.item);
        return out;
    }

    List<T> items() { return items(list); }

    private void changed() { rev++; }

    private static final class NoSink<T> implements Sink<T> {
        @Override public void add(int index, List<T> items) { }
        @Override public void move(int from, int to) { }
        @Override public void remove(int fromIndex, int toIndexExclusive) { }
        @Override public void replace(List<T> all, int nowIndex, long positionMs) { }
        @Override public void seek(int index) { }
        @Override public void repeatOne(boolean on) { }
    }
}

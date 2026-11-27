package net.kckern.daylight.cap.widgets.shell;

import android.app.Activity;
import android.app.Dialog;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Outline;
import android.graphics.Typeface;
import android.text.Editable;
import android.text.TextUtils;
import android.text.TextWatcher;
import android.util.LruCache;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;
import android.view.WindowManager;
import android.widget.BaseAdapter;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.GridView;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import net.kckern.daylight.api.PayloadPort;
import net.kckern.daylight.shellkit.DaylightTheme;
import net.kckern.daylight.shellkit.DaylightTheme.Radius;
import net.kckern.daylight.shellkit.DaylightTheme.Type;
import net.kckern.daylight.shellkit.DrivingRadioSettings;
import net.kckern.daylight.shellkit.PlaylistArtwork;
import net.kckern.daylight.shellkit.PlaylistEntry;
import net.kckern.daylight.shellkit.PlaylistSearch;
import net.kckern.daylight.shellkit.PlaylistUse;
import net.kckern.daylight.shellkit.PlaylistWidgetState;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * One place to choose a playlist, used by the Drive tab, a widget button and a day of
 * Driving Radio: a grid of covers you can search, narrow to what is in use or to one
 * source, and sort. Playlists already in use show where they are used. The full list loads
 * in the background; with no backend the remembered ones still show and a retry line asks
 * again.
 */
final class PlaylistPicker {
    interface OnPick { void picked(PlaylistEntry entry); }

    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor(r -> daemon(r, "Daylight-playlist-catalog"));
    private static final ExecutorService IMAGES = Executors.newFixedThreadPool(3, r -> daemon(r, "Daylight-playlist-cover"));
    private static final LruCache<String, Bitmap> COVERS = new LruCache<>(64);

    private PlaylistPicker() {}

    private static Thread daemon(Runnable r, String name) {
        Thread t = new Thread(r, name);
        t.setDaemon(true);
        return t;
    }

    /**
     * Widgets draw a playlist's cover from a cache on the phone, so a playlist picked here
     * gets its picture fetched once, then the widgets are redrawn. Quiet when there is no
     * https address or the fetch fails: the widget keeps its placeholder.
     */
    static void cacheCover(android.content.Context context, String contentId, String art) {
        if (contentId == null || contentId.isEmpty() || art == null || !art.startsWith("https://")) return;
        android.content.Context app = context.getApplicationContext();
        IMAGES.execute(() -> {
            Bitmap bitmap = PlaylistArtwork.load(art, 600);
            if (bitmap == null) return;
            PlaylistWidgetArtwork.save(app, "c:" + contentId, bitmap);
            PlaylistWidgetState.redraw(app);
        });
    }

    /** Full screen over the current screen, with a back arrow. */
    static void show(Activity activity, String title, OnPick onPick) {
        show(activity, title, null, null, onPick);
    }

    /**
     * With a clear label (and a clear action), a button at the top lets the owner pick
     * "nothing": a day of Driving Radio going back to the default, for example.
     */
    static void show(Activity activity, String title, String clearLabel, Runnable onClear, OnPick onPick) {
        DaylightTheme t = DaylightTheme.of(activity);
        Dialog dialog = new Dialog(activity, net.kckern.daylight.shellkit.R.style.Theme_Daylight);
        LinearLayout root = new LinearLayout(activity);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(t.background);
        LinearLayout bar = new LinearLayout(activity);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        TextView back = glyph(activity, "‹", 30, t.ink);
        back.setGravity(Gravity.CENTER);
        back.setContentDescription("Back");
        back.setOnClickListener(v -> dialog.dismiss());
        bar.addView(back, dp(activity, 56), dp(activity, 56));
        bar.addView(text(activity, title, Type.HEADLINE, t.ink, true));
        root.addView(bar, new LinearLayout.LayoutParams(-1, -2));
        if (clearLabel != null && onClear != null) {
            TextView clear = text(activity, clearLabel, Type.BODY, t.primary, true);
            clear.setGravity(Gravity.CENTER);
            clear.setBackground(t.round(t.surfaceVariant, Radius.LARGE));
            clear.setOnClickListener(v -> {
                dialog.dismiss();
                onClear.run();
            });
            LinearLayout.LayoutParams clearParams = new LinearLayout.LayoutParams(-1, dp(activity, 44));
            clearParams.setMargins(dp(activity, 16), 0, dp(activity, 16), dp(activity, 8));
            root.addView(clear, clearParams);
        }
        root.addView(view(activity, entry -> {
            dialog.dismiss();
            onPick.picked(entry);
        }), new LinearLayout.LayoutParams(-1, 0, 1));
        dialog.setContentView(root);
        dialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        dialog.show();
    }

    static View view(Activity activity, OnPick onPick) {
        DrivingRadioSettings settings = new DrivingRadioSettings(activity);
        String[] weekdays = new java.text.DateFormatSymbols().getWeekdays();

        State state = new State();
        List<PlaylistEntry> catalog = new ArrayList<>(PlaylistCatalog.cached());
        List<PlaylistEntry> shown = new ArrayList<>();

        DaylightTheme t = DaylightTheme.of(activity);
        LinearLayout layout = new LinearLayout(activity);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setBackgroundColor(t.background);
        int side = dp(activity, 16);
        layout.setPadding(side, 0, side, 0);

        EditText search = new EditText(activity);
        search.setHint("Search playlists");
        search.setSingleLine(true);
        t.style(search, Type.BODY, t.ink, false);
        search.setHintTextColor(t.inkMuted);
        search.setPadding(dp(activity, 16), 0, dp(activity, 16), 0);
        search.setBackground(t.round(t.surface, Radius.LARGE));
        search.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH);
        layout.addView(search, new LinearLayout.LayoutParams(-1, dp(activity, 52)));

        HorizontalScrollView chipScroll = new HorizontalScrollView(activity);
        chipScroll.setHorizontalScrollBarEnabled(false);
        LinearLayout chips = new LinearLayout(activity);
        chipScroll.addView(chips);
        LinearLayout.LayoutParams chipParams = new LinearLayout.LayoutParams(-1, -2);
        chipParams.topMargin = dp(activity, 10);
        layout.addView(chipScroll, chipParams);

        LinearLayout meta = new LinearLayout(activity);
        meta.setGravity(Gravity.CENTER_VERTICAL);
        TextView count = text(activity, "", Type.LABEL, t.inkMuted, false);
        meta.addView(count, new LinearLayout.LayoutParams(0, -2, 1));
        TextView sort = text(activity, "", Type.LABEL, t.primary, true);
        sort.setPadding(dp(activity, 12), dp(activity, 10), 0, dp(activity, 10));
        meta.addView(sort);
        layout.addView(meta, new LinearLayout.LayoutParams(-1, -2));

        FrameLayout body = new FrameLayout(activity);
        GridView grid = new GridView(activity);
        grid.setNumColumns(3);
        grid.setVerticalSpacing(dp(activity, 14));
        grid.setHorizontalSpacing(dp(activity, 10));
        grid.setStretchMode(GridView.STRETCH_COLUMN_WIDTH);
        grid.setClipToPadding(false);
        grid.setPadding(0, dp(activity, 4), 0, dp(activity, 24));
        grid.setSelector(new android.graphics.drawable.ColorDrawable(Color.TRANSPARENT));
        grid.setVerticalScrollBarEnabled(false);
        body.addView(grid, new FrameLayout.LayoutParams(-1, -1));
        LinearLayout empty = new LinearLayout(activity);
        empty.setOrientation(LinearLayout.VERTICAL);
        empty.setGravity(Gravity.CENTER);
        TextView emptyText = text(activity, "", Type.BODY, t.ink, false);
        emptyText.setGravity(Gravity.CENTER);
        empty.addView(emptyText);
        TextView emptyAction = text(activity, "", Type.BODY, t.primary, true);
        emptyAction.setGravity(Gravity.CENTER);
        emptyAction.setPadding(dp(activity, 16), dp(activity, 14), dp(activity, 16), dp(activity, 14));
        empty.addView(emptyAction);
        body.addView(empty, new FrameLayout.LayoutParams(-1, -1));
        layout.addView(body, new LinearLayout.LayoutParams(-1, 0, 1));

        Tiles tiles = new Tiles(activity, shown, settings, weekdays);
        grid.setAdapter(tiles);
        grid.setOnItemClickListener((parent, tile, position, id) -> onPick.picked(shown.get(position)));

        Runnable[] refresh = new Runnable[1];
        Runnable[] load = new Runnable[1];
        Runnable[] drawChips = new Runnable[1];

        drawChips[0] = () -> {
            chips.removeAllViews();
            List<String> labels = new ArrayList<>();
            labels.add("All");
            labels.add("On Drive");
            labels.addAll(PlaylistSearch.sources(merged(settings, catalog)));
            for (int i = 0; i < labels.size(); i++) {
                int index = i;
                TextView chip = text(activity, labels.get(i), Type.LABEL, index == state.filter ? t.onPrimary : t.ink, true);
                chip.setPadding(dp(activity, 16), 0, dp(activity, 16), 0);
                chip.setGravity(Gravity.CENTER);
                chip.setBackground(t.round(index == state.filter ? t.primary : t.surfaceVariant, Radius.LARGE));
                chip.setOnClickListener(v -> {
                    state.filter = index;
                    state.filterName = index < 2 ? "" : labels.get(index);
                    drawChips[0].run();
                    refresh[0].run();
                });
                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, dp(activity, 40));
                lp.rightMargin = dp(activity, 8);
                chips.addView(chip, lp);
            }
        };

        refresh[0] = () -> {
            List<PlaylistEntry> base = merged(settings, catalog);
            if (state.filter == 1) {
                List<PlaylistEntry> used = new ArrayList<>();
                for (PlaylistEntry entry : base) {
                    if (settings.isStaple(entry.id)) used.add(entry);
                }
                base = used;
            } else if (state.filter >= 2) {
                base = PlaylistSearch.bySource(base, state.filterName);
            }
            base = PlaylistSearch.filter(base, search.getText().toString());
            base = PlaylistSearch.sort(base, state.sort, settings::usedAt);
            shown.clear();
            shown.addAll(base);
            tiles.notifyDataSetChanged();

            sort.setText("Sort: " + state.sort.label + " ▾");
            sort.setContentDescription("Sorted by " + state.sort.label + ". Tap to change.");
            count.setText(state.loading ? "Loading all playlists…" : shown.size() + (shown.size() == 1 ? " playlist" : " playlists"));

            boolean none = shown.isEmpty();
            grid.setVisibility(none ? View.GONE : View.VISIBLE);
            empty.setVisibility(none ? View.VISIBLE : View.GONE);
            emptyAction.setOnClickListener(null);
            emptyAction.setVisibility(View.GONE);
            if (!none) return;
            String query = search.getText().toString().trim();
            if (state.loading && catalog.isEmpty()) {
                emptyText.setText("Loading playlists…");
            } else if (state.error != null) {
                emptyText.setText(state.error);
                emptyAction.setText("Try again");
                emptyAction.setVisibility(View.VISIBLE);
                emptyAction.setOnClickListener(v -> load[0].run());
            } else if (!query.isEmpty() || state.filter != 0) {
                emptyText.setText(query.isEmpty() ? "Nothing here yet." : "No playlists match “" + query + "”.");
                emptyAction.setText("Clear search and filters");
                emptyAction.setVisibility(View.VISIBLE);
                emptyAction.setOnClickListener(v -> {
                    search.setText("");
                    state.filter = 0;
                    state.filterName = "";
                    drawChips[0].run();
                    refresh[0].run();
                });
            } else {
                emptyText.setText("No playlists found.");
            }
        };

        search.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int a, int b, int c) {}
            @Override public void onTextChanged(CharSequence s, int a, int b, int c) { refresh[0].run(); }
            @Override public void afterTextChanged(Editable s) {}
        });
        sort.setOnClickListener(v -> {
            state.sort = state.sort.next();
            refresh[0].run();
            grid.setSelection(0);
        });

        load[0] = () -> {
            state.loading = true;
            state.error = null;
            refresh[0].run();
            WORKER.execute(() -> {
                List<PlaylistEntry> loaded = Collections.emptyList();
                String failure = null;
                try {
                    loaded = PlaylistCatalog.load();
                } catch (Exception e) {
                    failure = e instanceof PayloadPort.NotReadyException ? "Still starting up."
                            : "Could not load all playlists.";
                }
                List<PlaylistEntry> result = loaded;
                String message = failure;
                activity.runOnUiThread(() -> {
                    if (activity.isDestroyed() || activity.isFinishing()) return;
                    state.loading = false;
                    state.error = message;
                    if (message == null) {
                        catalog.clear();
                        catalog.addAll(result);
                    }
                    drawChips[0].run();
                    refresh[0].run();
                });
            });
        };

        drawChips[0].run();
        load[0].run();
        return layout;
    }

    private static List<PlaylistEntry> merged(DrivingRadioSettings settings, List<PlaylistEntry> catalog) {
        List<PlaylistEntry> remembered = new ArrayList<>();
        for (DrivingRadioSettings.Staple staple : settings.staged()) {
            remembered.add(new PlaylistEntry(staple.id, staple.title, staple.art));
        }
        // The catalog knows each playlist's source and thumbnail; the remembered record only
        // its title. Take the catalog's version when there is one, and keep the order the
        // source gave.
        java.util.Map<String, PlaylistEntry> known = new java.util.HashMap<>();
        for (PlaylistEntry entry : catalog) known.put(entry.id, entry);
        List<PlaylistEntry> upgraded = new ArrayList<>();
        for (PlaylistEntry entry : remembered) {
            PlaylistEntry full = known.get(entry.id);
            upgraded.add(full == null ? entry : new PlaylistEntry(entry.id, entry.title,
                    entry.art.isEmpty() ? full.art : entry.art, full.source));
        }
        // Source order is the catalog's: put the remembered ones back where the catalog had them.
        List<PlaylistEntry> out = new ArrayList<>(catalog);
        java.util.Set<String> inCatalog = known.keySet();
        for (PlaylistEntry entry : upgraded) {
            if (!inCatalog.contains(entry.id)) out.add(entry);
        }
        for (int i = 0; i < out.size(); i++) {
            for (PlaylistEntry entry : upgraded) {
                if (entry.id.equals(out.get(i).id)) { out.set(i, entry); break; }
            }
        }
        return out;
    }

    private static final class State {
        int filter;
        String filterName = "";
        PlaylistSearch.Sort sort = PlaylistSearch.Sort.AZ;
        boolean loading;
        String error;
    }

    private static final class Tiles extends BaseAdapter {
        private final Activity activity;
        private final List<PlaylistEntry> shown;
        private final DrivingRadioSettings settings;
        private final String[] weekdays;

        Tiles(Activity activity, List<PlaylistEntry> shown, DrivingRadioSettings settings, String[] weekdays) {
            this.activity = activity;
            this.shown = shown;
            this.settings = settings;
            this.weekdays = weekdays;
        }

        @Override public int getCount() { return shown.size(); }
        @Override public PlaylistEntry getItem(int position) { return shown.get(position); }
        @Override public long getItemId(int position) { return position; }

        @Override public View getView(int position, View recycled, ViewGroup parent) {
            Tile tile = recycled == null ? new Tile(activity) : (Tile) recycled;
            PlaylistEntry entry = getItem(position);
            String used = settings.isStaged(entry.id) ? PlaylistUse.describe(settings.snapshot(), entry.id, weekdays) : "";
            tile.bind(entry, used, settings.isStaple(entry.id));
            return tile;
        }
    }

    /** A cover with the title under it, and where the playlist is used. */
    private static final class Tile extends LinearLayout {
        private final Square frame;
        private final TextView placeholder;
        private final ImageView cover;
        private final TextView badge;
        private final TextView title;

        private final int usedColor;

        Tile(Activity activity) {
            super(activity);
            DaylightTheme t = DaylightTheme.of(activity);
            usedColor = t.primary;
            setOrientation(VERTICAL);
            frame = new Square(activity);
            cover = new ImageView(activity);
            cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
            cover.setBackgroundColor(t.tile);
            cover.setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
            frame.addView(cover, new FrameLayout.LayoutParams(-1, -1));
            placeholder = glyph(activity, "♪", 34, DaylightTheme.withAlpha(t.primary, 0x88));
            placeholder.setGravity(Gravity.CENTER);
            placeholder.setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
            frame.addView(placeholder, new FrameLayout.LayoutParams(-1, -1));
            int radius = dp(activity, 12);
            frame.setOutlineProvider(new ViewOutlineProvider() {
                @Override public void getOutline(View view, Outline outline) {
                    outline.setRoundRect(0, 0, view.getWidth(), view.getHeight(), radius);
                }
            });
            frame.setClipToOutline(true);
            badge = text(activity, "✓", Type.LABEL, t.onPrimary, true);
            badge.setGravity(Gravity.CENTER);
            badge.setBackground(DaylightTheme.round(t.primary, dp(activity, 12)));
            FrameLayout.LayoutParams badgeParams = new FrameLayout.LayoutParams(dp(activity, 24), dp(activity, 24), Gravity.TOP | Gravity.END);
            badgeParams.setMargins(0, dp(activity, 6), dp(activity, 6), 0);
            frame.addView(badge, badgeParams);
            addView(frame, new LayoutParams(-1, -2));
            // One block of text: the title, then where it is used right under it. Three lines
            // always, so every tile is the same height: a grid sizes its rows from one tile, and
            // a shorter tile would be overlapped by the row below.
            title = text(activity, "", Type.LABEL, t.ink, false);
            title.setMinLines(3);
            title.setMaxLines(3);
            title.setEllipsize(TextUtils.TruncateAt.END);
            title.setPadding(0, dp(activity, 6), 0, 0);
            title.setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
            addView(title);
        }

        void bind(PlaylistEntry entry, String used, boolean onDrive) {
            android.text.SpannableStringBuilder label = new android.text.SpannableStringBuilder(entry.title);
            label.setSpan(new android.text.style.StyleSpan(Typeface.BOLD), 0, label.length(), 0);
            if (!used.isEmpty()) {
                int from = label.length();
                label.append('\n').append(used);
                label.setSpan(new android.text.style.ForegroundColorSpan(usedColor), from, label.length(), 0);
                label.setSpan(new android.text.style.AbsoluteSizeSpan(11, true), from, label.length(), 0);
            }
            title.setText(label);
            badge.setVisibility(onDrive ? VISIBLE : GONE);
            setContentDescription(entry.title + (onDrive ? ". On Drive" : "") + (used.isEmpty() ? "" : ". Used: " + used));
            bindCover(cover, placeholder, entry.id, entry.art);
        }
    }

    /**
     * Put a playlist's cover in an image view: from the memory cache, else fetched (its https
     * thumbnail, or the widget cover already on the phone). The placeholder shows until then.
     */
    static void bindCover(ImageView cover, View placeholder, String id, String art) {
        String key = art == null || art.isEmpty() ? "c:" + id : art;
        cover.setTag(key);
        Bitmap hit = COVERS.get(key);
        cover.setImageBitmap(hit);
        if (placeholder != null) placeholder.setVisibility(hit == null ? View.VISIBLE : View.GONE);
        if (hit != null) return;
        android.content.Context context = cover.getContext().getApplicationContext();
        IMAGES.execute(() -> {
            Bitmap bitmap = art != null && art.startsWith("https://") ? PlaylistArtwork.load(art, 360) : null;
            if (bitmap == null) bitmap = PlaylistWidgetArtwork.read(context, "c:" + id);
            if (bitmap == null) return;
            COVERS.put(key, bitmap);
            Bitmap done = bitmap;
            cover.post(() -> {
                if (!key.equals(cover.getTag())) return;
                cover.setImageBitmap(done);
                if (placeholder != null) placeholder.setVisibility(View.GONE);
            });
        });
    }

    /** A frame that is as tall as it is wide. */
    private static final class Square extends FrameLayout {
        Square(android.content.Context context) { super(context); }

        @Override protected void onMeasure(int width, int height) {
            int size = MeasureSpec.getSize(width);
            super.onMeasure(MeasureSpec.makeMeasureSpec(size, MeasureSpec.EXACTLY),
                    MeasureSpec.makeMeasureSpec(size, MeasureSpec.EXACTLY));
        }
    }

    /** Text in a theme role: the widgets screens' one way to make a label. */
    static TextView text(android.content.Context context, String value, Type type, int color, boolean bold) {
        return DaylightTheme.of(context).text(context, value, type, color, bold);
    }

    /** A symbol drawn as text (a back arrow, a note) at its own size: not a type role. */
    static TextView glyph(android.content.Context context, String value, int sp, int color) {
        TextView view = new TextView(context);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(color);
        return view;
    }

    static int dp(android.content.Context context, int value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }
}

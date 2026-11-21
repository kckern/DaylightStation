package net.kckern.daylight.cap.widgets.shell;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.graphics.Bitmap;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.text.TextWatcher;
import android.text.Editable;
import android.widget.BaseAdapter;
import android.widget.EditText;
import android.widget.ListView;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** The launcher supplies the widget ID. The playlist selection comes from private setup state. */
public class ButtonWidgetConfigActivity extends Activity {
    private static final String TAG = "Daylight-Widget";
    private int widgetId;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        setResult(RESULT_CANCELED);
        widgetId = state == null
                ? getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
                : state.getInt("widgetId");
        AppWidgetManager manager = AppWidgetManager.getInstance(this);
        if (!ButtonWidgetProvider.owns(this, manager, widgetId)) {
            Log.w(TAG, "the chooser was opened for a widget that is not a Daylight button");
            finish();
            return;
        }

        PlacementStore store = new PlacementStore(this);
        setTitle("Choose a playlist");
        if (!ButtonWidgetProvider.chosen(this, widgetId).isEmpty()) {
            showMessage("This widget already has a playlist. Add another widget to choose a different one.");
            return;
        }
        List<PlacementStore.StagedPlaylist> staged = store.staged();
        if (staged.isEmpty()) {
            showMessage("Open Daylight → Play on demand to stage playlists for this widget.");
            return;
        }

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(dp(16), 0, dp(16), 0);
        layout.setFocusableInTouchMode(true);
        EditText search = new EditText(this);
        search.setHint("Search staged playlists");
        search.setSingleLine(true);
        layout.addView(search, new LinearLayout.LayoutParams(-1, -2));

        ListView list = new ListView(this);
        layout.addView(list, new LinearLayout.LayoutParams(-1, 0, 1));
        TextView empty = new TextView(this);
        empty.setText("No matching playlists");
        empty.setPadding(0, dp(12), 0, dp(12));
        layout.addView(empty, new LinearLayout.LayoutParams(-1, -2));
        list.setEmptyView(empty);
        PlaylistRows rows = new PlaylistRows(staged, store.recentlyPlaced(staged));
        list.setAdapter(rows);
        list.setOnItemClickListener((parent, view, position, id) -> {
            PlacementStore.StagedPlaylist playlist = rows.getItem(position).playlist;
            if (playlist != null) assign(store, manager, playlist);
        });
        search.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence text, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence text, int start, int before, int count) {
                rows.filter(text.toString());
                list.setSelection(0);
            }
            @Override public void afterTextChanged(Editable text) {}
        });
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN
                | WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        setContentView(layout);
        layout.requestFocus();
    }

    private void assign(PlacementStore store, AppWidgetManager manager, PlacementStore.StagedPlaylist playlist) {
        if (!ButtonWidgetProvider.owns(this, manager, widgetId) || !store.assignStaged(playlist.contentId, widgetId)) {
            showMessage("This playlist is no longer available. Add the widget again to refresh the list.");
            return;
        }
        try {
            manager.updateAppWidget(widgetId, ButtonWidgetProvider.render(this, widgetId));
        } catch (RuntimeException e) {
            Log.w(TAG, "could not draw the button: " + e.getClass().getSimpleName());
        }
        setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId));
        finish();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private static final class Row {
        final String title;
        final PlacementStore.StagedPlaylist playlist;

        Row(String title, PlacementStore.StagedPlaylist playlist) {
            this.title = title;
            this.playlist = playlist;
        }
    }

    private final class PlaylistRows extends BaseAdapter {
        private final List<PlacementStore.StagedPlaylist> staged;
        private final List<PlacementStore.StagedPlaylist> recent;
        private final List<Row> rows = new ArrayList<>();

        PlaylistRows(List<PlacementStore.StagedPlaylist> staged, List<PlacementStore.StagedPlaylist> recent) {
            this.staged = staged;
            this.recent = recent;
            filter("");
        }

        void filter(String query) {
            rows.clear();
            String term = query.trim().toLowerCase(Locale.ROOT);
            if (term.isEmpty()) {
                if (!recent.isEmpty()) {
                    rows.add(new Row("Recently placed", null));
                    for (PlacementStore.StagedPlaylist item : recent) rows.add(new Row(item.title, item));
                }
                rows.add(new Row("All staged playlists", null));
            }
            for (PlacementStore.StagedPlaylist item : staged) {
                if (item.title.toLowerCase(Locale.ROOT).contains(term)) rows.add(new Row(item.title, item));
            }
            notifyDataSetChanged();
        }

        @Override public int getCount() { return rows.size(); }
        @Override public Row getItem(int position) { return rows.get(position); }
        @Override public long getItemId(int position) { return position; }
        @Override public int getViewTypeCount() { return 2; }
        @Override public int getItemViewType(int position) { return isEnabled(position) ? 1 : 0; }
        @Override public boolean areAllItemsEnabled() { return false; }
        @Override public boolean isEnabled(int position) { return getItem(position).playlist != null; }

        @Override public View getView(int position, View recycled, ViewGroup parent) {
            Row data = getItem(position);
            if (data.playlist == null) {
                TextView header = recycled == null ? new TextView(ButtonWidgetConfigActivity.this) : (TextView) recycled;
                header.setPadding(0, dp(10), 0, dp(4));
                header.setText(data.title);
                header.setTypeface(null, android.graphics.Typeface.BOLD);
                if (android.os.Build.VERSION.SDK_INT >= 28) header.setAccessibilityHeading(true);
                return header;
            }
            LinearLayout row;
            if (recycled == null) {
                row = new LinearLayout(ButtonWidgetConfigActivity.this);
                row.setGravity(android.view.Gravity.CENTER_VERTICAL);
                row.setMinimumHeight(dp(56));
                ImageView cover = new ImageView(ButtonWidgetConfigActivity.this);
                cover.setBackgroundColor(0xff125b47);
                cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
                cover.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
                row.addView(cover, dp(44), dp(44));
                TextView title = new TextView(ButtonWidgetConfigActivity.this);
                title.setPaddingRelative(dp(12), 0, 0, 0);
                title.setTextSize(16);
                row.addView(title, new LinearLayout.LayoutParams(0, -2, 1));
            } else {
                row = (LinearLayout) recycled;
            }
            ImageView cover = (ImageView) row.getChildAt(0);
            Bitmap bitmap = PlaylistWidgetArtwork.read(ButtonWidgetConfigActivity.this, "c:" + data.playlist.contentId);
            if (bitmap == null) cover.setImageResource(R.drawable.widget_playlist_cover);
            else cover.setImageBitmap(bitmap);
            ((TextView) row.getChildAt(1)).setText(data.title);
            return row;
        }
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        state.putInt("widgetId", widgetId);
    }

    private void showMessage(String text) {
        TextView message = new TextView(this);
        int padding = (int) (24 * getResources().getDisplayMetrics().density);
        message.setPadding(padding, padding, padding, padding);
        message.setText(text);
        setContentView(message);
    }
}

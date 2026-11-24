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

import net.kckern.daylight.shellkit.DrivingRadioSettings;

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
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setFocusableInTouchMode(true);
        // Every playlist, searchable. The ones already in use come first.
        layout.addView(PlaylistPicker.view(this, entry -> {
            DrivingRadioSettings settings = new DrivingRadioSettings(this);
            settings.remember(entry.id, entry.title, entry.art);
            PlaylistPicker.cacheCover(this, entry.id, entry.art);
            assign(store, manager, entry.id);
        }), new LinearLayout.LayoutParams(-1, -1));
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN
                | WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        setContentView(layout);
        layout.requestFocus();
    }

    private void assign(PlacementStore store, AppWidgetManager manager, String contentId) {
        if (!ButtonWidgetProvider.owns(this, manager, widgetId) || !store.assignStaged(contentId, widgetId)) {
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

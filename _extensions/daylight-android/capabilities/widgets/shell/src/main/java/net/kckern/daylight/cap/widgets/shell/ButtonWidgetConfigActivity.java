package net.kckern.daylight.cap.widgets.shell;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.widget.ArrayAdapter;
import android.widget.ListView;
import android.widget.TextView;

import java.util.Collections;

/** The launcher supplies the widget ID. The playlist selection comes from private setup state. */
public class ButtonWidgetConfigActivity extends Activity {
    private static final String TAG = "Daylight-Widget";
    private String requestId;
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
        requestId = state == null ? store.manualRequestId() : state.getString("requestId", "");
        LauncherPlacement frozen = store.get(requestId);
        setTitle("Daylight playlist");
        if (!ButtonWidgetProvider.chosen(this, widgetId).isEmpty()) {
            showMessage("This widget already has a selection. Add another Daylight playlist widget to play a different playlist.");
            return;
        }
        if (frozen == null || !frozen.playlist || frozen.manualWidget > 0) {
            showMessage("In Daylight, choose Play a playlist, then choose Place manually to prepare this widget.");
            return;
        }

        ListView list = new ListView(this);
        list.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_list_item_1,
                Collections.singletonList("Play " + frozen.title)));
        list.setOnItemClickListener((parent, view, position, id) -> {
            // The selection is frozen; only its outcome may have changed while the chooser was open.
            LauncherPlacement current = store.get(requestId);
            boolean owned = ButtonWidgetProvider.owns(this, manager, widgetId);
            LauncherPlacement bound = !owned || current == null ? null
                    : current.bindManual(widgetId, !ButtonWidgetProvider.chosen(this, widgetId).isEmpty());
            if (!store.write(bound, widgetId)) {
                showMessage("This widget could not be assigned. Return to Android Home and try placing it again.");
                return;
            }
            try {
                manager.updateAppWidget(widgetId, ButtonWidgetProvider.render(this, widgetId));
            } catch (RuntimeException e) {
                Log.w(TAG, "could not draw the button: " + e.getClass().getSimpleName());
            }
            setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId));
            finish();
        });
        setContentView(list);
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        state.putInt("widgetId", widgetId);
        state.putString("requestId", requestId);
    }

    private void showMessage(String text) {
        TextView message = new TextView(this);
        int padding = (int) (24 * getResources().getDisplayMetrics().density);
        message.setPadding(padding, padding, padding, padding);
        message.setText(text);
        setContentView(message);
    }
}

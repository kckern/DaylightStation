package net.kckern.daylight.cap.widgets.shell;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.widget.ArrayAdapter;
import android.widget.ListView;
import android.widget.TextView;



/**
 * The step Android shows when a one-action button is placed: pick the action.
 *
 * Exported, because the launcher starts it (android.appwidget.action.APPWIDGET_CONFIGURE),
 * so any app can start it too. What it does with that:
 *
 *  - it reads one thing from its intent, the widget id, and uses it only when Android
 *    says the widget with that id is one of this app's button widgets (ButtonFace.ours);
 *  - it lists the actions the payload last wrote to the surface cache, by label;
 *  - a tap on one stores that action's id for that widget, in this app's private
 *    storage, and redraws the widget.
 *
 * It runs no action, starts no capture and no playback, opens no page, and returns
 * nothing but the widget id it was given. The worst another app can do with it is put
 * this list in front of the owner.
 */
public class ButtonWidgetConfigActivity extends Activity {
    private static final String TAG = "Daylight-Widget";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Leaving without choosing cancels the placement.
        setResult(RESULT_CANCELED);
        Intent intent = getIntent();
        final int widgetId = intent == null ? AppWidgetManager.INVALID_APPWIDGET_ID
                : intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        final AppWidgetManager manager = AppWidgetManager.getInstance(this);
        AppWidgetProviderInfo info = manager == null ? null : manager.getAppWidgetInfo(widgetId);
        boolean ours = info != null && info.provider != null && ButtonFace.ours(widgetId, info.provider.getPackageName(),
                info.provider.getClassName(), getPackageName(), ButtonWidgetProvider.class.getName());
        if (!ours) {
            Log.w(TAG, "the chooser was opened for a widget that is not a Daylight button");
            finish();
            return;
        }
        setTitle("Daylight playlist");
        String playlist = ButtonWidgetProvider.selectedPlaylist(this);
        String playlistTitle = ButtonWidgetProvider.selectedPlaylistTitle(this);
        if (!playlist.startsWith("c:")) {
            TextView message = new TextView(this);
            int padding = (int) (24 * getResources().getDisplayMetrics().density);
            message.setPadding(padding, padding, padding, padding);
            message.setText("Choose a playlist in Daylight → Play a playlist, then add this widget again.");
            setContentView(message);
            return;
        }
        ListView list = new ListView(this);
        list.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_list_item_1,
                java.util.Collections.singletonList("Play " + playlistTitle)));
        list.setOnItemClickListener((parent, view, position, id) -> {
            ButtonWidgetProvider.choosePlaylist(this, widgetId, playlist, playlistTitle);
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
}

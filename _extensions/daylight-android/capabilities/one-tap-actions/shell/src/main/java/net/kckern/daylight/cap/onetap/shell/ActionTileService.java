package net.kckern.daylight.cap.onetap.shell;

import android.app.PendingIntent;
import android.content.Intent;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;
import android.util.Log;

import net.kckern.daylight.api.DirectPlay;
import net.kckern.daylight.api.SurfaceKeys;
import net.kckern.daylight.shellkit.DirectPlayIntents;
import net.kckern.daylight.shellkit.SurfaceCache;

/**
 * One quick-settings slot. Android creates this by class name, possibly in a process
 * with no payload, so it reads only the surface cache and never calls the payload. A
 * tap launches the slot's daylight:// link through the link activity, which is where
 * the shell is started and the payload is waited for; a tap on a media action first
 * tries the play service (DirectPlay), which plays it with no window.
 *
 * Which action a slot shows is the payload's decision (the setting actions.tiles).
 * A slot with no action is shown unavailable.
 */
public abstract class ActionTileService extends TileService {
    private static final String TAG = "Daylight-Tile";

    protected abstract int slot();

    private TileFace face() {
        int slot = slot();
        return TileFace.of(slot,
                SurfaceCache.get(this, SurfaceKeys.tile(slot, SurfaceKeys.LABEL)),
                SurfaceCache.get(this, SurfaceKeys.tile(slot, SurfaceKeys.ICON)),
                SurfaceCache.link(this, SurfaceKeys.tile(slot, SurfaceKeys.URI)));
    }

    @Override
    public void onStartListening() {
        Tile tile = getQsTile();
        if (tile == null) return;
        TileFace face = face();
        tile.setLabel(face.label);
        tile.setState(face.available ? Tile.STATE_INACTIVE : Tile.STATE_UNAVAILABLE);
        int icon = getResources().getIdentifier(face.iconName, "drawable", getPackageName());
        if (icon != 0) tile.setIcon(Icon.createWithResource(this, icon));
        tile.updateTile();
    }

    @Override
    public void onClick() {
        final TileFace face = face();
        if (!face.available) {
            // Never a dead tap (audit): an empty slot says so.
            say("No action is set for this tile");
            return;
        }
        // Other actions change something, so a locked phone asks for the unlock first.
        // A voice or photo capture runs over the lock screen: capturing is the point of the tile.
        boolean overLock = "1".equals(SurfaceCache.get(this, SurfaceKeys.tile(slot(), SurfaceKeys.LOCK_OK)));
        if (isLocked() && !overLock) unlockAndRun(() -> tap(face.link));
        else tap(face.link);
    }

    /**
     * A media action plays with no window where Android lets a tile start the play
     * service (DirectPlay): always below Android 12, and from 12 when Android does not
     * refuse the start. A refused start launches the keyed link, as every other action does.
     */
    private void tap(String link) {
        int slot = slot();
        String direct = SurfaceCache.get(this, SurfaceKeys.tile(slot, SurfaceKeys.DIRECT));
        DirectPlay.Path path = DirectPlay.path(DirectPlay.Surface.TILE, Build.VERSION.SDK_INT, direct,
                DirectPlayIntents.installed(this));
        if (path != DirectPlay.Path.LINK && DirectPlayIntents.start(this, direct)) return;
        if (path == DirectPlay.Path.SERVICE_ELSE_LINK) Log.i(TAG, "slot " + slot + " plays through the link");
        launch(link);
    }

    private void launch(String link) {
        try {
            Intent intent = SurfaceCache.viewIntent(this, link).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (Build.VERSION.SDK_INT >= 34) {
                // API 34 replaced the Intent overload with a PendingIntent one. The project
                // compiles against API 33, so the new overload is reached by reflection.
                try {
                    PendingIntent pending = PendingIntent.getActivity(this, slot(), intent,
                            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
                    TileService.class.getMethod("startActivityAndCollapse", PendingIntent.class).invoke(this, pending);
                    return;
                } catch (ReflectiveOperationException fallThrough) {
                    // Use the Intent overload below.
                }
            }
            startActivityAndCollapse(intent);
        } catch (RuntimeException e) {
            Log.w(TAG, "could not launch slot " + slot() + ": " + e.getClass().getSimpleName());
            say("Could not open " + face().label + ". Open the app and try it from there");
        }
    }

    private void say(String line) {
        try { android.widget.Toast.makeText(getApplicationContext(), line, android.widget.Toast.LENGTH_LONG).show(); }
        catch (RuntimeException noWindow) { Log.w(TAG, "could not say: " + line); }
    }

    public static final class Tile1 extends ActionTileService { @Override protected int slot() { return 1; } }
    public static final class Tile2 extends ActionTileService { @Override protected int slot() { return 2; } }
    public static final class Tile3 extends ActionTileService { @Override protected int slot() { return 3; } }
    public static final class Tile4 extends ActionTileService { @Override protected int slot() { return 4; } }
}

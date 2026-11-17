package net.kckern.daylight.cap.onetap.shell;

import android.app.PendingIntent;
import android.content.Intent;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;
import android.util.Log;

import net.kckern.daylight.api.SurfaceKeys;
import net.kckern.daylight.shellkit.SurfaceCache;

/**
 * One quick-settings slot. Android creates this by class name, possibly in a process
 * with no payload, so it reads only the surface cache and never calls the payload or
 * starts a service. A tap launches the slot's daylight:// link through the link
 * activity, which is where the shell is started and the payload is waited for.
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
        if (!face.available) return;
        // An action changes something, so a locked phone asks for the unlock first.
        if (isLocked()) unlockAndRun(() -> launch(face.link));
        else launch(face.link);
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
        }
    }

    public static final class Tile1 extends ActionTileService { @Override protected int slot() { return 1; } }
    public static final class Tile2 extends ActionTileService { @Override protected int slot() { return 2; } }
    public static final class Tile3 extends ActionTileService { @Override protected int slot() { return 3; } }
    public static final class Tile4 extends ActionTileService { @Override protected int slot() { return 4; } }
}

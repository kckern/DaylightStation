package net.kckern.daylight.cap.mediaservice.shell;

import android.os.Bundle;

import androidx.media3.common.Player;
import androidx.media3.session.CommandButton;
import androidx.media3.session.SessionCommand;

import java.util.Arrays;
import java.util.List;

/**
 * The transport a car shows: back 10s, play/pause, forward 10s — the layout Plex
 * uses. Android Auto fills the two slots beside play/pause with skip-to-previous and
 * skip-to-next when the session offers them, and only otherwise with the first two
 * custom actions. So the session does not offer track skips; "Next track" and
 * "Stop" go to the overflow as the third and fourth custom actions.
 *
 * Seek back/forward player commands are not enough on their own: a car reads the
 * legacy session, where they become ACTION_REWIND/FAST_FORWARD, which Android Auto
 * does not draw. They must be custom actions.
 */
final class CarControls {
    static final long SEEK_STEP_MS = 10_000;

    static final String BACK_ACTION = "net.kckern.daylight.media.BACK_10";
    static final String FORWARD_ACTION = "net.kckern.daylight.media.FORWARD_10";
    static final String NEXT_ACTION = "net.kckern.daylight.media.NEXT_TRACK";
    static final String STOP_ACTION = "net.kckern.daylight.media.STOP";

    static final List<String> ACTIONS = Arrays.asList(BACK_ACTION, FORWARD_ACTION, NEXT_ACTION, STOP_ACTION);

    private static final int[] TRACK_SKIPS = {
            Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
            Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
    };

    private CarControls() { }

    /** The buttons, in slot order: left of play, right of play, then overflow. */
    static List<CommandButton> layout() {
        return Arrays.asList(
                button(BACK_ACTION, android.R.drawable.ic_media_rew, "Back 10 seconds"),
                button(FORWARD_ACTION, android.R.drawable.ic_media_ff, "Forward 10 seconds"),
                button(NEXT_ACTION, android.R.drawable.ic_media_next, "Next track"),
                button(STOP_ACTION, android.R.drawable.ic_menu_close_clear_cancel, "Stop"));
    }

    static boolean isTrackSkip(int command) {
        for (int skip : TRACK_SKIPS) if (skip == command) return true;
        return false;
    }

    static Player.Commands withoutTrackSkips(Player.Commands commands) {
        return commands.buildUpon().removeAll(TRACK_SKIPS).build();
    }

    /** Runs a custom action on the player. False when the action is not one of these. */
    static boolean run(String action, Player player, Runnable stop) {
        if (BACK_ACTION.equals(action)) { player.seekBack(); return true; }
        if (FORWARD_ACTION.equals(action)) { player.seekForward(); return true; }
        if (NEXT_ACTION.equals(action)) { if (player.hasNextMediaItem()) player.seekToNextMediaItem(); return true; }
        if (STOP_ACTION.equals(action)) { stop.run(); return true; }
        return false;
    }

    private static CommandButton button(String action, int icon, String name) {
        return new CommandButton.Builder().setSessionCommand(new SessionCommand(action, Bundle.EMPTY))
                .setIconResId(icon).setDisplayName(name).build();
    }
}

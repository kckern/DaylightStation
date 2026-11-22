package net.kckern.daylight.cap.mediaservice.shell;

import android.os.Bundle;

import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.Player;
import androidx.media3.session.CommandButton;
import androidx.media3.session.SessionCommand;

import java.util.Arrays;
import java.util.List;

/**
 * The transport a car shows, by what is playing.
 *
 * Long-form audio (an item from a household list — talks, scripture, courses — or
 * one at least 20 minutes long): back 10s, play/pause, forward 10s, the layout
 * Plex uses, with "Next track" and "Stop" in the overflow. Android Auto fills the
 * two slots beside play/pause with skip-to-previous/next when the session offers
 * them, and only otherwise with the first two custom actions, so for long-form the
 * session withholds track skips. A steering-wheel next/previous still arrives (the
 * legacy session falls back to seekToNextMediaItem and checks only the car's
 * connection commands), and becomes forward/back 10s.
 *
 * Music: previous, play/pause, next, as any player; Stop in the overflow; the wheel
 * skips tracks.
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

    /** An item at least this long is long-form even when it is not from a list. */
    static final long LONG_FORM_MS = 20 * 60 * 1000;

    static final List<String> ACTIONS = Arrays.asList(BACK_ACTION, FORWARD_ACTION, NEXT_ACTION, STOP_ACTION);

    private static final int[] TRACK_SKIPS = {
            Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
            Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
    };

    private CarControls() { }

    static boolean longForm(String listId, long durationMs) {
        return (listId != null && !listId.isEmpty()) || durationMs >= LONG_FORM_MS;
    }

    /** The buttons, in slot order: left of play, right of play, then overflow. */
    static List<CommandButton> layout(boolean longForm) {
        if (!longForm) return Arrays.asList(button(STOP_ACTION, android.R.drawable.ic_menu_close_clear_cancel, "Stop"));
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

    /**
     * Runs a custom action on the player. False when the action is not one of these.
     * Next track goes to the wrapped player: the session player turns a skip into a
     * 10s jump for long-form, and this button means the next item.
     */
    static boolean run(String action, Player player, Runnable stop) {
        Player target = player instanceof ForwardingPlayer ? ((ForwardingPlayer) player).getWrappedPlayer() : player;
        if (BACK_ACTION.equals(action)) { target.seekBack(); return true; }
        if (FORWARD_ACTION.equals(action)) { target.seekForward(); return true; }
        if (NEXT_ACTION.equals(action)) { if (target.hasNextMediaItem()) target.seekToNextMediaItem(); return true; }
        if (STOP_ACTION.equals(action)) { stop.run(); return true; }
        return false;
    }

    private static CommandButton button(String action, int icon, String name) {
        return new CommandButton.Builder().setSessionCommand(new SessionCommand(action, Bundle.EMPTY))
                .setIconResId(icon).setDisplayName(name).build();
    }
}

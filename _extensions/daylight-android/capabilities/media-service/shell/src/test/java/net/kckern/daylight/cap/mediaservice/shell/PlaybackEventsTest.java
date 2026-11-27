package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.assertEquals;

import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;

import com.google.common.util.concurrent.MoreExecutors;

import net.kckern.daylight.api.PayloadPort;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

public class PlaybackEventsTest {
    private final MediaItem first = item("plex:1");
    private final MediaItem second = item("plex:2");
    private MediaItem current = first;
    private int playbackState = Player.STATE_READY;
    private final List<String> states = new ArrayList<>();
    private final List<String> ends = new ArrayList<>();
    private final PayloadPort.Handler handler = raw -> {
        JSONObject event = new JSONObject(raw);
        states.add(event.getString("state"));
        if ("ended".equals(event.getString("state"))) {
            ends.add(event.getString("id") + "@" + event.getLong("positionMs") + "/" + event.getLong("durationMs"));
        }
        return "{}";
    };

    private final Player player = (Player) Proxy.newProxyInstance(Player.class.getClassLoader(),
            new Class<?>[]{Player.class}, (proxy, method, args) -> {
                switch (method.getName()) {
                    case "getCurrentMediaItem": return current;
                    case "getCurrentPosition": return current == second ? 2400L : 0L;
                    case "getDuration": return current == second ? 2400L : 1200L;
                    case "getPlaybackState": return playbackState;
                    case "getPlaybackParameters": return androidx.media3.common.PlaybackParameters.DEFAULT;
                    case "isPlaying": return false;
                    default: throw new AssertionError(method.getName());
                }
            });

    @Before public void attachPayload() { PayloadPort.named(PayloadMedia.PORT).attach(handler); }
    @After public void detachPayload() { PayloadPort.named(PayloadMedia.PORT).detach(handler); }

    @Test public void shortTracksEachEndOnceWithoutAPlaybackSample() {
        PlaybackEvents events = new PlaybackEvents(player, new PayloadMedia(), MoreExecutors.newDirectExecutorService());
        current = second;
        events.onPositionDiscontinuity(position(first, 0, 1200), position(second, 1, 0),
                Player.DISCONTINUITY_REASON_AUTO_TRANSITION);
        events.onMediaItemTransition(second, Player.MEDIA_ITEM_TRANSITION_REASON_AUTO);
        events.onPlaybackStateChanged(Player.STATE_ENDED);
        assertEquals(Arrays.asList("plex:1@1200/1200", "plex:2@2400/2400"), ends);
    }

    @Test public void manualSkipDoesNotCompleteTheOutgoingTrack() {
        PlaybackEvents events = new PlaybackEvents(player, new PayloadMedia(), MoreExecutors.newDirectExecutorService());
        current = second;
        events.onPositionDiscontinuity(position(first, 0, 1190), position(second, 1, 0),
                Player.DISCONTINUITY_REASON_SEEK);
        events.onMediaItemTransition(second, Player.MEDIA_ITEM_TRANSITION_REASON_SEEK);
        events.onPlaybackStateChanged(Player.STATE_ENDED);
        assertEquals(Collections.singletonList("plex:2@2400/2400"), ends);
    }

    @Test public void aTransitionToAnAlreadyEndedItemDoesNotEmitPausedProgress() {
        PlaybackEvents events = new PlaybackEvents(player, new PayloadMedia(), MoreExecutors.newDirectExecutorService());
        current = second;
        playbackState = Player.STATE_ENDED;
        events.onPositionDiscontinuity(position(first, 0, 1200), position(second, 1, 0),
                Player.DISCONTINUITY_REASON_AUTO_TRANSITION);
        events.onMediaItemTransition(second, Player.MEDIA_ITEM_TRANSITION_REASON_AUTO);
        events.onPlaybackStateChanged(Player.STATE_ENDED);
        assertEquals(Arrays.asList("ended", "transition", "ended"), states);
    }

    private static MediaItem item(String id) {
        return new MediaItem.Builder().setMediaId(id).build();
    }

    private static Player.PositionInfo position(MediaItem item, int index, long ms) {
        return new Player.PositionInfo(null, index, item, null, index, ms, ms, -1, -1);
    }
}

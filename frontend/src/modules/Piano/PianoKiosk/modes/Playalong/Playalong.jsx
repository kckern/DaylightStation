import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import { Karaoke } from '../Karaoke/Karaoke.jsx';

/**
 * Play-along — backing tracks. Play-along mirrors KARAOKE far more than the
 * courses/lessons flow: pick a track and play it, no sequence, no completion
 * history, no resume. So it reuses the Karaoke song browser (season tabs +
 * flat song list) over the configured Backing Tracks show
 * (`config.playalong.plexShow`), and `startFresh` makes every track start at 0.
 * Lives at /piano/playalong.
 */
export function Playalong() {
  const { config } = usePianoKioskConfig();
  return <Karaoke showId={config.playalong?.plexShow} startFresh />;
}

export default Playalong;

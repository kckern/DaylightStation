import { usePianoKioskConfig } from '../../PianoConfig.jsx';
import { Videos } from '../Videos/Videos.jsx';
import SingalongPlayer from './SingalongPlayer.jsx';

/**
 * Singalong — karaoke mode. Reuses the Videos grid→detail→player flow over the
 * configured karaoke collection (`config.singalong`), but swaps the lecture
 * player for SingalongPlayer so songs play through karaoke chrome (no keyboard,
 * staff, or circle of fifths). Content is a video collection just like Playalong;
 * only the player differs.
 */
export function Singalong() {
  const { config } = usePianoKioskConfig();
  return <Videos source={config.singalong} PlayerComponent={SingalongPlayer} />;
}

export default Singalong;

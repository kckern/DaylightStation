import { Karaoke } from '../Karaoke/Karaoke.jsx';

/**
 * Singalong — the karaoke menu entry. Renders the purpose-built Karaoke song
 * browser (search + category tabs over the configured Karaoke show,
 * `config.karaoke.plexShow`); each pick plays through SingalongPlayer's karaoke
 * chrome (no keyboard/staff/circle-of-fifths). Lives at /piano/singalong.
 */
export function Singalong() {
  return <Karaoke />;
}

export default Singalong;

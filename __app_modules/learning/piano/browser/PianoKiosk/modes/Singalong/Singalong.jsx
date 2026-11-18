import useKaraokeSchoolAccess, { KARAOKE_SCHOOL_MESSAGE } from '../../useKaraokeSchoolAccess.js';
import { Karaoke } from '../Karaoke/Karaoke.jsx';

/**
 * Singalong — the karaoke menu entry. Renders the purpose-built Karaoke song
 * browser (category tabs over the configured Karaoke show,
 * `config.karaoke.plexShow`); each pick plays through SingalongPlayer's karaoke
 * chrome (no keyboard/staff/circle-of-fifths). Lives at /piano/singalong.
 */
export function Singalong() {
  const access = useKaraokeSchoolAccess();
  if (!access.unlocked) {
    return (
      <section className="piano-mode__placeholder" role="status">
        {access.status === 'error' && <p>Unable to check schoolwork right now.</p>}
        <p>{KARAOKE_SCHOOL_MESSAGE}</p>
      </section>
    );
  }
  return <Karaoke />;
}

export default Singalong;

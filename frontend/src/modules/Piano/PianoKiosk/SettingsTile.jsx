import TransportButton from './transport/TransportButton.jsx';
import './SettingsSheets.scss';

/**
 * SettingsTile — one action in a settings grid: a tile-layout TransportButton
 * with its own result line underneath, so what an action did shows up where
 * the finger is, never at the bottom of the sheet.
 *
 * @param {string} icon
 * @param {string} label
 * @param {'default'|'primary'|'danger'} [emphasis]
 * @param {boolean} [on] armed / selected
 * @param {boolean} [disabled]
 * @param {() => void} onPress
 * @param {string|null} [message] result or hint shown under the tile
 * @param {'idle'|'working'|'success'|'failed'} [tone] colours the message
 */
export default function SettingsTile({ icon, label, emphasis = 'default', on = false, disabled = false, onPress, message = null, tone = 'idle', className = '' }) {
  return (
    <div className={`piano-settings__tile${className ? ` ${className}` : ''}`}>
      <TransportButton layout="tile" icon={icon} label={label} emphasis={emphasis} on={on} disabled={disabled} onPress={onPress} />
      {message && <p role="status" className={`piano-settings__tilemsg is-${tone}`}>{message}</p>}
    </div>
  );
}

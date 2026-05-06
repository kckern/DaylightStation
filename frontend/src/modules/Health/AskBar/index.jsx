import { AiMark } from '../AiMark/index.jsx';
import './AskBar.scss';

export function AskBar({ onActivate }) {
  const handleKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate?.();
    }
  };

  return (
    <div
      className="ask-bar"
      role="button"
      tabIndex={0}
      aria-label="Ask the health coach"
      onClick={() => onActivate?.()}
      onKeyDown={handleKey}
    >
      <AiMark size={24} />
      <span className="ask-bar__placeholder">
        Ask your coach…
        <span className="ask-bar__hint"> type @ to mention a period or workout</span>
      </span>
      <kbd className="ask-bar__shortcut">⌘K</kbd>
    </div>
  );
}

export default AskBar;

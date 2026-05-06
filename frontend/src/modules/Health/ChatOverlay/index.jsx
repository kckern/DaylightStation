import { useEffect } from 'react';
import { AiMark } from '../AiMark/index.jsx';
import './ChatOverlay.scss';

export function ChatOverlay({ open, onClose, userId, children }) {
  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Body scroll lock
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  return (
    <div
      className={`chat-overlay ${open ? 'chat-overlay--open' : ''}`}
      aria-hidden={!open}
    >
      <div className="chat-overlay__scrim" onClick={() => onClose?.()} />
      <div className="chat-overlay__panel" role="dialog" aria-modal="true">
        <header className="chat-overlay__header">
          <AiMark size={24} />
          <span className="chat-overlay__title">Health Coach</span>
          {userId && <span className="chat-overlay__user">· {userId}</span>}
          <button className="chat-overlay__close" onClick={() => onClose?.()} type="button">
            Esc to dismiss
          </button>
        </header>
        <div className="chat-overlay__body">
          {children}
        </div>
      </div>
    </div>
  );
}

export default ChatOverlay;

import { Sheet } from '@/lib/ui';
import './ChatOverlay.scss';

export function ChatOverlay({ open, onClose, userId, children }) {
  return (
    <Sheet open={open} onClose={onClose} title="Health Coach">
      <div className="chat-overlay__body" style={{ height: '65dvh' }}>{children}</div>
    </Sheet>
  );
}

export default ChatOverlay;

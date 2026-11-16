import { SchoolButton } from '../portal/SchoolButton.jsx';
/**
 * EmptyState — THE kiosk empty-state pattern (design audit, remediation #8):
 * icon + one-line what-this-is + one-line how-it-fills + optional action,
 * centered as a single unit. Replaces the product's anthology of stranded
 * sentences (a lone "Nothing to print yet." hugging a corner of a 1280×800
 * canvas reads as a crash with good grammar).
 *
 * Also carries the loading twin, so "Loading…" stops appearing as a bare
 * unanchored string in three different positions on three screens.
 */
import Icon from "./icons/Icon.jsx";
import { StateMessage, LoadingState as HouseLoadingState } from "#frontend/lib/ui/states.jsx";

export default function EmptyState({ icon = null, title, hint = null, actionLabel = null, onAction = null }) {
  return (
    <StateMessage className="school-empty" data-testid="empty-state" title={title} detail={hint} icon={icon && <Icon name={icon} className="school-empty__icon" />}>
      {actionLabel && onAction && (
        <SchoolButton variant="plain" type="button" className="school-empty__action" onClick={onAction}>{actionLabel}</SchoolButton>
      )}
    </StateMessage>
  );
}

export function LoadingState({ label = 'Loading…' }) {
  return (
    <HouseLoadingState label={label} rows={0} className="school-empty school-empty--loading" data-testid="loading-state" aria-live="polite">
      <p className="school-empty__title">{label}</p>
    </HouseLoadingState>
  );
}

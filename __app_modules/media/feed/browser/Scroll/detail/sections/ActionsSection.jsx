import { SubmitButton } from '../../../../../../../frontend/src/lib/ui/SubmitButton.jsx';

export default function ActionsSection({ data, detailActions }) {
  if (!data?.items?.length) return null;
  const { error, pending, run } = detailActions.forSection(data.items);

  return (
    <div className="detail-actions">
      {error && <div className="detail-actions__error" role="alert">{error}</div>}
      {data.items.map(action => (
        <SubmitButton
          key={action.id}
          className={action.style === 'danger' ? 'detail-actions__danger' : undefined}
          variant={action.style === 'primary' ? 'primary' : 'secondary'}
          density="compact"
          type="button"
          pending={pending(action)}
          onClick={() => run(action)}
        >
          {action.label}
        </SubmitButton>
      ))}
    </div>
  );
}

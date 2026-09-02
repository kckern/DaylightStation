import './ds.scss';

const SparkIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 1l1.8 4.5L14 7l-4.2 1.5L8 13l-1.8-4.5L2 7l4.2-1.5L8 1z"
      stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
);

/** Chat entry pill. Pairs with modules/Agent/AgentChatSurface in an overlay. */
export function AskAffordance({ placeholder = 'Ask your coach…', onActivate }) {
  return (
    <button type="button" className="ds-ask" onClick={onActivate}>
      <SparkIcon />
      <span className="ds-ask__placeholder">{placeholder}</span>
      <kbd className="ds-ask__kbd">⌘K</kbd>
    </button>
  );
}

export default AskAffordance;

// The home layout node that swaps to a session's detail when a session is open,
// and the subtree it swaps to. Shared by the sessions widget (row clicks, outside
// selections) and FitnessApp (seeding the pane at mount so a post-session
// redirect or /session-{id} deep link lands on the detail directly).
export const SESSION_DETAIL_NODE_ID = 'right-area';

export function sessionDetailSubtree(sessionId) {
  return { children: [{ widget: 'fitness:session-detail', props: { sessionId } }] };
}

export function sessionDetailSeed(sessionId) {
  return sessionId ? { [SESSION_DETAIL_NODE_ID]: sessionDetailSubtree(sessionId) } : undefined;
}

// Session id shown by the node's current replacement, or null.
export function openSessionIdOf(nodeState) {
  if (!nodeState?.replaced) return null;
  const child = nodeState.node?.children?.[0];
  return child?.widget === 'fitness:session-detail' ? (child.props?.sessionId ?? null) : null;
}

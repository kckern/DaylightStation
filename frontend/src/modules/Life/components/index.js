export { LifePage } from './LifePage.jsx';
export { ErrorState } from './ErrorState.jsx';
// Straight re-exports over the DS versions — no prop mismatch against any
// Life call site (LoadingState/SectionCard) once Dashboard.jsx dropped its
// dead Paper passthrough props; see ErrorState.jsx for the one component that
// needed an adapter instead of a plain re-export.
export { LoadingState, EmptyState, SectionCard } from '@/lib/ui';

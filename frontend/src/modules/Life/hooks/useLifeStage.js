import { useAlignment } from './useAlignment.js';

export function useLifeStage(username) {
  const { data, loading } = useAlignment('dashboard', username);
  const dashboard = data?.dashboard;
  return {
    stage: dashboard?.stage || null,
    completeness: dashboard?.completeness || null,
    loading,
  };
}

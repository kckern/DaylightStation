import { useApiResource } from "../../../../../frontend/src/lib/hooks/useApiResource.js";
import { useLifeUsername } from "./useLifeUser.js";

export function useAlignment(mode = 'priorities', username) {
  const contextUsername = useLifeUsername();
  const user = username || contextUsername;
  const params = new URLSearchParams({ mode });
  if (user) params.set('username', user);
  const { data, loading, error, reload } = useApiResource(`api/v1/life/now?${params}`, { label: 'life alignment' });
  return { data, loading, error: error?.message ?? null, refetch: reload };
}

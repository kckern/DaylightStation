import { it, expect, vi } from 'vitest';
import { createParticipantLaunchClient } from './participantLaunchClient.js';

it('posts only the launch request using the established authenticated headers', async () => {
  localStorage.setItem('ds_token','test-token');
  const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({ready:true})});
  const client=createParticipantLaunchClient(fetcher);
  await client.inspect({ref:{schema:'participant-launch-ref/v1',provider:'agenda',ref:'opaque'},action:'display'});
  expect(fetcher).toHaveBeenCalledWith('/api/v1/participant-launches/inspect',expect.objectContaining({method:'POST',headers:expect.objectContaining({Authorization:'Bearer test-token','Content-Type':'application/json'})}));
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ref:{schema:'participant-launch-ref/v1',provider:'agenda',ref:'opaque'},action:'display'});
  localStorage.removeItem('ds_token');
});

export function buildDispatchUrl({
  deviceId,
  play,
  queue,
  dispatchId,
  shader,
  volume,
  shuffle,
}) {
  if (!deviceId) throw new Error('buildDispatchUrl: deviceId is required');
  if (!dispatchId) throw new Error('buildDispatchUrl: dispatchId is required');
  if (!play && !queue) throw new Error('buildDispatchUrl: play or queue is required');

  const params = new URLSearchParams();
  if (play) params.set('play', play);
  else params.set('queue', queue);
  params.set('dispatchId', dispatchId);
  if (shader) params.set('shader', shader);
  if (typeof volume === 'number' && Number.isFinite(volume)) params.set('volume', String(volume));
  if (shuffle) params.set('shuffle', '1');
  return `api/v1/device/${deviceId}/load?${params.toString()}`;
}

export default buildDispatchUrl;

/**
 * ISatelliteRegistry
 *   findByToken(token: string): Promise<Satellite | null>
 *   list(): Promise<Satellite[]>
 */
export function isSatelliteRegistry(obj) {
  return !!obj && typeof obj.findByToken === 'function' && typeof obj.list === 'function';
}

export function assertSatelliteRegistry(obj) {
  if (!isSatelliteRegistry(obj)) throw new Error('Object does not implement ISatelliteRegistry');
}

export default { isSatelliteRegistry, assertSatelliteRegistry };

/** Project raw ambient configuration into semantic zone subscriptions. */
export function projectAmbientZones(config) {
  const out = [];
  const push = (channel, entities) => {
    const resolvedChannel = typeof channel === 'string' && channel.trim() ? channel.trim() : null;
    const resolvedEntities = Array.isArray(entities)
      ? entities.filter((entity) => typeof entity === 'string' && entity)
      : [];
    if (resolvedChannel && resolvedEntities.length) out.push({ channel: resolvedChannel, entities: resolvedEntities });
  };
  if (Array.isArray(config?.zones)) {
    for (const zone of config.zones) push(zone?.topic, zone?.entities);
    return out;
  }
  if (config?.illuminance) push(config.illuminance.topic || 'ambient', config.illuminance.entities);
  return out;
}

export default projectAmbientZones;

const normalize = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
export function classifySupervision({ participantIds = [], supervisorIds = [] } = {}) {
  const supervisors = new Set(supervisorIds.map(normalize).filter(Boolean));
  const present = [...new Set(participantIds.map(normalize).filter(id => supervisors.has(id)))];
  return { supervised: present.length > 0, supervisorIds: present };
}

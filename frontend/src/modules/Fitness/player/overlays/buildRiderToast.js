/**
 * Map a rider_select event to a FitnessToast payload. Pure — name resolution is
 * injected so this stays testable and decoupled from FitnessContext internals.
 *
 * @param {Object} data - { userId, equipmentId }
 * @param {Object} resolvers
 * @param {(userId:string)=>string} resolvers.resolveUserName
 * @param {(equipmentId:string)=>string} resolvers.resolveEquipmentName
 * @returns {{ avatarUrl: string, title: string, subtitle: string, variant: string }}
 */
export function buildRiderToast(data, { resolveUserName, resolveEquipmentName } = {}) {
  const userId = data?.userId;
  const equipmentId = data?.equipmentId;
  const name = (typeof resolveUserName === 'function' && resolveUserName(userId)) || userId;
  const equipmentName = (typeof resolveEquipmentName === 'function' && resolveEquipmentName(equipmentId)) || equipmentId;
  return {
    avatarUrl: `/api/v1/static/img/users/${userId}`,
    title: name,
    subtitle: `is riding the ${equipmentName}`,
    variant: 'success',
  };
}

export default buildRiderToast;

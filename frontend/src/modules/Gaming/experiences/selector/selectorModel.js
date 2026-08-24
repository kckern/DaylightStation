import { orderSeeded, selectSeeded } from '@shared-gaming/mechanics/selection.mjs';

export function selectHouseholdMember(members, seed) { return selectSeeded(members, seed); }
export function orderHouseholdMembers(members, seed) { return orderSeeded(members, seed); }

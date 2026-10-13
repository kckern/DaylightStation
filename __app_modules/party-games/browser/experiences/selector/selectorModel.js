import { orderSeeded, selectSeeded } from "../../../../../__capabilities/gaming/portable/mechanics/selection.mjs";

export function selectHouseholdMember(members, seed) { return selectSeeded(members, seed); }
export function orderHouseholdMembers(members, seed) { return orderSeeded(members, seed); }

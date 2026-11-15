const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,121}$/;
const display = guest => ({ name: guest.name, avatar: guest.avatar ?? null });
const guestEntry = guest => ({ person: { kind: 'guest', id: guest.id }, display: display(guest), active: guest.active });
function validateGuest(guest) {
  if (!ID.test(guest.id || '') || typeof guest.name !== 'string' || !guest.name.trim() || typeof guest.active !== 'boolean') throw new Error('Invalid guest identity');
  if (guest.avatar != null && (typeof guest.avatar !== 'object' || Array.isArray(guest.avatar))) throw new Error('Invalid guest avatar');
}
export class PeopleDirectory {
  constructor({ householdDirectory, guestStore }) { this.householdDirectory = householdDirectory; this.guestStore = guestStore; }
  list({ householdId, query = '', includeArchived = false }) {
    const users = (this.householdDirectory.userIds?.(householdId) || []).map(id => {
      const profile = this.householdDirectory.userProfile?.(id);
      return { person: { kind: 'user', id }, display: { name: profile?.display_name || profile?.name || id, avatar: profile?.avatar ?? null }, active: true };
    });
    const guests = this.guestStore.read(householdId).guests.filter(g => includeArchived || g.active).map(guestEntry);
    const needle = String(query).trim().toLowerCase();
    return [...users, ...guests].filter(entry => entry.display.name.toLowerCase().includes(needle));
  }
  resolve({ householdId, person }) {
    if (!person || !['user', 'guest'].includes(person.kind)) return null;
    return (this.list({ householdId, includeArchived: true })).find(entry => entry.person.kind === person.kind && entry.person.id === person.id) || null;
  }
  async createGuest({ householdId, input, expectedRevision }) {
    const doc = this.guestStore.read(householdId);
    const guest = { id: input?.id, name: input?.name, avatar: input?.avatar ?? null, active: true };
    validateGuest(guest);
    if (doc.guests.some(g => g.id === guest.id)) throw new Error('Guest identity already exists');
    return this.guestStore.write(householdId, expectedRevision, [...doc.guests, guest]);
  }
  async updateGuest({ householdId, id, input, expectedRevision }) {
    const doc = this.guestStore.read(householdId);
    const index = doc.guests.findIndex(g => g.id === id);
    if (index < 0) throw new Error('Unknown guest');
    if (!input || Object.keys(input).some(k => !['name','avatar'].includes(k))) throw new Error('Invalid guest update');
    const guest = { ...doc.guests[index], ...input };
    validateGuest(guest);
    const guests = [...doc.guests]; guests[index] = guest;
    return this.guestStore.write(householdId, expectedRevision, guests);
  }
  async archiveGuest({ householdId, id, expectedRevision }) {
    const doc = this.guestStore.read(householdId);
    if (!doc.guests.some(g => g.id === id)) throw new Error('Unknown guest');
    return this.guestStore.write(householdId, expectedRevision, doc.guests.map(g => g.id === id ? { ...g, active: false } : g));
  }
}

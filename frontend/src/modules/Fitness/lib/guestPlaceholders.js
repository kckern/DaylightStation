// Placeholder avatar tiers (audit N5 / guest-mode Part 4):
//   untagged device            → 'user'        (Pikachu — unchanged, means "tag me")
//   generic Guest, adult       → 'guest-adult' (claimed-but-anonymous)
//   generic Guest, kid         → 'guest-kid'
// Assets live server-side at /static/img/users/<id>.jpg. If an asset is
// missing the existing <img onError> chains fall back to 'user', so this
// degrades to today's behavior until the images are dropped in.

export function genericGuestImageId(ageClass) {
  return ageClass === 'kid' ? 'guest-kid' : 'guest-adult';
}

export function isGenericGuestProfileId(profileId) {
  return typeof profileId === 'string' && profileId.startsWith('guest_');
}

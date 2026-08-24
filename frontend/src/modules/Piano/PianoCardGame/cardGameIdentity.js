export function resolveCardGameUserId(currentUser, queryUserId = null) {
  return queryUserId
    || (typeof currentUser === 'string' ? currentUser : currentUser?.user_id || currentUser?.userId || currentUser?.id)
    || 'guest';
}

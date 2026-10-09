import { useCallback, useRef, useState } from 'react';
import { resolvePianoPlayerName } from '../game-platform/identity/playerName.js';
import { isPersistentUser } from '../PianoKiosk/pianoUser.js';

function identityOf(currentUser, playerName) {
  const slug = typeof currentUser === 'string' ? currentUser : currentUser?.id ?? null;
  return {
    userId: isPersistentUser(slug) ? slug : null,
    avatarId: isPersistentUser(slug) ? slug : null,
    displayName: resolvePianoPlayerName(currentUser, playerName),
  };
}

function randomSeed() {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

/** A game session is an immutable snapshot of player identity, id, and entropy. */
export function useChessSessionIdentity({ currentUser, playerName, initialSeed = null }) {
  const candidateRef = useRef(identityOf(currentUser, playerName));
  candidateRef.current = identityOf(currentUser, playerName);
  const sequenceRef = useRef(Date.now());
  const sessionRef = useRef(null);
  if (!sessionRef.current) {
    sessionRef.current = {
      gameId: `chess-${sequenceRef.current}`,
      ...candidateRef.current,
      seed: Number.isFinite(initialSeed) ? Number(initialSeed) >>> 0 : randomSeed(),
    };
  }
  const [session, setSession] = useState(sessionRef.current);
  sessionRef.current = session;
  const gameIdRef = useRef(session.gameId);
  gameIdRef.current = session.gameId;

  const beginNextGame = useCallback(() => {
    const previous = sessionRef.current;
    sequenceRef.current = Math.max(Date.now(), sequenceRef.current + 1);
    const next = {
      gameId: `chess-${sequenceRef.current}`,
      ...candidateRef.current,
      seed: (previous.seed + 1) >>> 0,
    };
    sessionRef.current = next;
    gameIdRef.current = next.gameId;
    setSession(next);
    return next;
  }, []);

  return {
    currentUserId: candidateRef.current.userId,
    lockedUser: session.userId,
    playerAvatarId: session.avatarId,
    displayName: session.displayName,
    gameId: session.gameId,
    gameIdRef,
    gameSeed: session.seed,
    beginNextGame,
  };
}

export default useChessSessionIdentity;

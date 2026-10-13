import jwt from 'jsonwebtoken';

export function signToken(payload, secret, options = {}) {
  return jwt.sign(payload, secret, options);
}

export function verifyToken(token, secret, options = {}) {
  try {
    return jwt.verify(token, secret, options);
  } catch {
    return null;
  }
}

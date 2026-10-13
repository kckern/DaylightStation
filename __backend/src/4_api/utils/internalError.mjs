/** Central 500 responder that preserves each endpoint's established body. */
export function sendInternalError(res, body) {
  return res.status(500).json(body);
}

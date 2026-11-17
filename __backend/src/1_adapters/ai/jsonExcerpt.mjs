// JSON.parse messages quote part of the input (`Unexpected token 'm', "my mom" is not valid JSON`).
// Logs and thrown error details keep the error kind and position and drop the
// quoted text, which can be a user's words echoed by the model.
export const redactJsonExcerpt = message => typeof message === 'string' ? message.replace(/"[\s\S]*"/, '"…"') : message;

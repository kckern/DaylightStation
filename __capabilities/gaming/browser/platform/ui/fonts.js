// Self-hosted faces — the kiosk CSP blocks external font hosts, so these
// ship in the bundle via @fontsource (woff2 + @font-face, no network).
// Anton  — display: title cards, dollar values, categories, scores.
// Bitter — serif: clue prompts and answers.
// Roboto — UI text. Named and bundled, not left to `system-ui`: the games
// looked like Roboto only because the living-room Shield's system font was
// Roboto, and a WebView update changed what `system-ui` resolves to.
import '@fontsource/anton';
import '@fontsource/bitter/500.css';
import '@fontsource/bitter/700.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import '@fontsource/roboto/900.css';

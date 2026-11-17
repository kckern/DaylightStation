import { useSchoolCommands } from '../../portal/useSchoolCommands.js';
import { noteKeyEvent } from './inputVia.js';

export function useProgramKeys(map, options = {}) {
  useSchoolCommands(Object.fromEntries(Object.entries(map).filter(([, action]) => typeof action === 'function').map(([key, action]) => [key, event => { noteKeyEvent(event); action(); }])), { ...options, allowInInput: key => key === 'tab' });
}
export function speak(text) {
  try { const speech = window.speechSynthesis; if (!speech || !text) return; speech.cancel(); speech.speak(new SpeechSynthesisUtterance(text)); } catch { /* optional browser facility */ }
}

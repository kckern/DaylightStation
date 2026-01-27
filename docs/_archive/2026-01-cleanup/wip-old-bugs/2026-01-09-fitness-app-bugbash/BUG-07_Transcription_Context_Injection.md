# BUG-07: Transcription Context Injection (AI)

**Date Reported:** 2026-01-09  
**Category:** 🎙️ Feature: Voice Memo  
**Priority:** Medium  
**Status:** Open

---

## Summary

Transcription struggles with specific entities, transcribing domain-specific terms incorrectly. For example:
- "YUVI" (show name) → transcribed as "Ultraviolet" or "UV"
- Family member names → misspelled or misheard

## Expected Behavior

Inject dynamic context into the AI transcription prompt based on the current session to improve recognition of:
- Currently/recently played Show and Episode titles
- Family Member names (from Household Config)
- Users currently in the session

## Current Behavior

Transcription uses generic Whisper model without domain context, leading to frequent misrecognition of proper nouns specific to the household.

---

## Technical Analysis

### Relevant Components

| File | Purpose |
|------|---------|
| [`OpenAIGateway.mjs`](file:///Users/kckern/Documents/GitHub/DaylightStation/backend/lib/ai/OpenAIGateway.mjs) | OpenAI API gateway including transcribe function |
| [`VoiceMemoManager.js`](file:///Users/kckern/Documents/GitHub/DaylightStation/frontend/src/hooks/fitness/VoiceMemoManager.js) | Voice memo state management |

### Current Transcription Implementation

In `OpenAIGateway.mjs` (lines 227-268), the transcribe function:

```javascript
async transcribe(audioBuffer, options = {}) {
  const FormData = (await import('form-data')).default;
  const form = new FormData();
  
  form.append('file', audioBuffer, {
    filename: 'audio.ogg',
    contentType: 'audio/ogg',
  });
  form.append('model', 'whisper-1');
  
  if (options.language) {
    form.append('language', options.language);
  }
  if (options.prompt) {           // ← Context injection point exists!
    form.append('prompt', options.prompt);
  }
  
  // ... API call
}
```

**Key Finding**: The `options.prompt` parameter is already supported but not being used for context injection.

### OpenAI Whisper Prompt Feature

Whisper's `prompt` parameter accepts text that helps guide the model's recognition:
- Proper nouns, spelling of names
- Technical vocabulary
- Domain-specific terminology

---

## Recommended Fix

### Step 1: Define Context Builder

Create a function to build context prompts:

```javascript
// New: backend/lib/ai/transcriptionContext.mjs
export function buildTranscriptionContext(sessionData) {
  const contextParts = [];
  
  // Current media context
  if (sessionData.currentShow) {
    contextParts.push(`Currently playing: ${sessionData.currentShow}`);
    if (sessionData.currentEpisode) {
      contextParts.push(`Episode: ${sessionData.currentEpisode}`);
    }
  }
  
  // Recently played shows
  if (sessionData.recentShows?.length) {
    contextParts.push(`Recent shows: ${sessionData.recentShows.join(', ')}`);
  }
  
  // Household members
  if (sessionData.householdMembers?.length) {
    contextParts.push(`Family members: ${sessionData.householdMembers.join(', ')}`);
  }
  
  // Active session users
  if (sessionData.activeUsers?.length) {
    contextParts.push(`Present users: ${sessionData.activeUsers.join(', ')}`);
  }
  
  return contextParts.join('. ');
}
```

### Step 2: Pass Context to Transcription

Update the voice memo API endpoint to include session context:

```javascript
// In voice memo upload handler
const transcriptionPrompt = buildTranscriptionContext({
  currentShow: req.body.currentShow,
  currentEpisode: req.body.currentEpisode,
  recentShows: req.body.recentShows,
  householdMembers: await getHouseholdMembers(userId),
  activeUsers: req.body.activeUsers,
});

const transcription = await aiGateway.transcribe(audioBuffer, {
  prompt: transcriptionPrompt,
  language: 'en',
});
```

### Step 3: Frontend Context Collection

Collect and send context from the frontend:

```javascript
// In useVoiceMemoRecorder.js or similar
const collectSessionContext = useCallback(() => {
  return {
    currentShow: fitnessCtx?.currentItem?.showName,
    currentEpisode: fitnessCtx?.currentItem?.title,
    recentShows: fitnessCtx?.recentlyPlayed?.map(item => item.showName),
    activeUsers: fitnessCtx?.fitnessSessionInstance?.getActiveParticipants()
      ?.map(p => p.name),
  };
}, [fitnessCtx]);
```

---

## Context Prompt Examples

### Before (No Context)
```
Audio: "Add YUVI to the queue"
Transcription: "Add ultraviolet to the queue"
```

### After (With Context)
```
Prompt: "Currently playing: YUVI Season 2. Family members: Mom, Dad, Kenny, Sarah"
Audio: "Add YUVI to the queue"  
Transcription: "Add YUVI to the queue" ✓
```

---

## Files to Modify

1. **New File**: `backend/lib/ai/transcriptionContext.mjs` - Context builder function
2. **Modify**: Voice memo upload endpoint - Include context in transcription call
3. **Frontend**: Collect and send session context with voice memo upload

---

## Data Sources for Context

| Context Type | Source | Notes |
|--------------|--------|-------|
| Current Show/Episode | FitnessContext.currentItem | Available in frontend |
| Recent Shows | History/queue data | May need backend lookup |
| Household Members | Household Config | Backend: `/api/household` |
| Active Users | FitnessSession | Real-time participant roster |
| Show Library | Plex metadata | Consider caching common titles |

---

## Verification Steps

1. Configure household with specific names
2. Start a show with a unique title (e.g., "YUVI")
3. Record a voice memo mentioning the show by name
4. Verify transcription correctly recognizes the show name
5. Mention a family member's name
6. Verify transcription correctly spells the name

---

## Performance Considerations

- Prompt should be concise (Whisper has token limits)
- Consider caching common context (household members don't change often)
- Don't include excessive history (5 recent shows max)

---

*For testing, assign to: QA Team (voice recognition testing)*  
*For development, assign to: Backend Team (AI integration)*

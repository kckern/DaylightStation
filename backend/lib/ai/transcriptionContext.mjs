/**
 * Builds a guiding prompt for OpenAI Whisper transcription to improve recognition 
 * of domain-specific terms like show names, participant names, and household members.
 */
export function buildTranscriptionContext(sessionData = {}) {
  const contextParts = [];
  
  // Baseline fitness transcription prompt
  contextParts.push("Transcribe this description of a fitness workout. Common terms: pounds (lbs), weights, dumbbells, reps, sets, squats, lunges, burpees, HIIT, intervals, warmup, cooldown, rest, cardio, kettlebell, pushups, pullups, planks, crunches.");

  // Current media context
  if (sessionData.currentShow) {
    contextParts.push(`Currently playing: ${sessionData.currentShow}`);
    if (sessionData.currentEpisode) {
      contextParts.push(`Episode: ${sessionData.currentEpisode}`);
    }
  }
  
  // Recently played shows
  if (sessionData.recentShows && Array.isArray(sessionData.recentShows) && sessionData.recentShows.length > 0) {
    const uniqueShows = [...new Set(sessionData.recentShows)].slice(0, 5);
    contextParts.push(`Recent shows: ${uniqueShows.join(', ')}`);
  }
  
  // Household members
  if (sessionData.householdMembers && Array.isArray(sessionData.householdMembers) && sessionData.householdMembers.length > 0) {
    contextParts.push(`Family and household members: ${sessionData.householdMembers.join(', ')}`);
  }
  
  // Active session users
  if (sessionData.activeUsers && Array.isArray(sessionData.activeUsers) && sessionData.activeUsers.length > 0) {
    contextParts.push(`Participants present in this session: ${sessionData.activeUsers.join(', ')}`);
  }
  
  // Custom exercise terminology (App specific)
  contextParts.push("Additional terms: YUVI, Cadence, Heart Rate, Zone, Sprint, Climb, Resistance.");

  return contextParts.join('. ');
}

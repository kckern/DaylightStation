# Morning Debrief MVP - Quick Start Guide

## ✅ Status: READY TO TEST

Implementation completed on December 30, 2025. Core functionality is complete and ready for manual testing.

---

## Architecture Overview

```
Daily Brief Flow
├─ GET /journalist/morning?user={username}&date={YYYY-MM-DD}
├─ LifelogAggregator.aggregate(username, date)
│   └─ Reads: events, garmin, fitness, lastfm, letterboxd, todoist, gmail, foursquare
├─ GenerateMorningDebrief.execute()
│   ├─ AI Summary (800 tokens, fallback to template)
│   └─ AI Questions (1,400 tokens, fallback to generic)
├─ SendMorningDebrief.execute()
│   └─ Telegram message with reply keyboard
└─ User selects category → HandleCategorySelection.execute()
    └─ Asks follow-up question
```

---

## Files Created/Modified

### New Files (MVP)
- `adapters/LifelogAggregator.mjs` - Aggregates harvested lifelog data
- `application/usecases/GenerateMorningDebrief.mjs` - Generates AI summary and questions
- `application/usecases/SendMorningDebrief.mjs` - Sends debrief to Telegram
- `application/usecases/HandleCategorySelection.mjs` - Handles category selection
- `handlers/morning.mjs` - HTTP endpoint handler
- `test-morning-debrief.mjs` - Test script

### Modified Files
- `container.mjs` - Added morning debrief use cases and UserResolver
- `server.mjs` - Added GET /journalist/morning endpoint
- `adapters/JournalistInputRouter.mjs` - Added category selection detection
- `handlers/index.mjs` - Exported morning handler
- `PRD-v2.1.md` - Marked Phase 1 & 2 MVP tasks complete

---

## Testing Locally

### 1. Ensure dev server is running
```bash
npm run dev
# Or check if already running: ps aux | grep "node backend/index.js"
```

### 2. Test the endpoint manually
```bash
# Navigate to journalist bot directory
cd backend/chatbots/bots/journalist

# Test with default user (head of household)
node test-morning-debrief.mjs

# Test with specific user
node test-morning-debrief.mjs kckern

# Test with specific date
node test-morning-debrief.mjs kckern 2025-12-29
```

### 3. Or use curl
```bash
# Default user, yesterday
curl "http://localhost:3112/journalist/morning"

# Specific user
curl "http://localhost:3112/journalist/morning?user=kckern"

# Specific date
curl "http://localhost:3112/journalist/morning?user=kckern&date=2025-12-29"
```

### 4. Check Telegram
- Morning debrief should appear in your Telegram chat with Journalist bot
- Should show yesterday's summary with category keyboard
- Tap a category to get follow-up questions

---

## Expected Behavior

### Successful Debrief (2+ data sources available)
```
📅 Yesterday (2025-12-29)

[AI-generated summary of your day]

What would you like to reflect on?

[📆 Events & People] [🏃 Health & Fitness]
[🎬 Media & Culture] [✅ Work & Tasks]
[💭 Thoughts & Reflections] [✍️ Free Write]
[⏭️ Skip for now]
```

### Insufficient Data (<2 sources)
```
Good morning! I don't have much data from yesterday. 
How was your day? What stood out to you?
```

### Error (AI or system failure)
```
Good morning! How was yesterday? Anything interesting happen?
```

---

## Next Steps for Production

### Phase 3: Cron Integration
1. Add to `state/cron.yml`:
```yaml
- name: journalist_morning_kckern
  url: http://localhost:3112/journalist/morning?user=kckern
  cron_tab: "0 8 * * *"  # 8 AM daily
  window: 15
  nextRun: null
  last_run: 0
```

2. Or add to user profile:
```yaml
# data/users/kckern/profile.yml
preferences:
  morningDebriefTime: "08:00"
```

### Phase 4: Refinements
- [ ] Add inline keyboard for "Different question" / "Done"
- [ ] Implement multi-question conversation flow
- [ ] Add debrief state persistence (save to `users/{username}/lifelog/journal/debriefs/`)
- [ ] Improve AI prompts based on feedback
- [ ] Add Plex harvester for media data
- [ ] Performance optimization (sub-10s generation time)

### Phase 5: Testing
- [ ] Unit tests for LifelogAggregator
- [ ] Unit tests for use cases
- [ ] Integration tests with real data
- [ ] E2E test with Telegram
- [ ] Load test with multiple users

---

## Configuration Requirements

### User Profile Must Have
```yaml
# data/users/{username}/profile.yml
username: kckern
identities:
  telegram:
    user_id: "575596036"      # Required
    default_bot: "journalist"  # Required

preferences:
  timezone: America/Los_Angeles
```

### Chatbots Config Must Have
```yaml
# config/apps/chatbots.yml (or equivalent)
bots:
  journalist:
    telegram_bot_id: "6898194425"  # Required
```

---

## Troubleshooting

### "No username specified"
- Solution: Pass `?user=kckern` or set head of household in config

### "Could not resolve conversation ID"
- Check user profile has `identities.telegram.user_id`
- Check chatbots config has `bots.journalist.telegram_bot_id`
- Verify UserResolver is injected into container

### No Telegram message received
- Check Telegram bot is set up correctly
- Check user's telegram ID matches profile
- Check backend logs for `debrief.sent` event
- Verify user hasn't blocked the bot

### "Insufficient data" fallback
- Check harvesters are running and populating data
- Verify files exist: `data/users/{username}/lifelog/*.yml`
- Check dates match (harvester data vs. target date)
- Need at least 2 data sources with data for target date

### AI summary/questions fail
- Check OpenAI API key is configured
- Check AI gateway is properly injected
- Fallback templates should still work

---

## Monitoring

Watch logs for these events:
```bash
tail -f dev.log | grep -E "morning|debrief|lifelog"
```

Key log events:
- `morning.handler.start` - Endpoint called
- `lifelog.aggregate.start` - Data aggregation started
- `lifelog.aggregate.complete` - Data aggregation done (check availableSources)
- `debrief.generate.start` - Debrief generation started
- `debrief.summary-generated` - AI summary complete
- `debrief.questions-generated` - AI questions complete
- `debrief.sent` - Message sent to Telegram
- `debrief.category-selected` - User selected a category

---

## Quick Wins

Once tested and working:
1. **Add to cron** - Get daily debriefs automatically
2. **Tune prompts** - Improve AI summary and question quality
3. **Add more categories** - Based on what data you find most valuable
4. **Iterate on keyboard** - Adjust based on actual usage patterns
5. **Track metrics** - Log open rates, category selections, response rates

---

## Success Metrics (MVP Goals)

- [ ] Successfully triggers daily at configured time
- [ ] Generates summary for 80%+ of days (has enough data)
- [ ] User responds to debrief 60%+ of the time
- [ ] Average 3-5 questions answered per session
- [ ] Generation time < 10 seconds (p95)
- [ ] Zero crashes or errors over 1 week

---

**You're ready to start receiving daily briefs! 🎉**

Test it now, then add to cron once working.

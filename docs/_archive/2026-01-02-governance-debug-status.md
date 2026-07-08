# Governance Detection Debug Status

## Current Situation

Looking at `dev.log`, I can see:
1. **TreasureBox is working correctly** - processing ticks with participants: `["user_4","user_3","user_2","user_5","user_1"]`
2. **Zones are being resolved** - users have HR data and are in zones (warm, hot, fire)
3. **NO GovernanceEngine logs** - This means either:
   - Frontend hasn't reloaded with new code yet
   - GovernanceEngine.evaluate() is not being called

## What I Found in the Logs

```json
// From tick 10:
{
  "trackingId": "user_4",
  "entityId": null,
  "userId": "user_4",
  "hr": 154
}

// TreasureBox is receiving correct data:
{
  "tick": 10,
  "perUserSize": 5,
  "activeParticipants": ["user_4","user_3","user_2","user_5","user_1"],
  "perUserKeys": ["user_4","user_3","user_2","user_5","user_1"]
}
```

**Key Insight**: The system is using userName (like "user_4", "user_3") as the trackingId, which is correct! Both FitnessSession and TreasureBox are consistent.

## What's Wrong

The **GovernanceEngine** is NOT logging anything, which means either:
1. The frontend hasn't reloaded the new code
2. `updateSnapshot()` is not being called with `participantRoster`
3. There's an early return preventing governance evaluation

## Logging Added

I've added comprehensive logging to track the issue:

### 1. FitnessSession.updateSnapshot() (line 1291)
```javascript
console.log('[PHASE 4 CODE LOADED] updateSnapshot called with roster:', participantRoster?.length);
```
**Purpose**: Verify new code is loaded

### 2. FitnessSession governance inputs (lines 1444-1451)
```javascript
getLogger().warn('governance.evaluate.inputs', {
  activeParticipants,
  userZoneMap,
  activeCount: activeParticipants.length,
  zoneMapKeys: Object.keys(userZoneMap),
  zoneRankMapKeys: Object.keys(zoneRankMap),
  effectiveRosterCount: effectiveRoster.length
});
```
**Purpose**: See what FitnessSession is passing to GovernanceEngine

### 3. GovernanceEngine.evaluate() (lines 641-652)
```javascript
getLogger().warn('governance.evaluate.called', {
  hasMedia: !!(this.media && this.media.id),
  mediaId: this.media?.id,
  hasGovernanceRules,
  activeParticipantsCount: activeParticipants.length,
  activeParticipants,
  userZoneMap
});
```
**Purpose**: See what GovernanceEngine receives and its internal state

### 4. GovernanceEngine early exits (lines 656-682)
- Logs if media is missing or not governed
- Logs if no participants
- Logs decision-making at each step

## Next Steps

### 1. Reload Frontend
The new logging code needs to be loaded:
```bash
# Hard refresh in browser:
# - Chrome/Firefox: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows/Linux)
# - Or just refresh the page

# If that doesn't work, restart the dev server:
npm run dev
```

### 2. Check Browser Console
After reloading, check the browser console for:
```
[PHASE 4 CODE LOADED] updateSnapshot called with roster: <number>
```
If you see this, the new code is loaded.

### 3. Monitor dev.log
After reload, watch for these new logs:
```bash
tail -f dev.log | grep -E "governance\.evaluate|PHASE.*4.*CODE"
```

You should see:
- `governance.evaluate.inputs` - What FitnessSession sends
- `governance.evaluate.called` - What GovernanceEngine receives
- Possible early exit reasons (no_media_or_rules, media_not_governed, no_participants)

## Expected Flow

Once new code loads, you should see:
```json
// 1. FitnessSession prepares inputs:
{
  "event": "governance.evaluate.inputs",
  "activeParticipants": ["user_4", "user_3", "user_2", "user_5", "user_1"],
  "userZoneMap": {
    "user_4": "hot",
    "user_3": "fire",
    "user_2": "hot",
    "user_5": "hot",
    "user_1": "warm"
  }
}

// 2. GovernanceEngine receives:
{
  "event": "governance.evaluate.called",
  "hasMedia": true,
  "activeParticipantsCount": 5,
  "activeParticipants": ["user_4", "user_3", ...],
  "userZoneMap": {...}
}
```

## Potential Issues

### Issue 1: No Media Set
If you see:
```json
{"event": "governance.evaluate.no_media_or_rules"}
```
**Solution**: Make sure video is playing and has governance labels/types configured

### Issue 2: Media Not Governed
If you see:
```json
{"event": "governance.evaluate.media_not_governed"}
```
**Solution**: Check that current media has labels matching `governed_labels` or type matching `governed_types` in fitness config

### Issue 3: No Participants
If you see:
```json
{"event": "governance.evaluate.no_participants"}
```
**Solution**: Check that `participantRoster` is being passed to `updateSnapshot()` and that roster entries have `isActive: true`

### Issue 4: Empty activeParticipants Array
If GovernanceEngine receives empty array:
- Check roster entries have `entityId`, `profileId`, or `id` fields
- Check roster entries have `isActive !== false`
- Check the filter logic in updateSnapshot() (lines 1412-1420)

## Summary

**Current Status**: ✅ TreasureBox working, ❌ GovernanceEngine not receiving calls

**Root Cause**: Frontend code not reloaded yet OR GovernanceEngine.evaluate() not being called

**Next Action**:
1. Refresh browser to load new code
2. Look for `[PHASE 4 CODE LOADED]` in browser console
3. Check `dev.log` for `governance.evaluate` logs
4. Report what you see!

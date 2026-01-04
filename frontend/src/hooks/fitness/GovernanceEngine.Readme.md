# Governance Engine

The Governance Engine controls video playback during fitness sessions based on participant heart rate performance. It ensures that users maintain target exertion levels to continue watching content, creating an incentive system that ties entertainment to physical activity.

## Core Concept

When watching "governed" content (videos labeled as cardio, strength, HIIT, yoga, etc.), participants must keep their heart rates in specified zones for playback to continue. If participants fall below the required zones, they receive warnings and eventually the video pauses until they meet the requirements again.

## Status Phases

The engine operates in four distinct phases that determine the playback state:

### Init (Grey)
- **What it means**: Session is starting up or waiting for participants
- **User experience**: Video is paused with a "Get Ready" overlay
- **Audio**: Startup music plays
- **How to proceed**: Connect heart rate monitors and begin exercising

### Green
- **What it means**: All requirements are satisfied
- **User experience**: Video plays normally with no overlays
- **Audio**: Normal video audio
- **How to proceed**: Keep exercising at the current intensity

### Yellow (Warning)
- **What it means**: Requirements are no longer met, grace period active
- **User experience**: A countdown progress bar appears showing time remaining before lock
- **What's shown**:
  - Each participant not meeting requirements appears as a chip
  - Their current heart rate and target are displayed
  - A progress bar shows how close they are to the target zone
- **How to proceed**: Increase intensity before the countdown expires

### Red (Locked)
- **What it means**: Grace period expired or challenge failed
- **User experience**: Video is fully paused with a lock overlay
- **Audio**: "Locked" audio cue plays
- **What's shown**:
  - "Video Locked" panel
  - Table showing each participant who needs to improve
  - Current zone vs. target zone for each person
  - Progress toward meeting the requirement
- **How to proceed**: All participants must reach their target zones to unlock

## Policies

Policies define the rules for a session. The system selects the appropriate policy based on the number of active participants.

### Base Requirements
Each policy specifies baseline heart rate zone requirements. For example:
- **"All participants must be in the Active zone or higher"**
- **"Majority of participants must reach the Warm zone"**

Requirement rules can be:
- `all` - Every participant must meet the requirement
- `majority` / `most` - More than half must meet it
- `some` - At least 30% must meet it
- `any` - At least one person must meet it
- A specific number (e.g., `2` means exactly 2 participants)

### Grace Period
When participants drop below requirements, they get a configurable grace period (countdown timer) before the video locks. This prevents brief dips from immediately pausing content.

## Challenges

Challenges are periodic mini-goals that appear during playback to keep sessions engaging.

### How Challenges Work

1. **Countdown**: A preview appears showing the upcoming challenge (e.g., "Get to Hot zone in 45 seconds")
2. **Active**: The challenge timer starts; participants must reach the target zone before time expires
3. **Success**: All required participants reached the zone - challenge completed, next one scheduled
4. **Failure**: Time expired before requirements were met - video locks until requirements are satisfied

### Challenge Selection
Challenges are selected from a configured pool. Selection can be:
- **Random**: Weighted random selection from available challenges
- **Cyclic**: Rotates through challenges in order

### Challenge Properties
- **Zone Target**: Which heart rate zone participants must reach
- **Time Limit**: How long participants have to complete the challenge
- **Required Count**: How many participants must succeed (uses same rules as base requirements)

## Participant Display

### Lock Rows
When video is locked, each participant who needs to improve is shown in a row with:
- **Avatar**: Profile picture with border colored by current zone
- **Name**: Participant's display name
- **Current Heart Rate**: Their live heart rate reading
- **Current Zone**: Which zone they're currently in (e.g., "Cool" with blue styling)
- **Target Zone**: Which zone they need to reach (e.g., "Warm" with yellow styling)
- **Progress Bar**: Visual indicator showing how close their heart rate is to the target

### Warning Chips
During the yellow warning phase, compact chips show each participant who is falling short, with their current heart rate and a progress bar toward the target.

## Heart Rate Zones

Zones are ranked by intensity. Meeting a requirement means being at or above that zone's rank:

| Zone | Typical HR Range | Color |
|------|-----------------|-------|
| Cool | 0-60% max HR | Blue |
| Active | 60-70% max HR | Green |
| Warm | 70-80% max HR | Yellow |
| Hot | 80-90% max HR | Orange |
| Fire | 90-100% max HR | Red |

If a policy requires the "Warm" zone, being in "Hot" or "Fire" also satisfies the requirement.

## Governed Content

Not all videos trigger governance. Content must be marked with specific labels or types:

### Governed Labels (examples)
- `cardio`
- `strength`
- `hiit`
- `yoga`

### Governed Types (examples)
- `episode`
- `movie`

Videos without these labels/types play normally without heart rate requirements.

## Audio Cues

The system provides audio feedback for state changes:
- **Init/Grey phase**: Startup music to signal session beginning
- **Red/Locked phase**: Lock sound effect to indicate video is paused

## Challenge History

The engine maintains a history of the last 20 challenges, recording:
- Challenge ID and status (success/failed)
- Target zone and required count
- Start and completion times
- Selection label (if named)

This enables displaying past challenge performance during or after a session.

## Multi-Participant Behavior

When multiple people are exercising together:
- Requirements apply across all active participants
- The lock screen shows each person who needs to improve
- Challenges require the specified number of participants to succeed
- Each person's progress is tracked and displayed individually
- The strictest unmet requirement is shown for each participant (if someone is missing multiple zones, only the highest target is displayed)

## Recovery from Locked State

To unlock a paused video:
1. All participants identified in the lock overlay must reach their target zones
2. Once all requirements are satisfied, the video automatically resumes
3. The engine transitions back to the green phase
4. A new challenge is scheduled based on the policy's interval settings

## Manual Challenge Triggering

Challenges can be triggered manually (e.g., via an admin interface), bypassing the normal scheduling. This allows for on-demand intensity bursts during a session.

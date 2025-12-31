# Harvester Bifurcation: Lifelog vs Current Data

**Version:** 1.0  
**Date:** December 31, 2025  
**Status:** Design Document

---

## Executive Summary

Several harvesters (Gmail, ClickUp, Todoist, Calendar/Events) collect data that serves **dual purposes**:
1. **Lifelog (Past)** - Historical records of completed actions (sent emails, finished tasks, past events)
2. **Current (Present)** - Active items requiring attention (unread inbox, pending tasks, upcoming events)

This document proposes a clean bifurcation strategy to separate these concerns, enabling:
- **Lifelog extractors** to pull from historical/completed data
- **Upcoming module** to pull from current/pending data
- **Entropy metrics** to use both (days-since from lifelog, pending counts from current)

---

## Problem Statement

### Current Architecture Issues

| Harvester | Current Behavior | Problem |
|-----------|------------------|---------|
| **Gmail** | Saves inbox messages only | No date field; can't distinguish read vs unread history |
| **Todoist** | Saves open tasks only | No completion dates; lifelog can't see what was done |
| **ClickUp** | Saves in-progress tasks only | No `date_done`; lifelog can't track completed work |
| **Calendar** | Saves upcoming events only | Past events pruned; lifelog can't reconstruct day's schedule |

### Data Flow Confusion

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Harvester  │────▶│  Single YML File │◀────│  Multiple Readers│
│  (mixed)    │     │  (mixed data)    │     │  (confused)      │
└─────────────┘     └──────────────────┘     └──────────────────┘
                                                    │
                    ┌───────────────────────────────┼───────────────────────┐
                    │                               │                       │
                    ▼                               ▼                       ▼
            ┌──────────────┐              ┌──────────────┐         ┌──────────────┐
            │ Upcoming.jsx │              │  Lifelog     │         │  Entropy     │
            │ (wants curr) │              │  Extractors  │         │  (wants both)│
            └──────────────┘              │  (wants past)│         └──────────────┘
                                          └──────────────┘
```

---

## Proposed Architecture

### Directory Structure

```
data/
└── users/{username}/
    ├── lifelog/                    # PAST DATA (historical, date-keyed)
    │   ├── gmail.yml               # Emails by date (sent, received, archived)
    │   ├── todoist.yml             # Tasks by completion date
    │   ├── clickup.yml             # Tasks by completion date
    │   ├── calendar.yml            # Events by occurrence date
    │   ├── events.yml              # Aggregated events (deprecated, merge into calendar)
    │   └── ...                     # Other lifelog sources
    │
    └── current/                    # PRESENT DATA (active, ephemeral)
        ├── gmail.yml               # Current inbox (unread/flagged)
        ├── todoist.yml             # Open tasks with due dates
        ├── clickup.yml             # In-progress tickets
        ├── calendar.yml            # Upcoming events (next 6 weeks)
        └── events.yml              # Aggregated upcoming items

households/{hid}/
└── shared/
    ├── events.yml                  # Household aggregated upcoming events (for TV display)
    └── current/                    # Household-level current data
        └── calendar.yml            # Shared family calendar (upcoming)
```

### Data Flow (Bifurcated)

```
┌─────────────────┐
│    Harvester    │
│  (fetches ALL)  │
└────────┬────────┘
         │
         ├─────────────────────────────────────┐
         │                                     │
         ▼                                     ▼
┌─────────────────────────┐       ┌─────────────────────────┐
│  users/{u}/lifelog/     │       │  users/{u}/current/     │
│  ─────────────────────  │       │  ─────────────────────  │
│  • Date-keyed history   │       │  • Active items only    │
│  • Completed tasks      │       │  • Pending tasks        │
│  • Past events          │       │  • Upcoming events      │
│  • Sent/archived mail   │       │  • Unread inbox         │
└────────────┬────────────┘       └────────────┬────────────┘
             │                                 │
             ▼                                 ▼
┌─────────────────────────┐       ┌─────────────────────────┐
│   Lifelog Extractors    │       │     Upcoming Module     │
│   ─────────────────────  │       │   ─────────────────────  │
│   • Morning debrief     │       │   • TV display widget   │
│   • Journalist context  │       │   • What's next panel   │
│   • Historical queries  │       │   • Real-time updates   │
└─────────────────────────┘       └─────────────────────────┘
             │                                 │
             └────────────────┬────────────────┘
                              ▼
                    ┌─────────────────────────┐
                    │      Entropy Module     │
                    │   ─────────────────────  │
                    │   • Days-since (lifelog)│
                    │   • Item counts (curr)  │
                    └─────────────────────────┘
```

---

## Per-Harvester Bifurcation Design

### 1. Gmail Harvester

**API Capabilities:**
- List messages with query filters (`is:inbox`, `is:unread`, `after:YYYY/MM/DD`)
- Get message details including `internalDate`, `labelIds`

**Bifurcation Logic:**

| Destination | What Gets Saved | Rationale |
|-------------|-----------------|-----------|
| **Lifelog** | All sent emails + inbox emails received TODAY | Captures outbound communication and "important enough to keep" inbound |
| **Current** | All emails currently in inbox | Shows active inbox state for entropy/attention metrics |

**Proposed Changes:**

```javascript
// backend/lib/gmail.mjs

const listMails = async (logger, job_id, targetUsername = null) => {
    // ... auth setup ...
    
    const today = moment().format('YYYY-MM-DD');
    
    // === CURRENT DATA: All emails currently in inbox ===
    const inboxQuery = 'is:inbox';
    const { data: inboxData } = await gmail.users.messages.list({ 
        userId: 'me', 
        q: inboxQuery,
        maxResults: 100 
    });
    
    const inboxMessages = await Promise.all(
        (inboxData.messages || []).map(async msg => {
            const { data } = await gmail.users.messages.get({ userId: 'me', id: msg.id });
            return formatMessage(data);
        })
    );
    
    // Save to current/
    userSaveCurrent(username, 'gmail', {
        lastUpdated: new Date().toISOString(),
        unreadCount: inboxMessages.filter(m => m.isUnread).length,
        totalCount: inboxMessages.length,
        messages: inboxMessages
    });
    
    // === LIFELOG DATA ===
    // 1. All sent emails (last 7 days for incremental harvest)
    const weekAgo = moment().subtract(7, 'days').format('YYYY/MM/DD');
    const sentQuery = `is:sent after:${weekAgo}`;
    const { data: sentData } = await gmail.users.messages.list({
        userId: 'me',
        q: sentQuery,
        maxResults: 200
    });
    
    const sentMessages = await Promise.all(
        (sentData.messages || []).map(async msg => {
            const { data } = await gmail.users.messages.get({ userId: 'me', id: msg.id });
            return { ...formatMessage(data), category: 'sent' };
        })
    );
    
    // 2. Inbox emails received TODAY (still in inbox = deemed important)
    const todaysInboxMessages = inboxMessages
        .filter(m => m.date === today && !m.isSent)
        .map(m => ({ ...m, category: 'received' }));
    
    // Combine and merge into date-keyed lifelog
    const lifelogMessages = [...sentMessages, ...todaysInboxMessages];
    const existingLifelog = userLoadFile(username, 'gmail') || {};
    const updatedLifelog = mergeByDate(existingLifelog, lifelogMessages);
    userSaveFile(username, 'gmail', updatedLifelog);
    
    return { 
        current: inboxMessages.length, 
        lifelog: { sent: sentMessages.length, received: todaysInboxMessages.length }
    };
};

// Helper: Format message with date
const formatMessage = (data) => {
    const headers = data.payload.headers;
    const internalDate = new Date(parseInt(data.internalDate));
    
    return {
        id: data.id,
        date: moment(internalDate).format('YYYY-MM-DD'),
        time: moment(internalDate).format('HH:mm'),
        subject: sanitize(headers.find(h => h.name === 'Subject')?.value || 'No Subject'),
        from: sanitize(headers.find(h => h.name === 'From')?.value || 'Unknown'),
        to: sanitize(headers.find(h => h.name === 'To')?.value || 'Unknown'),
        snippet: sanitize(data.snippet),
        isUnread: data.labelIds?.includes('UNREAD'),
        isSent: data.labelIds?.includes('SENT')
    };
};

// Helper: Merge messages by date into lifelog structure
const mergeByDate = (existing, newMessages) => {
    const merged = { ...existing };
    for (const msg of newMessages) {
        if (!merged[msg.date]) merged[msg.date] = [];
        if (!merged[msg.date].find(m => m.id === msg.id)) {
            merged[msg.date].push(msg);
        }
    }
    // Sort each day's messages by time
    for (const date of Object.keys(merged)) {
        merged[date].sort((a, b) => a.time.localeCompare(b.time));
    }
    return merged;
};
```

**Data Structures:**

```yaml
# users/{username}/current/gmail.yml
lastUpdated: '2025-12-31T10:30:00Z'
unreadCount: 12
totalCount: 45
messages:
  - id: '1947f...'
    date: '2025-12-31'
    time: '09:15'
    subject: 'Your order has shipped'
    from: 'Amazon <ship-confirm@amazon.com>'
    isUnread: true
    isSent: false
  - id: '1946b...'
    date: '2025-12-28'
    time: '14:30'
    subject: 'Old email still in inbox'
    from: 'newsletter@example.com'
    isUnread: false
    isSent: false

# users/{username}/lifelog/gmail.yml  
'2025-12-31':
  - id: '1947a...'
    time: '08:30'
    subject: 'Re: Project update'
    from: 'kckern@gmail.com'
    to: 'colleague@company.com'
    category: sent
  - id: '1947f...'
    time: '09:15'
    subject: 'Your order has shipped'
    from: 'Amazon <ship-confirm@amazon.com>'
    category: received         # Still in inbox at harvest = important
'2025-12-30':
  - id: '1946c...'
    time: '16:45'
    subject: 'Meeting confirmation'
    from: 'kckern@gmail.com'
    to: 'boss@company.com'
    category: sent
```

**Note:** Received emails only appear in lifelog if they're still in the inbox at harvest time. This naturally filters out spam/noise (which gets deleted) and captures emails the user deemed worth keeping.
```

---

### 2. Todoist Harvester

**API Capabilities:**
- `getTasks()` - Returns only uncompleted tasks
- `getCompletedTasks()` - Returns completed tasks with `completed_at` timestamp (requires Pro plan or use activity log)

**Proposed Changes:**

```javascript
// backend/lib/todoist.mjs

const getTasks = async (logger, job_id, targetUsername = null) => {
    // ... auth setup ...
    
    // === CURRENT DATA: Open tasks ===
    const openTasks = await api.getTasks();
    const currentTasks = openTasks.map(task => ({
        id: task.id,
        content: task.content,
        description: task.description,
        priority: task.priority,
        dueDate: task.due?.date || null,
        dueString: task.due?.string || null,
        projectId: task.projectId,
        labels: task.labels,
        url: task.url
    }));
    
    userSaveFile(username, 'current/todoist', {
        lastUpdated: new Date().toISOString(),
        taskCount: currentTasks.length,
        tasks: currentTasks
    });
    
    // === LIFELOG DATA: Completed tasks (last 7 days) ===
    // Option A: Use Activity Log API (available on all plans)
    const since = moment().subtract(7, 'days').toISOString();
    const activityUrl = `https://api.todoist.com/sync/v9/activity/get`;
    const { data: activity } = await axios.post(activityUrl, {
        event_type: 'item:completed',
        since
    }, { headers: { Authorization: `Bearer ${apiKey}` }});
    
    // Option B: Use completed tasks endpoint (Pro only)
    // const completed = await api.getCompletedTasks({ since });
    
    const completedTasks = (activity.events || []).map(event => ({
        id: event.object_id,
        content: event.extra_data?.content || 'Unknown task',
        completedAt: event.event_date,
        date: moment(event.event_date).format('YYYY-MM-DD'),
        projectId: event.parent_project_id
    }));
    
    // Merge into date-keyed lifelog
    const existingLifelog = userLoadFile(username, 'todoist') || {};
    const updatedLifelog = mergeCompletedByDate(existingLifelog, completedTasks);
    userSaveFile(username, 'todoist', updatedLifelog);
    
    saveEvents(job_id);
    return { current: currentTasks.length, completed: completedTasks.length };
};
```

**Data Structures:**

```yaml
# users/{username}/current/todoist.yml
lastUpdated: '2025-12-31T10:30:00Z'
taskCount: 15
tasks:
  - id: '9106200118'
    content: 'Add Memos to Amazon Transactions'
    priority: 2
    dueDate: '2025-12-31'
    dueString: 'today'
    labels: ['finance']

# users/{username}/lifelog/todoist.yml
'2025-12-30':
  - id: '9106200100'
    content: 'Review budget spreadsheet'
    completedAt: '2025-12-30T16:45:00Z'
    projectId: '2342113574'
'2025-12-29':
  - id: '9106200095'
    content: 'Schedule dentist appointment'
    completedAt: '2025-12-29T10:30:00Z'
```

---

### 3. ClickUp Harvester

**API Capabilities:**
- Task list with status filtering
- `date_done` field available on completed tasks
- `date_updated` available for tracking changes

**Proposed Changes:**

```javascript
// backend/lib/clickup.mjs

const getTickets = async () => {
    const { apiKey } = getClickUpAuth();
    const { clickup: { statuses, done_statuses, team_id } } = process.env;
    
    // === CURRENT DATA: In-progress tasks ===
    const currentStatuses = statuses.filter(s => !done_statuses?.includes(s));
    const currentTasks = await fetchTasksByStatus(team_id, apiKey, currentStatuses);
    
    userSaveFile(username, 'current/clickup', {
        lastUpdated: new Date().toISOString(),
        taskCount: currentTasks.length,
        tasks: currentTasks.map(formatTask)
    });
    
    // === LIFELOG DATA: Recently completed tasks ===
    // Fetch tasks with done status from last 7 days
    const doneTasks = await fetchTasksByStatus(team_id, apiKey, done_statuses || ['done', 'complete']);
    const recentlyDone = doneTasks.filter(t => {
        const doneDate = t.date_done || t.date_updated;
        return doneDate && moment(parseInt(doneDate)).isAfter(moment().subtract(7, 'days'));
    });
    
    // Merge into date-keyed lifelog
    const existingLifelog = userLoadFile(username, 'clickup') || {};
    const updatedLifelog = mergeTasksByDoneDate(existingLifelog, recentlyDone);
    userSaveFile(username, 'clickup', updatedLifelog);
    
    return { current: currentTasks.length, completed: recentlyDone.length };
};
```

**Data Structures:**

```yaml
# users/{username}/current/clickup.yml
lastUpdated: '2025-12-31T10:30:00Z'
taskCount: 8
tasks:
  - id: 'abc123'
    name: 'UI Improvements'
    status: 'in progress'
    taxonomy:
      901607520316: 'TV View'
    url: 'https://app.clickup.com/t/abc123'

# users/{username}/lifelog/clickup.yml
'2025-12-30':
  - id: 'xyz789'
    name: 'Fix login bug'
    completedAt: '2025-12-30T17:00:00Z'
    taxonomy:
      901607520316: 'TV View'
'2025-12-29':
  - ...
```

---

### 4. Calendar/Events Harvester

**API Capabilities:**
- Google Calendar API: `timeMin`, `timeMax` parameters
- Can fetch both past and future events

**Proposed Changes:**

```javascript
// backend/lib/gcal.mjs

const listCalendarEvents = async (logger, job_id, targetUsername = null) => {
    // ... auth setup ...
    
    const now = new Date();
    const sixWeeksAgo = new Date();
    sixWeeksAgo.setDate(now.getDate() - 42);
    const sixWeeksFromNow = new Date();
    sixWeeksFromNow.setDate(now.getDate() + 42);
    
    // === CURRENT DATA: Upcoming events (next 6 weeks) ===
    let upcomingEvents = [];
    for (const cal of calendars) {
        const { data } = await calendar.events.list({
            calendarId: cal.id,
            timeMin: now.toISOString(),
            timeMax: sixWeeksFromNow.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
        });
        upcomingEvents = upcomingEvents.concat(data.items);
    }
    
    // Save to current/ (for Upcoming module)
    userSaveFile(username, 'current/calendar', formatEvents(upcomingEvents));
    
    // Also save to household shared (for TV display)
    const hid = process.env.household_id || 'default';
    saveFile(`households/${hid}/shared/calendar`, formatEvents(upcomingEvents));
    
    // === LIFELOG DATA: Past events (last 6 weeks) ===
    let pastEvents = [];
    for (const cal of calendars) {
        const { data } = await calendar.events.list({
            calendarId: cal.id,
            timeMin: sixWeeksAgo.toISOString(),
            timeMax: now.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
        });
        pastEvents = pastEvents.concat(data.items);
    }
    
    // Merge into date-keyed lifelog
    const existingLifelog = userLoadFile(username, 'calendar') || {};
    const updatedLifelog = mergeEventsByDate(existingLifelog, pastEvents);
    userSaveFile(username, 'calendar', updatedLifelog);
    
    saveEvents(job_id);  // Regenerate combined events
    return { upcoming: upcomingEvents.length, past: pastEvents.length };
};
```

**Data Structures:**

```yaml
# users/{username}/current/calendar.yml (also households/{hid}/shared/calendar.yml)
- id: 'event123'
  start: '2025-12-31T14:00:00Z'
  end: '2025-12-31T15:00:00Z'
  summary: 'Team standup'
  calendarName: 'Work'
  location: 'https://zoom.us/j/123'
  allday: false

# users/{username}/lifelog/calendar.yml
'2025-12-30':
  - id: 'event120'
    time: '10:00 AM'
    endTime: '11:00 AM'
    summary: 'Doctor appointment'
    duration: 1
    calendarName: 'Personal'
    location: 'Medical Center'
'2025-12-29':
  - ...
```

---

### 5. Events Job (Aggregator)

The `events.mjs` job should be updated to pull from `current/` subdirectories:

```javascript
// backend/jobs/events.mjs

export default async (job_id) => {
    const username = getDefaultUsername();
    
    // Load from CURRENT sources (not lifelog)
    const calendarEvents = userLoadFile(username, 'current/calendar') || [];
    const todoItems = userLoadFile(username, 'current/todoist')?.tasks || [];
    const clickupData = userLoadFile(username, 'current/clickup')?.tasks || [];
    
    // ... rest of aggregation logic ...
    
    // Save to household shared location (for Upcoming module)
    const hid = process.env.household_id || 'default';
    saveFile(`households/${hid}/shared/events`, allItems);
    
    return allItems;
};
```

---

## I/O Layer Updates

### New Functions for io.mjs

```javascript
// backend/lib/io.mjs

/**
 * Load current (ephemeral) data for a specific user
 * @param {string} username - The username
 * @param {string} service - The service name (e.g., 'gmail', 'todoist')
 * @returns {object|null} The loaded data or null if not found
 */
const userLoadCurrent = (username, service) => {
    if (!username) {
        ioLogger.warn('io.userLoadCurrent.noUsername', { service });
        return null;
    }
    return loadFile(`users/${username}/current/${service}`);
};

/**
 * Save current (ephemeral) data for a specific user
 * @param {string} username - The username
 * @param {string} service - The service name (e.g., 'gmail', 'todoist')
 * @param {object} data - The data to save
 * @returns {boolean} True if saved successfully
 */
const userSaveCurrent = (username, service, data) => {
    if (!username) {
        ioLogger.warn('io.userSaveCurrent.noUsername', { service });
        return false;
    }
    return saveFile(`users/${username}/current/${service}`, data);
};

// Export new functions
export {
    // ... existing exports ...
    userLoadCurrent,
    userSaveCurrent
};
```

---

## Consumer Updates

### Upcoming Module (Frontend)

No changes needed - already pulls from `/data/events` endpoint which will now be populated from `current/` sources.

### Lifelog Extractors

Update extractors to use the new date-keyed structure:

```javascript
// backend/lib/lifelog-extractors/gmail.mjs (NEW)

export const gmailExtractor = {
  source: 'gmail',
  category: 'communication',
  filename: 'gmail',
  
  extractForDate(data, date) {
    // Data is now date-keyed: { '2025-12-30': [...], ... }
    const dayMessages = data?.[date];
    if (!Array.isArray(dayMessages) || !dayMessages.length) return null;
    
    return {
      sent: dayMessages.filter(m => m.isSent),
      received: dayMessages.filter(m => !m.isSent),
      total: dayMessages.length
    };
  },

  summarize(entry) {
    if (!entry) return null;
    const lines = ['EMAIL ACTIVITY:'];
    if (entry.sent.length) {
      lines.push(`  Sent ${entry.sent.length} email${entry.sent.length > 1 ? 's' : ''}`);
      entry.sent.slice(0, 3).forEach(m => {
        lines.push(`    - To: ${m.to.split('<')[0].trim()} - "${m.subject}"`);
      });
    }
    if (entry.received.length) {
      lines.push(`  Received ${entry.received.length} email${entry.received.length > 1 ? 's' : ''}`);
    }
    return lines.join('\n');
  }
};
```

```javascript
// backend/lib/lifelog-extractors/todoist.mjs (NEW)

export const todoistExtractor = {
  source: 'todoist',
  category: 'productivity',
  filename: 'todoist',
  
  extractForDate(data, date) {
    // Data is now date-keyed: { '2025-12-30': [...], ... }
    const completedTasks = data?.[date];
    if (!Array.isArray(completedTasks) || !completedTasks.length) return null;
    
    return {
      tasks: completedTasks,
      count: completedTasks.length
    };
  },

  summarize(entry) {
    if (!entry || !entry.count) return null;
    const lines = [`TASKS COMPLETED (${entry.count}):`];
    entry.tasks.forEach(t => {
      lines.push(`  ✓ ${t.content}`);
    });
    return lines.join('\n');
  }
};
```

### Entropy Module

Update to pull from appropriate sources:

```javascript
// backend/lib/entropy.mjs

export const getEntropyReport = async () => {
    const config = configService.getAppConfig('entropy');
    const username = getDefaultUsername();
    
    for (const [id, sourceConfig] of Object.entries(config.sources)) {
        let value = 0;
        let label = '';
        
        if (sourceConfig.metric === 'days_since') {
            // LIFELOG: Check last entry date
            const data = userLoadFile(username, sourceConfig.dataPath);
            // ... existing days_since logic ...
        } 
        else if (sourceConfig.metric === 'count') {
            // CURRENT: Check pending item count
            const data = userLoadCurrent(username, sourceConfig.dataPath);
            if (sourceConfig.dataPath === 'gmail') {
                value = data?.unreadCount || 0;
                label = `${value} unread email${value === 1 ? '' : 's'}`;
            } else if (sourceConfig.dataPath === 'todoist') {
                value = data?.taskCount || 0;
                label = `${value} pending task${value === 1 ? '' : 's'}`;
            }
        }
        // ... rest of entropy calculation ...
    }
};
```

---

## Migration Path

### Phase 1: Add Current Data (Non-Breaking)

1. Add `userLoadCurrent`/`userSaveCurrent` to io.mjs
2. Update harvesters to ALSO save to `current/` (don't change existing lifelog saves)
3. Update Upcoming module to prefer `current/events` if available

### Phase 2: Update Lifelog Structure

1. Update harvesters to save date-keyed lifelog data
2. Add new lifelog extractors (gmail, todoist, clickup)
3. Update existing extractors to handle new structure
4. Run migration script to convert existing data

### Phase 3: Update Entropy ✅ COMPLETED

1. ✅ Updated entropy config to specify `lifelog` vs `current` data source (`dataSource` field)
2. ✅ Updated entropy.mjs to use `userLoadCurrent()` for count metrics and `userLoadFile()` for days_since metrics
3. ✅ Added `countField` and `itemName` to config for flexible field mapping

### Phase 4: Cleanup

1. Remove redundant saves
2. Archive/remove deprecated paths
3. Update documentation

---

## Configuration

### Entropy Config Update

```yaml
# config/apps/entropy.yml
sources:
  weight:
    name: Weight
    icon: scale
    dataPath: weight              # lifelog (days_since)
    metric: days_since
    dataSource: lifelog           # NEW: explicit source
    thresholds:
      green: 1
      yellow: 3
      
  inbox:
    name: Inbox
    icon: envelope
    dataPath: gmail               # current (count)
    metric: count
    dataSource: current           # NEW: explicit source
    thresholds:
      green: 10
      yellow: 25
      
  tasks:
    name: Tasks
    icon: check-square
    dataPath: todoist             # current (count)
    metric: count
    dataSource: current           # NEW: explicit source
    thresholds:
      green: 5
      yellow: 15
```

---

## Summary

| Component | Before | After |
|-----------|--------|-------|
| **Gmail** | `lifelog/gmail.yml` (flat array) | `lifelog/gmail.yml` (date-keyed: sent + today's inbox) + `current/gmail.yml` (full inbox) |
| **Todoist** | `lifelog/todoist.yml` (open tasks) | `lifelog/todoist.yml` (completed) + `current/todoist.yml` (open) |
| **ClickUp** | `lifelog/clickup.yml` (in-progress) | `lifelog/clickup.yml` (done) + `current/clickup.yml` (active) |
| **Calendar** | `shared/calendar.yml` (upcoming) | `lifelog/calendar.yml` (past) + `current/calendar.yml` (upcoming) |
| **Events** | Reads lifelog sources | Reads current sources |
| **Entropy** | Mixed sources | Explicit `dataSource: lifelog|current` |

This bifurcation cleanly separates temporal concerns while maintaining backward compatibility during migration.

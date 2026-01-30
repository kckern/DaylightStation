# Briefing Domain Design

> Context-aware data aggregation with multi-channel delivery

**Last Updated:** 2026-01-30
**Status:** Design Complete, Ready for Implementation

---

## Overview

The Briefing domain provides context-aware data aggregation and multi-channel delivery. It answers the question: **"What do I need to know right now, given my context?"**

This domain powers:
- Morning thermal printer receipts
- Evening review summaries
- Pre-workout focus briefings
- Weekly review digests
- Telegram/email notifications

### Relationship to Existing Domains

DaylightStation has an emerging temporal architecture:

```
    PAST                    CUSP                    PRESENT → FUTURE
   ────────                ──────                  ─────────────────

   Lifelog                 Entropy                 Briefing
   (extractors)            (IEntropyReader)        (IBriefingReader)

   "What happened"         "How stale?"            "What to focus on"

   - Strava activities     - Days since workout    - Today's calendar
   - Sleep data            - Inbox count           - Pending todos
   - Meals logged          - Days since call       - Weather
   - Journal entries                               - Entropy alerts
                                                   - RSS headlines
```

**Lifelog** looks backward (yesterday's data for journaling).
**Entropy** measures the gap between past and present (staleness).
**Briefing** looks forward (today's schedule, pending tasks, what needs attention).

---

## Architecture

### DDD Layer Placement

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Layer 0: System/Infrastructure                                           │
│                                                                          │
│   (Future: Shared extractor framework if patterns converge)              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          ▼                         ▼                         ▼
┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
│ Layer 1: Domain     │  │ Layer 1: Domain     │  │ Layer 1: Domain     │
│                     │  │                     │  │                     │
│ Lifelog             │  │ Entropy             │  │ (Briefing entities  │
│ (past)              │  │ (staleness)         │  │  live here)         │
└─────────────────────┘  └─────────────────────┘  └─────────────────────┘
          │                         │                         │
          └─────────────────────────┼─────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Layer 2: Adapters                                                        │
│                                                                          │
│   YamlBriefingReader          BriefingReceiptRenderer                    │
│   TelegramDelivery            BriefingTelegramRenderer                   │
│   EmailDelivery               BriefingEmailRenderer                      │
│   SESEmailGateway (stubbed)                                              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Layer 3: Application                                                     │
│                                                                          │
│   BriefingService              - Orchestrates data aggregation           │
│   DeliverBriefing              - Use case: generate + deliver            │
│   IBriefingReader              - Port interface                          │
│   IBriefingDelivery            - Delivery port interface                 │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Layer 4: API                                                             │
│                                                                          │
│   GET  /api/briefing/:context           - Generate + deliver             │
│   GET  /api/briefing/:context/preview   - Generate only (no delivery)   │
│   POST /api/briefing/:context/deliver   - Deliver to specific channels  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Port Interfaces

### IBriefingReader

Unified interface for reading context-relevant data:

```javascript
/**
 * IBriefingReader Port Interface
 *
 * Unified interface for reading context-relevant data for briefings.
 * Implementations aggregate from multiple sources (calendar, todos,
 * entropy, weather, etc.) into a single coherent snapshot.
 *
 * @module applications/briefing/ports
 */

export class IBriefingReader {
  /**
   * Fetch briefing data based on resolved config
   *
   * @param {string} username - User identifier
   * @param {Object} contextConfig - Resolved context configuration
   * @returns {Promise<Object>} - Section data keyed by section ID
   */
  async getBriefing(username, contextConfig) {
    throw new Error('IBriefingReader.getBriefing must be implemented');
  }

  /**
   * Get list of available section types
   * @returns {string[]}
   */
  getAvailableSections() {
    throw new Error('IBriefingReader.getAvailableSections must be implemented');
  }
}
```

### IBriefingDelivery

Abstraction for delivering briefings through various channels:

```javascript
/**
 * IBriefingDelivery Port Interface
 *
 * Abstraction for delivering briefings through various channels.
 *
 * @module applications/briefing/ports
 */

export class IBriefingDelivery {
  /**
   * @returns {string} Channel identifier
   */
  get channel() {
    throw new Error('Must implement');
  }

  /**
   * Check if delivery channel is available
   * @returns {Promise<{ available: boolean, error?: string }>}
   */
  async checkAvailability() {
    throw new Error('Must implement');
  }

  /**
   * Deliver a briefing
   * @param {BriefingData} briefing
   * @param {Object} recipient - Channel-specific recipient info
   * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
   */
  async deliver(briefing, recipient) {
    throw new Error('Must implement');
  }
}
```

### IEmailGateway

Stubbed interface for email delivery:

```javascript
/**
 * IEmailGateway Port Interface
 * @module applications/messaging/ports
 */

export class IEmailGateway {
  /**
   * Check if email gateway is available
   * @returns {Promise<{ available: boolean, error?: string }>}
   */
  async checkAvailability() {
    throw new Error('Must implement');
  }

  /**
   * Send an email
   * @param {Object} options
   * @param {string} options.to - Recipient email
   * @param {string} [options.toName] - Recipient name
   * @param {string} options.subject - Email subject
   * @param {string} options.html - HTML body
   * @param {string} [options.text] - Plain text body (fallback)
   * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
   */
  async send({ to, toName, subject, html, text }) {
    throw new Error('Must implement');
  }
}
```

---

## Context Configuration

Contexts drive section selection. Code provides defaults; YAML can override.

### Default Context Configurations

```javascript
/**
 * Default context configurations
 *
 * Each context defines:
 * - name: Display name
 * - sections: Which data sections to include
 *   - required: Fail if section unavailable
 *   - filter: Section-specific filter criteria
 *   - max: Maximum items to include
 * - fallbacks: Messages for empty sections
 */

const DEFAULT_CONTEXTS = {
  morning: {
    name: 'Morning Briefing',
    sections: {
      weather:   { required: true },
      calendar:  { required: true, filter: 'today' },
      todos:     { required: false, filter: 'overdue_or_due_today', max: 5 },
      entropy:   { required: false, filter: 'yellow_or_red', max: 3 },
    },
    fallbacks: {
      calendar: { empty: 'No events scheduled' },
      todos:    { empty: 'All caught up!' },
      entropy:  { empty: null },  // Omit section if empty
    }
  },

  evening: {
    name: 'Evening Review',
    sections: {
      calendar:  { required: false, filter: 'tomorrow' },
      todos:     { required: false, filter: 'completed_today' },
      entropy:   { required: false, filter: 'improved_today' },
    },
    fallbacks: {
      calendar: { empty: 'No events tomorrow' },
      todos:    { empty: 'Nothing completed today' },
    }
  },

  workout: {
    name: 'Workout Prep',
    sections: {
      entropy:   { required: true, filter: 'fitness_only' },
      weather:   { required: false },  // For outdoor activities
    },
    fallbacks: {}
  },

  weekly: {
    name: 'Weekly Review',
    sections: {
      entropy:   { required: true, filter: 'all' },
      calendar:  { required: true, filter: 'next_7_days' },
      todos:     { required: true, filter: 'due_this_week' },
    },
    fallbacks: {}
  }
};
```

### YAML Override Example

File: `data/household/apps/briefing/config.yml`

```yaml
contexts:
  morning:
    sections:
      entropy:
        max: 5  # Override default of 3
      rss:      # Add custom section
        required: false
        filter: top_headlines
        max: 3
    fallbacks:
      todos:
        empty: "Nothing urgent today"

  # Custom context
  pre_meeting:
    name: "Pre-Meeting Brief"
    sections:
      calendar:
        required: true
        filter: next_2_hours
      todos:
        required: false
        filter: tagged_meeting_prep
```

### Config Resolution

```
Code Defaults → YAML Overrides → Runtime Overrides
```

---

## Value Objects

### BriefingData

Immutable representation of a generated briefing:

```javascript
/**
 * BriefingData Value Object
 *
 * Immutable representation of a generated briefing.
 *
 * @module domains/briefing/entities
 */

export class BriefingData {
  /**
   * @param {Object} params
   * @param {string} params.context - Context ID
   * @param {string} params.contextName - Display name
   * @param {string} params.date - ISO date string
   * @param {Object} params.sections - Section data keyed by section ID
   */
  constructor({ context, contextName, date, sections }) {
    this.context = context;
    this.contextName = contextName;
    this.date = date;
    this.sections = Object.freeze(sections);
    this.generatedAt = new Date().toISOString();
    Object.freeze(this);
  }

  /**
   * Check if a section has data
   */
  hasSection(sectionId) {
    return this.sections[sectionId] != null;
  }

  /**
   * Get section data
   */
  getSection(sectionId) {
    return this.sections[sectionId];
  }

  /**
   * Get IDs of sections with data
   */
  getSectionIds() {
    return Object.keys(this.sections).filter(id => this.sections[id] != null);
  }

  /**
   * Serialize for API response
   */
  toJSON() {
    return {
      context: this.context,
      contextName: this.contextName,
      date: this.date,
      sections: this.sections,
      generatedAt: this.generatedAt,
    };
  }
}
```

---

## Application Services

### BriefingService

Orchestrates briefing generation:

```javascript
/**
 * BriefingService
 *
 * Orchestrates briefing data aggregation across multiple sources.
 * Context configurations define which sections to include.
 *
 * @module applications/briefing/services
 */

export class BriefingService {
  #briefingReader;
  #configService;
  #logger;

  static DEFAULT_CONTEXTS = { /* ... */ };

  constructor({ briefingReader, configService, logger }) {
    this.#briefingReader = briefingReader;
    this.#configService = configService;
    this.#logger = logger;
  }

  /**
   * Generate briefing for a context
   *
   * @param {string} username
   * @param {string} contextId
   * @param {Object} [overrides] - Runtime section overrides
   * @returns {Promise<BriefingData>}
   */
  async generateBriefing(username, contextId, overrides = {}) {
    this.#logger.info?.('briefing.generate.start', { username, contextId });

    // 1. Resolve context config (code defaults + YAML + overrides)
    const contextConfig = this.#resolveContextConfig(contextId, overrides);

    // 2. Fetch data for each section
    const sections = await this.#briefingReader.getBriefing(username, contextConfig);

    // 3. Apply fallbacks for empty sections
    const populated = this.#applyFallbacks(sections, contextConfig);

    // 4. Return BriefingData value object
    return new BriefingData({
      context: contextId,
      contextName: contextConfig.name,
      date: new Date().toISOString().split('T')[0],
      sections: populated,
    });
  }

  /**
   * Get list of available contexts
   */
  getAvailableContexts() {
    const defaults = Object.keys(BriefingService.DEFAULT_CONTEXTS);
    const yamlContexts = Object.keys(
      this.#configService.getAppConfig('briefing')?.contexts || {}
    );
    return [...new Set([...defaults, ...yamlContexts])];
  }

  #resolveContextConfig(contextId, overrides) {
    const defaults = BriefingService.DEFAULT_CONTEXTS[contextId] || {};
    const yamlConfig = this.#configService.getAppConfig('briefing')
      ?.contexts?.[contextId] || {};

    return deepMerge(defaults, yamlConfig, overrides);
  }

  #applyFallbacks(sections, contextConfig) {
    const result = { ...sections };
    const fallbacks = contextConfig.fallbacks || {};

    for (const [sectionId, sectionData] of Object.entries(result)) {
      if (this.#isEmpty(sectionData) && fallbacks[sectionId]) {
        const fallback = fallbacks[sectionId];
        if (fallback.empty === null) {
          delete result[sectionId];  // Omit section entirely
        } else {
          result[sectionId] = { _fallback: true, message: fallback.empty };
        }
      }
    }

    return result;
  }

  #isEmpty(data) {
    if (!data) return true;
    if (Array.isArray(data)) return data.length === 0;
    if (data.count !== undefined) return data.count === 0;
    if (data.items) return data.items.length === 0;
    if (data.events) return data.events.length === 0;
    if (data.tasks) return data.tasks.length === 0;
    return false;
  }
}
```

---

## Use Cases

### DeliverBriefing

Generates and delivers a briefing through one or more channels:

```javascript
/**
 * DeliverBriefing Use Case
 *
 * Generates a briefing for a given context and delivers it
 * through one or more channels.
 *
 * @module applications/briefing/usecases
 */

export class DeliverBriefing {
  #briefingService;
  #deliveryChannels;  // Map<channelId, IBriefingDelivery>
  #logger;

  constructor({ briefingService, deliveryChannels, logger }) {
    this.#briefingService = briefingService;
    this.#deliveryChannels = deliveryChannels;
    this.#logger = logger;
  }

  /**
   * Generate and deliver a briefing
   *
   * @param {string} username
   * @param {string} context - 'morning' | 'evening' | 'workout' | 'weekly' | custom
   * @param {Object} [options]
   * @param {string[]} [options.channels] - Delivery channels (default: ['thermal_printer'])
   * @param {Object} [options.recipients] - Channel-specific recipients
   * @param {Object} [options.overrides] - Section config overrides
   * @returns {Promise<{ success: boolean, briefing: BriefingData, delivery: Object }>}
   */
  async execute(username, context, options = {}) {
    const {
      channels = ['thermal_printer'],
      recipients = {},
      overrides = {}
    } = options;

    this.#logger.info?.('briefing.deliver.start', { username, context, channels });

    // 1. Generate briefing
    const briefing = await this.#briefingService.generateBriefing(
      username,
      context,
      overrides
    );

    this.#logger.debug?.('briefing.deliver.generated', {
      context,
      sections: briefing.getSectionIds(),
    });

    // 2. Deliver to each channel
    const results = {};
    for (const channelId of channels) {
      const delivery = this.#deliveryChannels.get(channelId);

      if (!delivery) {
        this.#logger.warn?.('briefing.deliver.unknown_channel', { channelId });
        results[channelId] = { success: false, error: 'Unknown channel' };
        continue;
      }

      try {
        const availability = await delivery.checkAvailability();
        if (!availability.available) {
          results[channelId] = { success: false, error: availability.error };
          continue;
        }

        results[channelId] = await delivery.deliver(
          briefing,
          recipients[channelId] || {}
        );

        this.#logger.info?.('briefing.deliver.channel_complete', {
          channelId,
          success: results[channelId].success,
        });
      } catch (error) {
        this.#logger.error?.('briefing.deliver.channel_error', {
          channelId,
          error: error.message,
        });
        results[channelId] = { success: false, error: error.message };
      }
    }

    return {
      success: true,
      briefing,
      delivery: results,
    };
  }

  /**
   * Get available delivery channels
   */
  getAvailableChannels() {
    return Array.from(this.#deliveryChannels.keys());
  }
}
```

---

## Adapters

### YamlBriefingReader

Implements `IBriefingReader` by coordinating existing services:

```javascript
/**
 * YamlBriefingReader
 *
 * Implements IBriefingReader by aggregating data from existing adapters.
 * Each section type has a dedicated fetcher.
 *
 * @module adapters/briefing
 */

export class YamlBriefingReader {
  #entropyService;
  #calendarAdapter;
  #todoAdapter;
  #weatherAdapter;
  #logger;

  constructor({ entropyService, calendarAdapter, todoAdapter, weatherAdapter, logger }) {
    this.#entropyService = entropyService;
    this.#calendarAdapter = calendarAdapter;
    this.#todoAdapter = todoAdapter;
    this.#weatherAdapter = weatherAdapter;
    this.#logger = logger;
  }

  getAvailableSections() {
    return ['weather', 'calendar', 'todos', 'entropy'];
  }

  async getBriefing(username, contextConfig) {
    const sections = {};

    for (const [sectionId, sectionConfig] of Object.entries(contextConfig.sections || {})) {
      try {
        sections[sectionId] = await this.#fetchSection(username, sectionId, sectionConfig);
      } catch (error) {
        this.#logger.error?.('briefing.section.error', {
          sectionId,
          error: error.message
        });
        if (sectionConfig.required) throw error;
        sections[sectionId] = null;
      }
    }

    return sections;
  }

  async #fetchSection(username, sectionId, config) {
    switch (sectionId) {
      case 'weather':
        return this.#fetchWeather(username, config);
      case 'calendar':
        return this.#fetchCalendar(username, config);
      case 'todos':
        return this.#fetchTodos(username, config);
      case 'entropy':
        return this.#fetchEntropy(username, config);
      default:
        this.#logger.warn?.('briefing.section.unknown', { sectionId });
        return null;
    }
  }

  async #fetchWeather(username, config) {
    const data = await this.#weatherAdapter.getCurrent(username);
    return {
      temperature: data.temp,
      condition: data.condition,
      icon: data.icon,
      high: data.high,
      low: data.low,
    };
  }

  async #fetchCalendar(username, config) {
    const events = await this.#calendarAdapter.getEvents(username, {
      filter: config.filter,  // 'today', 'tomorrow', 'next_7_days'
    });
    const max = config.max || 10;
    return {
      count: events.length,
      events: events.slice(0, max).map(e => ({
        time: e.startTime,
        title: e.summary,
        location: e.location,
        allDay: e.allDay,
      })),
    };
  }

  async #fetchTodos(username, config) {
    const tasks = await this.#todoAdapter.getTasks(username, {
      filter: config.filter,  // 'overdue_or_due_today', 'due_this_week'
    });
    const max = config.max || 5;
    return {
      count: tasks.length,
      tasks: tasks.slice(0, max).map(t => ({
        title: t.content,
        due: t.due,
        overdue: t.overdue,
        priority: t.priority,
      })),
      overdueCount: tasks.filter(t => t.overdue).length,
    };
  }

  async #fetchEntropy(username, config) {
    const report = await this.#entropyService.getReport(username);
    let items = report.items;

    // Apply filter
    if (config.filter === 'yellow_or_red') {
      items = items.filter(i => i.status !== 'green');
    } else if (config.filter === 'fitness_only') {
      items = items.filter(i => i.source.includes('fitness') || i.source.includes('workout'));
    }

    const max = config.max || 3;
    return {
      items: items.slice(0, max),
      summary: report.summary,
    };
  }
}
```

### Delivery Adapters

#### ThermalPrinterDelivery

```javascript
/**
 * ThermalPrinterDelivery
 * @module adapters/briefing/delivery
 */

export class ThermalPrinterDelivery {
  #printerAdapter;
  #renderer;

  constructor({ printerAdapter, renderer }) {
    this.#printerAdapter = printerAdapter;
    this.#renderer = renderer;
  }

  get channel() { return 'thermal_printer'; }

  async checkAvailability() {
    const ping = await this.#printerAdapter.ping();
    return { available: ping.success, error: ping.error };
  }

  async deliver(briefing, recipient = {}) {
    const printJob = this.#renderer.render(briefing);
    const success = await this.#printerAdapter.print(printJob);
    return { success };
  }
}
```

#### TelegramDelivery

```javascript
/**
 * TelegramDelivery
 * @module adapters/briefing/delivery
 */

export class TelegramDelivery {
  #telegramAdapter;
  #renderer;

  constructor({ telegramAdapter, renderer }) {
    this.#telegramAdapter = telegramAdapter;
    this.#renderer = renderer;
  }

  get channel() { return 'telegram'; }

  async checkAvailability() {
    return { available: this.#telegramAdapter.isConfigured() };
  }

  async deliver(briefing, recipient) {
    const { chatId } = recipient;
    if (!chatId) return { success: false, error: 'No chatId provided' };

    const message = this.#renderer.render(briefing);
    const result = await this.#telegramAdapter.sendMessage(chatId, message, {
      parseMode: 'Markdown',
    });
    return { success: true, messageId: result.messageId };
  }
}
```

#### EmailDelivery (Stubbed)

```javascript
/**
 * EmailDelivery
 * @module adapters/briefing/delivery
 */

export class EmailDelivery {
  #emailGateway;
  #renderer;

  constructor({ emailGateway, renderer }) {
    this.#emailGateway = emailGateway;
    this.#renderer = renderer;
  }

  get channel() { return 'email'; }

  async checkAvailability() {
    return this.#emailGateway.checkAvailability();
  }

  async deliver(briefing, recipient) {
    const { email, name } = recipient;
    if (!email) return { success: false, error: 'No email provided' };

    const { subject, html } = this.#renderer.render(briefing);
    return this.#emailGateway.send({ to: email, toName: name, subject, html });
  }
}
```

#### SESEmailGateway (Stubbed)

```javascript
/**
 * SESEmailGateway - AWS SES implementation (stubbed)
 * @module adapters/email
 */

export class SESEmailGateway {
  #sesClient;
  #fromAddress;
  #fromName;
  #logger;

  constructor({ sesClient, fromAddress, fromName, logger }) {
    this.#sesClient = sesClient;
    this.#fromAddress = fromAddress;
    this.#fromName = fromName;
    this.#logger = logger;
  }

  async checkAvailability() {
    if (!this.#sesClient) {
      return { available: false, error: 'SES client not configured' };
    }
    return { available: true };
  }

  async send({ to, toName, subject, html, text }) {
    this.#logger.info?.('email.send.start', { to, subject });

    // STUB: Actual SES implementation
    // const command = new SendEmailCommand({
    //   Source: `${this.#fromName} <${this.#fromAddress}>`,
    //   Destination: { ToAddresses: [to] },
    //   Message: {
    //     Subject: { Data: subject },
    //     Body: {
    //       Html: { Data: html },
    //       Text: { Data: text },
    //     },
    //   },
    // });
    // const response = await this.#sesClient.send(command);

    this.#logger.warn?.('email.send.stubbed', { to, subject });

    return {
      success: true,
      messageId: `stub-${Date.now()}`,
      stubbed: true,
    };
  }
}
```

---

## Renderers

### BriefingReceiptRenderer (Thermal Printer)

```javascript
/**
 * BriefingReceiptRenderer
 *
 * Transforms BriefingData into thermal printer PrintJob format.
 *
 * @module adapters/briefing/rendering
 */

export class BriefingReceiptRenderer {
  render(briefing) {
    const items = [];

    // Header: Date
    items.push({
      type: 'text',
      content: this.#formatDate(briefing.date),
      align: 'center',
      size: { width: 2, height: 2 },
      style: { bold: true },
    });
    items.push({ type: 'space', lines: 1 });

    // Weather
    if (briefing.hasSection('weather')) {
      items.push(...this.#renderWeather(briefing.getSection('weather')));
    }

    // Calendar
    if (briefing.hasSection('calendar')) {
      items.push(...this.#renderCalendar(briefing.getSection('calendar')));
    }

    // Todos
    if (briefing.hasSection('todos')) {
      items.push(...this.#renderTodos(briefing.getSection('todos')));
    }

    // Entropy
    if (briefing.hasSection('entropy')) {
      items.push(...this.#renderEntropy(briefing.getSection('entropy')));
    }

    return {
      items,
      footer: { paddingLines: 4, autoCut: true },
    };
  }

  #formatDate(dateStr) {
    const d = new Date(dateStr);
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];
    return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`;
  }

  #renderWeather(weather) {
    if (weather._fallback) return [];
    return [
      { type: 'text', content: `${weather.icon} ${weather.temperature}°F, ${weather.condition}`, align: 'center' },
      { type: 'text', content: `High ${weather.high}° / Low ${weather.low}°`, align: 'center' },
      { type: 'space', lines: 1 },
      { type: 'line', width: 32 },
    ];
  }

  #renderCalendar(calendar) {
    if (calendar._fallback) {
      return [
        { type: 'space', lines: 1 },
        { type: 'text', content: 'TODAY', style: { bold: true } },
        { type: 'text', content: calendar.message },
        { type: 'line', width: 32 },
      ];
    }

    const items = [
      { type: 'space', lines: 1 },
      { type: 'text', content: `TODAY (${calendar.count} events)`, style: { bold: true } },
    ];

    for (const event of calendar.events) {
      const timeStr = event.allDay ? 'All day' : event.time;
      items.push({ type: 'text', content: `• ${timeStr} ${event.title}` });
    }

    items.push({ type: 'line', width: 32 });
    return items;
  }

  #renderTodos(todos) {
    if (todos._fallback) {
      return [
        { type: 'space', lines: 1 },
        { type: 'text', content: 'TASKS', style: { bold: true } },
        { type: 'text', content: todos.message },
        { type: 'line', width: 32 },
      ];
    }

    if (todos.tasks.length === 0) return [];

    const items = [
      { type: 'space', lines: 1 },
      { type: 'text', content: todos.overdueCount > 0
          ? `TASKS (${todos.overdueCount} overdue)`
          : 'TASKS',
        style: { bold: true } },
    ];

    for (const task of todos.tasks) {
      const prefix = task.overdue ? '!' : 'o';
      items.push({ type: 'text', content: `${prefix} ${task.title}` });
    }

    items.push({ type: 'line', width: 32 });
    return items;
  }

  #renderEntropy(entropy) {
    if (entropy._fallback || entropy.items.length === 0) return [];

    const items = [
      { type: 'space', lines: 1 },
      { type: 'text', content: 'ATTENTION', style: { bold: true } },
    ];

    for (const item of entropy.items) {
      const icon = item.status === 'red' ? '[!]' : '[*]';
      items.push({ type: 'text', content: `${icon} ${item.name}: ${item.label}` });
    }

    return items;
  }
}
```

### BriefingTelegramRenderer

```javascript
/**
 * BriefingTelegramRenderer
 *
 * Transforms BriefingData into Telegram Markdown message.
 *
 * @module adapters/briefing/rendering
 */

export class BriefingTelegramRenderer {
  render(briefing) {
    const lines = [];

    // Header
    lines.push(`*${this.#formatDate(briefing.date)}*`);
    lines.push('');

    // Weather
    if (briefing.hasSection('weather')) {
      const w = briefing.getSection('weather');
      if (!w._fallback) {
        lines.push(`${w.icon} ${w.temperature}°F, ${w.condition}`);
        lines.push('');
      }
    }

    // Calendar
    if (briefing.hasSection('calendar')) {
      const cal = briefing.getSection('calendar');
      if (cal._fallback) {
        lines.push(`📅 *Today*: ${cal.message}`);
      } else {
        lines.push(`📅 *Today* (${cal.count} events)`);
        for (const event of cal.events.slice(0, 5)) {
          const timeStr = event.allDay ? 'All day' : event.time;
          lines.push(`  • ${timeStr} ${event.title}`);
        }
      }
      lines.push('');
    }

    // Todos
    if (briefing.hasSection('todos')) {
      const todos = briefing.getSection('todos');
      if (todos._fallback) {
        lines.push(`✅ *Tasks*: ${todos.message}`);
      } else if (todos.tasks.length > 0) {
        const header = todos.overdueCount
          ? `✅ *Tasks* (${todos.overdueCount} overdue)`
          : '✅ *Tasks*';
        lines.push(header);
        for (const task of todos.tasks) {
          const icon = task.overdue ? '⚠️' : '○';
          lines.push(`  ${icon} ${task.title}`);
        }
      }
      lines.push('');
    }

    // Entropy
    if (briefing.hasSection('entropy')) {
      const entropy = briefing.getSection('entropy');
      if (!entropy._fallback && entropy.items.length > 0) {
        lines.push('🎯 *Attention*');
        for (const item of entropy.items) {
          const icon = item.status === 'red' ? '🔴' : '🟡';
          lines.push(`  ${icon} ${item.name}: ${item.label}`);
        }
      }
    }

    return lines.join('\n').trim();
  }

  #formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    });
  }
}
```

### BriefingEmailRenderer

```javascript
/**
 * BriefingEmailRenderer
 *
 * Transforms BriefingData into email subject + HTML body.
 *
 * @module adapters/briefing/rendering
 */

export class BriefingEmailRenderer {
  render(briefing) {
    const subject = `${briefing.contextName} - ${this.#formatDate(briefing.date)}`;
    const html = this.#buildHtml(briefing);
    return { subject, html };
  }

  #formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    });
  }

  #buildHtml(briefing) {
    const sections = [];

    sections.push(`<h1>${this.#formatDate(briefing.date)}</h1>`);

    if (briefing.hasSection('weather')) {
      const w = briefing.getSection('weather');
      if (!w._fallback) {
        sections.push(`
          <div class="section weather">
            <p>${w.icon} ${w.temperature}°F, ${w.condition}</p>
            <p>High ${w.high}° / Low ${w.low}°</p>
          </div>
        `);
      }
    }

    if (briefing.hasSection('calendar')) {
      const cal = briefing.getSection('calendar');
      if (cal._fallback) {
        sections.push(`<div class="section calendar"><h2>Today</h2><p>${cal.message}</p></div>`);
      } else {
        const eventList = cal.events.map(e => {
          const timeStr = e.allDay ? 'All day' : e.time;
          return `<li>${timeStr} - ${e.title}</li>`;
        }).join('');
        sections.push(`
          <div class="section calendar">
            <h2>Today (${cal.count} events)</h2>
            <ul>${eventList}</ul>
          </div>
        `);
      }
    }

    if (briefing.hasSection('todos')) {
      const todos = briefing.getSection('todos');
      if (todos._fallback) {
        sections.push(`<div class="section todos"><h2>Tasks</h2><p>${todos.message}</p></div>`);
      } else if (todos.tasks.length > 0) {
        const taskList = todos.tasks.map(t => {
          const style = t.overdue ? 'color: red; font-weight: bold;' : '';
          return `<li style="${style}">${t.title}</li>`;
        }).join('');
        const header = todos.overdueCount
          ? `Tasks (${todos.overdueCount} overdue)`
          : 'Tasks';
        sections.push(`
          <div class="section todos">
            <h2>${header}</h2>
            <ul>${taskList}</ul>
          </div>
        `);
      }
    }

    if (briefing.hasSection('entropy')) {
      const entropy = briefing.getSection('entropy');
      if (!entropy._fallback && entropy.items.length > 0) {
        const itemList = entropy.items.map(i => {
          const color = i.status === 'red' ? 'red' : 'orange';
          return `<li style="color: ${color};">${i.name}: ${i.label}</li>`;
        }).join('');
        sections.push(`
          <div class="section entropy">
            <h2>Attention</h2>
            <ul>${itemList}</ul>
          </div>
        `);
      }
    }

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
          h1 { border-bottom: 2px solid #333; padding-bottom: 10px; }
          h2 { font-size: 1.1em; margin-top: 20px; }
          ul { padding-left: 20px; }
          li { margin: 5px 0; }
          .section { margin-bottom: 20px; }
        </style>
      </head>
      <body>
        ${sections.join('\n')}
        <hr>
        <p style="color: #666; font-size: 0.9em;">Generated by Daylight Station</p>
      </body>
      </html>
    `;
  }
}
```

---

## API Endpoints

### Briefing Router

```javascript
/**
 * Briefing Router
 * @module api/routers/briefing
 */

export function createBriefingRouter({ deliverBriefing, briefingService, configService }) {
  const router = express.Router();

  const getUsername = () => configService.getHeadOfHousehold();

  /**
   * GET /briefing
   * List available contexts and channels
   */
  router.get('/', (req, res) => {
    res.json({
      contexts: briefingService.getAvailableContexts(),
      channels: deliverBriefing.getAvailableChannels(),
      endpoints: {
        'GET /:context': 'Generate and deliver briefing (default: thermal_printer)',
        'GET /:context/preview': 'Generate briefing without delivery',
        'POST /:context/deliver': 'Deliver to specific channels',
      },
    });
  });

  /**
   * GET /briefing/:context
   * Generate and deliver via default channel (thermal_printer)
   */
  router.get('/:context', asyncHandler(async (req, res) => {
    const { context } = req.params;
    const { channel = 'thermal_printer' } = req.query;
    const username = getUsername();

    const result = await deliverBriefing.execute(username, context, {
      channels: [channel],
    });

    res.json(result);
  }));

  /**
   * GET /briefing/:context/preview
   * Generate without delivery
   */
  router.get('/:context/preview', asyncHandler(async (req, res) => {
    const { context } = req.params;
    const username = getUsername();

    const briefing = await briefingService.generateBriefing(username, context);
    res.json(briefing.toJSON());
  }));

  /**
   * POST /briefing/:context/deliver
   * Deliver to specific channels
   *
   * Body: {
   *   channels: ['thermal_printer', 'telegram', 'email'],
   *   recipients: {
   *     telegram: { chatId: '12345' },
   *     email: { email: 'user@example.com', name: 'User' }
   *   },
   *   overrides: { ... }
   * }
   */
  router.post('/:context/deliver', asyncHandler(async (req, res) => {
    const { context } = req.params;
    const { channels, recipients, overrides } = req.body;
    const username = getUsername();

    const result = await deliverBriefing.execute(username, context, {
      channels,
      recipients,
      overrides,
    });

    res.json(result);
  }));

  return router;
}
```

---

## Triggering

The API is the single interface. Triggering is external and configurable:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         TRIGGERING OPTIONS                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐              │
│   │   Cron Job   │    │     Home     │    │   Physical   │              │
│   │              │    │  Assistant   │    │   Trigger    │              │
│   │ 0 6 * * *    │    │  automation  │    │  button/NFC  │              │
│   └──────┬───────┘    └──────┬───────┘    └──────┬───────┘              │
│          │                   │                   │                       │
│          └───────────────────┼───────────────────┘                       │
│                              ▼                                           │
│                    GET /api/briefing/morning                             │
│                              │                                           │
│                              ▼                                           │
│                  ┌───────────────────────┐                               │
│                  │    DeliverBriefing    │                               │
│                  │       Use Case        │                               │
│                  └───────────────────────┘                               │
│                              │                                           │
│               ┌──────────────┼──────────────┐                            │
│               ▼              ▼              ▼                            │
│           🖨️ Print      📱 Telegram      📧 Email                        │
└─────────────────────────────────────────────────────────────────────────┘
```

### Home Assistant Example

```yaml
# automations.yaml
- alias: "Morning Briefing Receipt"
  trigger:
    - platform: time
      at: "06:00:00"
    - platform: state
      entity_id: binary_sensor.kitchen_motion
      to: "on"
      for: "00:00:30"
  condition:
    - condition: time
      after: "05:00:00"
      before: "09:00:00"
    - condition: template
      value_template: "{{ not is_state('input_boolean.morning_receipt_printed', 'on') }}"
  action:
    - service: rest_command.daylight_briefing
      data:
        context: morning
    - service: input_boolean.turn_on
      entity_id: input_boolean.morning_receipt_printed

# Reset at midnight
- alias: "Reset Morning Receipt Flag"
  trigger:
    platform: time
    at: "00:00:00"
  action:
    service: input_boolean.turn_off
    entity_id: input_boolean.morning_receipt_printed

# configuration.yaml
rest_command:
  daylight_briefing:
    url: "http://daylight:3111/api/briefing/{{ context }}"
    method: GET
```

### Cron Example

```bash
# Morning receipt at 6am
0 6 * * * curl -s http://localhost:3111/api/briefing/morning

# Weekly review on Sunday at 8pm
0 20 * * 0 curl -s http://localhost:3111/api/briefing/weekly
```

---

## File Structure

```
backend/src/
├── 1_domains/
│   └── briefing/
│       └── entities/
│           └── BriefingData.mjs
│
├── 2_adapters/
│   ├── briefing/
│   │   ├── YamlBriefingReader.mjs
│   │   ├── delivery/
│   │   │   ├── ThermalPrinterDelivery.mjs
│   │   │   ├── TelegramDelivery.mjs
│   │   │   ├── EmailDelivery.mjs
│   │   │   └── index.mjs
│   │   ├── rendering/
│   │   │   ├── BriefingReceiptRenderer.mjs
│   │   │   ├── BriefingTelegramRenderer.mjs
│   │   │   ├── BriefingEmailRenderer.mjs
│   │   │   └── index.mjs
│   │   └── index.mjs
│   │
│   └── email/
│       ├── IEmailGateway.mjs
│       ├── SESEmailGateway.mjs
│       └── index.mjs
│
├── 3_applications/
│   └── briefing/
│       ├── ports/
│       │   ├── IBriefingReader.mjs
│       │   ├── IBriefingDelivery.mjs
│       │   └── index.mjs
│       ├── services/
│       │   ├── BriefingService.mjs
│       │   └── index.mjs
│       ├── usecases/
│       │   ├── DeliverBriefing.mjs
│       │   └── index.mjs
│       ├── config/
│       │   └── defaultContexts.mjs
│       └── index.mjs
│
└── 4_api/
    └── v1/
        └── routers/
            └── briefing.mjs
```

---

## Implementation Plan

### Phase 1: Core Infrastructure
1. Create `BriefingData` value object
2. Create `IBriefingReader` port interface
3. Create `BriefingService` with default context configs
4. Create `YamlBriefingReader` adapter (weather, calendar, todos, entropy)

### Phase 2: Thermal Printer Delivery
5. Create `IBriefingDelivery` port interface
6. Create `BriefingReceiptRenderer`
7. Create `ThermalPrinterDelivery` adapter
8. Create `DeliverBriefing` use case

### Phase 3: API & Testing
9. Create briefing router with endpoints
10. Wire up in bootstrap
11. Manual testing with thermal printer
12. Unit tests for services and renderers

### Phase 4: Additional Channels
13. Create `BriefingTelegramRenderer`
14. Create `TelegramDelivery` adapter
15. Create `BriefingEmailRenderer`
16. Create stubbed `SESEmailGateway`
17. Create `EmailDelivery` adapter

### Phase 5: Configuration & Polish
18. Add YAML config override support
19. Add custom context support
20. Documentation
21. Integration tests

---

## Future Enhancements

- **Wisdom/Quote section**: Abstract provider for stoic wisdom, scripture, mantras, affirmations
- **RSS headlines section**: Top headlines from FreshRSS
- **Lifeplan integration**: Surface today's focus goals from JOP framework
- **Scheduling within DaylightStation**: Optional internal cron for users without HA
- **Template customization**: User-defined receipt/message templates
- **Delivery preferences per user**: Multi-household support with per-user channel preferences

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-30 | Initial design document |

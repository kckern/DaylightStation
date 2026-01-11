// backend/index.js - Proxy to legacy during DDD migration
// See docs/_wip/plans/2026-01-10-backend-ddd-architecture.md for migration plan
// This file routes all traffic to _legacy/ until migration is complete

import './_legacy/index.js';

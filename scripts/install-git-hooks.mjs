#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// Docker deliberately excludes `.git` from its build context. Installing a
// developer-only hook there is meaningless, and must never prevent the
// production image from being built.
if (!existsSync('.git')) process.exit(0);

execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'inherit' });

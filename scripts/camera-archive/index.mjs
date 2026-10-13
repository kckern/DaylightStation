#!/usr/bin/env node
// Stable command entry; implementation belongs to its declared owner.
import { runCliEntry } from "../../__app_modules/camera/cli/archive.mjs";
if (import.meta.url === `file://${process.argv[1]}`) { runCliEntry(); }

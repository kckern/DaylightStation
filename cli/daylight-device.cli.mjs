#!/usr/bin/env node
// Stable command entry; implementation belongs to its application owner.
import { main } from "../_extensions/daylight-android/cli/daylight-device.mjs";
main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error('✗ ' + (e.message || e)); process.exit(1); });

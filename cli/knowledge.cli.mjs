#!/usr/bin/env node
import { main } from '../__app_modules/personal/lifelog/cli/knowledge.cli.mjs';
main().then(code=>{process.exitCode=code;}).catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});

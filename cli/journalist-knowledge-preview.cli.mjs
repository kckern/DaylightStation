#!/usr/bin/env node
import {main} from '../__app_modules/personal/journalist/cli/journalist-knowledge-preview.cli.mjs';
main().then(code=>{process.exitCode=code;}).catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});

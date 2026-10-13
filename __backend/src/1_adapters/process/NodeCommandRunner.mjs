import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export class NodeCommandRunner {
  run = promisify(execFile);
}

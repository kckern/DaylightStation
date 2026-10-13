#!/usr/bin/env node
/**
 * Paged Media TOC Backfill CLI
 *
 * Invokes the paged-media-toc agent via the backend API to process books
 * that need TOC extraction. The agent is the single source of truth for
 * all TOC parsing logic — this CLI is just a thin invocation wrapper.
 *
 * Usage:
 *   node cli/paged-media-toc-backfill.cli.mjs              # Run agent (synchronous, wait for result)
 *   node cli/paged-media-toc-backfill.cli.mjs --background  # Run agent in background
 *   node cli/paged-media-toc-backfill.cli.mjs --port 3112   # Specify backend port (default: 3112)
 *
 * @module cli/paged-media-toc-backfill
 */

const args = process.argv.slice(2);
const background = args.includes('--background');
const portIdx = args.indexOf('--port');
const port = portIdx >= 0 ? parseInt(args[portIdx + 1], 10) : 3112;
const baseUrl = `http://localhost:${port}/api/v1/agents/paged-media-toc`;

const AGENT_INPUT = 'Scan for books that need TOC extraction and process them.';

async function main() {
  console.log('Paged Media TOC Backfill');
  console.log(`  Backend: http://localhost:${port}`);
  console.log(`  Mode: ${background ? 'BACKGROUND' : 'SYNCHRONOUS'}\n`);

  // Health check — verify agent is registered
  const listRes = await fetch(`http://localhost:${port}/api/v1/agents`);
  if (!listRes.ok) {
    console.error(`ERROR: Backend not responding on port ${port} (${listRes.status})`);
    process.exit(1);
  }
  const { agents } = await listRes.json();
  const agent = agents?.find(a => a.id === 'paged-media-toc');
  if (!agent) {
    console.error('ERROR: paged-media-toc agent not registered. Check backend logs.');
    process.exit(1);
  }
  console.log(`Agent: ${agent.id} — ${agent.description}\n`);

  if (background) {
    // Fire and forget
    const res = await fetch(`${baseUrl}/run-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: AGENT_INPUT }),
    });
    const data = await res.json();

    if (res.status === 202) {
      console.log(`Background task started: ${data.taskId}`);
      console.log('Agent is processing books in the background.');
    } else {
      console.error(`ERROR: ${res.status}`, data);
      process.exit(1);
    }
  } else {
    // Synchronous — wait for completion
    console.log('Running agent (this may take several minutes)...\n');
    const res = await fetch(`${baseUrl}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: AGENT_INPUT }),
      signal: AbortSignal.timeout(10 * 60 * 1000), // 10 minute timeout
    });
    const data = await res.json();

    if (res.ok) {
      console.log('Agent output:');
      console.log(data.output || '(no output)');
      if (data.toolCalls?.length) {
        console.log(`\nTool calls: ${data.toolCalls.length}`);
      }
    } else {
      console.error(`ERROR: ${res.status}`, data);
      process.exit(1);
    }
  }
}

main().catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(1);
});

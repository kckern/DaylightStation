import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import * as FileIO from '#system/utils/FileIO.mjs';
import { JournalKnowledgeFile } from './JournalKnowledgeFile.mjs';
import { HistoricalJournalEvidence } from './HistoricalJournalEvidence.mjs';
import { JournalKnowledgeEvidence } from './JournalKnowledgeEvidence.mjs';
import { AuthorizedJournalEvidence } from './AuthorizedJournalEvidence.mjs';
it('uses one canonical file representation for unquoted timestamps and propagates read/parse failures', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-source-file-')),
    file = path.join(root, 'lifelog', 'journalist', 'messages.yml');
  fs.mkdirSync(path.dirname(file), {
    recursive: true
  });
  fs.writeFileSync(file, "messages:\n  - id: entry-1\n    senderId: '101'\n    timestamp: 2026-11-02T18:00:00Z\n    content: I will finish the story.\n");
  try {
    const source = new JournalKnowledgeFile({
      userDirForUser: () => root
    });
    expect((await source.read('sample')).messages[0].timestamp).toBe('2026-11-02T18:00:00Z');
    const options = {
      loadJournal: u => source.read(u),
      identityForUser: async () => ({
        senderId: '101',
        conversationId: 'private'
      }),
      timezoneForUser: () => 'America/Los_Angeles'
    };
    const historical = new HistoricalJournalEvidence(options),
      asOf = Date.parse('2026-11-03T18:00Z'),
      from = asOf - 90 * 86400000;
    const original = (await historical.read({
      username: 'sample',
      from,
      asOf
    })).messages[0];
    const authorizations = {
      [original.ref]: {
        originalRef: original.originalRef,
        sourceHash: original.sourceHash,
        from,
        asOf,
        jobId: 'job-1'
      }
    };
    const catalog = new AuthorizedJournalEvidence({
      live: new JournalKnowledgeEvidence(options),
      historical,
      readAuthorizations: async () => authorizations
    });
    expect(await catalog.readRevocations({
      username: 'sample'
    })).toEqual([]);
    // Existing journal writers load/dump YAML dates; equivalent instant formatting is not an edit.
    fs.writeFileSync(file, yaml.dump(yaml.load(fs.readFileSync(file, 'utf8'))));
    expect((await historical.read({
      username: 'sample',
      from,
      asOf
    })).messages[0].ref).toBe(original.ref);
    fs.writeFileSync(file, 'messages: [invalid yaml');
    await expect(catalog.readRevocations({
      username: 'sample'
    })).rejects.toThrow();
    fs.writeFileSync(file, 'messages: []\n');
    expect(await catalog.readRevocations({
      username: 'sample'
    })).toContain(original.ref);
    fs.unlinkSync(file);
    await expect(catalog.readRevocations({
      username: 'sample'
    })).rejects.toThrow(/unavailable/i);
    const unavailable = new JournalKnowledgeFile({
      userDirForUser: () => root,
      io: {
        ...FileIO,
        readTextFromPath: () => {
          throw Object.assign(new Error('unreadable'), {
            code: 'EACCES'
          });
        }
      }
    });
    await expect(unavailable.read('sample')).rejects.toMatchObject({
      code: 'EACCES'
    });
  } finally {
    fs.rmSync(root, {
      recursive: true,
      force: true
    });
  }
});

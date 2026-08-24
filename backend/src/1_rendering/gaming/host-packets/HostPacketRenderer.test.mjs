import { describe, expect, it } from 'vitest';
import { HostPacketRenderer } from './HostPacketRenderer.mjs';

describe('HostPacketRenderer', () => {
  it('renders an explicit printable PDF packet', async () => {
    const pdf = await new HostPacketRenderer().render({ definition: { title: 'Activity Party', challenges: [{ activity: 'draw', prompt: 'A tree' }] }, session: { header: { session_id: 'one' } } });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-'); expect(pdf.length).toBeGreaterThan(500);
  });
});

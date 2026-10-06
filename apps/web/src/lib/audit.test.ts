// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { writeAudit } from './audit';

const client = (result: { data: unknown; error: unknown }) =>
  ({ rpc: vi.fn().mockResolvedValue(result) }) as unknown as Parameters<typeof writeAudit>[0];

describe('writeAudit', () => {
  it('calls write_audit with the change and returns the row id', async () => {
    const supabase = client({ data: 'audit-1', error: null });
    const id = await writeAudit(supabase, {
      action: 'site.mute',
      entity: 'site',
      entityId: 's1',
      before: { muted_until: null },
      after: { muted_until: '2026-09-25T11:00:00Z' },
    });
    expect(id).toBe('audit-1');
    expect(supabase.rpc).toHaveBeenCalledWith('write_audit', {
      p_action: 'site.mute',
      p_entity: 'site',
      p_entity_id: 's1',
      p_before: { muted_until: null },
      p_after: { muted_until: '2026-09-25T11:00:00Z' },
    });
  });

  it('throws when the database refuses', async () => {
    await expect(
      writeAudit(client({ data: null, error: { message: 'No active profile' } }), {
        action: 'x',
        entity: 'y',
        entityId: null,
      }),
    ).rejects.toThrow(/No active profile/);
  });
});

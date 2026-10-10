import { describe, expect, it } from 'vitest';
import { ALWAYS_NEEDS, INCIDENT_COLUMNS, NARROWEST_TABLE } from './incident-columns';

describe('Incidents table columns (no sideways scroll, S07 layout-consistency)', () => {
  it('the columns always shown fit the narrowest table (md)', () => {
    expect(ALWAYS_NEEDS).toBeLessThanOrEqual(NARROWEST_TABLE);
  });
  it('each optional column joins only once the table has room for it and those before it', () => {
    expect(INCIDENT_COLUMNS.started.from).toBe(768);
    expect(INCIDENT_COLUMNS.duration.from).toBe(856);
    expect(INCIDENT_COLUMNS.trigger.from).toBe(984);
    expect(INCIDENT_COLUMNS.id.from).toBeUndefined();
  });
});

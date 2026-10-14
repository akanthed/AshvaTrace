import { describe, it, expect, beforeEach } from 'vitest';

// No GCP_PROJECT_ID in test env, so sopService falls back to its local copy
// without touching BigQuery.
delete process.env.GCP_PROJECT_ID;

import { retrieveSops, getSopById } from '../services/sopService';

describe('sopService', () => {
  beforeEach(() => {
    delete process.env.GCP_PROJECT_ID;
  });

  it('retrieves the power-drift SOP when power deviation is elevated', async () => {
    const sops = await retrieveSops({ powerDevPct: 8, vibration: 1 });
    expect(sops.map((s) => s.id)).toContain('SOP-101');
  });

  it('retrieves the tool-inspection SOP when vibration is elevated', async () => {
    const sops = await retrieveSops({ powerDevPct: 0, vibration: 3.5 });
    expect(sops.map((s) => s.id)).toContain('SOP-102');
  });

  it('retrieves both when both signals are elevated', async () => {
    const sops = await retrieveSops({ powerDevPct: 10, vibration: 4 });
    expect(sops.map((s) => s.id)).toEqual(expect.arrayContaining(['SOP-101', 'SOP-102']));
  });

  it('falls back to at least one SOP when no signal crosses a trigger', async () => {
    const sops = await retrieveSops({ powerDevPct: 0.1, vibration: 0.1 });
    expect(sops.length).toBeGreaterThan(0);
  });

  it('getSopById returns the matching SOP', async () => {
    const sop = await getSopById('SOP-103');
    expect(sop?.title).toBe('Post-Adjustment Verification');
  });
});

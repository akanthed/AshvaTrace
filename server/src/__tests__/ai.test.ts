import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock google-auth-library so vertexAIRequest can obtain a token without real credentials.
vi.mock('google-auth-library', () => ({
  GoogleAuth: vi.fn().mockImplementation(() => ({
    getAccessToken: vi.fn().mockResolvedValue('fake-token'),
  })),
}));

// Mock https.request to simulate the Vertex AI generateContent REST response.
const { mockResponseText, mockShouldError } = vi.hoisted(() => ({
  mockResponseText: { value: '' },
  mockShouldError: { value: false },
}));

vi.mock('https', () => ({
  default: {
    request: vi.fn((_opts: any, callback: any) => {
      const res = new EventEmitter() as any;
      const req = new EventEmitter() as any;
      req.write = vi.fn();
      req.end = vi.fn(() => {
        if (mockShouldError.value) {
          req.emit('error', new Error('network down'));
          return;
        }
        callback(res);
        const body = JSON.stringify({
          candidates: [{ content: { parts: [{ text: mockResponseText.value }] } }],
        });
        res.emit('data', body);
        res.emit('end');
      });
      return req;
    }),
  },
}));

vi.hoisted(() => {
  process.env.GCP_PROJECT_ID = 'test-project';
});

import { investigate, critiqueHypotheses, simulate, verify } from '../utils/ai';

describe('utils/ai', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResponseText.value = '';
    mockShouldError.value = false;
  });

  describe('investigate', () => {
    it('parses JSON from the AI response into hypotheses', async () => {
      mockResponseText.value = JSON.stringify([
        {
          title: 'Bearing wear',
          confidence: 80,
          evidenceFor: ['Power trending up'],
          evidenceAgainst: ['No spike'],
        },
        {
          title: 'Material variation',
          confidence: 60,
          evidenceFor: ['Cycle time elevated'],
          evidenceAgainst: ['No MES change'],
        },
      ]);

      const hypotheses = await investigate({
        machineId: 'CNC-03',
        devPct: 15,
        signals: { vibration: 3.2 },
      });

      expect(hypotheses).toHaveLength(2);
      expect(hypotheses[0]).toEqual({
        id: 'HYP-1',
        title: 'Bearing wear',
        confidence: 80,
        evidenceFor: ['Power trending up'],
        evidenceAgainst: ['No spike'],
        sopRef: null,
      });
      expect(hypotheses[1].id).toBe('HYP-2');
    });

    it('applies defaults for missing fields in the AI response', async () => {
      mockResponseText.value = JSON.stringify([{ confidence: 42 }]);

      const hypotheses = await investigate({
        machineId: 'CNC-03',
        devPct: 15,
        signals: {},
      });

      expect(hypotheses[0].title).toBe('Hypothesis 1');
      expect(hypotheses[0].confidence).toBe(42);
      expect(hypotheses[0].evidenceFor).toEqual([]);
      expect(hypotheses[0].evidenceAgainst).toEqual([]);
    });

    it('throws when the API is unavailable (never substitutes canned content)', async () => {
      mockShouldError.value = true;

      await expect(
        investigate({ machineId: 'CNC-03', devPct: 15, signals: {} })
      ).rejects.toThrow('network down');
    });

    it('throws when the response is invalid JSON (never substitutes canned content)', async () => {
      mockResponseText.value = 'not json at all';

      await expect(
        investigate({ machineId: 'CNC-03', devPct: 15, signals: {} })
      ).rejects.toThrow('No valid JSON in response');
    });
  });

  describe('critiqueHypotheses', () => {
    const draft = [
      { id: 'HYP-1', title: 'Bearing wear', confidence: 80, evidenceFor: ['Power trending up'], evidenceAgainst: [], sopRef: 'SOP-101' },
      { id: 'HYP-2', title: 'Material variation', confidence: 60, evidenceFor: ['Cycle time elevated'], evidenceAgainst: [], sopRef: null },
    ];

    it('lowers confidence for hypotheses the review flags', async () => {
      mockResponseText.value = JSON.stringify([
        { id: 'HYP-1', confidence: 80 },
        { id: 'HYP-2', confidence: 30 },
      ]);

      const result = await critiqueHypotheses(
        { machineId: 'CNC-03', devPct: 15, signals: {} },
        draft,
        []
      );

      expect(result[0].confidence).toBe(80);
      expect(result[1].confidence).toBe(30);
      // Title/evidence are never rewritten by the critique step
      expect(result[1].title).toBe('Material variation');
    });

    it('returns the original hypotheses unchanged if the critique call fails', async () => {
      mockShouldError.value = true;

      const result = await critiqueHypotheses(
        { machineId: 'CNC-03', devPct: 15, signals: {} },
        draft,
        []
      );

      expect(result).toEqual(draft);
    });

    it('is a no-op on an empty hypothesis list', async () => {
      const result = await critiqueHypotheses({ machineId: 'CNC-03', devPct: 15, signals: {} }, [], []);
      expect(result).toEqual([]);
    });
  });

  describe('simulate', () => {
    it('parses the AI simulation response', async () => {
      mockResponseText.value = JSON.stringify({
        predictedOutcome: 'Deviation should drop below 2%',
        confidence: 85,
      });

      const result = await simulate({
        machineId: 'CNC-03',
        hypothesis: 'Bearing wear',
        action: 'Replace bearing',
      });

      expect(result).toEqual({
        action: 'Replace bearing',
        predictedOutcome: 'Deviation should drop below 2%',
        confidence: 85,
      });
    });

    it('throws when the API fails (never substitutes canned content)', async () => {
      mockShouldError.value = true;

      await expect(
        simulate({ machineId: 'CNC-03', hypothesis: 'Bearing wear', action: 'Replace bearing' })
      ).rejects.toThrow('network down');
    });
  });

  describe('verify (deterministic, no AI)', () => {
    it('passes when all metrics are within acceptable range', () => {
      const result = verify(
        { action: 'x', predictedOutcome: 'y', confidence: 70 },
        { powerDevPct: 1.5, vibrationMmS: 2.5, cycleTimeSec: 95 }
      );
      expect(result.passed).toBe(true);
      expect(result.actualOutcome).toContain('successful');
      expect(result.metrics).toEqual({
        powerDevPct: 1.5,
        vibrationMmS: 2.5,
        cycleTimeSec: 95,
      });
    });

    it('fails when power deviation exceeds 3%', () => {
      const result = verify(
        { action: 'x', predictedOutcome: 'y', confidence: 70 },
        { powerDevPct: 4.0, vibrationMmS: 2.5, cycleTimeSec: 95 }
      );
      expect(result.passed).toBe(false);
      expect(result.actualOutcome).toContain('Further action needed');
    });

    it('fails when vibration exceeds 4.5 mm/s', () => {
      const result = verify(
        { action: 'x', predictedOutcome: 'y', confidence: 70 },
        { powerDevPct: 1.0, vibrationMmS: 5.0, cycleTimeSec: 95 }
      );
      expect(result.passed).toBe(false);
    });

    it('fails when cycle time exceeds 120s', () => {
      const result = verify(
        { action: 'x', predictedOutcome: 'y', confidence: 70 },
        { powerDevPct: 1.0, vibrationMmS: 2.0, cycleTimeSec: 130 }
      );
      expect(result.passed).toBe(false);
    });

    it('treats missing metrics as zero (pass)', () => {
      const result = verify(
        { action: 'x', predictedOutcome: 'y', confidence: 70 },
        {}
      );
      expect(result.passed).toBe(true);
      expect(result.metrics).toEqual({ powerDevPct: 0, vibrationMmS: 0, cycleTimeSec: 0 });
    });
  });
});

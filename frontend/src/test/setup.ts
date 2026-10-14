import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock fetch for API calls
global.fetch = vi.fn();

// Mock EventSource for SSE
global.EventSource = vi.fn().mockImplementation(() => ({
  close: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})) as unknown as typeof EventSource;

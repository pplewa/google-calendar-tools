// Test setup file for Vitest
import { vi } from 'vitest';

// Mock Chrome APIs
Object.defineProperty(globalThis, 'chrome', {
  value: {
    runtime: {
      sendMessage: vi.fn(),
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn()
      },
      getManifest: vi.fn(() => ({ version: '1.0.0' }))
    },
    storage: {
      local: {
        get: vi.fn(),
        set: vi.fn(),
        remove: vi.fn()
      },
      sync: {
        get: vi.fn(),
        set: vi.fn(),
        remove: vi.fn()
      }
    },
    tabs: {
      query: vi.fn(),
      sendMessage: vi.fn()
    }
  },
  writable: true
});

// Mock DOM globals that might be needed
Object.defineProperty(globalThis, 'MutationObserver', {
  value: vi.fn(() => ({
    observe: vi.fn(),
    disconnect: vi.fn(),
    takeRecords: vi.fn()
  })),
  writable: true
});

// Mock console methods for testing
globalThis.console = {
  ...console,
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn()
}; 
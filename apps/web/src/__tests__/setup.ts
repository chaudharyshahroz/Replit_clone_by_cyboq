/**
 * jsdom lacks a few browser APIs that React and the menu rely on. Each stub
 * here exists because a test failed without it, not pre-emptively.
 */
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

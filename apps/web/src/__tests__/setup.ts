/**
 * jsdom lacks a few browser APIs that React and the menu rely on. Each stub
 * here exists because a test failed without it, not pre-emptively.
 */
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * jsdom implements no scrolling at all, so the chat view's auto-scroll throws
 * on an element that a real browser would happily scroll. Stubbed rather than
 * guarded in the component: the component is correct, the environment is what
 * is missing.
 */
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}

afterEach(() => {
  cleanup();
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';
import { BRAND_IMAGE_SOURCE } from '../../../../packages/build/src/design-compiler';

// Execute the actual emitted source, not a second implementation of its behavior.
const compiled = ts.transpileModule(BRAND_IMAGE_SOURCE, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const exports: Record<string, unknown> = {};
new Function('require', 'exports', compiled)((name: string) => {
  if (name === 'react') return React;
  if (name === 'react/jsx-runtime') return jsxRuntime;
  throw new Error(`Unexpected generated dependency: ${name}`);
}, exports);
const BrandImage = exports.BrandImage as React.ComponentType<{
  src: string;
  alt: string;
  role?: 'critical' | 'optional';
}>;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('compiled image runtime', () => {
  it('marks only successfully decoded images as loaded', () => {
    const { container } = render(
      <BrandImage src="/generated/coffee.png" alt="A cup of coffee" role="critical" />,
    );
    const image = screen.getByRole('img');
    expect(container.querySelector('figure')?.getAttribute('data-asset-status')).toBe('loading');
    Object.defineProperties(image, { naturalWidth: { value: 800 }, naturalHeight: { value: 600 } });
    fireEvent.load(image);
    expect(container.querySelector('figure')?.getAttribute('data-asset-status')).toBe('loaded');
  });

  it('recovers when an asset arrives after the interactive preview', () => {
    vi.useFakeTimers();
    const { container } = render(<BrandImage src="/generated/coffee.png" alt="A cup of coffee" />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByText('Image unavailable')).toBeTruthy();
    expect(container.querySelector('figure')?.getAttribute('data-asset-status')).toBe('failed');
    act(() => vi.advanceTimersByTime(15000));
    expect(screen.getByRole('img').getAttribute('src')).toBe(
      '/generated/coffee.png?rk_asset_retry=1',
    );
    expect(container.querySelector('figure')?.getAttribute('data-asset-status')).toBe('loading');
  });

  it('does not poll third-party URLs and cleans timers on unmount', () => {
    vi.useFakeTimers();
    const view = render(<BrandImage src="https://example.com/photo.jpg" alt="A cup of coffee" />);
    fireEvent.error(screen.getByRole('img'));
    expect(vi.getTimerCount()).toBe(0);
    view.rerender(<BrandImage src="/generated/new.png" alt="A new cup of coffee" />);
    fireEvent.error(screen.getByRole('img'));
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

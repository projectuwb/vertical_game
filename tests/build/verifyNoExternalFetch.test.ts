import { describe, expect, it } from 'vitest';
import { findExternalUrls } from '../../src/build/verifyNoExternalFetch.js';

describe('findExternalUrls', () => {
  it('finds nothing in ordinary same-origin bundle code', () => {
    const source = `fetch('/api/foo').then(r=>r.json());const x="/assets/icon-192.png";`;
    expect(findExternalUrls(source)).toEqual([]);
  });

  it('flags an absolute http(s) URL anywhere in the source', () => {
    const source = `fetch("https://example.com/telemetry")`;
    expect(findExternalUrls(source)).toEqual(['https://example.com/telemetry']);
  });

  it('flags every distinct occurrence, including plain http', () => {
    const source = `const a = 'http://cdn.example.com/x.js'; const b = "https://fonts.googleapis.com/css";`;
    expect(findExternalUrls(source)).toEqual([
      'http://cdn.example.com/x.js',
      'https://fonts.googleapis.com/css',
    ]);
  });

  it('does not match a bare protocol-relative or relative path', () => {
    const source = `const a = '//not-a-real-external'; const b = 'relative/path';`;
    expect(findExternalUrls(source)).toEqual([]);
  });
});

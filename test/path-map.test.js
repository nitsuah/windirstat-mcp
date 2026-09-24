import { describe, it, expect } from 'vitest';
import { createPathMapper, mapResultToHost } from '../lib/path-map.js';

describe('createPathMapper', () => {
  const drive = createPathMapper({ hostRoot: 'C:/' });

  it('is the identity when no host root is configured', () => {
    const m = createPathMapper();
    expect(m.enabled).toBe(false);
    expect(m.toContainer('C:\\Users')).toBe('C:\\Users');
    expect(m.toHost('/host-c/Users')).toBe('/host-c/Users');
  });

  it('maps Windows paths into the mount', () => {
    expect(drive.toContainer('C:\\Users\\me\\Downloads')).toBe('/host-c/Users/me/Downloads');
    expect(drive.toContainer('c:/Users/me/')).toBe('/host-c/Users/me');
    expect(drive.toContainer('C:\\')).toBe('/host-c');
    expect(drive.toContainer('C:')).toBe('/host-c');
  });

  it('leaves paths outside the host root untouched', () => {
    expect(drive.toContainer('D:\\data')).toBe('D:\\data');
    expect(drive.toContainer('/host-c/Users')).toBe('/host-c/Users');
  });

  it('maps mount paths back to Windows form', () => {
    expect(drive.toHost('/host-c/Users/me')).toBe('C:\\Users\\me');
    expect(drive.toHost('/host-c')).toBe('C:\\');
    expect(drive.toHost('/host-cx/Users')).toBe('/host-cx/Users');
    expect(drive.toHost('/tmp/x')).toBe('/tmp/x');
  });

  it('handles a narrowed host root', () => {
    const m = createPathMapper({ hostRoot: 'C:\\Users\\me\\code\\' });
    expect(m.toContainer('C:\\Users\\me\\code\\repo')).toBe('/host-c/repo');
    expect(m.toContainer('C:\\Users\\me\\codex')).toBe('C:\\Users\\me\\codex');
    expect(m.toHost('/host-c/repo')).toBe('C:\\Users\\me\\code\\repo');
    expect(m.toHost('/host-c')).toBe('C:\\Users\\me\\code\\');
  });

  it('round-trips', () => {
    expect(drive.toContainer(drive.toHost('/host-c/a/b c'))).toBe('/host-c/a/b c');
  });
});

describe('mapResultToHost', () => {
  const m = createPathMapper({ hostRoot: 'C:/' });

  it('rewrites paths inside JSON results', () => {
    const result = {
      content: [{ type: 'text', text: JSON.stringify({ target: '/host-c/Users', items: [{ path: '/host-c/Users/a', sizeMB: 1 }] }) }]
    };
    const out = JSON.parse(mapResultToHost(result, m).content[0].text);
    expect(out).toEqual({ target: 'C:\\Users', items: [{ path: 'C:\\Users\\a', sizeMB: 1 }] });
  });

  it('rewrites paths inside plain-text results', () => {
    const result = { content: [{ type: 'text', text: 'Directory not found: /host-c/Users/nope' }], isError: true };
    const out = mapResultToHost(result, m);
    expect(out.content[0].text).toBe('Directory not found: C:\\Users\\nope');
    expect(out.isError).toBe(true);
  });

  it('is a no-op when mapping is disabled', () => {
    const result = { content: [{ type: 'text', text: '/host-c/x' }] };
    expect(mapResultToHost(result, createPathMapper())).toBe(result);
  });
});

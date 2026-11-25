import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadConfig } from '../lib/config.js';

describe('loadConfig', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wds-config-'));
    fs.writeFileSync(path.join(dir, 'config.default.json'), JSON.stringify({ protectedKeywords: ['a'], tier1Keywords: ['t'] }));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('returns the shipped defaults when no override is set', () => {
    expect(loadConfig(dir, {})).toEqual({ protectedKeywords: ['a'], tier1Keywords: ['t'] });
  });

  it('returns {} when the default file is missing and no override is set', () => {
    expect(loadConfig(path.join(dir, 'nope'), {})).toEqual({});
  });

  it('merges the override over the defaults key by key', () => {
    const override = path.join(dir, 'user.json');
    fs.writeFileSync(override, JSON.stringify({ protectedKeywords: ['x', 'y'] }));
    expect(loadConfig(dir, { WINDIRSTAT_MCP_CONFIG: override })).toEqual({
      protectedKeywords: ['x', 'y'],
      tier1Keywords: ['t']
    });
  });

  it('throws when the override file is missing', () => {
    expect(() => loadConfig(dir, { WINDIRSTAT_MCP_CONFIG: path.join(dir, 'missing.json') })).toThrow(/WINDIRSTAT_MCP_CONFIG/);
  });

  it('throws when the override is not a JSON object', () => {
    const override = path.join(dir, 'list.json');
    fs.writeFileSync(override, '[1,2]');
    expect(() => loadConfig(dir, { WINDIRSTAT_MCP_CONFIG: override })).toThrow(/JSON object/);
  });
});

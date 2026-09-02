import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { pathComponents, matchesKeyword, getFolderSize, categorizeItem } from '../lib/utils.js';

describe('pathComponents', () => {
  it('splits Windows paths correctly', () => {
    expect(pathComponents('C:\\Users\\test\\folder')).toEqual(['C:', 'Users', 'test', 'folder']);
  });

  it('splits Unix paths correctly', () => {
    expect(pathComponents('/home/user/folder')).toEqual(['home', 'user', 'folder']);
  });

  it('handles mixed separators', () => {
    expect(pathComponents('C:/Users\\test/folder')).toEqual(['C:', 'Users', 'test', 'folder']);
  });

  it('filters empty segments', () => {
    expect(pathComponents('C:\\\\Users\\\\\\test')).toEqual(['C:', 'Users', 'test']);
  });
});

describe('matchesKeyword', () => {
  const PROTECTED_KEYWORDS = [
    'code project',
    'freelance',
    'downloads\\apk',
    'documents\\backup',
    'system32',
    'windows',
    'program files',
    'boot',
    '.git',
    'node_modules',
    '.vscode',
    '.idea'
  ];

  it('matches exact single-component keywords', () => {
    expect(matchesKeyword('C:\\project\\node_modules\\pkg', PROTECTED_KEYWORDS)).toBe(true);
    expect(matchesKeyword('C:\\project\\.git\\config', PROTECTED_KEYWORDS)).toBe(true);
    expect(matchesKeyword('C:\\project\\.vscode\\settings.json', PROTECTED_KEYWORDS)).toBe(true);
    expect(matchesKeyword('C:\\project\\.idea\\workspace.xml', PROTECTED_KEYWORDS)).toBe(true);
  });

  it('matches multi-segment keywords with path separators', () => {
    expect(matchesKeyword('C:\\users\\downloads\\apk\\file.apk', PROTECTED_KEYWORDS)).toBe(true);
    expect(matchesKeyword('C:\\users\\documents\\backup\\old', PROTECTED_KEYWORDS)).toBe(true);
  });

  it('matches multi-segment keywords with spaces', () => {
    expect(matchesKeyword('C:\\my code project\\src', PROTECTED_KEYWORDS)).toBe(true);
    expect(matchesKeyword('C:\\program files\\app', PROTECTED_KEYWORDS)).toBe(true);
  });

  it('does NOT match substrings of single-component keywords', () => {
    expect(matchesKeyword('C:\\project\\node\\src', PROTECTED_KEYWORDS)).toBe(false);
    expect(matchesKeyword('C:\\project\\git\\src', PROTECTED_KEYWORDS)).toBe(false);
    expect(matchesKeyword('C:\\project\\vscode\\src', PROTECTED_KEYWORDS)).toBe(false);
  });

  it('matches system paths', () => {
    expect(matchesKeyword('C:\\Windows\\System32\\drivers', PROTECTED_KEYWORDS)).toBe(true);
    expect(matchesKeyword('C:\\Program Files\\App', PROTECTED_KEYWORDS)).toBe(true);
    expect(matchesKeyword('C:\\Boot\\BCD', PROTECTED_KEYWORDS)).toBe(true);
  });
});

describe('getFolderSize', () => {
  it('calculates size of files in directory', () => {
    const testDir = fs.mkdtempSync(path.join(process.cwd(), 'test-'));

    fs.writeFileSync(path.join(testDir, 'file1.txt'), 'a'.repeat(1000));
    fs.writeFileSync(path.join(testDir, 'file2.txt'), 'b'.repeat(2000));

    const subDir = path.join(testDir, 'subdir');
    fs.mkdirSync(subDir);
    fs.writeFileSync(path.join(subDir, 'file3.txt'), 'c'.repeat(3000));

    const result = getFolderSize(testDir, 0, 3);

    expect(result.totalSize).toBe(6000);
    expect(result.fileCount).toBe(3);

    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('respects maxDepth', () => {
    const testDir = fs.mkdtempSync(path.join(process.cwd(), 'test-'));

    const level1 = path.join(testDir, 'level1');
    fs.mkdirSync(level1);
    fs.writeFileSync(path.join(level1, 'file1.txt'), 'a'.repeat(1000));

    const level2 = path.join(level1, 'level2');
    fs.mkdirSync(level2);
    fs.writeFileSync(path.join(level2, 'file2.txt'), 'b'.repeat(2000));

    const level3 = path.join(level2, 'level3');
    fs.mkdirSync(level3);
    fs.writeFileSync(path.join(level3, 'file3.txt'), 'c'.repeat(3000));

    const result = getFolderSize(testDir, 0, 2);

    expect(result.totalSize).toBe(3000);
    expect(result.fileCount).toBe(2);

    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('handles empty directories', () => {
    const testDir = fs.mkdtempSync(path.join(process.cwd(), 'test-'));

    const result = getFolderSize(testDir, 0, 3);

    expect(result.totalSize).toBe(0);
    expect(result.fileCount).toBe(0);

    fs.rmSync(testDir, { recursive: true, force: true });
  });
});

describe('categorizeItem (safety-tier categorization)', () => {
  const tier1Keywords = ['temp', 'cache', 'crashdump', 'updater', '.tmp', '.log'];
  const tier2Keywords = ['download', '.zip', '.rar', '.exe', '.msi', '.xapk', '.iso'];

  it('categorizes temp/cache as Tier 1', () => {
    expect(categorizeItem('temp', tier1Keywords, tier2Keywords)).toEqual({ tier: 1, reason: '100% Safe Cache / Temporary Files' });
    expect(categorizeItem('cache', tier1Keywords, tier2Keywords)).toEqual({ tier: 1, reason: '100% Safe Cache / Temporary Files' });
    expect(categorizeItem('crashdump', tier1Keywords, tier2Keywords)).toEqual({ tier: 1, reason: '100% Safe Cache / Temporary Files' });
    expect(categorizeItem('updater', tier1Keywords, tier2Keywords)).toEqual({ tier: 1, reason: '100% Safe Cache / Temporary Files' });
    expect(categorizeItem('file.tmp', tier1Keywords, tier2Keywords)).toEqual({ tier: 1, reason: '100% Safe Cache / Temporary Files' });
    expect(categorizeItem('app.log', tier1Keywords, tier2Keywords)).toEqual({ tier: 1, reason: '100% Safe Cache / Temporary Files' });
  });

  it('categorizes downloads/installers as Tier 2', () => {
    expect(categorizeItem('downloads', tier1Keywords, tier2Keywords)).toEqual({ tier: 2, reason: 'Reviewable Media / Downloads / Installers' });
    expect(categorizeItem('file.zip', tier1Keywords, tier2Keywords)).toEqual({ tier: 2, reason: 'Reviewable Media / Downloads / Installers' });
    expect(categorizeItem('file.rar', tier1Keywords, tier2Keywords)).toEqual({ tier: 2, reason: 'Reviewable Media / Downloads / Installers' });
    expect(categorizeItem('setup.exe', tier1Keywords, tier2Keywords)).toEqual({ tier: 2, reason: 'Reviewable Media / Downloads / Installers' });
    expect(categorizeItem('install.msi', tier1Keywords, tier2Keywords)).toEqual({ tier: 2, reason: 'Reviewable Media / Downloads / Installers' });
    expect(categorizeItem('game.xapk', tier1Keywords, tier2Keywords)).toEqual({ tier: 2, reason: 'Reviewable Media / Downloads / Installers' });
    expect(categorizeItem('disk.iso', tier1Keywords, tier2Keywords)).toEqual({ tier: 2, reason: 'Reviewable Media / Downloads / Installers' });
  });

  it('categorizes unknown as Tier 2 (User Data)', () => {
    expect(categorizeItem('documents', tier1Keywords, tier2Keywords)).toEqual({ tier: 2, reason: 'User Data / Unclassified' });
    expect(categorizeItem('photos', tier1Keywords, tier2Keywords)).toEqual({ tier: 2, reason: 'User Data / Unclassified' });
    expect(categorizeItem('projects', tier1Keywords, tier2Keywords)).toEqual({ tier: 2, reason: 'User Data / Unclassified' });
  });

  it('does not match a substring occurrence of an extension keyword mid-name', () => {
    // '.tmp' is treated as an extension keyword (matched via endsWith), so a
    // name that merely contains it should not be classified as Tier 1.
    expect(categorizeItem('app.tmpfile', tier1Keywords, tier2Keywords)).toEqual({ tier: 2, reason: 'User Data / Unclassified' });
  });

  it('ignores empty tier2 keywords instead of matching every filename', () => {
    // An empty string is a substring of everything, so blank keywords
    // (e.g. from an unset config value) must be filtered out before matching.
    expect(categorizeItem('documents', tier1Keywords, ['', ...tier2Keywords])).toEqual({ tier: 2, reason: 'User Data / Unclassified' });
  });

  it('still matches tier2 extension keywords that are not a trailing suffix', () => {
    // Tier2 keeps substring matching, unlike tier1, so ".zip" is found even
    // when it's not the very end of the name.
    expect(categorizeItem('archive.zip.old', tier1Keywords, tier2Keywords)).toEqual({ tier: 2, reason: 'Reviewable Media / Downloads / Installers' });
  });

  it('matches keywords case-insensitively regardless of config casing', () => {
    // Keywords themselves may come from config with mixed case; they must be
    // normalized the same way the filename is before comparing.
    expect(categorizeItem('archive.zip', ['TEMP', 'CACHE'], ['.ZIP'])).toEqual({ tier: 2, reason: 'Reviewable Media / Downloads / Installers' });
    expect(categorizeItem('Temp', ['TEMP', 'CACHE'], ['.ZIP'])).toEqual({ tier: 1, reason: '100% Safe Cache / Temporary Files' });
  });
});

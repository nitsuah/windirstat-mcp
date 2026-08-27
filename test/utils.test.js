import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('pathComponents', () => {
  function pathComponents(p) {
    return p.split(/[\\/]/).filter(Boolean);
  }

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

  function pathComponents(p) {
    return p.split(/[\\/]/).filter(Boolean);
  }

  function matchesKeyword(p) {
    const lower = p.toLowerCase();
    const components = pathComponents(lower);
    return PROTECTED_KEYWORDS.some(kw => {
      const kwLower = kw.toLowerCase();
      if (/[\\/\s]/.test(kwLower)) {
        return lower.includes(kwLower);
      }
      return components.includes(kwLower);
    });
  }

  it('matches exact single-component keywords', () => {
    expect(matchesKeyword('C:\\project\\node_modules\\pkg')).toBe(true);
    expect(matchesKeyword('C:\\project\\.git\\config')).toBe(true);
    expect(matchesKeyword('C:\\project\\.vscode\\settings.json')).toBe(true);
    expect(matchesKeyword('C:\\project\\.idea\\workspace.xml')).toBe(true);
  });

  it('matches multi-segment keywords with path separators', () => {
    expect(matchesKeyword('C:\\users\\downloads\\apk\\file.apk')).toBe(true);
    expect(matchesKeyword('C:\\users\\documents\\backup\\old')).toBe(true);
  });

  it('matches multi-segment keywords with spaces', () => {
    expect(matchesKeyword('C:\\my code project\\src')).toBe(true);
    expect(matchesKeyword('C:\\program files\\app')).toBe(true);
  });

  it('does NOT match substrings of single-component keywords', () => {
    expect(matchesKeyword('C:\\project\\node\\src')).toBe(false);
    expect(matchesKeyword('C:\\project\\git\\src')).toBe(false);
    expect(matchesKeyword('C:\\project\\vscode\\src')).toBe(false);
  });

  it('matches system paths', () => {
    expect(matchesKeyword('C:\\Windows\\System32\\drivers')).toBe(true);
    expect(matchesKeyword('C:\\Program Files\\App')).toBe(true);
    expect(matchesKeyword('C:\\Boot\\BCD')).toBe(true);
  });
});

describe('getFolderSize', () => {
  function getFolderSize(dirPath, currentDepth = 0, maxDepth = 3) {
    let totalSize = 0;
    let fileCount = 0;
    let lastModified = new Date(0);

    try {
      const items = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(dirPath, item.name);
        try {
          if (item.isDirectory()) {
            if (currentDepth < maxDepth) {
              const sub = getFolderSize(fullPath, currentDepth + 1, maxDepth);
              totalSize += sub.totalSize;
              fileCount += sub.fileCount;
              if (sub.lastModified > lastModified) lastModified = sub.lastModified;
            }
          } else if (item.isFile()) {
            const stats = fs.statSync(fullPath);
            totalSize += stats.size;
            fileCount++;
            if (stats.mtime > lastModified) lastModified = stats.mtime;
          }
        } catch (e) {
          // Silently skip locked files
        }
      }
    } catch (e) {
      // Silently skip inaccessible dirs
    }

    return { totalSize, fileCount, lastModified };
  }

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

describe('categorizeSafetyTiers logic', () => {
  const tier1Keywords = ['temp', 'cache', 'crashdump', 'updater', '.tmp', '.log'];
  const tier2Keywords = ['download', '.zip', '.rar', '.exe', '.msi', '.xapk', '.iso'];

  function categorizeItem(name, fullPath) {
    const lowerName = name.toLowerCase();

    if (tier1Keywords.some(kw => lowerName.includes(kw) || lowerName.endsWith(kw))) {
      return { tier: 1, reason: '100% Safe Cache / Temporary Files' };
    }
    if (tier2Keywords.some(kw => lowerName.includes(kw) || lowerName.endsWith(kw))) {
      return { tier: 2, reason: 'Reviewable Media / Downloads / Installers' };
    }
    return { tier: 2, reason: 'User Data / Unclassified' };
  }

  it('categorizes temp/cache as Tier 1', () => {
    expect(categorizeItem('temp', 'C:\\temp')).toEqual({ tier: 1, reason: '100% Safe Cache / Temporary Files' });
    expect(categorizeItem('cache', 'C:\\cache')).toEqual({ tier: 1, reason: '100% Safe Cache / Temporary Files' });
    expect(categorizeItem('crashdump', 'C:\\crashdump')).toEqual({ tier: 1, reason: '100% Safe Cache / Temporary Files' });
    expect(categorizeItem('updater', 'C:\\updater')).toEqual({ tier: 1, reason: '100% Safe Cache / Temporary Files' });
    expect(categorizeItem('file.tmp', 'C:\\file.tmp')).toEqual({ tier: 1, reason: '100% Safe Cache / Temporary Files' });
    expect(categorizeItem('app.log', 'C:\\app.log')).toEqual({ tier: 1, reason: '100% Safe Cache / Temporary Files' });
  });

  it('categorizes downloads/installers as Tier 2', () => {
    expect(categorizeItem('downloads', 'C:\\downloads')).toEqual({ tier: 2, reason: 'Reviewable Media / Downloads / Installers' });
    expect(categorizeItem('file.zip', 'C:\\file.zip')).toEqual({ tier: 2, reason: 'Reviewable Media / Downloads / Installers' });
    expect(categorizeItem('file.rar', 'C:\\file.rar')).toEqual({ tier: 2, reason: 'Reviewable Media / Downloads / Installers' });
    expect(categorizeItem('setup.exe', 'C:\\setup.exe')).toEqual({ tier: 2, reason: 'Reviewable Media / Downloads / Installers' });
    expect(categorizeItem('install.msi', 'C:\\install.msi')).toEqual({ tier: 2, reason: 'Reviewable Media / Downloads / Installers' });
    expect(categorizeItem('game.xapk', 'C:\\game.xapk')).toEqual({ tier: 2, reason: 'Reviewable Media / Downloads / Installers' });
    expect(categorizeItem('disk.iso', 'C:\\disk.iso')).toEqual({ tier: 2, reason: 'Reviewable Media / Downloads / Installers' });
  });

  it('categorizes unknown as Tier 2 (User Data)', () => {
    expect(categorizeItem('documents', 'C:\\documents')).toEqual({ tier: 2, reason: 'User Data / Unclassified' });
    expect(categorizeItem('photos', 'C:\\photos')).toEqual({ tier: 2, reason: 'User Data / Unclassified' });
    expect(categorizeItem('projects', 'C:\\projects')).toEqual({ tier: 2, reason: 'User Data / Unclassified' });
  });
});
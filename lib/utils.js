import fs from 'fs';
import path from 'path';

function pathComponents(p) {
  return p.split(/[\\/]/).filter(Boolean);
}

export function matchesKeyword(p, PROTECTED_KEYWORDS) {
  const lower = p.toLowerCase();
  const components = pathComponents(lower);
  return PROTECTED_KEYWORDS.some(kw => {
    const kwLower = kw.toLowerCase();
    // Multi-segment keywords (contain path separator or space) use substring match
    if (/[\\/\s]/.test(kwLower)) {
      return lower.includes(kwLower);
    }
    // Single-component keywords must match an exact path segment
    return components.includes(kwLower);
  });
}

export function getFolderSize(dirPath, currentDepth = 0, maxDepth = 3) {
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

<<<<<<< HEAD
export function categorizeItem(name, tier1Keywords, tier2Keywords) {
  const lowerName = name.toLowerCase();

  if (tier1Keywords.some(kw => lowerName.includes(kw) || lowerName.endsWith(kw))) {
    return { tier: 1, reason: '100% Safe Cache / Temporary Files' };
  }
  if (tier2Keywords.some(kw => lowerName.includes(kw) || lowerName.endsWith(kw))) {
=======
// Categorize an item name into a safety tier (1 = safe cache/temp,
// 2 = reviewable downloads/media/unclassified user data), based on the
// configured tier1/tier2 keyword lists. Callers are expected to check
// protection status (Tier 3) separately before falling back to this.
// A keyword starting with '.' is treated as a file extension and matched
// with endsWith; any other keyword is matched as exact or substring.
export function categorizeItem(name, tier1Keywords, tier2Keywords) {
  const lowerName = name.toLowerCase();

  // For tier1: match exact name, or endsWith for extension-like keywords (starting with .)
  if (tier1Keywords.some(kw => {
    if (kw.startsWith('.')) {
      return lowerName === kw || lowerName.endsWith(kw);
    }
    return lowerName === kw;
  })) {
    return { tier: 1, reason: '100% Safe Cache / Temporary Files' };
  }
  // For tier2: match exact name, or endsWith for extension-like keywords
  if (tier2Keywords.some(kw => {
    if (kw.startsWith('.')) {
      return lowerName === kw || lowerName.endsWith(kw);
    }
    return lowerName === kw || lowerName.includes(kw);
  })) {

    return { tier: 2, reason: 'Reviewable Media / Downloads / Installers' };
  }
  return { tier: 2, reason: 'User Data / Unclassified' };
}
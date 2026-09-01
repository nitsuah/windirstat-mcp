import fs from 'fs';
import path from 'path';

export function pathComponents(p) {
  return p.split(/[\\/]/).filter(Boolean);
}

export function matchesKeyword(p, keywords) {
  const lower = p.toLowerCase();
  const components = pathComponents(lower);
  return keywords.some(kw => {
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

export function categorizeItem(name, tier1Keywords, tier2Keywords) {
  const lowerName = name.toLowerCase();
  const normalizedTier1Keywords = (tier1Keywords || []).map(kw => kw.toLowerCase());
  const normalizedTier2Keywords = (tier2Keywords || []).map(kw => kw.toLowerCase());

  // For tier1: match exact name, or endsWith for extension-like keywords (starting with .)
  if (normalizedTier1Keywords.some(kw => {
    if (kw.startsWith('.')) {
      return lowerName === kw || lowerName.endsWith(kw);
    }
    return lowerName === kw;
  })) {
    return { tier: 1, reason: '100% Safe Cache / Temporary Files' };
  }
  // For tier2: match exact name, or endsWith for extension-like keywords
  if (normalizedTier2Keywords.some(kw => {
    if (kw.startsWith('.')) {
      return lowerName === kw || lowerName.endsWith(kw);
    }
    return lowerName === kw || lowerName.includes(kw);
  })) {
    return { tier: 2, reason: 'Reviewable Media / Downloads / Installers' };
  }
  return { tier: 2, reason: 'User Data / Unclassified' };
}
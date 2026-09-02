import fs from 'fs';
import path from 'path';

export function pathComponents(p) {
  // Normalize path separators to / for consistency
  const normalizedPath = p.replace(/[\\/]+/g, '/');
  // Split by /
  const parts = normalizedPath.split('/');
  // Handle Windows drive letter
  if (parts.length > 0 && /^[a-zA-Z]:$/.test(parts[0])) {
    // Keep drive letter as separate component
    return [parts[0], ...parts.slice(1).filter(Boolean)];
  }
  // Filter out empty segments
  return parts.filter(Boolean);

}

export function matchesKeyword(p, keywords) {
  const lower = p.toLowerCase().replace(/[\\/]+/g, '/');
  const components = pathComponents(lower);
  return (keywords || []).some(kw => {
    const kwLower = kw.toLowerCase().replace(/[\\/]+/g, '/');
    if (/[\\/\s]/.test(kwLower)) {
      return lower.includes(kwLower);
    }
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
      }
    }
  } catch (e) {
  }

  return { totalSize, fileCount, lastModified };
}

// Categorize an item name into a safety tier (1 = safe cache/temp,
// 2 = reviewable downloads/media/unclassified user data), based on the
// configured tier1/tier2 keyword lists. Callers are expected to check
// protection status (Tier 3) separately before falling back to this.
// A keyword starting with '.' is treated as a file extension.
export function categorizeItem(name, tier1Keywords, tier2Keywords) {
  const lowerName = name.toLowerCase();
  const normalizedTier1Keywords = (tier1Keywords || []).map(kw => kw.toLowerCase()).filter(Boolean);
  const normalizedTier2Keywords = (tier2Keywords || []).map(kw => kw.toLowerCase()).filter(Boolean);

  // For tier1: match exact name, or endsWith for extension-like keywords (starting with .)
  if (normalizedTier1Keywords.some(kw => {
    if (kw.startsWith('.')) {
      return lowerName === kw || lowerName.endsWith(kw);
    }
    return lowerName === kw;
  })) {
    return { tier: 1, reason: '100% Safe Cache / Temporary Files' };
  }
  // For tier2: match exact name, or substring for extension-like keywords
  // (unlike tier1, tier2 keeps substring matching so a keyword like ".zip"
  // still matches even when it's not a trailing extension, e.g. "archive.zip.old")
  if (normalizedTier2Keywords.some(kw => {
    if (kw.startsWith('.')) {
      return lowerName.includes(kw);
    }
    return lowerName === kw || lowerName.includes(kw);
  })) {
    return { tier: 2, reason: 'Reviewable Media / Downloads / Installers' };
  }
  return { tier: 2, reason: 'User Data / Unclassified' };
}

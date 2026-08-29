import fs from 'fs';
import path from 'path';

// Split a normalized path string into its individual components
export function pathComponents(p) {
  return p.split(/[\\/]/).filter(Boolean);
}

// Determine whether a (already lower-cased) path matches any of the given
// protected keywords. Multi-segment keywords (containing a path separator or
// a space) are matched as substrings; single-component keywords must match an
// exact path segment.
export function matchesKeyword(p, keywords) {
  const lower = p.toLowerCase();
  const components = pathComponents(lower);
  return keywords.some(kw => {
    const kwLower = kw.toLowerCase();
    if (/[\\/\s]/.test(kwLower)) {
      return lower.includes(kwLower);
    }
    return components.includes(kwLower);
  });
}

// Recursively compute the total size, file count, and most recent
// modification time for a directory, bounded by maxDepth.
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

// Categorize an item name into a safety tier (1 = safe cache/temp,
// 2 = reviewable downloads/media/unclassified user data), based on the
// configured tier1/tier2 keyword lists. Callers are expected to check
// protection status (Tier 3) separately before falling back to this.
// A keyword starting with '.' is treated as a file extension and matched
// with endsWith; any other keyword is matched as a substring with includes.
export function categorizeItem(name, tier1Keywords, tier2Keywords) {
  const lowerName = name.toLowerCase();

  const matchesAny = keywords => keywords.some(kw => {
    const kwLower = kw.toLowerCase();
    return kwLower.startsWith('.') ? lowerName.endsWith(kwLower) : lowerName.includes(kwLower);
  });

  if (matchesAny(tier1Keywords)) {
    return { tier: 1, reason: '100% Safe Cache / Temporary Files' };
  }
  if (matchesAny(tier2Keywords)) {
    return { tier: 2, reason: 'Reviewable Media / Downloads / Installers' };
  }
  return { tier: 2, reason: 'User Data / Unclassified' };
}

/**
 * Translate between Windows host paths and the container's mount.
 *
 * In Docker mode the host directory HOST_ROOT (e.g. `C:/`) is mounted at
 * HOST_MOUNT (default `/host-c`). Clients speak Windows paths, so incoming
 * paths are mapped into the mount and paths in results are mapped back.
 * Without HOST_ROOT (running natively) both directions are the identity.
 */

function trimTrailingSlashes(p) {
  return p.replace(/\/+$/, '');
}

export function createPathMapper({ hostRoot, mount = '/host-c' } = {}) {
  if (!hostRoot) {
    const identity = p => p;
    return { enabled: false, mount: null, toContainer: identity, toHost: identity };
  }

  // 'C:/' -> 'C:', 'C:\\Users\\me\\' -> 'C:/Users/me'
  const root = trimTrailingSlashes(hostRoot.replace(/\\/g, '/'));
  const rootLower = root.toLowerCase();
  const mnt = trimTrailingSlashes(mount);

  function toContainer(p) {
    if (typeof p !== 'string') return p;
    const normalized = p.replace(/\\/g, '/');
    const lower = normalized.toLowerCase();
    if (lower === rootLower || lower === rootLower + '/') return mnt;
    if (lower.startsWith(rootLower + '/')) {
      return mnt + '/' + trimTrailingSlashes(normalized.slice(root.length + 1));
    }
    return p;
  }

  function toHost(p) {
    if (typeof p !== 'string') return p;
    if (p !== mnt && !p.startsWith(mnt + '/')) return p;
    const rest = p.slice(mnt.length).replace(/^\/+/, '');
    const host = rest ? `${root}/${rest}` : `${root}/`;
    return host.replace(/\//g, '\\');
  }

  return { enabled: true, mount: mnt, toContainer, toHost };
}

// Map every mount path in a tool result back to its host form. JSON payloads
// are rewritten value by value; plain text (e.g. error messages) by prefix.
export function mapResultToHost(result, mapper) {
  if (!mapper.enabled || !Array.isArray(result?.content)) return result;

  const mapValue = value => {
    if (typeof value === 'string') return mapper.toHost(value);
    if (Array.isArray(value)) return value.map(mapValue);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapValue(v)]));
    }
    return value;
  };

  const escapedMount = mapper.mount.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const mountPathPattern = new RegExp(`${escapedMount}(?:/[^\\s"'\`]*)?(?![^/\\s"'\`])`, 'g');

  return {
    ...result,
    content: result.content.map(item => {
      if (item.type !== 'text' || typeof item.text !== 'string') return item;
      try {
        const parsed = JSON.parse(item.text);
        if (parsed && typeof parsed === 'object') {
          return { ...item, text: JSON.stringify(mapValue(parsed), null, 2) };
        }
      } catch {
        // Not JSON; fall through to text replacement.
      }
      return { ...item, text: item.text.replace(mountPathPattern, m => mapper.toHost(m)) };
    })
  };
}

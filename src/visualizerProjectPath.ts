import { posix } from 'node:path';

/** Normalize a URL pathname with POSIX semantics on every host before filesystem conversion. */
export function normalizeProjectUrlPath(pathname: string): string | null {
  try {
    const decoded = decodeURIComponent(pathname.replace(/^\/project\//, ''));
    if (decoded.includes('\\')) return null;
    return posix.normalize(decoded).replace(/^\/+/, '');
  } catch {
    return null;
  }
}

export function classifyProjectPath(rel: string, stateDir: string): {
  segments: string[];
  canonicalEvidence: boolean;
  canonicalSource: boolean;
} {
  const segments = rel.split('/');
  return {
    segments,
    canonicalEvidence: segments.length > 2 && segments[0] === stateDir && segments[1] === 'evidence',
    canonicalSource: segments.length > 2 && segments[0] === 'docs' && segments[1] === 'sources',
  };
}

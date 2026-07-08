function parseList(value?: string) {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeOrigin(origin: string) {
  return origin.replace(/\/+$/, '');
}

export function getAllowedCorsOrigins() {
  return Array.from(
    new Set([
      ...parseList(process.env.FRONTEND_ORIGIN || 'http://localhost:3000'),
      ...parseList(process.env.APP_URL),
    ].map(normalizeOrigin)),
  );
}

export function getAllowedCorsOriginSuffixes() {
  return parseList(process.env.FRONTEND_ORIGIN_SUFFIXES);
}

export function getAllowedCorsHostnamePatterns() {
  return parseList(process.env.FRONTEND_ORIGIN_HOSTNAME_PATTERNS || 'omnichat-saas-*.vercel.app');
}

function wildcardMatches(value: string, pattern: string) {
  const escaped = pattern
    .toLowerCase()
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(value.toLowerCase());
}

export function isAllowedCorsOrigin(
  origin: string | undefined,
  allowedOrigins = getAllowedCorsOrigins(),
  allowedSuffixes = getAllowedCorsOriginSuffixes(),
  allowedHostnamePatterns = getAllowedCorsHostnamePatterns(),
) {
  if (!origin) return true;
  const normalizedOrigin = normalizeOrigin(origin);
  const normalizedAllowedOrigins = allowedOrigins.map(normalizeOrigin);
  if (normalizedAllowedOrigins.includes('*') || normalizedAllowedOrigins.includes(normalizedOrigin)) {
    return true;
  }

  let hostname: string;
  try {
    hostname = new URL(normalizedOrigin).hostname;
  } catch {
    return false;
  }

  if (allowedSuffixes.some((suffix) => {
    const normalized = suffix.replace(/^\./, '');
    return (
      hostname === normalized ||
      hostname.endsWith(`.${normalized}`) ||
      hostname.endsWith(`-${normalized}`)
    );
  })) {
    return true;
  }

  return allowedHostnamePatterns.some((pattern) => wildcardMatches(hostname, pattern));
}

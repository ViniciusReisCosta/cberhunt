function parseList(value?: string) {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getAllowedCorsOrigins() {
  return parseList(process.env.FRONTEND_ORIGIN || 'http://localhost:3000');
}

export function getAllowedCorsOriginSuffixes() {
  return parseList(process.env.FRONTEND_ORIGIN_SUFFIXES);
}

export function isAllowedCorsOrigin(
  origin: string | undefined,
  allowedOrigins = getAllowedCorsOrigins(),
  allowedSuffixes = getAllowedCorsOriginSuffixes(),
) {
  if (!origin) return true;
  if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return true;

  let hostname: string;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    return false;
  }

  return allowedSuffixes.some((suffix) => {
    const normalized = suffix.replace(/^\./, '');
    return (
      hostname === normalized ||
      hostname.endsWith(`.${normalized}`) ||
      hostname.endsWith(`-${normalized}`)
    );
  });
}

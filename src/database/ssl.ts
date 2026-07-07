export function shouldUseDatabaseSsl() {
  const explicit = process.env.DATABASE_SSL;
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;

  const databaseUrl = process.env.DATABASE_URL || '';
  return databaseUrl.includes('amazonaws.com') || databaseUrl.includes('heroku');
}


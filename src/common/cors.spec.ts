import { getAllowedCorsOrigins, isAllowedCorsOrigin } from './cors';

describe('CORS origin validation', () => {
  it('allows exact configured origins', () => {
    expect(
      isAllowedCorsOrigin('https://app.example.com', ['https://app.example.com'], [], []),
    ).toBe(true);
  });

  it('normalizes trailing slashes in configured origins', () => {
    expect(
      isAllowedCorsOrigin('https://app.example.com', ['https://app.example.com/'], [], []),
    ).toBe(true);
  });

  it('includes APP_URL as an allowed origin', () => {
    process.env.FRONTEND_ORIGIN = 'https://frontend.example.com';
    process.env.APP_URL = 'https://app.example.com';

    expect(getAllowedCorsOrigins()).toEqual([
      'https://frontend.example.com',
      'https://app.example.com',
    ]);
  });

  it('allows configured preview suffixes', () => {
    expect(
      isAllowedCorsOrigin(
        'https://omnichat-saas-ngsffawuk-viniciureis-projects.vercel.app',
        [],
        ['viniciureis-projects.vercel.app'],
        [],
      ),
    ).toBe(true);
  });

  it('allows project Vercel aliases by hostname pattern', () => {
    expect(
      isAllowedCorsOrigin(
        'https://omnichat-saas-rouge.vercel.app',
        [],
        [],
        ['omnichat-saas-*.vercel.app'],
      ),
    ).toBe(true);
  });

  it('rejects unknown origins without throwing', () => {
    expect(isAllowedCorsOrigin('https://unknown.example.com', [], [], [])).toBe(false);
  });
});

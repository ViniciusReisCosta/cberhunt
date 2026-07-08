import { isAllowedCorsOrigin } from './cors';

describe('CORS origin validation', () => {
  it('allows exact configured origins', () => {
    expect(
      isAllowedCorsOrigin('https://app.example.com', ['https://app.example.com'], []),
    ).toBe(true);
  });

  it('allows configured preview suffixes', () => {
    expect(
      isAllowedCorsOrigin(
        'https://omnichat-saas-ngsffawuk-viniciureis-projects.vercel.app',
        [],
        ['viniciureis-projects.vercel.app'],
      ),
    ).toBe(true);
  });

  it('rejects unknown origins without throwing', () => {
    expect(isAllowedCorsOrigin('https://unknown.example.com', [], [])).toBe(false);
  });
});

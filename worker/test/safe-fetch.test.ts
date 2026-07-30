import { fetchMock } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fetchWithTimeout, isPrivateHost, safeTarget } from '../src/safe-fetch';

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

describe('isPrivateHost', () => {
  // These four passed the old regex. IPv4-mapped IPv6 is the dangerous one:
  // the URL parser rewrites ::ffff:127.0.0.1 to ::ffff:7f00:1, which no longer
  // looks like loopback to a textual match.
  it.each([
    ['[::ffff:127.0.0.1]', 'IPv4-mapped loopback'],
    ['[::ffff:7f00:1]', 'IPv4-mapped loopback, normalized'],
    ['[::ffff:169.254.169.254]', 'IPv4-mapped cloud metadata'],
    ['[::ffff:a9fe:a9fe]', 'IPv4-mapped cloud metadata, normalized'],
    ['[::]', 'unspecified address'],
    ['100.64.1.1', 'CGNAT 100.64/10'],
    ['100.127.255.255', 'CGNAT upper bound'],
  ])('blocks %s (%s)', (host) => {
    expect(isPrivateHost(host)).toBe(true);
  });

  it.each([
    ['localhost'],
    ['foo.internal'],
    ['printer.local'],
    ['127.0.0.1'],
    ['10.0.0.1'],
    ['192.168.1.1'],
    ['169.254.169.254'],
    ['172.16.0.1'],
    ['172.31.255.255'],
    ['0.0.0.0'],
    ['[::1]'],
    ['[fc00::1]'],
    ['[fd12:3456::1]'],
    ['[fe80::1]'],
    ['[64:ff9b::7f00:1]'],
    ['224.0.0.1'],
  ])('keeps blocking %s', (host) => {
    expect(isPrivateHost(host)).toBe(true);
  });

  it.each([
    ['example.com'],
    ['8.8.8.8'],
    ['1.1.1.1'],
    ['100.63.255.255'],
    ['100.128.0.1'],
    ['172.15.0.1'],
    ['172.32.0.1'],
    ['[2606:4700::1111]'],
    ['feeds.megaphone.fm'],
    ['localhost.example.com'],
  ])('allows public host %s', (host) => {
    expect(isPrivateHost(host)).toBe(false);
  });
});

describe('safeTarget', () => {
  it('rejects the bypasses through the public entry point', () => {
    expect(safeTarget('http://[::ffff:169.254.169.254]/latest/meta-data/')).toBeNull();
    expect(safeTarget('http://100.64.1.1/')).toBeNull();
    expect(safeTarget('http://[::]/')).toBeNull();
  });

  it('still rejects non-http schemes and embedded credentials', () => {
    expect(safeTarget('file:///etc/passwd')).toBeNull();
    expect(safeTarget('gopher://example.com/')).toBeNull();
    expect(safeTarget('https://user:pass@example.com/')).toBeNull();
    expect(safeTarget(undefined)).toBeNull();
  });

  it('accepts an ordinary feed url', () => {
    expect(safeTarget('https://feeds.simplecast.com/abc')?.hostname).toBe('feeds.simplecast.com');
  });
});

describe('fetchWithTimeout redirect handling', () => {
  it('rejects a 302 that points at a private target', async () => {
    fetchMock
      .get('https://redir.example.com')
      .intercept({ path: '/start' })
      .reply(302, '', { headers: { location: 'http://169.254.169.254/' } });
    await expect(fetchWithTimeout('https://redir.example.com/start', 5000)).rejects.toThrow(
      'unsafe redirect',
    );
  });

  it('follows a 302 to a valid https host and returns the final body', async () => {
    fetchMock
      .get('https://redir.example.com')
      .intercept({ path: '/start' })
      .reply(302, '', { headers: { location: 'https://final.example.com/audio' } });
    fetchMock
      .get('https://final.example.com')
      .intercept({ path: '/audio' })
      .reply(200, 'FINAL-BODY', { headers: { 'content-type': 'audio/mpeg' } });
    const res = await fetchWithTimeout('https://redir.example.com/start', 5000);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('FINAL-BODY');
  });

  it('rejects a redirect chain longer than 3 hops', async () => {
    const origin = fetchMock.get('https://chain.example.com');
    origin
      .intercept({ path: '/1' })
      .reply(302, '', { headers: { location: 'https://chain.example.com/2' } });
    origin
      .intercept({ path: '/2' })
      .reply(302, '', { headers: { location: 'https://chain.example.com/3' } });
    origin
      .intercept({ path: '/3' })
      .reply(302, '', { headers: { location: 'https://chain.example.com/4' } });
    origin
      .intercept({ path: '/4' })
      .reply(302, '', { headers: { location: 'https://chain.example.com/5' } });
    await expect(fetchWithTimeout('https://chain.example.com/1', 5000)).rejects.toThrow(
      'too many redirects',
    );
  });

  it('resolves a relative Location against the current url and follows it', async () => {
    const origin = fetchMock.get('https://rel.example.com');
    origin.intercept({ path: '/start' }).reply(302, '', { headers: { location: '/next' } });
    origin.intercept({ path: '/next' }).reply(200, 'REL-BODY');
    const res = await fetchWithTimeout('https://rel.example.com/start', 5000);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('REL-BODY');
  });
});

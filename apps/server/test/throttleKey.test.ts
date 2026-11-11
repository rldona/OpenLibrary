import { describe, expect, it } from 'vitest';
import { throttleKey } from '../src/auth/throttleKey.js';

describe('throttleKey', () => {
  it('keeps an IPv4 address as it is', () => {
    expect(throttleKey('203.0.113.7')).toBe('203.0.113.7');
  });

  it('reduces an IPv6 address to its /64 prefix, whatever the notation', () => {
    const key = '2001:db8:1:2::/64';
    expect(throttleKey('2001:db8:1:2::1')).toBe(key);
    expect(throttleKey('2001:0db8:0001:0002:abcd:ef01:2345:6789')).toBe(key);
    expect(throttleKey('2001:DB8:1:2:FFFF::')).toBe(key);
    expect(throttleKey('2001:db8:1:3::1')).toBe('2001:db8:1:3::/64');
    expect(throttleKey('::1')).toBe('0:0:0:0::/64');
    expect(throttleKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
  });

  it('treats IPv4-mapped IPv6 as the IPv4 address', () => {
    expect(throttleKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(throttleKey('::ffff:cb00:7107')).toBe('203.0.113.7');
  });

  it('returns anything that is not an address unchanged', () => {
    expect(throttleKey('unknown')).toBe('unknown');
    expect(throttleKey('')).toBe('');
  });
});

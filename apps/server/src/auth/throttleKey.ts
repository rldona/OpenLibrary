import { isIPv4, isIPv6 } from 'node:net';

/**
 * The key the login protections count by (lockout, admission gate, known addresses). An IPv4
 * address is its own key. An IPv6 client normally controls a whole /64 (one home, one server), so
 * every IPv6 address counts as its /64 prefix: an attacker cannot get a fresh budget by switching
 * addresses inside it. IPv4-mapped IPv6 (`::ffff:a.b.c.d`) is the IPv4 address. Logs keep the full
 * address; anything that is not an IP address is returned as it is.
 */
export function throttleKey(ip: string): string {
  const address = ip.trim().toLowerCase().replace(/%.*$/, ''); // drop a zone id (fe80::1%eth0)
  if (isIPv4(address)) return address;
  if (!isIPv6(address)) return ip;
  const groups = expand(address);
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return [groups[6]! >> 8, groups[6]! & 255, groups[7]! >> 8, groups[7]! & 255].join('.');
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(':')}::/64`;
}

/** The eight 16-bit groups of a valid IPv6 address (with `::` and a trailing dotted IPv4 resolved). */
function expand(address: string): number[] {
  let text = address;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted[1]!.split('.').map(Number) as [number, number, number, number];
    text =
      text.slice(0, -dotted[1]!.length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split('::') as [string, string | undefined];
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const missing = tail === undefined ? 0 : 8 - left.length - right.length;
  return [...left, ...Array<string>(missing).fill('0'), ...right].map((g) => parseInt(g, 16));
}

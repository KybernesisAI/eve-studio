/** Parse `major.minor.patch` (pre-release/build suffixes ignored). */
function parse(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Compare two semver strings: negative when `a < b`, 0 when equal, positive when `a > b`. */
export function compareSemver(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  if (!(pa && pb)) {
    return 0;
  }
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) {
      return pa[i] - pb[i];
    }
  }
  return 0;
}

/** True when `latest` is a strictly newer release than `installed` (both known). */
export function isNewerVersion(
  latest: string | null | undefined,
  installed: string | null | undefined,
): boolean {
  if (!(latest && installed)) {
    return false;
  }
  return compareSemver(latest, installed) > 0;
}

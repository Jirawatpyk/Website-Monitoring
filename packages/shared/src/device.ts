/**
 * A signed-in device as the Profile and Security boards name it: "Chrome · macOS", "Safari · iPhone",
 * tagged Phone or Laptop (D-062 item 12). Read from the session's User-Agent, which the web app forwards
 * to Supabase Auth; a session made before that (Auth recorded "node") or by a script is "Unknown device".
 * Order matters: Edge and Opera carry "Chrome", Chrome carries "Safari", iPad and Android carry "Mobile".
 */
export interface DeviceLabel {
  name: string;
  tag: 'Phone' | 'Tablet' | 'Laptop' | null;
}

const BROWSERS: readonly [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\b(?:OPR|Opera)\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/\b(?:Chrome|CriOS|Chromium)\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
];

const SYSTEMS: readonly [RegExp, string, DeviceLabel['tag']][] = [
  [/\biPhone\b/, 'iPhone', 'Phone'],
  [/\biPad\b/, 'iPad', 'Tablet'],
  [/\bAndroid\b.*\bMobile\b/, 'Android', 'Phone'],
  [/\bAndroid\b/, 'Android', 'Tablet'],
  [/\bWindows\b/, 'Windows', 'Laptop'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS', 'Laptop'],
  [/\bCrOS\b/, 'ChromeOS', 'Laptop'],
  [/\bLinux\b/, 'Linux', 'Laptop'],
];

const UNKNOWN: DeviceLabel = { name: 'Unknown device', tag: null };

export function deviceLabel(userAgent: string | null | undefined): DeviceLabel {
  if (!userAgent || !/^Mozilla\//.test(userAgent)) return UNKNOWN;
  const browser = BROWSERS.find(([re]) => re.test(userAgent))?.[1];
  const system = SYSTEMS.find(([re]) => re.test(userAgent));
  if (!browser && !system) return UNKNOWN;
  return {
    name: [browser ?? 'Browser', system?.[1]].filter(Boolean).join(' · '),
    tag: system?.[2] ?? null,
  };
}

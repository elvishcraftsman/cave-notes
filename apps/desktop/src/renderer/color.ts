/**
 * Accent colours. Each family has five shades, light to dark. A workspace's accent is stored as one #rrggbb
 * (a named family is stored as its middle shade); any other colour gets five shades made from it.
 */
export const ACCENT_FAMILIES: Array<{ name: string; shades: [string, string, string, string, string] }> = [
  { name: "Blue", shades: ["#99C1F1", "#62A0EA", "#3584E4", "#1C71D8", "#1A5FB4"] },
  { name: "Green", shades: ["#8FF0A4", "#57E389", "#33D17A", "#2EC27E", "#26A269"] },
  { name: "Yellow", shades: ["#F9F06B", "#F8E45C", "#F6D32D", "#F5C211", "#E5A50A"] },
  { name: "Orange", shades: ["#FFBE6F", "#FFA348", "#FF7800", "#E66100", "#C64600"] },
  { name: "Red", shades: ["#F66151", "#ED333B", "#E01B24", "#C01C28", "#A51D2D"] },
  { name: "Purple", shades: ["#DC8ADD", "#C061CB", "#9141AC", "#813D9C", "#613583"] },
  { name: "Brown", shades: ["#CDAB8F", "#B5835A", "#986A44", "#865E3C", "#63452C"] }
];

type Theme = 'dark' | 'light';
type RGB = [number, number, number];

const parse = (hex: string): RGB | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (c: RGB): string => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** The value stored for a family: its middle shade. */
export const familyColor = (f: (typeof ACCENT_FAMILIES)[number]): string => f.shades[2].toLowerCase();

/** The family a stored colour belongs to (any of its shades), if any. */
export function familyOf(hex: string | null | undefined): (typeof ACCENT_FAMILIES)[number] | null {
  if (!hex) return null;
  const h = hex.toLowerCase();
  return ACCENT_FAMILIES.find((f) => f.shades.some((s) => s.toLowerCase() === h)) ?? null;
}

/** Five shades, light to dark, for a stored colour. */
export function shadesOf(hex: string): string[] {
  const fam = familyOf(hex);
  if (fam) return [...fam.shades];
  const c = parse(hex);
  if (!c) return [];
  const white: RGB = [255, 255, 255];
  const black: RGB = [0, 0, 0];
  return [toHex(mix(c, white, 0.4)), toHex(mix(c, white, 0.2)), toHex(c), toHex(mix(c, black, 0.18)), toHex(mix(c, black, 0.36))];
}

const lin = (v: number): number => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string): number => {
  const c = parse(hex);
  return c ? 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]) : 0;
};
/** Text colour that reads on a background. */
export const textOn = (bg: string): string => (luminance(bg) > 0.34 ? '#1d1d1f' : '#ffffff');

export interface AccentRoles {
  /** the title bar: the darkest shade (the lightest in light mode) */
  header: string;
  headerFg: string;
  /** the shown tab, the pressed buttons of the title bar, and highlights: the fourth shade (one darker than the middle) */
  active: string;
  activeFg: string;
  /** tabs that are not shown: same as the title bar */
  idle: string;
  idleFg: string;
  /** accent-coloured text and outlines on the window background */
  text: string;
}

/** What each part of the window takes from an accent colour. */
export function accentRoles(theme: Theme, accent: string | null | undefined): AccentRoles | null {
  if (!accent) return null;
  const s = shadesOf(accent);
  if (s.length !== 5) return null;
  const edge = theme === 'dark' ? s[4]! : s[0]!;
  return {
    header: edge,
    headerFg: textOn(edge),
    active: s[3]!,
    activeFg: textOn(s[3]!),
    idle: edge,
    idleFg: textOn(edge),
    text: theme === 'dark' ? s[0]! : s[3]!,
  };
}

/** Inline CSS variables for one tab. */
export function tabVars(theme: Theme, accent: string | null | undefined, active: boolean): Record<string, string> | undefined {
  const r = accentRoles(theme, accent);
  if (!r) return undefined;
  return active ? { '--tab-bg': r.active, '--tab-fg': r.activeFg } : { '--tab-bg': r.idle, '--tab-fg': r.idleFg };
}

/** Colour of the title bar for a workspace accent, or null (the theme's own). */
export const headerColorFor = (theme: Theme, accent: string | null | undefined): string | null => accentRoles(theme, accent)?.header ?? null;

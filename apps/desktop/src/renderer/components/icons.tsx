import type { JSX } from 'preact';
import { LUCIDE, LUCIDE_TAGS } from './lucide';

/** Simple symbolic icons in the spirit of Adwaita's: 16px grid, 1.5px strokes, currentColor. */
const PATHS: Record<string, string> = {
  'sidebar-left': 'M2.5 3.5h11v9h-11z M6.5 3.5v9',
  'sidebar-right': 'M2.5 3.5h11v9h-11z M9.5 3.5v9',
  plus: 'M8 3v10 M3 8h10',
  menu: 'M2.5 4h11 M2.5 8h11 M2.5 12h11',
  sun: 'M8 5.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z M8 1.5v1.6 M8 12.9v1.6 M1.5 8h1.6 M12.9 8h1.6 M3.4 3.4l1.1 1.1 M11.5 11.5l1.1 1.1 M3.4 12.6l1.1-1.1 M11.5 4.5l1.1-1.1',
  moon: 'M13 9.6A5.6 5.6 0 0 1 6.4 3 5.6 5.6 0 1 0 13 9.6z',
  chevron: 'M6 3.5L10.5 8 6 12.5',
  page: 'M4 1.8h5.2L12 4.6v9.6H4z M9 1.8v3h3',
  folder: 'M2 4.2h4l1.4 1.6H14v6.6H2z',
  link: 'M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7l-.8.8 M9.2 6.8a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 0 0 3.7 3.7l.8-.8',
  file: 'M4 1.8h5.2L12 4.6v9.6H4z M6 8.2h4 M6 10.6h4',
  globe: 'M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8z M1.8 8h12.4 M8 1.8c2 1.8 2 10.6 0 12.4 M8 1.8c-2 1.8-2 10.6 0 12.4',
  back: 'M13 8H3.5 M7 4.5L3.5 8 7 11.5',
  outline: 'M2.5 4h2 M6.5 4h7 M4.5 8h2 M8.5 8h5 M4.5 12h2 M8.5 12h5',
  warning: 'M8 2.2L14.4 13H1.6z M8 6.4v3 M8 11.1v.1',
  close: 'M3.8 3.8l8.4 8.4 M12.2 3.8l-8.4 8.4',
  undo: 'M4.2 6.2h5.1a3.2 3.2 0 0 1 0 6.4H6 M6.6 3.6L4 6.2l2.6 2.6',
  redo: 'M11.8 6.2H6.7a3.2 3.2 0 0 0 0 6.4H10 M9.4 3.6L12 6.2 9.4 8.8',
  history: 'M2.6 8a5.4 5.4 0 1 0 1.7-3.9 M2.4 2.6v2.7h2.7 M8 5.2v3l2.1 1.3',
  help: 'M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8z M6.2 6.3a1.9 1.9 0 1 1 2.7 1.7c-.6.3-.9.7-.9 1.3 M8 11.4v.1',
  refresh: 'M13 8a5 5 0 1 1-1.6-3.7 M13 2.6v2.8h-2.8',
  trash: 'M3.2 4.5h9.6 M6.2 4.5V3h3.6v1.5 M4.4 4.5l.6 9h6l.6-9',
  rename: 'M3 13l.5-2.8 7.2-7.2 2.3 2.3-7.2 7.2z M9.6 4.1l2.3 2.3',
  check: 'M3 8.5l3.2 3.2L13 4.8',
  download: 'M8 2.5v7.5 M4.8 7.2L8 10.4l3.2-3.2 M3 13h10',
  copy: 'M5.5 5.5h7.5v8h-7.5z M3 10.5V2.5h7.5',
  search: 'M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z M10.4 10.4L13.5 13.5',
  table: 'M2.5 3.5h11v9h-11z M2.5 7h11 M7 3.5v9',
  list: 'M5.5 4.5h8 M5.5 8h8 M5.5 11.5h8 M2.5 4.5h.1 M2.5 8h.1 M2.5 11.5h.1',
  gallery: 'M2.5 2.5h4.5v4.5h-4.5z M9 2.5h4.5v4.5h-4.5z M2.5 9h4.5v4.5h-4.5z M9 9h4.5v4.5h-4.5z',
  board: 'M2.5 2.5h3v11h-3z M6.5 2.5h3v7h-3z M10.5 2.5h3v9h-3z',
  calendar: 'M2.5 3.5h11v10h-11z M2.5 6.5h11 M5.5 2v3 M10.5 2v3',
  filter: 'M2 3.5h12L9.5 8.5v4l-3 1.5V8.5z',
  code: 'M5.5 4.5L2 8l3.5 3.5 M10.5 4.5L14 8l-3.5 3.5',
  pin: 'M10 2.2l3.8 3.8-1.6.5-2.6 2.6.2 2.7-.9.9-6-6 .9-.9 2.7.2 2.6-2.6z M5.2 10.8L2.2 13.8',
  sort: 'M5 3v10 M2.5 10.5L5 13l2.5-2.5 M11 13V3 M8.5 5.5L11 3l2.5 2.5',
  'chevron-down': 'M3.5 6L8 10.5 12.5 6',
  keyboard: 'M2 4.5h12v7H2z M4.5 7h.1 M7 7h.1 M9.5 7h.1 M12 7h.1 M5 9.5h6',
  book: 'M3 2.5h8.5A1.5 1.5 0 0 1 13 4v9.5H4.5A1.5 1.5 0 0 1 3 12z M3 12a1.5 1.5 0 0 1 1.5-1.5H13',
  star: 'M8 1.8l1.9 4 4.3.5-3.2 3 .9 4.3L8 11.4l-3.9 2.2.9-4.3-3.2-3 4.3-.5z',
  heart: 'M8 13.5S2 9.8 2 6a3 3 0 0 1 6-.8A3 3 0 0 1 14 6c0 3.8-6 7.5-6 7.5z',
  home: 'M2 8L8 2.5 14 8 M3.5 7v6.5h9V7 M6.5 13.5v-4h3v4',
  briefcase: 'M2 5h12v8H2z M5.5 5V3h5v2 M2 8.5h12',
  flask: 'M6 2h4 M6.5 2v4.5L2.8 12.6a1 1 0 0 0 .9 1.4h8.6a1 1 0 0 0 .9-1.4L9.5 6.5V2 M4.5 10h7',
  bulb: 'M8 1.8a4.2 4.2 0 0 0-2.4 7.6c.5.4.8 1 .8 1.6v.5h3.2V11c0-.6.3-1.2.8-1.6A4.2 4.2 0 0 0 8 1.8z M6.5 13.2h3 M7 14.6h2',
  leaf: 'M13.5 2.5C7 2.5 3 5 3 9.5c0 1.2.4 2.2 1 3 M13.5 2.5c0 6-2.5 10-8.5 10.5 M3 14l4-4',
  flame: 'M8 1.8c.4 2.4 3.8 4 3.8 7.4a3.8 3.8 0 0 1-7.6 0c0-1.6.8-2.6 1.6-3.4.2 1 .6 1.5 1.1 1.7C6.6 5.6 7 3.6 8 1.8z',
  bolt: 'M9 1.8L3.5 9H8l-1 5.2L12.5 7H8z',
  bookmark: 'M4 2h8v12l-4-3-4 3z',
  tag: 'M2.5 2.5h5.6l5.4 5.4-5.6 5.6L2.5 8.1z M5.5 5.5h.1',
  key: 'M5.5 3.8a2.7 2.7 0 1 0 .1 0z M7.4 8.2l6.1 5.6 M11.2 11.9l1.6-1.6',
  flag: 'M3.5 14V2.5 M3.5 3h8.5l-1.7 2.8L12 8.6H3.5',
  cloud: 'M4.5 12.5a3 3 0 0 1-.4-6 4 4 0 0 1 7.7 1 2.6 2.6 0 0 1-.3 5z',
  templates: 'M3 2.5h10v3H3z M3 8h4.5v5.5H3z M10 8h3 M10 10.5h3 M10 13h3',
  cave: 'M1.5 13.5V8.2C1.5 4.4 4.4 2 8 2s6.5 2.4 6.5 6.2v5.3 M5 13.5V9.6c0-1.6 1.3-2.8 3-2.8s3 1.2 3 2.8v3.9',
};

export type IconName = keyof typeof PATHS;

/**
 * The icons a workspace can wear on its tab: the whole Lucide set (see lucide.ts) and the app's own `cave`. Names saved
 * by older versions (`bulb`, `home` ...) keep working: they are looked up in the app's own icons when Lucide has none.
 */
const SUGGESTED: string[] = [
  'cave', 'house', 'book', 'book-open', 'notebook', 'folder', 'file-text', 'library', 'scroll-text', 'bookmark', 'star', 'heart', 'briefcase', 'graduation-cap',
  'flask-conical', 'lightbulb', 'brain', 'atom', 'microscope', 'telescope', 'compass', 'map', 'globe', 'landmark', 'church', 'cross', 'wheat', 'feather', 'crown',
  'leaf', 'tree-pine', 'mountain', 'sun', 'moon', 'droplet', 'flame', 'zap', 'cloud', 'sparkles', 'palette', 'camera', 'music-4', 'coffee', 'utensils', 'gift',
  'rocket', 'target', 'trophy', 'shield', 'key-round', 'flag', 'tag', 'pin', 'link', 'code', 'terminal', 'database', 'cpu', 'wrench', 'hammer', 'users',
  'message-circle', 'mail', 'bell', 'clock', 'hourglass', 'calendar', 'kanban', 'archive', 'inbox', 'wallet', 'shopping-cart', 'plane', 'car', 'bike', 'anchor',
];
export const WORKSPACE_ICONS: string[] = SUGGESTED.filter((n) => n === 'cave' || n in LUCIDE);

/** Every icon a workspace can wear, by name, for the picker. */
export const ALL_WORKSPACE_ICONS: string[] = ['cave', ...Object.keys(LUCIDE).sort()];

/** Icons whose name or search words contain every word typed. */
export function searchIcons(query: string): string[] {
  const words = query.toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (words.length === 0) return WORKSPACE_ICONS;
  return ALL_WORKSPACE_ICONS.filter((n) => {
    const hay = `${n.replace(/-/g, ' ')} ${LUCIDE_TAGS[n] ?? ''}`;
    return words.every((w) => hay.includes(w));
  });
}

export const isIconName = (n: string | null | undefined): n is string => !!n && (n in LUCIDE || n in PATHS);

/** An icon a workspace wears on its tab (any name isIconName accepts). */
export function WorkspaceIcon({ name, size = 16, class: cls, style }: { name: string; size?: number; class?: string; style?: JSX.CSSProperties }): JSX.Element {
  const lucide = name in LUCIDE;
  return (
    <svg
      class={`icon ${cls ?? ''}`}
      width={size}
      height={size}
      viewBox={lucide ? '0 0 24 24' : '0 0 16 16'}
      fill="none"
      stroke="currentColor"
      stroke-width={lucide ? 2 : 1.5}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={lucide ? LUCIDE[name]! : PATHS[name]} />
    </svg>
  );
}

/** An icon of the app's own set (16px grid), or, when the name is not in it, the Lucide icon of that name (24px grid). */
export function Icon({ name, size = 16, class: cls, style }: { name: IconName; size?: number; class?: string; style?: JSX.CSSProperties }): JSX.Element {
  const own = name in PATHS;
  return (
    <svg
      class={`icon ${cls ?? ''}`}
      width={size}
      height={size}
      viewBox={own ? '0 0 16 16' : '0 0 24 24'}
      fill="none"
      stroke="currentColor"
      stroke-width={own ? 1.5 : 2}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={own ? PATHS[name] : LUCIDE[name]} />
    </svg>
  );
}

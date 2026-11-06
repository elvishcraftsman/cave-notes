/** Word lists are bundled as text (see build.mjs). */
declare module '*.txt' {
  const text: string;
  export default text;
}

/** The app's version, put in by the build (see build.mjs). */
declare const __APP_VERSION__: string | undefined;

/** The synonym word list of @cave-notes/thesaurus, bundled as text. */
declare module '@cave-notes/thesaurus/data' {
  const text: string;
  export default text;
}

// UTF-8 helpers that behave the same with and without Node's Buffer (a WebView has no Buffer).
const encoder = new TextEncoder();
// ignoreBOM: true keeps a leading byte-order mark in the text, as Buffer.toString('utf8') and fs.readFile(…, 'utf8') do.
const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

/** The UTF-8 bytes of a string. */
export const utf8Bytes = (text) => encoder.encode(text);
/** How many bytes a string takes in UTF-8. */
export const utf8Length = (text) => encoder.encode(text).length;
/** Text from UTF-8 bytes; invalid sequences become U+FFFD (so re-encoding differs from the input), and a BOM is kept. */
export const utf8Text = (bytes) => decoder.decode(bytes);
/** Whether two byte arrays hold the same bytes. */
export function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

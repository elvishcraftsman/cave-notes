import { Thesaurus } from '@cave-notes/thesaurus';
// the word list is part of the script (esbuild's text loader); it is turned into a lookup table the first time a word is looked up
import data from '@cave-notes/thesaurus/data';

let thesaurus: Thesaurus | null = null;

/** Synonyms for a word in its own form and capitals, or null when the word is not worth a menu. */
export function lookupSynonyms(word: string): string[] | null {
  thesaurus ??= new Thesaurus(data);
  return thesaurus.lookup(word);
}

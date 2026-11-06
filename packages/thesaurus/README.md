# @cave-notes/thesaurus

Synonyms for the editor's right-click menu. `data/thesaurus.txt` (about 40,000 words, 3 MB) is plain text, one line per word: `word:synonym,synonym,...`, best first. The first line, `#v:...`, lists the words that are verbs, so that "walking" can be inflected from "walk".

`Thesaurus.lookup(word)` returns synonyms in the word's own capitals and, for regular verb, plural and adverb forms, its own ending, or `null` for articles, prepositions and other small words, numbers and unknown words.

## Where the data comes from

| Source | Licence | Used for |
|---|---|---|
| WordNet 3.0, Princeton University | WordNet License (notice must accompany copies: `apps/desktop/assets/licenses/wordnet-LICENSE.txt`) | synonyms by meaning, commonest meaning first |
| Moby Thesaurus II, Grady Ward | public domain (`apps/desktop/assets/licenses/moby-NOTICE.txt`) | a much larger list of related words, ranked and trimmed |

Each word's candidates are the union of both sources. A candidate scores higher when WordNet lists it (more, the earlier its meaning), when Moby lists the word and the candidate in each other's entries, when the two entries overlap, and when both sources agree. Phrases, hyphenated terms, capitalised words and Moby terms that are not common words (Moby Words II `COMMON.TXT`) are left out; each word keeps its best 12.

## Rebuilding the data

```
git clone --depth 1 https://github.com/elitejake/Moby-Project        # the Moby files
npm pack wordnet-db && tar xzf wordnet-db-*.tgz                       # WordNet's dict/ folder
node scripts/build-data.mjs "Moby-Project/Moby Thesaurus II/mthesaur.txt" \
  "Moby-Project/Moby Words II/COMMON.TXT" package/dict
```

The result is committed; the sources are not.

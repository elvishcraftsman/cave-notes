/** Everything except the file-based history: safe to bundle for a browser or renderer. */
export { hunks, matchPairs, merge3 } from './diff.js';
export { CONFLICT_CLOSE, CONFLICT_MID, CONFLICT_OPEN, commonLines, lineDistance, mergeDocuments, pickBase, splitFrontmatter, textChanges } from './merge.js';
export { conflictOriginal, isConflictName } from './names.js';

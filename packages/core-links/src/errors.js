/**
 * Error codes:
 *  STALE          - a file changed between planning and applying (nothing was modified)
 *  APPLY_FAILED   - writing edits or moving failed; every change was rolled back
 *  UNDO_CONFLICT  - files were edited since the move; pass { force: true } to undo the rest
 *  NO_JOURNAL     - nothing to undo
 *  BAD_PLAN       - the plan is malformed or belongs to a different workspace
 */
export class LinksError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LinksError';
    this.code = code;
    this.details = details;
  }
}

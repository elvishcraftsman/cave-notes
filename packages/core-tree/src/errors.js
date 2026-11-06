/**
 * Error codes:
 *  INVALID_NAME    - a page name is empty, hidden, or contains forbidden characters
 *  INVALID_PATH    - a page path is malformed (absolute, `..`, hidden or ignored segment, no .md)
 *  NOT_FOUND       - the page (or its parent) does not exist
 *  EXISTS          - the page already exists
 *  COLLISION       - a sibling with the same name (case-insensitive) already exists
 *  MOVE_INTO_SELF  - tried to move a page into itself or one of its descendants
 *  HAS_CHILDREN    - tried to delete a page that has children without `recursive: true`
 *  IO_ERROR        - a filesystem operation failed (any partial work was rolled back)
 */
export class TreeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TreeError';
    this.code = code;
    this.details = details;
  }
}

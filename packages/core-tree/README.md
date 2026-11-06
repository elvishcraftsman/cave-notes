# @cave-notes/core-tree

Page/folder hierarchy for Markdown workspaces. No dependencies, no Electron, Node >= 20.

A page `Foo.md` keeps its children in a sibling folder `Foo/`. A folder with no matching `.md` is a **virtual page**.
Page paths are workspace-relative POSIX paths ending in `.md` (e.g. `Theology/Soteriology.md`).

```js
import { openTree } from '@cave-notes/core-tree';

const tree = openTree('/home/me/workspace', {
  ignore: ['assets'],                 // names hidden at every level
  orderOf: (p) => index.orderOf(p),   // optional sync frontmatter `order` lookup
});

await tree.listChildren(null);                    // top level
await tree.listChildren('Theology.md');           // children of a page
await tree.createPage('Theology.md', 'Grace');    // -> 'Theology/Grace.md' (folder created lazily)
await tree.movePage('Grace.md', 'Other.md');      // page + folder move together
await tree.renamePage('Theology.md', 'Doctrine'); // -> { from, to, pageMoves }
await tree.deletePage('Old.md', { recursive: true });
for await (const p of tree.allPages()) { /* depth-first, for the indexer */ }
```

## Guarantees

- Page and folder always move together; a failed move is rolled back completely.
- Rejected operations (`COLLISION`, `MOVE_INTO_SELF`, `HAS_CHILDREN`) change nothing on disk.
- Name collisions are case- and Unicode-normalization-insensitive.
- Mutations are serialized per `openTree` instance.
- A page's folder is removed automatically when its last child leaves (only if the page file exists).
- `movePage` / `renamePage` return `pageMoves` for the page and every descendant: feed this to the indexer and to link rewriting (M4).
- Symlinks, dotfiles, non-`.md` files and `ignore`d names are invisible to the tree.

## Not handled here

Frontmatter, titles, links and search live in other packages. Trash vs permanent delete is the app's decision.
Names are used as they exist on disk; this package does not rewrite Unicode forms of existing files.

## Tests

`npm test` runs unit tests plus seeded randomized sequences that check content preservation and structural invariants after every operation.

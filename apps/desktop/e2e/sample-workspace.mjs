// Creates a small sample workspace of concept notes for trying the app out and for the e2e screenshots.
import { deflateSync } from 'node:zlib';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function createSample(root) {
  await fs.rm(root, { recursive: true, force: true });
  const w = async (rel, text) => {
    const p = path.join(root, ...rel.split('/'));
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, text);
  };

  await w('Welcome.md', `# Welcome to Cave Notes

Every page is a **Markdown file**, and every sub-page lives in a folder named after its parent. This workspace maps a few ideas as a hierarchy.

## Where to start

- [ ] Open [[Theology]] and browse its sub-pages with the arrow keys
- [x] Read about [[Soteriology]], which links to other pages
- [ ] Try *Ctrl+click* on a link to follow it

> Links to files and websites work too: see the *Links* tab on the right.

Read the [project site](https://example.com/cave-notes) or open [the reading list](Notes/Reading%20List.md).
`);

  await w('Theology.md', `---
status: draft
tags: [doctrine, systematic]
order: 1
---
# Theology

The study of God and of the things of God. This page organises the topics below.

## Topics

1. [[Grace]]
2. [[Soteriology]]
3. [[Church History/Councils/Nicaea|The Council of Nicaea]]

## Method

Start from the text, then move to the tradition. See also [[Ideas]] for open questions.
`);

  await w('Theology/Grace.md', `---
aliases: [Charis]
status: review
tags: [doctrine]
---
# Grace

Unmerited favour. In Greek, *charis*. It is the ground of [[Soteriology|salvation]] and runs through the whole of Scripture.

## In the New Testament

Paul uses the word over 100 times; it is central in Romans and Ephesians.

## Related

- [[Imputation]]
- Back to [Theology](../Theology.md)
`);

  await w('Theology/Soteriology.md', `---
status: draft
tags: [doctrine, salvation]
weight: 8
---
# Soteriology

The doctrine of **salvation**. It asks how God saves, whom he saves, and what salvation changes.

## Key terms

| Term | Meaning |
| --- | --- |
| Justification | declared righteous |
| Sanctification | made holy |

## Justification by faith

See [[Imputation]] for how righteousness is credited, and [[Grace]] for its source. The slogan is *sola fide*, but the history is richer than a slogan.

> "For by grace you have been saved through faith." This is the hinge of the argument.

### Objections

- It makes works irrelevant
- It is a legal fiction

\`\`\`text
Faith -> Justification -> Sanctification -> Glorification
\`\`\`

![A small diagram](Soteriology/diagram.png)

## Sources

- [Notes on Romans](https://example.com/romans)
- [Spec sheet](../docs/spec.pdf)
- [[A page that does not exist yet]]
`);

  await w('Theology/Soteriology/Imputation.md', `# Imputation

The crediting of righteousness to someone's account. Compare the [[Soteriology]] overview.
`);

  await w('Notes/Ideas.md', `# Ideas

- Compare the Eastern and Western accounts of [[Grace]]
- A timeline of the councils
`);
  await w('Notes/Reading List.md', `---
status: idea
---
# Reading List

1. Augustine, *On the Spirit and the Letter*
2. Calvin, *Institutes*, Book III
`);
  await w('Church History/Councils/Nicaea.md', `# Nicaea

The first ecumenical council, in 325.
`);
  await w('docs/spec.pdf', '%PDF-1.4 sample');

  // a small gradient PNG, so image rendering can be seen
  const W = 220, H = 70;
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const o = y * (W * 4 + 1) + 1 + x * 4;
      raw[o] = 53 + Math.round((x / W) * 120);
      raw[o + 1] = 132 - Math.round((y / H) * 50);
      raw[o + 2] = 228;
      raw[o + 3] = 255;
    }
  }
  const crc = (buf) => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  await fs.mkdir(path.join(root, 'Theology', 'Soteriology'), { recursive: true });
  await fs.writeFile(path.join(root, 'Theology', 'Soteriology', 'diagram.png'), png);

  // ---- a small project with typed attributes and database views
  await w('.cave-notes/schema.yaml', `attributes:
  status: { type: enum, values: [idea, todo, doing, review, done] }
  due: { type: date }
  tags: { type: list, of: string }
  weight: { type: number }
`);
  const filler = Array.from({ length: 36 }, (_, i) => `Line ${i + 1} of the project notes, written so that this page is taller than the window.`).join('\n\n');
  await w('Projects.md', `# Projects

Tasks for the cave notes project, shown three ways. Edit a property on a task page and every view follows.

\`\`\`view
type: table
title: All tasks
query: under:$this
columns: [title, status, due, tags]
sort: due
\`\`\`

## Board

\`\`\`view
type: kanban
query: under:$this
group: status
\`\`\`

## Calendar

\`\`\`view
type: calendar
query: under:$this
date: due
\`\`\`

## Notes

${filler}
`);
  await w('Projects/Write docs.md', `---\nstatus: todo\ndue: 2026-10-12\ntags: [writing, docs]\nweight: 3\n---\n# Write docs\n\nDocument the view blocks.\n`);
  await w('Projects/Fix bugs.md', `---\nstatus: doing\ndue: 2026-10-14\ntags: [code]\nweight: 8\n---\n# Fix bugs\n`);
  await w('Projects/Release.md', `---\nstatus: done\ndue: 2026-10-20\ntags: [code, docs]\nweight: 5\n---\n# Release\n`);
  await w('Projects/Ideas Box.md', `# Ideas Box\n\nUnsorted thoughts, no status yet.\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2] ?? '/tmp/cave-sample';
  await createSample(root);
  console.log('created', root);
}

import { parse } from '../src/index.js';

function page(i) {
  let s = `---\ntitle: Page ${i}\nstatus: draft\ntags: [a, b, c]\n---\n# Page ${i}\n\n`;
  for (let h = 0; h < 6; h++) {
    s += `## Section ${h}\n\nSome prose with a [link](Other/Page${h}.md#sec), a [[Wiki ${h}#Head|alias]], and https://example.com/${h}.\n\n`;
    s += '- item one\n- item two with `code`\n\n```js\nconst x = [[1]];\n```\n\n';
  }
  return s;
}

const N = 2000;
const pages = Array.from({ length: N }, (_, i) => page(i));
const bytes = pages.reduce((n, p) => n + p.length, 0);
parse(pages[0]); // warm up
const t0 = performance.now();
let links = 0;
for (const p of pages) links += parse(p).links.length;
const ms = performance.now() - t0;
console.log(`${N} pages (${(bytes / 1e6).toFixed(1)} MB, ${links} links): ${ms.toFixed(0)} ms total, ${(ms / N).toFixed(2)} ms/page`);

const big = Array.from({ length: 400 }, (_, i) => page(i)).join('\n');
const t1 = performance.now();
parse(big);
console.log(`one ${(big.length / 1e6).toFixed(1)} MB page: ${(performance.now() - t1).toFixed(0)} ms`);

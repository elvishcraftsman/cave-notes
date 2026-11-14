import fs from 'node:fs';

/** The text of the automation documentation: the overview page and every page in the `04-automation` folder. */
export function automationDocs() {
  const root = new URL('../../../docs/', import.meta.url);
  const parts = [fs.readFileSync(new URL('04-automation.md', root), 'utf8')];
  const walk = (dir) => {
    for (const e of fs.readdirSync(new URL(dir, root), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory()) walk(`${dir}${e.name}/`);
      else if (e.name.endsWith('.md')) parts.push(fs.readFileSync(new URL(`${dir}${e.name}`, root), 'utf8'));
    }
  };
  walk('04-automation/');
  return parts.join('\n\n');
}

/** The YAML block of the documentation that holds the rule `id`, so a test runs exactly what the page shows. */
export function docRules(id) {
  for (const m of automationDocs().matchAll(/```yaml\n([\s\S]*?)```/g)) if (new RegExp(`^\\s*- id: ${id}\\s*$`, 'm').test(m[1])) return m[1];
  throw new Error(`no documentation example with the rule id ${id}`);
}

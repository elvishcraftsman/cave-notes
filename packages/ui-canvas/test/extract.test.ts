import { describe, expect, it } from 'vitest';
import { canvasLinks, canvasText, renameFiles, type Canvas } from '../src';

const c: Canvas = {
  nodes: [
    { id: 'a', type: 'text', text: 'Grace and [[Faith]] and [[Works|deeds]]', x: 0, y: 0, width: 1, height: 1 },
    { id: 'b', type: 'file', file: 'Theology/Soteriology.md', subpath: '#Grace', x: 0, y: 0, width: 1, height: 1 },
    { id: 'c', type: 'link', url: 'https://example.com', x: 0, y: 0, width: 1, height: 1 },
    { id: 'd', type: 'group', label: 'Salvation', x: 0, y: 0, width: 1, height: 1 },
    { id: 'e', type: 'file', file: 'Theology/Soteriology/Notes.md', x: 0, y: 0, width: 1, height: 1 },
  ],
  edges: [{ id: 'x', fromNode: 'a', toNode: 'b', label: 'depends on' }],
};

describe('what a canvas holds', () => {
  it('canvasText is the words to search for', () => {
    const t = canvasText(c);
    expect(t).toContain('Grace and [[Faith]]');
    expect(t).toContain('Salvation');
    expect(t).toContain('depends on');
    expect(t).toContain('Soteriology');
    expect(t).toContain('https://example.com');
  });

  it('canvasLinks lists files, addresses and wikilinks', () => {
    expect(canvasLinks(c)).toEqual({
      files: [{ file: 'Theology/Soteriology.md', subpath: '#Grace' }, { file: 'Theology/Soteriology/Notes.md' }],
      urls: ['https://example.com'],
      wikilinks: ['Faith', 'Works'],
    });
  });

  it('renameFiles follows a rename and a folder move', () => {
    const r = renameFiles(c, 'Theology/Soteriology.md', 'Doctrine/Salvation.md');
    expect(r.nodes.find((n) => n.id === 'b')).toMatchObject({ file: 'Doctrine/Salvation.md', subpath: '#Grace' });
    expect(r.nodes.find((n) => n.id === 'e')).toMatchObject({ file: 'Theology/Soteriology/Notes.md' });
    const f = renameFiles(c, 'Theology/Soteriology', 'Doctrine/Salvation');
    expect(f.nodes.find((n) => n.id === 'e')).toMatchObject({ file: 'Doctrine/Salvation/Notes.md' });
    expect(renameFiles(c, 'Nothing.md', 'X.md')).toBe(c);
  });
});

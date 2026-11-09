import { BORDER_STYLES, NODE_KIND, PRESET_COLORS, PRESET_NAMES, SHAPES, SHAPE_NAMES, arrowGlyph, borderStyleOf, cssColor, describeNode, objectTree, shapeOf, type CanvasEdge, type CanvasNode, type CanvasView } from '@cave-notes/ui-canvas';
import type { JSX } from 'preact';
import type { Controller } from '../controller';

const GLYPH: Record<string, string> = { text: '📝', file: '📄', link: '🔗', group: '▣' };

/** The right sidebar of a canvas: the list of what is on it (groups hold what is inside them), and the properties of what is selected. */
export function CanvasObjects({ ctl, cv }: { ctl: Controller; cv: CanvasView }): JSX.Element {
  void ctl.canvasTick.value; // redraw when the canvas or the selection changes
  const canvas = cv.current;
  const selected = new Set(cv.selected);
  const rows = objectTree(canvas);
  const pick = (id: string, e: MouseEvent): void => {
    const add = e.shiftKey || e.ctrlKey || e.metaKey;
    const next = add ? (selected.has(id) ? cv.selected.filter((x) => x !== id) : [...cv.selected, id]) : [id];
    cv.select(next);
    cv.reveal(id);
  };
  return (
    <div class="cv-pane">
      <div class="cv-objects" role="listbox" aria-label="Objects on the canvas" aria-multiselectable="true">
        {rows.length === 0 && canvas.edges.length === 0 && <p class="empty-note">This canvas is empty. Double-click it to add a note card.</p>}
        {rows.map(({ node, depth }) => (
          <button key={node.id} role="option" aria-selected={selected.has(node.id)} class={`cv-obj ${selected.has(node.id) ? 'on' : ''}`} style={{ paddingLeft: `${8 + depth * 16}px` }} onClick={(e) => pick(node.id, e)} title={`${NODE_KIND[node.type] ?? ''}: ${describeNode(node)}`}>
            <span class="cv-obj-icon" aria-hidden="true">{GLYPH[node.type]}</span>
            <span class="cv-obj-name">{describeNode(node)}</span>
          </button>
        ))}
        {canvas.edges.length > 0 && <h3 class="cv-obj-head">Arrows</h3>}
        {canvas.edges.map((e) => {
          const a = canvas.nodes.find((n) => n.id === e.fromNode);
          const b = canvas.nodes.find((n) => n.id === e.toNode);
          return (
            <button key={e.id} role="option" aria-selected={selected.has(e.id)} class={`cv-obj ${selected.has(e.id) ? 'on' : ''}`} style={{ paddingLeft: '8px' }} onClick={(ev) => pick(e.id, ev)}>
              <span class="cv-obj-icon" aria-hidden="true">{arrowGlyph(e)}</span>
              <span class="cv-obj-name">{e.label ? `${e.label}: ` : ''}{a ? describeNode(a) : '?'} → {b ? describeNode(b) : '?'}</span>
            </button>
          );
        })}
      </div>
      <Properties cv={cv} />
    </div>
  );
}

function Num({ label, value, min, onSet, disabled }: { label: string; value: number; min?: number; onSet: (v: number) => void; disabled: boolean }): JSX.Element {
  return (
    <label class="cv-field">
      <span>{label}</span>
      <input type="number" step="1" {...(min !== undefined ? { min } : {})} value={Math.round(value)} disabled={disabled} onChange={(e) => { const v = Number((e.currentTarget as HTMLInputElement).value); if (Number.isFinite(v)) onSet(v); }} />
    </label>
  );
}

function Colors({ label = 'Colour', color, disabled, onSet }: { label?: string; color: string | undefined; disabled: boolean; onSet: (c: string | undefined) => void }): JSX.Element {
  const css = cssColor(color);
  return (
    <div class="cv-field cv-colors" role="group" aria-label={label}>
      <span>{label}</span>
      <div class="cv-swatches">
        {Object.entries(PRESET_COLORS).map(([k, c]) => (
          <button key={k} type="button" class={`cv-sw ${color === k ? 'on' : ''}`} style={{ background: c }} title={PRESET_NAMES[k]} aria-label={PRESET_NAMES[k]} aria-pressed={color === k} disabled={disabled} onClick={() => onSet(k)} />
        ))}
        <button type="button" class={`cv-sw none ${color === undefined ? 'on' : ''}`} title="No colour" aria-label="No colour" aria-pressed={color === undefined} disabled={disabled} onClick={() => onSet(undefined)}>∅</button>
        <input type="color" class="cv-custom" title={`Another colour for the ${label.toLowerCase()}`} aria-label={`Another colour for the ${label.toLowerCase()}`} value={css && css.length === 7 ? css : '#808080'} disabled={disabled} onChange={(e) => onSet((e.currentTarget as HTMLInputElement).value)} />
      </div>
    </div>
  );
}

function Properties({ cv }: { cv: CanvasView }): JSX.Element | null {
  const canvas = cv.current;
  const nodes = canvas.nodes.filter((n) => cv.selected.includes(n.id));
  const edges = canvas.edges.filter((e) => cv.selected.includes(e.id));
  const off = cv.isViewMode;
  if (nodes.length === 0 && edges.length === 0) return <div class="cv-props"><p class="empty-note">Select something on the canvas to see its properties.</p></div>;
  const note = off ? <p class="cv-props-note">View mode is on: switch to edit mode (the pencil at the bottom right of the canvas) to change things.</p> : null;
  if (nodes.length === 0) return <EdgeProps cv={cv} edge={edges[0] as CanvasEdge} count={edges.length} off={off} note={note} />;
  const one = nodes.length === 1 ? (nodes[0] as CanvasNode) : null;
  const same = <T,>(f: (n: CanvasNode) => T): T | undefined => (nodes.every((n) => f(n) === f(nodes[0] as CanvasNode)) ? f(nodes[0] as CanvasNode) : undefined);
  const color = same((n) => (typeof n.color === 'string' ? n.color : '')) || undefined;
  const fill = same((n) => (typeof n.fill === 'string' ? n.fill : '')) || undefined;
  const bgPath = same((n) => (typeof n.background === 'string' ? n.background : '')) || undefined;
  const bgStyle = same((n) => (n.backgroundStyle === 'ratio' || n.backgroundStyle === 'repeat' ? n.backgroundStyle : 'cover')) as 'cover' | 'ratio' | 'repeat' | undefined;
  const shape = same((n) => shapeOf(n));
  const border = same((n) => borderStyleOf(n) ?? '');
  const width = same((n) => (typeof n.borderWidth === 'number' ? n.borderWidth : -1));
  const onlyGroups = nodes.every((n) => n.type === 'group');
  const shapes = onlyGroups ? SHAPES.filter((s) => s === 'rounded' || s === 'rectangle') : nodes.some((n) => n.type === 'group') ? SHAPES.filter((s) => s === 'rounded' || s === 'rectangle') : SHAPES;
  return (
    <div class="cv-props">
      <h3 class="cv-obj-head">{one ? `${NODE_KIND[one.type]}: properties` : `${nodes.length} objects: properties`}</h3>
      {note}
      {one && (
        <div class="cv-grid">
          <Num label="X" value={one.x} disabled={off} onSet={(v) => cv.setBox(one.id, { x: v })} />
          <Num label="Y" value={one.y} disabled={off} onSet={(v) => cv.setBox(one.id, { y: v })} />
          <Num label="Width" value={one.width} min={60} disabled={off} onSet={(v) => cv.setBox(one.id, { width: v })} />
          <Num label="Height" value={one.height} min={40} disabled={off} onSet={(v) => cv.setBox(one.id, { height: v })} />
        </div>
      )}
      {one?.type === 'group' && (
        <label class="cv-field">
          <span>Name</span>
          <input type="text" value={typeof one.label === 'string' ? one.label : ''} disabled={off} onChange={(e) => cv.patchSelectedNodes({ label: (e.currentTarget as HTMLInputElement).value.trim() || undefined })} />
        </label>
      )}
      {one?.type === 'link' && (
        <label class="cv-field">
          <span>Address</span>
          <input type="text" value={String(one.url)} disabled={off} onChange={(e) => { const v = (e.currentTarget as HTMLInputElement).value.trim(); if (/^https?:\/\//i.test(v)) cv.patchSelectedNodes({ url: v }); }} />
        </label>
      )}
      {one?.type === 'file' && <p class="cv-props-note">{String(one.file)}</p>}
      <Colors label="Border colour" color={color} disabled={off} onSet={(c) => cv.patchSelectedNodes({ color: c })} />
      <Colors label="Fill colour" color={fill} disabled={off} onSet={(c) => cv.patchSelectedNodes({ fill: c })} />
      <label class="cv-field">
        <span>Shape</span>
        <select disabled={off} value={shape ?? ''} onChange={(e) => cv.patchSelectedNodes({ shape: (e.currentTarget as HTMLSelectElement).value === 'rounded' ? undefined : (e.currentTarget as HTMLSelectElement).value })}>
          {shape === undefined && <option value="">(mixed)</option>}
          {shapes.map((s) => <option key={s} value={s}>{SHAPE_NAMES[s]}</option>)}
        </select>
      </label>
      <label class="cv-field">
        <span>Border</span>
        <select disabled={off} value={border ?? ''} onChange={(e) => cv.patchSelectedNodes({ borderStyle: (e.currentTarget as HTMLSelectElement).value || undefined })}>
          {border === undefined && <option value="" disabled>(mixed)</option>}
          <option value="">Default</option>
          {BORDER_STYLES.map((b) => <option key={b} value={b}>{b[0]!.toUpperCase() + b.slice(1)}</option>)}
        </select>
      </label>
      <div class="cv-field">
        <span>Background picture</span>
        {bgPath !== undefined && bgPath !== '' && <p class="cv-props-note">{bgPath}</p>}
        <div class="cv-swatches">
          <button type="button" class="pill-button small" disabled={off} onClick={() => void cv.chooseBackgroundImage()}>{bgPath ? 'Change…' : 'Choose…'}</button>
          {!!bgPath && <button type="button" class="pill-button small" disabled={off} onClick={() => cv.setBackgroundImage(null)}>Remove</button>}
        </div>
      </div>
      {!!bgPath && (
        <label class="cv-field">
          <span>Picture fits</span>
          <select disabled={off} value={bgStyle ?? 'cover'} onChange={(e) => cv.setBackgroundImage(bgPath, (e.currentTarget as HTMLSelectElement).value as 'cover' | 'ratio' | 'repeat')}>
            <option value="cover">Fill the card</option>
            <option value="ratio">Show all of it</option>
            <option value="repeat">Tile it</option>
          </select>
        </label>
      )}
      {one?.type === 'text' && <div class="cv-field"><button type="button" class="pill-button small" disabled={off} onClick={() => void cv.insertImage(one.id)}>Insert a picture into the text…</button></div>}
      <Num label="Border width" value={width === undefined || width < 0 ? 2 : width} min={0} disabled={off} onSet={(v) => cv.patchSelectedNodes({ borderWidth: Math.max(0, Math.min(12, v)) })} />
    </div>
  );
}

function EdgeProps({ cv, edge, count, off, note }: { cv: CanvasView; edge: CanvasEdge; count: number; off: boolean; note: JSX.Element | null }): JSX.Element {
  const nodes = cv.current.nodes;
  const name = (id: string): string => { const n = nodes.find((x) => x.id === id); return n ? describeNode(n) : '?'; };
  return (
    <div class="cv-props">
      <h3 class="cv-obj-head">{count === 1 ? 'Arrow: properties' : `${count} arrows: properties`}</h3>
      {note}
      {count === 1 && <p class="cv-props-note">{name(edge.fromNode)} → {name(edge.toNode)}</p>}
      {count === 1 && (
        <label class="cv-field">
          <span>Label</span>
          <input type="text" value={typeof edge.label === 'string' ? edge.label : ''} disabled={off} onChange={(e) => cv.patchSelectedEdges({ label: (e.currentTarget as HTMLInputElement).value.trim() || undefined })} />
        </label>
      )}
      <Colors color={typeof edge.color === 'string' ? edge.color : undefined} disabled={off} onSet={(c) => cv.patchSelectedEdges({ color: c })} />
      <div class="cv-field">
        <span>Arrowheads</span>
        <button type="button" class="pill-button small" disabled={off} onClick={() => cv.cycleArrowheads()} title="One end, the other end, both, none">{arrowGlyph(edge)} Change</button>
      </div>
    </div>
  );
}

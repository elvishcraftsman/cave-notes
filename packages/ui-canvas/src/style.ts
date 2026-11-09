/** The canvas's look. Colours come from the app's theme variables, with fallbacks so it also stands alone. */
export const CANVAS_CSS = `
.cv-root { position: relative; width: 100%; height: 100%; min-height: 240px; overflow: hidden; outline: none; user-select: none; touch-action: none; cursor: grab;
  background-color: var(--editor-bg, var(--window-bg, #fff)); color: var(--editor-fg, var(--window-fg, #222));
  background-image: radial-gradient(circle, var(--cv-dot, rgba(128,128,128,.35)) 1px, transparent 1px);
  background-size: calc(24px * var(--cv-zoom, 1)) calc(24px * var(--cv-zoom, 1)); background-position: var(--cv-x, 0) var(--cv-y, 0); }
.cv-root input, .cv-root textarea, .cv-root .cm-editor { user-select: text; -webkit-user-select: text; }
.cv-root:active { cursor: grabbing; }
.cv-readonly .cv-port, .cv-readonly .cv-handle { display: none; }
.cv-world { position: absolute; left: 0; top: 0; width: 0; height: 0; transform-origin: 0 0; }
.cv-edges { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none; z-index: 0; }
.cv-edge-hit { fill: none; stroke: transparent; stroke-width: 16px; pointer-events: stroke; cursor: pointer; }
.cv-edge-line { fill: none; stroke-width: 2px; pointer-events: none; }
.cv-edge.cv-selected .cv-edge-line { stroke-width: 4px; }
.cv-edge-draft { stroke: var(--accent, #3584e4); stroke-dasharray: 6 4; }
.cv-edge-moving .cv-edge-line { opacity: .3; }
.cv-edge-end { fill: var(--accent, #3584e4); stroke: var(--editor-bg, #fff); stroke-width: 2px; pointer-events: all; cursor: grab; }
.cv-hint { fill: var(--editor-bg, #fff); stroke: var(--accent, #3584e4); stroke-width: 2px; pointer-events: none; }
.cv-hint-on { fill: var(--accent, #3584e4); }
.cv-edge-label { font: 13px/1 var(--ui-font, sans-serif); fill: currentColor; text-anchor: middle; dominant-baseline: middle; paint-order: stroke; stroke: var(--editor-bg, var(--window-bg, #fff)); stroke-width: 6px; pointer-events: none; }
.cv-node { position: absolute; box-sizing: border-box; overflow: visible; cursor: default; }
.cv-node[data-node] { --cv-edge-z: 1; }
.cv-shape { position: absolute; inset: 0; box-sizing: border-box; pointer-events: none; border: var(--cv-bw, 2px) var(--cv-bs, solid) var(--cv-color, var(--cv-border, rgba(128,128,128,.55))); border-radius: 8px; background: var(--cv-bg, var(--cv-card, var(--card-bg, var(--editor-bg, #fff)))); background-image: var(--cv-img, none); background-size: var(--cv-img-size, cover); background-repeat: var(--cv-img-repeat, no-repeat); background-position: center; }
.cv-shape-rectangle { border-radius: 0; } .cv-shape-pill { border-radius: 9999px; } .cv-shape-ellipse { border-radius: 50%; }
.cv-shape-diamond { background-image: none; --cv-poly: polygon(50% 0, 100% 50%, 50% 100%, 0 50%); border: 0; border-radius: 0; clip-path: var(--cv-poly); background: var(--cv-color, var(--cv-border, rgba(128,128,128,.55))); }
.cv-shape-diamond::before { content: ''; position: absolute; inset: var(--cv-bw, 2px); clip-path: var(--cv-poly); background: var(--cv-bg, var(--cv-card, var(--card-bg, var(--editor-bg, #fff)))); background-image: var(--cv-img, none); background-size: var(--cv-img-size, cover); background-repeat: var(--cv-img-repeat, no-repeat); background-position: center; }
.cv-node[style*="--cv-bs: none"] .cv-shape-diamond::before { inset: 0; }
.cv-node[style*="--cv-ink"] > .cv-body { color: var(--cv-ink); }
.cv-node[data-image] > .cv-body { text-shadow: 0 0 3px var(--cv-card, var(--card-bg, var(--editor-bg, #fff))), 0 0 6px var(--cv-card, var(--card-bg, var(--editor-bg, #fff))); }
.cv-md img, .cv-node .cv-md-img { max-width: 100%; height: auto; display: block; margin: 4px 0; border-radius: 4px; }
.cv-node.cv-selected > .cv-shape { box-shadow: 0 0 0 3px var(--accent, #3584e4); }
.cv-node.cv-selected > .cv-shape-diamond { box-shadow: none; background: var(--accent, #3584e4); }
.cv-node.cv-selected > .cv-shape-diamond::before { inset: 3px; }
.cv-node[data-shape="ellipse"] > .cv-body { padding: 10% 14%; } .cv-node[data-shape="diamond"] > .cv-body { padding: 22% 25%; } .cv-node[data-shape="pill"] > .cv-body { padding: 6px 18px; }
.cv-body { position: absolute; inset: 0; overflow: auto; border-radius: 6px; padding: 6px 10px; }
.cv-text .cv-body { cursor: text; }
.cv-editing .cv-body { overflow: auto; }
.cv-plain-edit { width: 100%; height: 100%; box-sizing: border-box; border: 0; resize: none; background: transparent; color: inherit; font: inherit; outline: none; }
.cv-group > .cv-shape { background-color: var(--cv-bg, color-mix(in srgb, var(--cv-color, rgba(128,128,128,.9)) 8%, transparent)); border-style: var(--cv-bs, dashed); }
.cv-group .cv-body { pointer-events: none; padding: 0; overflow: visible; }
.cv-group-label { position: absolute; left: 0; top: -30px; max-width: 100%; padding: 2px 10px; border-radius: 6px 6px 0 0; background: color-mix(in srgb, var(--cv-color, rgba(128,128,128,.9)) 25%, var(--editor-bg, var(--window-bg, #fff))); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: auto; cursor: grab; }
.cv-group-label:empty { display: none; }
.cv-handle { position: absolute; width: 10px; height: 10px; border-radius: 3px; background: var(--accent, #3584e4); border: 2px solid var(--editor-bg, #fff); box-sizing: border-box; z-index: 3; }
.cv-h-nw { left: -6px; top: -6px; cursor: nwse-resize; } .cv-h-ne { right: -6px; top: -6px; cursor: nesw-resize; }
.cv-h-sw { left: -6px; bottom: -6px; cursor: nesw-resize; } .cv-h-se { right: -6px; bottom: -6px; cursor: nwse-resize; }
.cv-h-n { left: calc(50% - 5px); top: -6px; cursor: ns-resize; } .cv-h-s { left: calc(50% - 5px); bottom: -6px; cursor: ns-resize; }
.cv-h-e { right: -6px; top: calc(50% - 5px); cursor: ew-resize; } .cv-h-w { left: -6px; top: calc(50% - 5px); cursor: ew-resize; }
.cv-port { position: absolute; width: 16px; height: 16px; border-radius: 50%; background: var(--editor-bg, #fff); border: 2px solid var(--accent, #3584e4); box-sizing: border-box; cursor: crosshair; z-index: 3; }
.cv-p-top { left: calc(50% - 8px); top: -26px; } .cv-p-bottom { left: calc(50% - 8px); bottom: -26px; }
.cv-p-left { left: -26px; top: calc(50% - 8px); } .cv-p-right { right: -26px; top: calc(50% - 8px); }
.cv-file .cv-body, .cv-link .cv-body { display: flex; flex-direction: column; gap: 4px; overflow-wrap: anywhere; }
.cv-body, .cv-card-title, .cv-card-sub { white-space: normal; word-break: break-word; }
.cv-file .cv-body { padding-right: 30px; }
.cv-expand { position: absolute; top: 4px; right: 4px; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: inherit; font: inherit; cursor: pointer; z-index: 2; }
.cv-expand:hover { background: rgba(128,128,128,.25); }
.cv-expand:focus-visible { outline: 2px solid var(--accent, #3584e4); }
.cv-card-clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.cv-page-preview { margin-top: 4px; padding-top: 6px; border-top: 1px solid var(--cv-border, rgba(128,128,128,.35)); overflow: auto; flex: 1 1 auto; min-height: 0; }
.cv-card-title { font-weight: 600; overflow-wrap: anywhere; }
.cv-card-sub { color: var(--dim-fg, #777); font-size: 12px; overflow-wrap: anywhere; }
.cv-body img { max-width: 100%; max-height: 100%; object-fit: contain; }
.cv-rubber { position: absolute; border: 1px solid var(--accent, #3584e4); background: color-mix(in srgb, var(--accent, #3584e4) 15%, transparent); pointer-events: none; z-index: 5; }
.cv-overlay { position: absolute; inset: 0; pointer-events: none; z-index: 6; }
.cv-overlay > * { pointer-events: auto; }
.cv-edge-input { position: absolute; transform: translate(-50%, -50%); min-width: 6em; padding: 3px 8px; border-radius: 6px; border: 2px solid var(--accent, #3584e4); background: var(--editor-bg, #fff); color: inherit; font: inherit; }
.cv-toolbar { position: absolute; transform: translateX(-50%); display: flex; gap: 2px; align-items: center; padding: 4px; border-radius: 10px; z-index: 6; background: var(--card-bg, var(--window-bg, #fff)); border: 1px solid var(--cv-border, rgba(128,128,128,.4)); box-shadow: 0 2px 10px rgba(0,0,0,.2); }
.cv-toolbar[hidden], .cv-rubber[hidden] { display: none; }
.cv-btn { min-width: 28px; height: 28px; padding: 0 6px; border: 0; border-radius: 6px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.cv-btn:hover { background: rgba(128,128,128,.22); }
.cv-btn:focus-visible { outline: 2px solid var(--accent, #3584e4); }
.cv-swatch { min-width: 20px; width: 20px; height: 20px; margin: 4px 2px; border-radius: 50%; padding: 0; }
.cv-danger:hover { background: rgba(224,27,36,.35); }
.cv-palette { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; gap: 2px; padding: 4px; border-radius: 10px; z-index: 6; background: var(--card-bg, var(--window-bg, #fff)); border: 1px solid var(--cv-border, rgba(128,128,128,.4)); box-shadow: 0 2px 10px rgba(0,0,0,.2); }
.cv-readonly .cv-palette { display: none; }
.cv-btn.cv-on { background: color-mix(in srgb, var(--accent, #3584e4) 35%, transparent); }
.cv-btn:disabled { opacity: .4; cursor: default; }
.cv-menu { position: absolute; z-index: 8; min-width: 190px; display: flex; flex-direction: column; padding: 4px; border-radius: 10px; background: var(--card-bg, var(--window-bg, #fff)); color: inherit; border: 1px solid var(--cv-border, rgba(128,128,128,.4)); box-shadow: 0 2px 10px rgba(0,0,0,.25); font-size: 14px; user-select: none; }
.cv-menu-item { text-align: left; border: 0; border-radius: 6px; background: transparent; color: inherit; font: inherit; padding: 6px 10px; cursor: pointer; }
.cv-menu-item:hover, .cv-menu-item:focus-visible { background: rgba(128,128,128,.22); outline: none; }
.cv-menu-head { padding: 4px 10px 2px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; opacity: .65; }
.cv-menu-sep { height: 1px; margin: 4px 6px; background: var(--cv-border, rgba(128,128,128,.35)); }
.cv-embedded { touch-action: pan-y pinch-zoom; }
.cv-zoom { position: absolute; right: 10px; bottom: 10px; display: flex; flex-direction: column; gap: 2px; padding: 4px; border-radius: 10px; z-index: 6; background: var(--card-bg, var(--window-bg, #fff)); border: 1px solid var(--cv-border, rgba(128,128,128,.4)); box-shadow: 0 2px 10px rgba(0,0,0,.2); }
`;

import type { OutlineItem } from '@cave-notes/editor';
import type { JSX } from 'preact';
import type { Controller } from '../controller';
import type { LinkInfo } from '../../shared/api';
import { Icon, type IconName } from './icons';
import { stripExt } from '../paths';
import { CanvasObjects } from './CanvasPanes';

/** `[=Label](automation:rule-id)` is a button, not a link to anywhere. */
const isAutomationButton = (l: { target: string }): boolean => /^automation:/i.test(l.target.trim());

export function RightSidebar({ ctl }: { ctl: Controller }): JSX.Element {
  const tab = ctl.settings.value.rightTab;
  const onCanvas = !!ctl.canvasView.value && /\.canvas$/i.test(ctl.current.value?.path ?? '');
  const linkCount = ctl.links.value.filter((l) => (l.kind !== 'page' || l.target !== '') && !isAutomationButton(l)).length;
  return (
    <div class="right-sidebar">
      <div class="segmented" role="tablist" aria-label="Sidebar view">
        <button role="tab" aria-selected={tab === 'outline'} class={tab === 'outline' ? 'on' : ''} onClick={() => ctl.setRightTab('outline')}>
          {onCanvas ? 'Objects' : 'Outline'}
        </button>
        <button role="tab" aria-selected={tab === 'links'} class={tab === 'links' ? 'on' : ''} onClick={() => ctl.setRightTab('links')}>
          Links{linkCount + ctl.backlinks.value.length > 0 ? <span class="count">{linkCount + ctl.backlinks.value.length}</span> : null}
        </button>
      </div>
      <div class="right-body">{tab === 'outline' ? <Outline ctl={ctl} /> : <Links ctl={ctl} />}</div>
      <DocStats ctl={ctl} />
    </div>
  );
}

/** Words at the foot of the sidebar; and pages when the page names an export style (`exportStyle:`), or slides in a presentation. */
function DocStats({ ctl }: { ctl: Controller }): JSX.Element | null {
  const cur = ctl.current.value;
  const st = ctl.docStats.value;
  if (!cur?.exists || st.path !== cur.path) return null;
  const n = (x: number, one: string, many: string): string => `${x.toLocaleString()} ${x === 1 ? one : many}`;
  return (
    <div class="doc-stats" role="status" aria-label="Page statistics">
      <span>{n(st.words, 'word', 'words')}</span>
      {st.slides !== null && <span>{n(st.slides, 'slide', 'slides')}</span>}
      {st.slides === null && st.style && (
        <span title={st.missing ? `There is no export style called “${st.style}”, so Clean is used.` : `Pages as exported in “${st.style}”`}>
          {st.pages === null ? '… pages' : n(st.pages, 'page', 'pages')}{st.missing ? ' ⚠' : ''}
        </span>
      )}
    </div>
  );
}

export function Outline({ ctl }: { ctl: Controller }): JSX.Element {
  const items: OutlineItem[] = ctl.outline.value;
  const active = ctl.activeHeading.value;
  const cur = ctl.current.value;
  const cv = ctl.canvasView.value;
  // a canvas has no headings: its sidebar lists what is on it, and the properties of what is selected
  if (cur?.exists && cv && /\.canvas$/i.test(cur.path)) return <CanvasObjects ctl={ctl} cv={cv} />;
  if (!cur?.exists) return <p class="empty-note">Open a page to see its headings.</p>;
  if (items.length === 0) return <p class="empty-note">This page has no headings yet. Start a line with # to add one.</p>;
  const heads = items.filter((i) => i.kind !== 'list');
  const min = Math.min(...(heads.length > 0 ? heads : items).map((i) => i.level));
  return (
    <ul class="outline" role="list">
      {items.map((it, i) => (
        <li key={`${it.from}-${i}`}>
          <button class={`outline-item ${i === active ? 'active' : ''}`} style={{ paddingLeft: `${10 + Math.max(0, it.level - min) * 14}px` }} onClick={() => ctl.goToHeading(it)} title={it.text}>
            {it.kind === 'list' ? (
              <span class="outline-text list">
                <span class="outline-marker">{it.marker}</span> {it.text}
              </span>
            ) : (
              <span class={`outline-text level-${Math.min(it.level, 4)}`}>{it.text || '(empty heading)'}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

const STATUS_LABEL: Partial<Record<LinkInfo['status'], string>> = { broken: 'Missing', ambiguous: 'Ambiguous' };

function LinkRow({ ctl, link }: { ctl: Controller; link: LinkInfo }): JSX.Element {
  const icon: IconName = link.kind === 'workspace' ? 'cave' : link.kind === 'web' || link.kind === 'other' ? 'globe' : link.kind === 'file' ? 'file' : 'page';
  const ws = link.kind === 'workspace' ? /^cave:\/\/([^/]+)\/?(.*)$/i.exec(link.url ?? '') : null;
  const title = link.text || (ws ? `${decodeURIComponent(ws[1]!)}: ${stripExt(decodeURIComponent(ws[2] ?? '')).split('/').pop() || 'workspace'}` : '') || (link.kind === 'page' ? stripExt(link.resolvedPage ?? link.target).split('/').pop() : link.kind === 'file' ? (link.target.split('/').pop() ?? link.target) : (link.url ?? link.raw));
  const sub = ws ? `${decodeURIComponent(ws[1]!)} › ${stripExt(decodeURIComponent(ws[2] ?? ''))}` : link.kind === 'page' ? ((link.resolvedPage ? stripExt(link.resolvedPage) : undefined) ?? link.target) : link.kind === 'file' ? link.target : (link.url ?? '');
  const bad = link.status === 'broken' || link.status === 'ambiguous';
  return (
    <button class={`link-row ${bad ? 'bad' : ''}`} onClick={() => void ctl.followIndexed(link)} title={`Line ${link.line}`}>
      {link.status === 'broken' ? (
        <span class="link-warning" role="button" tabIndex={0} title="There is no such page. Click to edit the link." onClick={(e) => { e.stopPropagation(); ctl.editBrokenLink(link); }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); ctl.editBrokenLink(link); } }}>
          <Icon name="warning" size={15} class="link-icon" />
        </span>
      ) : (
        <Icon name={bad ? 'warning' : icon} size={15} class="link-icon" />
      )}
      <span class="link-text">
        <span class="link-title">{title || '(untitled)'}{link.fragment ? <span class="link-frag"> # {link.fragment}</span> : null}</span>
        <span class="link-sub">{sub}</span>
      </span>
      {STATUS_LABEL[link.status] && (
        <span class="badge" {...(link.status === 'broken' ? { role: 'button', title: 'There is no such page. Click to edit the link.', onClick: (e: MouseEvent) => { e.stopPropagation(); ctl.editBrokenLink(link); } } : {})}>{STATUS_LABEL[link.status]}</span>
      )}
    </button>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: JSX.Element[] }): JSX.Element | null {
  if (count === 0) return null;
  return (
    <section class="link-section">
      <h3>
        {title}
        <span class="count">{count}</span>
      </h3>
      {children}
    </section>
  );
}

export function Links({ ctl }: { ctl: Controller }): JSX.Element {
  const cur = ctl.current.value;
  if (!cur?.exists) return <p class="empty-note">Open a page to see its links.</p>;
  const links = ctl.links.value.filter((l) => !(l.kind === 'page' && l.target === ''));
  const pages = links.filter((l) => l.kind === 'page');
  const files = links.filter((l) => l.kind === 'file');
  const web = links.filter((l) => (l.kind === 'web' || l.kind === 'other') && !isAutomationButton(l));
  const spaces = links.filter((l) => l.kind === 'workspace');
  const back = ctl.backlinks.value;
  if (links.length === 0 && back.length === 0) return <p class="empty-note">This page has no links, and no page links to it.</p>;
  return (
    <div class="links">
      <Section title="Pages" count={pages.length}>
        {pages.map((l, i) => <LinkRow key={`p${i}`} ctl={ctl} link={l} />)}
      </Section>
      <Section title="Files" count={files.length}>
        {files.map((l, i) => <LinkRow key={`f${i}`} ctl={ctl} link={l} />)}
      </Section>
      <Section title="Other Workspaces" count={spaces.length}>
        {spaces.map((l, i) => <LinkRow key={`x${i}`} ctl={ctl} link={l} />)}
      </Section>
      <Section title="Web" count={web.length}>
        {web.map((l, i) => <LinkRow key={`w${i}`} ctl={ctl} link={l} />)}
      </Section>
      <Section title="Linked From" count={back.length}>
        {back.map((b, i) => (
          <button key={`b${i}`} class="link-row" onClick={() => void ctl.openPage(b.fromPath, { focus: false })} title={`Line ${b.line}`}>
            <Icon name="back" size={15} class="link-icon" />
            <span class="link-text">
              <span class="link-title">{b.fromTitle}</span>
              <span class="link-sub">{stripExt(b.fromPath)}</span>
            </span>
          </button>
        ))}
      </Section>
    </div>
  );
}

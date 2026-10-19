import {
  EMPTY_PROJECT,
  rectangularShape,
  flushHydration,
  renderPage,
  openSettingsSection,
  openMobileProperties,
  toolButton,
  clickBinHistory,
  selectPocket,
} from "./bin-designer.test-support";
import * as React from "react";
import { expect, it, vi } from "vitest";
import { parseProjectDoc } from "@shared/gridfinity/project";
import { fingerHoleSchema, parseCutoutPlacement } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { useBinGeometry } from "@/lib/gridfinity/use-bin-geometry";
import * as ProjectPersistence from "@/lib/project/persist";

it.each([false, true])("prototype has one object list and preserves identity when reopening properties on mobile=%s", async mobile => {
  const originalUrl = window.location.href;
  window.history.replaceState(null, "", "/bin?layout=workflow");
  const shape = rectangularShape("workflow-tool", "Tool");
  const cutouts = [0, 1].map(i => parseCutoutPlacement({ id: `workflow-${i}`, name: `Tool ${i + 1}`, shapeId: shape.id, position: { x: i * 40 - 20, y: 0 } }));
  const finger = fingerHoleSchema.parse({ id: "workflow-f", name: "Thumb access", center: { x: 0, y: 0 } });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec: parseBinSpec({ gridX: 4, gridY: 4, heightUnits: 6 }), shapes: [shape], cutouts, fingerHoles: [finger] });
  const { container, unmount } = renderPage({ mobile, experimental: true });
  try {
    await flushHydration();
    const workflow = container.querySelector<HTMLElement>('#workflow-panel')!;
    const inspector = container.querySelector<HTMLElement>('[data-testid="selection-inspector"]')!;
    const leftScroll = workflow.querySelector('#bin-settings-pockets')!.parentElement!;
    expect(inspector.querySelector('[data-testid="object-list-scroll"]')).toBeNull();
    leftScroll.scrollTop = 230;
    const leftButton = (kind: string, id: string) => workflow.querySelector<HTMLButtonElement>(`[data-testid="button-select-${kind === "finger" ? "finger-hole-" : ""}${id}"]`)!;
    const click = (label: string) => { const button = toolButton(container, label); React.act(() => button.click()); };
    const showWorkflow = () => { if (workflow.hidden) React.act(() => [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Workflow')!.click()); };
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
    expect(workflow.querySelectorAll('button[data-testid^="button-select-"]')).toHaveLength(3);
    expect(workflow.querySelector('[aria-label^="Rename "]')).toBeNull();
    expect(workflow.textContent).toContain('Add pocket');
    for (const [row, add] of [
      [leftButton('pocket', 'workflow-1'), workflow.querySelector('[data-testid="button-add-pocket"]')!],
      [leftButton('finger', 'workflow-f'), workflow.querySelector('[data-testid="button-add-finger-hole"]')!],
    ]) expect(row.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    React.act(() => leftButton('pocket', 'workflow-0').click());
    if (mobile) openMobileProperties();
    expect(leftButton('pocket', 'workflow-0').getAttribute('aria-pressed')).toBe('true');
    expect(workflow.querySelector<HTMLInputElement>('[aria-label="Include Tool 1 in selection"]')!.checked).toBe(true);
    expect(inspector.querySelector('#pocket-properties')!.closest('[hidden]')).toBeNull();
    expect(workflow.hidden).toBe(mobile);

    // Choosing the same item must reopen the inspector and leave a transform tool.
    click('Rotate selected objects');
    if (mobile) React.act(() => container.querySelector<HTMLButtonElement>('#objects-panel [data-testid="button-back-to-canvas"]')!.click());
    else click('Collapse properties panel');
    showWorkflow();
    React.act(() => leftButton('pocket', 'workflow-0').click());
    if (mobile) openMobileProperties();
    else click('Expand properties panel');
    expect(inspector.closest('[hidden]')).toBeNull();
    expect(inspector.querySelector('[data-testid="inspector-properties-header"] h3')!.textContent).toBe('Tool 1');

    // The same tree supports both single and additive selection.
    selectPocket(container, 'workflow-1');
    expect(leftButton('pocket', 'workflow-0').getAttribute('aria-pressed')).toBe('false');
    expect(leftButton('pocket', 'workflow-1').getAttribute('aria-pressed')).toBe('true');
    showWorkflow();
    React.act(() => leftButton('finger', 'workflow-f').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })));
    expect(inspector.querySelector('[data-testid="batch-properties"]')).not.toBeNull();
    expect(workflow.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(2);
    showWorkflow();
    React.act(() => leftButton('finger', 'workflow-f').click());
    if (mobile) openMobileProperties();
    expect(leftButton('pocket', 'workflow-1').getAttribute('aria-pressed')).toBe('false');
    expect(leftButton('finger', 'workflow-f').getAttribute('aria-pressed')).toBe('true');
    expect(inspector.querySelector('#finger-access-properties')!.closest('[hidden]')).toBeNull();
    expect(workflow.querySelector('#pocket-properties, #finger-access-properties')).toBeNull();
    showWorkflow();
    React.act(() => workflow.querySelector<HTMLInputElement>('[aria-label="Include Tool 1 in selection"]')!.click());
    expect(workflow.hidden).toBe(false);
    expect(workflow.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(2);
    expect(leftScroll.scrollTop).toBe(230);
  } finally { unmount(); window.history.replaceState(null, '', originalUrl); }
});

it.each([
  { layout: "standard", mobile: false }, { layout: "workflow", mobile: false },
  { layout: "standard", mobile: true }, { layout: "workflow", mobile: true },
])("link management works for a single linked copy in $layout (mobile: $mobile)", async ({ layout, mobile }) => {
  window.history.replaceState(null, '', `/bin?layout=${layout}`);
  const shape = rectangularShape('single-link', 'Tool');
  const cutouts = [-20, 20].map((x, i) => parseCutoutPlacement({ id: `link-${i}`, name: `Tool ${i + 1}`, shapeId: shape.id,
    position: { x, y: 0 }, depth: { mode: 'mm', value: 10 }, designLink: { id: 'set' } }));
  const finger = fingerHoleSchema.parse({ id: 'separate-access', name: 'Access', center: { x: 0, y: 25 } });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts, fingerHoles: [finger] });
  const { container, unmount } = renderPage({ mobile, experimental: true });
  try {
    await flushHydration();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
    selectPocket(container, cutouts[0].id);
    expect(toolButton(container, 'Link and unlink selected objects').hasAttribute('disabled')).toBe(false);
    React.act(() => toolButton(container, 'Link and unlink selected objects').click());
    const controls = container.querySelector('[data-testid="pocket-3d-controls"]')!;
    expect(controls.textContent).toContain('Edits update all 2 copies.');
    expect(controls.querySelector('[aria-label="Linked design source"]')).toBeNull();
    React.act(() => [...controls.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Unlink')!.click());
    const edited = vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts;
    expect(edited[0].designLink).toBeUndefined();
    expect(edited[1]).toEqual(cutouts[1]);
    const action = toolButton(container, 'Link and unlink selected objects');
    expect(action.hasAttribute('disabled') || action.getAttribute('aria-disabled') === 'true').toBe(true);
    openSettingsSection(container, 'finger-holes');
    React.act(() => container.querySelector<HTMLInputElement>('[aria-label="Include Access in selection"]')!.click());
    const mixed = toolButton(container, 'Link and unlink selected objects');
    expect(mixed.hasAttribute('disabled') || mixed.getAttribute('aria-disabled') === 'true').toBe(true);
  } finally { unmount(); }
});

it.each([false, true])("prototype toolbar opens scoped link/unlink controls with undo on mobile=%s", async mobile => {
  const originalUrl = window.location.href;
  window.history.replaceState(null, '', '/bin?layout=workflow');
  const shape = rectangularShape('toolbar-links', 'Tool');
  const cutouts = [10, 20].map((value, i) => parseCutoutPlacement({ id: `linked-tool-${i}`, name: `Tool ${i + 1}`, shapeId: shape.id,
    position: { x: i * 40 - 20, y: 0 }, depth: { mode: 'mm', value }, ...(i === 0 ? { elevationMm: 7, insertionMode: 'axis', tilt: { xDeg: 15, yDeg: 0 } } : {}) }));
  const finger = fingerHoleSchema.parse({ id: 'toolbar-access', name: 'Tool access', center: { x: 0, y: 0 }, depthMm: 8 });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec: parseBinSpec({ gridX: 4, gridY: 4, heightUnits: 6 }), shapes: [shape], cutouts, fingerHoles: [finger] });
  const { container, unmount } = renderPage({ mobile, experimental: true });
  try {
    await flushHydration();
    const button = (label: string) => toolButton(container, label);
    const disabled = (label:string) => button(label).getAttribute("aria-disabled")==="true" || button(label).hasAttribute("disabled");
    const click = (label: string) => { const target=button(label); React.act(() => target.click()); };
    const choose = (name: string) => React.act(() => container.querySelector<HTMLInputElement>(`[aria-label="Include ${name} in selection"]`)!.click());
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
    expect(disabled('Link and unlink selected objects')).toBe(true);
    selectPocket(container, cutouts[0].id);
    expect(disabled('Link and unlink selected objects')).toBe(true);
    choose('Tool 2'); choose('Tool access');
    expect(disabled('Arrange selected objects')).toBe(false);
    if (mobile) React.act(()=>document.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    if (!mobile) click('Collapse properties panel');
    click('Link and unlink selected objects');
    const inspector = container.querySelector('[data-testid="selection-inspector"]')!;
    const header = () => inspector.querySelector('[data-testid="inspector-active-tool"] span')!.textContent;
    const controls = () => mobile ? container.querySelector('[data-testid="mobile-object-tool-controls"]')! : inspector.querySelector('[data-testid="inspector-transforms"]')!;
    const action = (text: string) => React.act(() => [...controls().querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text)!.click());
    const doc = () => ({ cutouts: vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts, fingers: vi.mocked(useBinGeometry).mock.lastCall![2]!.fingerHoles });
    expect(inspector.closest('[hidden]') !== null).toBe(mobile);
    expect(header()).toBe('Linked designs');
    if (!mobile) expect(button('Link and unlink selected objects')!.getAttribute('aria-pressed')).toBe('true');
    expect(controls().querySelector('[aria-label="Move X by"]')).toBeNull();
    expect(controls().querySelectorAll('[aria-label="Linked design"]')).toHaveLength(2);
    const source = controls().querySelector<HTMLSelectElement>('[aria-label="Linked design source"]')!;
    expect(source.value).toBe(cutouts[1].id);
    React.act(() => { source.value = cutouts[0].id; source.dispatchEvent(new Event('change', { bubbles: true })); });
    action('Link 2 pockets');
    expect(doc().cutouts[0].designLink?.id).toBeTruthy();
    expect(doc().cutouts[1].designLink).toEqual(doc().cutouts[0].designLink);
    expect(doc().cutouts.map(c => c.depth)).toEqual([cutouts[0].depth, cutouts[0].depth]);
    expect(doc().cutouts.map(c => ({ name: c.name, position: c.position }))).toEqual(cutouts.map(c => ({ name: c.name, position: c.position })));
    expect(doc().fingers).toEqual([finger]);
    expect(parseProjectDoc({ ...EMPTY_PROJECT, spec: parseBinSpec({ gridX: 4, gridY: 4, heightUnits: 6 }), shapes: [shape], cutouts: doc().cutouts, fingerHoles: doc().fingers })).not.toBeNull();
    action('Unlink 2 pockets');
    expect(doc().cutouts.every(c => !c.designLink)).toBe(true);
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
    expect(doc().cutouts.every(c => c.designLink)).toBe(true);
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
    expect(doc().cutouts).toEqual(cutouts);
    expect(container.querySelectorAll('[aria-label^="Include "]:checked')).toHaveLength(3);
    React.act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' })));
    expect(header()).toBe('Move');
    if (!mobile) expect(button('Link and unlink selected objects')!.getAttribute('aria-pressed')).toBe('false');
    click('Link and unlink selected objects');
    choose('Tool access'); choose('Tool 2');
    expect(disabled('Link and unlink selected objects')).toBe(true);
    expect(inspector.querySelector('[data-testid="inspector-active-tool"]')).toBeNull();
    expect(container.querySelector('#pocket-properties')!.closest('[hidden]') !== null).toBe(mobile);
  } finally { unmount(); window.history.replaceState(null, '', originalUrl); }
});

it.each([
  { layout: "standard", width: 320 }, { layout: "workflow", width: 320 },
  { layout: "standard", width: 390 }, { layout: "workflow", width: 390 },
  { layout: "standard", width: 844 }, { layout: "workflow", width: 844 },
])("phone Move and Rotate only open numeric adjustments on request in $layout layout at $width px", async ({ layout, width }) => {
  window.history.replaceState(null, "", `/bin?layout=${layout}`);
  const shape = rectangularShape("docked-tool", "Tool");
  const cutout = parseCutoutPlacement({ id: "docked-pocket", name: "Tool", shapeId: shape.id, position: { x: 0, y: 0 }, depth: { mode: "mm", value: 10 } });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts: [cutout] });
  const { container, unmount } = renderPage({ mobile: true, experimental: false });
  try {
    React.act(() => { window.innerWidth = width; window.dispatchEvent(new Event("resize")); });
    await flushHydration();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
    selectPocket(container, cutout.id);
    const canvas = container.querySelector('[data-testid="layout-canvas"]')!;
    const panel = container.querySelector<HTMLElement>(layout === "workflow" ? "#objects-panel" : '[data-testid="mobile-properties-panel"]')!;
    expect(panel.hidden).toBe(true);
    const toolbar = container.querySelector('[aria-label="Editing tools"]')!;
    expect(toolbar.querySelector('[data-testid="button-bin-undo"]')).not.toBeNull();
    expect(toolbar.querySelector('[data-testid="button-layout-ruler"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="bin-history-toolbar"]')).toBeNull();
    expect(container.querySelector('[data-testid="layout-tool-toolbar"]')).toBeNull();
    const dock = () => container.querySelector('[data-testid="mobile-object-tool-controls"]')!;
    const adjust = () => React.act(() => [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Adjust')!.click());
    const doc = () => vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts[0];
    for (const [tool, axis, value] of [["Move", "X", "5"], ["Rotate", "Z", "30"]]) {
      React.act(() => toolbar.querySelector<HTMLButtonElement>(`[aria-label="${tool} selected objects"]`)!.click());
      expect(panel.hidden).toBe(true);
      expect(dock()).toBeNull();
      expect(container.querySelector('.mobile-adjustment-tray')).toBeNull();
      adjust();
      expect(dock().closest('[data-testid="mobile-workspace-actions"]')).not.toBeNull();
      expect(canvas.contains(dock())).toBe(false);
      expect(dock().querySelector('[data-testid="pocket-3d-controls"]')!.classList.contains("absolute")).toBe(false);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      const input = dock().querySelector<HTMLInputElement>(`[aria-label="${tool} ${axis} by"]`)!;
      React.act(() => {
        input.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      React.act(() => input.blur());
      expect(tool === "Move" ? doc().position.x : doc().rotationDeg).toBeCloseTo(Number(value), 8);
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      expect(tool === "Move" ? doc().position.x : doc().rotationDeg).toBe(0);
      expect(container.querySelector('[data-testid="layout-canvas"]')).toBe(canvas);
    }
    React.act(() => [...container.querySelectorAll<HTMLButtonElement>(".mobile-adjustment-tray button")].find(button => button.textContent === "Done")!.click());
    expect(dock()).toBeNull();
    expect(panel.hidden).toBe(true);
    expect(toolbar.querySelector('[aria-label="Rotate selected objects"]')!.getAttribute('aria-pressed')).toBe('true');
    React.act(() => toolbar.querySelector<HTMLButtonElement>('[aria-label="Move selected objects"]')!.click());
    adjust();
    React.act(() => [...container.querySelectorAll<HTMLButtonElement>(".mobile-adjustment-tray button")].find(button => button.textContent === "All properties")!.click());
    expect(panel.hidden).toBe(false);
    expect(container.querySelector('[data-testid="layout-canvas"]')).toBe(canvas);
  } finally { unmount(); }
});

it.each(["standard", "workflow"])("mobile toolbar history can restore an earlier design (%s)", async layout => {
  window.history.replaceState(null, "", `/bin?layout=${layout}`);
  const shape = rectangularShape("history-tool", "Tool");
  const cutout = parseCutoutPlacement({ id: "history-pocket", name: "Tool", shapeId: shape.id, position: { x: 0, y: 0 } });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts: [cutout] });
  const { container, unmount } = renderPage({ mobile: true });
  try {
    await flushHydration();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
    selectPocket(container, cutout.id);
    React.act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts[0].position.x).not.toBe(0);
    const history = toolButton(container, 'Show edit history');
    React.act(() => history.click());
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
    const back = document.querySelector<HTMLElement>('[aria-label="Back to tools"]')!;
    expect(document.activeElement).toBe(back);
    React.act(() => back.click());
    const historyAgain = document.querySelector<HTMLElement>('[aria-label="Show edit history"]')!;
    expect(historyAgain).not.toBeNull();
    React.act(() => historyAgain.click());
    const first = document.querySelector<HTMLElement>('[data-testid="history-step-0"]')!;
    expect(first).not.toBeNull();
    React.act(() => first.click());
    expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts[0].position.x).toBe(0);
    clickBinHistory(container, 'redo');
    expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts[0].position.x).not.toBe(0);
  } finally { unmount(); }
});

it("phone panes require explicit opening and keep canvas and selection through every adjustment", async () => {
  const originalUrl=window.location.href; window.history.replaceState(null,'','/bin?layout=workflow');
  const shape=rectangularShape('phone-shape','Mobile tool');
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({...EMPTY_PROJECT,shapes:[shape],cutouts:[0,1].map(i=>parseCutoutPlacement({id:`phone-${i}`,name:`Tool ${i+1}`,shapeId:shape.id,position:{x:i*20,y:0}}))});
  const {container,unmount}=renderPage({mobile:true,experimental:false});
  const click=(text:string)=>React.act(()=>[...container.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===text)!.click());
  try {
    await flushHydration();
    React.act(()=>container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
    const canvas=container.querySelector('[data-testid="layout-canvas"]');
    const properties=container.querySelector<HTMLElement>('#objects-panel')!;
    const workflow=container.querySelector<HTMLElement>('#workflow-panel')!;
    expect(properties.hidden).toBe(true); expect(workflow.hidden).toBe(true);
    click('Workflow'); selectPocket(container,'phone-0');
    expect(properties.hidden).toBe(true); expect(workflow.hidden).toBe(false);
    expect(container.querySelector('.mobile-adjustment-tray')).toBeNull();
    click('Adjust'); expect(workflow.hidden).toBe(true);
    expect(container.querySelector('.mobile-adjustment-tray')?.textContent).toContain('Tool 1');
    selectPocket(container,'phone-1');
    expect(container.querySelector('.mobile-adjustment-tray')?.textContent).toContain('Tool 2');
    click('All properties'); expect(properties.hidden).toBe(false);
    expect(container.querySelector('.mobile-adjustment-tray')).toBeNull();
    React.act(()=>container.querySelector<HTMLButtonElement>('#objects-panel [data-testid="button-back-to-canvas"]')!.click());
    selectPocket(container,'phone-0'); expect(properties.hidden).toBe(true);
    click('Export'); expect(properties.hidden).toBe(false);
    expect(container.querySelector('[data-testid="button-export-3mf"]')!.closest('[hidden]')).toBeNull();
    expect(container.querySelector('[data-testid="layout-canvas"]')).toBe(canvas);
    expect(container.querySelector<HTMLInputElement>('[aria-label="Include Tool 1 in selection"]')!.checked).toBe(true);
    expect(container.querySelector('[data-testid="editor-project-header"]')!.closest('.hidden')).not.toBeNull();
  } finally {unmount();window.history.replaceState(null,'',originalUrl);}
});

it.each([false, true])("workflow layout routes every section to matching properties and preserves selection on mobile=%s", async mobile => {
  const originalUrl = window.location.href;
  window.history.replaceState(null, '', '/bin?layout=workflow');
  const shape = rectangularShape('flow-tool', 'Tool');
  const finger = fingerHoleSchema.parse({ id: 'flow-finger', name: 'Thumb', center: { x: 0, y: 0 } });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts: [parseCutoutPlacement({ id: 'flow-pocket', shapeId: shape.id, position: { x: 0, y: 0 } })], fingerHoles: [finger] });
  const { container, unmount } = renderPage({ mobile });
  try {
    await flushHydration();
    const left = container.querySelector('#workflow-panel')!;
    const right = container.querySelector('[data-testid="selection-inspector"]')!;
    const canvas = container.querySelector('[data-testid="inspector-workspace-canvas"]');
    const chooseSection = (name: string) => React.act(() => left.querySelector<HTMLButtonElement>(`[aria-label="${name} — show properties"]`)!.click());
    expect(left.querySelector('[aria-label="Find bin settings"]')).toBeNull();
    expect(left.textContent).not.toContain('Find a setting');
    expect(left.querySelector('[aria-label="Clear object selection"]')).toBeNull();
    expect([...left.querySelectorAll('button')].find(button => button.textContent === 'Select all')).toBeUndefined();
    expect(left.querySelector('#bin-settings-pockets')).not.toBeNull();
    expect(left.querySelector('#bin-settings-finger-holes')).not.toBeNull();
    expect(left.querySelectorAll('button[data-testid^="workflow-section-"]')).toHaveLength(6);
    expect(left.querySelector('[aria-label="Width in standard cells"]')).toBeNull();
    for (const [name, tone, selector] of [
      ['Bin size', 'blue', '[aria-label="Width in standard cells"]'],
      ['Construction', 'rose', '#bin-settings-construction'],
      ['Materials & Colors', 'amber', '#input-bin-color'],
      ['Check fit', 'indigo', '#bin-settings-fit'],
      ['Export', 'emerald', '[data-testid="button-export-3mf"]'],
      ['Project', 'slate', '[aria-label="Browser library"]'],
    ]) {
      chooseSection(name);
      expect(right.querySelector('[data-testid="inspector-properties-header"] h3')!.textContent).toBe(name);
      expect(right.querySelector(selector)).not.toBeNull();
      expect(right.querySelector('[data-testid="inspector-properties-header"]')!.getAttribute('data-property-tone')).toBe(tone);
      expect(right.querySelector('[data-testid="inspector-bin-settings"] > [data-property-tone]')!.getAttribute('data-property-tone')).toBe(tone);
      expect(left.querySelector(`[aria-label="${name} — show properties"]`)!.getAttribute('aria-pressed')).toBe('true');
    }
    selectPocket(container, 'flow-pocket');
    expect(right.querySelector('#pocket-properties')!.getAttribute('data-property-tone')).toBe('violet');
    chooseSection('Export');
    expect(left.querySelector<HTMLInputElement>('[aria-label="Include Tool in selection"]')!.checked).toBe(true);
    selectPocket(container, 'flow-pocket');
    expect(right.querySelector('#pocket-properties')!.closest('[hidden]')).toBeNull();
    openSettingsSection(container, 'finger-holes');
    React.act(() => left.querySelector<HTMLButtonElement>('[aria-label="Thumb — edit finger access properties"]')!.click());
    expect(right.querySelector('#finger-access-properties')!.getAttribute('data-property-tone')).toBe('cyan');
    chooseSection('Bin size');
    expect(left.querySelector('[aria-label="Thumb — edit finger access properties"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(right.querySelector('[data-testid="inspector-properties-header"] h3')!.textContent).toBe('Bin size');
    if (mobile) React.act(() => Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'Workflow')!.click());
    openSettingsSection(container, 'finger-holes');
    for (const id of ['bin-settings-finger-holes', 'bin-settings-pockets']) {
      const section = left.querySelector(`#${id}`)!;
      const trigger = section.querySelector<HTMLButtonElement>('[data-panel-section-trigger]')!;
      expect(section.getAttribute('data-state')).toBe('open');
      React.act(() => trigger.click());
      expect(section.getAttribute('data-state')).toBe('closed');
      React.act(() => trigger.click());
      expect(section.getAttribute('data-state')).toBe('open');
      expect(left.hasAttribute('hidden')).toBe(false);
    }
    expect(container.querySelector('[data-testid="inspector-workspace-canvas"]')).toBe(canvas);
  } finally { unmount(); window.history.replaceState(null, '', originalUrl); }
});

it.each(["standard", "workflow"])("mobile canvas selection and inline editing remain accessible (%s)", async layout => {
  const originalUrl=window.location.href; window.history.replaceState(null,"",`/bin?layout=${layout}`);
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({...EMPTY_PROJECT,
    spec:parseBinSpec({...EMPTY_PROJECT.spec,surfaceTexts:[{id:"audit-text",text:"Audit text",position:{x:0,y:20}}]})});
  const {container,unmount}=renderPage({mobile:true,experimental:false});
  try {
    await flushHydration();
    React.act(()=>container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
    const hit=container.querySelector('[data-testid="surface-text-hit-audit-text"]')!;
    const layer = container.querySelector('[data-testid="surface-text-layer"]')!;
    vi.stubGlobal("DOMPoint", class { constructor(public x: number, public y: number) {} matrixTransform() { return this; } });
    Object.defineProperty(layer, "getScreenCTM", { value: () => ({ inverse: () => ({}) }) });
    Object.defineProperty(hit.parentElement!, "setPointerCapture", { value: vi.fn() });
    for (const type of ["pointerdown", "pointerup"]) React.act(() => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: 10, clientY: 10 });
      Object.defineProperty(event, "pointerId", { value: 1 }); hit.dispatchEvent(event);
    });
    expect(document.querySelector('[data-testid="surface-text-editor"]')).not.toBeNull();
    expect(document.querySelector('[role="dialog"][data-state="open"]')).toBeNull();
    React.act(()=>hit.dispatchEvent(new MouseEvent("dblclick",{bubbles:true,button:0})));
    const inline=container.querySelector<HTMLInputElement>('[aria-label="Edit surface text wording"]');
    expect(inline).not.toBeNull();
    expect(document.querySelector('[role="dialog"][data-state="open"]')).toBeNull();
    expect(document.activeElement).toBe(inline);
  } finally {unmount();window.history.replaceState(null,"",originalUrl);}
});

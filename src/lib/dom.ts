/**
 * Minimal DOM builder.
 *
 * Everything rendered here comes from the game data dump, which contains
 * characters like `<` and `&`. Building real nodes and assigning textContent
 * means there is no HTML string to escape, so none of it can be misread as
 * markup.
 */

type Attrs = Record<string, string | number | boolean | EventListener | null | undefined>;
export type Child = Node | string | number | null | undefined | false | Child[];

function append(parent: Node, child: Child): void {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) {
    for (const c of child) append(parent, c);
  } else if (child instanceof Node) {
    parent.appendChild(child);
  } else {
    parent.appendChild(document.createTextNode(String(child)));
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k === 'class') {
        el.className = String(v);
      } else if (k === 'text') {
        el.textContent = String(v);
      } else if (v === true) {
        el.setAttribute(k, '');
      } else {
        el.setAttribute(k, String(v));
      }
    }
  }
  append(el, children);
  return el;
}

export function clear(el: Element): void {
  el.replaceChildren();
}

/** Format a number with thin thousands separators. */
export function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

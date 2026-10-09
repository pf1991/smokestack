/** A child may be a node, text, a number, a skipped value, or (recursively) an array of children. */
export type Child = Node | string | number | null | false | undefined | Child[];

/** Props that must be set as DOM properties, not attributes, so the live state is what changes. */
const DOM_PROPS = new Set(['value', 'checked', 'selected', 'disabled']);

function appendChild(parent: Node, child: Child): void {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) {
    for (const c of child) appendChild(parent, c);
    return;
  }
  parent.appendChild(
    typeof child === 'string' || typeof child === 'number'
      ? document.createTextNode(String(child))
      : child,
  );
}

/**
 * Tiny element factory. Props starting with `on` attach listeners (`onClick` → 'click') and
 * non-function `on*` values are ignored. `class` sets className, `style` accepts an object,
 * `value`/`checked`/`selected`/`disabled` set DOM properties, `true` sets a bare attribute,
 * and `false`/`null`/`undefined` are skipped. Children may be nested arrays.
 */
export function h(
  tag: string,
  props?: Record<string, unknown> | null,
  ...children: Child[]
): HTMLElement {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (key.startsWith('on')) {
      if (typeof value === 'function' && key.length > 2) {
        el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      }
      continue;
    }
    if (value === undefined || value === null || value === false) continue;
    if (DOM_PROPS.has(key)) {
      (el as unknown as Record<string, unknown>)[key] = value;
    } else if (key === 'class') {
      el.className = String(value);
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value as Record<string, string>);
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children) appendChild(el, child);
  return el;
}

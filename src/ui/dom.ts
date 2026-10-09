export type Child = Node | string | null | false | undefined;

/**
 * Tiny element factory. Props starting with `on` attach listeners (`onClick` → 'click'),
 * `class` sets className, `style` accepts an object, `true` sets a bare attribute,
 * and `false`/`null`/`undefined` are skipped.
 */
export function h(
  tag: string,
  props?: Record<string, unknown> | null,
  ...children: Child[]
): HTMLElement {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && key.length > 2 && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
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
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

import { type IconId, iconDataUrl } from '../render/icons';

/**
 * `<img class="icon">` showing atlas icon `id` at `size` CSS px. Give a `label` when the icon
 * stands alone (it becomes the alt text); without one the icon is decorative and hidden from
 * assistive tech, so put the words next to it.
 */
export function iconEl(id: IconId, size = 16, label?: string): HTMLElement {
  const img = document.createElement('img');
  img.className = 'icon';
  img.setAttribute('width', String(size));
  img.setAttribute('height', String(size));
  img.setAttribute('alt', label ?? '');
  img.setAttribute('role', 'img');
  if (!label) img.setAttribute('aria-hidden', 'true');
  img.dataset.icon = id;
  const src = iconDataUrl(id, size);
  if (src) img.src = src;
  return img;
}

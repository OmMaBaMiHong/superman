import type { SerializedRange } from './rangeSerializer';

/**
 * Locate the text node and local offset within `root` for a (selector, offset)
 * pair previously produced by the serializer. The offset is treated as the
 * character distance from the start of the matched element's text content.
 */
function findNode(
  root: HTMLElement,
  selector: string,
  offset: number,
): { node: Node; offset: number } | null {
  const element = root.querySelector(selector);
  if (!element) return null;

  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  while (walker.nextNode()) {
    const textNode = walker.currentNode;
    const length = textNode.textContent?.length ?? 0;
    if (remaining <= length) {
      return { node: textNode, offset: remaining };
    }
    remaining -= length;
  }
  return null;
}

/**
 * Restore a Range from a SerializedRange descriptor relative to `root`.
 * Returns null if any step fails (e.g. selector no longer matches).
 */
export function restoreRange(serialized: SerializedRange, root: HTMLElement): Range | null {
  try {
    const start = findNode(root, serialized.rangeStartSelector, serialized.rangeStartOffset);
    const end = findNode(root, serialized.rangeEndSelector, serialized.rangeEndOffset);
    if (!start || !end) return null;

    const range = document.createRange();
    range.setStart(start.node, Math.min(start.offset, start.node.textContent?.length ?? 0));
    range.setEnd(end.node, Math.min(end.offset, end.node.textContent?.length ?? 0));
    return range;
  } catch {
    return null;
  }
}

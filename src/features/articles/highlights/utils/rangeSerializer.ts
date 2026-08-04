export interface SerializedRange {
  rangeStartSelector: string;
  rangeStartOffset: number;
  rangeEndSelector: string;
  rangeEndOffset: number;
  text: string;
}

function escapeAttributeValue(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, '\\$&');
}

/**
 * Build a CSS selector that targets the element containing `node`.
 *
 * Walks up from `node` to `root`. When an ancestor element carries a
 * `data-paragraph-id` attribute, the selector anchors on it and stops,
 * which keeps the path stable across re-renders that preserve paragraph ids.
 * Otherwise, each step is encoded as `tag:nth-child(index+1)`.
 */
export function buildSelector(node: Node, root: HTMLElement): string {
  const targetElement =
    node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element | null);
  if (!targetElement || !root.contains(targetElement)) {
    return '';
  }

  const parts: string[] = [];
  let current: Element | null = targetElement;

  while (current && current !== root && root.contains(current)) {
    const paragraphId = current.getAttribute('data-paragraph-id');
    if (paragraphId) {
      parts.unshift(`[data-paragraph-id="${escapeAttributeValue(paragraphId)}"]`);
      break;
    }

    const parent: Element | null = current.parentElement;
    if (!parent) break;
    const index = Array.from(parent.children).indexOf(current) + 1;
    if (index <= 0) break;
    const tagName = current.tagName.toLowerCase();
    parts.unshift(`${tagName}:nth-child(${index})`);

    current = parent;
  }

  return parts.join(' > ');
}

/**
 * Convert a (node, offset) pair from the Range API into a character offset
 * measured from the start of the containing element's text content. This
 * makes the offset resilient to text node splits after serialization.
 */
function computeAbsoluteOffset(node: Node, offset: number): number {
  if (node.nodeType !== Node.TEXT_NODE) {
    return offset;
  }
  const parent = node.parentElement;
  if (!parent) return offset;

  const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT);
  let absoluteOffset = 0;
  while (walker.nextNode()) {
    if (walker.currentNode === node) {
      return absoluteOffset + offset;
    }
    absoluteOffset += walker.currentNode.textContent?.length ?? 0;
  }
  return offset;
}

/**
 * Serialize a DOM Selection Range into a persistable position descriptor.
 * Returns null when the range cannot be expressed relative to `root`.
 */
export function serializeRange(range: Range, root: HTMLElement): SerializedRange | null {
  try {
    const startSelector = buildSelector(range.startContainer, root);
    const endSelector = buildSelector(range.endContainer, root);
    if (!startSelector || !endSelector) return null;

    const startOffset = computeAbsoluteOffset(range.startContainer, range.startOffset);
    const endOffset = computeAbsoluteOffset(range.endContainer, range.endOffset);
    const text = range.toString();

    return {
      rangeStartSelector: startSelector,
      rangeStartOffset: startOffset,
      rangeEndSelector: endSelector,
      rangeEndOffset: endOffset,
      text,
    };
  } catch {
    return null;
  }
}

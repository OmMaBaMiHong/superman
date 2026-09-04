const CHUNK_MAX_CHARS = 2000;
const CHUNK_OVERLAP_CHARS = 50;

/**
 * 按段落分割文章内容，每个 chunk 约 512 tokens（约 2000 字符），
 * 相邻 chunk 重叠 50 字符，保留标题作为上下文前缀。
 */
export function chunkArticle(
  content: string,
  title: string,
): Array<{ text: string; index: number }> {
  if (!content.trim()) {
    return [];
  }

  const paragraphs = content.split(/\n\n+/).filter(Boolean);
  const chunks: Array<{ text: string; index: number }> = [];
  let currentChunk = '';
  let currentIndex = 0;

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;

    // 如果当前段落本身超过最大长度，需要拆分成更小的块
    if (trimmed.length > CHUNK_MAX_CHARS) {
      // 先保存当前累积的内容
      if (currentChunk) {
        chunks.push({
          text: title ? `[${title}]\n${currentChunk.trim()}` : currentChunk.trim(),
          index: currentIndex++,
        });
        currentChunk = '';
      }

      // 将长段落按句子拆分为多个 chunk
      const sentences = trimmed.match(/[^。！？\n]+[。！？]?/g) ?? [trimmed];
      let sentenceBuffer = '';

      for (const sentence of sentences) {
        if ((sentenceBuffer + sentence).length > CHUNK_MAX_CHARS && sentenceBuffer) {
          chunks.push({
            text: title ? `[${title}]\n${sentenceBuffer.trim()}` : sentenceBuffer.trim(),
            index: currentIndex++,
          });
          sentenceBuffer = sentenceBuffer.slice(-CHUNK_OVERLAP_CHARS) + sentence;
        } else {
          sentenceBuffer += sentence;
        }
      }

      if (sentenceBuffer) {
        chunks.push({
          text: title ? `[${title}]\n${sentenceBuffer.trim()}` : sentenceBuffer.trim(),
          index: currentIndex++,
        });
      }

      continue;
    }

    // 如果加入当前段落会超过最大长度，先保存当前 chunk
    const separator = currentChunk ? '\n\n' : '';
    if ((currentChunk + separator + trimmed).length > CHUNK_MAX_CHARS && currentChunk) {
      chunks.push({
        text: title ? `[${title}]\n${currentChunk.trim()}` : currentChunk.trim(),
        index: currentIndex++,
      });
      // 保留尾部重叠内容
      currentChunk = currentChunk.slice(-CHUNK_OVERLAP_CHARS) + '\n\n' + trimmed;
    } else {
      currentChunk += separator + trimmed;
    }
  }

  // 保存最后一个 chunk
  if (currentChunk) {
    chunks.push({
      text: title ? `[${title}]\n${currentChunk.trim()}` : currentChunk.trim(),
      index: currentIndex++,
    });
  }

  return chunks;
}
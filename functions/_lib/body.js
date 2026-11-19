export class BodyTooLarge extends Error {}
export async function readLimitedText(request, limit) {
  if (Number(request.headers.get('Content-Length')) > limit) throw new BodyTooLarge();
  const reader = request.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0, result = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => {});
        throw new BodyTooLarge();
      }
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally { reader.releaseLock(); }
}

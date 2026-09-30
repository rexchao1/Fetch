/**
 * Read enough of a body to tell a playlist from media, and hand back a stream
 * that still yields every byte, the peeked ones first.
 */
export async function peekBody(body: ReadableStream<Uint8Array>, want = 64) {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let done = false;
  while (size < want) {
    const next = await reader.read();
    if (next.done) {
      done = true;
      break;
    }
    chunks.push(next.value);
    size += next.value.byteLength;
  }
  const headBytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    headBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const head = new TextDecoder().decode(headBytes.subarray(0, want));
  const rest = new ReadableStream<Uint8Array>({
    start(controller) {
      if (size) controller.enqueue(headBytes);
      if (done) controller.close();
    },
    async pull(controller) {
      if (done) return;
      const next = await reader.read();
      if (next.done) {
        done = true;
        controller.close();
      } else {
        controller.enqueue(next.value);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return { head: head.replace(/^\uFEFF/, ""), body: rest };
}

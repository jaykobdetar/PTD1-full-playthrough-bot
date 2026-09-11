/** Video-export-only observation. The original module is never edited and
 * the getter cannot alter the private identity allocator. */
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (new URL(url).pathname.endsWith('/src/model.js')) {
    return { ...result, source: String(result.source) + '\nexport function videoNextId() { return nextId; }\n' };
  }
  return result;
}

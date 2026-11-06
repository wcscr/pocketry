/** Let Node evaluation import the app's Vite-only Manifold WASM asset URL. */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.includes('manifold-3d/manifold.wasm') || /\/manifold\.wasm(?:\?url)?$/.test(specifier)) {
    return { url: new URL('./node-wasm-url.mjs', import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

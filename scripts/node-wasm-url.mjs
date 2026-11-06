import { createRequire } from 'node:module';
export default createRequire(import.meta.url).resolve('manifold-3d/manifold.wasm');

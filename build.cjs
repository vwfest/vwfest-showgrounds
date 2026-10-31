require('fs').rmSync('docs/js', { recursive: true, force: true }); // no stale hashed chunks (docs/ is published as-is)
// Bundles the client (Three.js is local, no CDN) into docs/js. Wallet/Solana code is a lazy chunk loaded only when someone buys.
const entries = ['src/main.js']; if (process.env.PREVIEW) entries.push('src/preview.js');
require('esbuild').build({ entryPoints: entries, bundle: true, minify: !process.env.DEV, format: 'esm', splitting: true, target: 'es2020', outdir: 'docs/js', chunkNames: 'chunks/[name]-[hash]', legalComments: 'none', logLevel: 'info', define: { global: 'globalThis' } }).catch(() => process.exit(1));

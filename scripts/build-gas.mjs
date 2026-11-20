import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const outDir = path.resolve(rootDir, 'dist-gas');
const gasDir = path.resolve(rootDir, 'gas');
const sourceAssetsDir = path.resolve(rootDir, 'public', 'assets', 'aistudio');

// Keep each generated GAS HTML partial <= ~3.1 MB to avoid Apps Script web IDE editor
// lag/save timeouts while keeping total Apps Script project well within the 50 MB limit.
const MAX_ASSET_PARTIAL_BYTES = 3_150_000;
const APPS_SCRIPT_PROJECT_LIMIT_BYTES = 50 * 1024 * 1024;

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
};

function detectImageMime(filename, buffer) {
  const ext = path.extname(filename).toLowerCase();
  if (MIME_BY_EXT[ext]) {
    return MIME_BY_EXT[ext];
  }

  // Fallback magic-byte check for extensionless image files
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === 'GIF8') {
    return 'image/gif';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
}

async function collectSourceImageAssets() {
  let dirEntries = [];
  try {
    dirEntries = await fs.readdir(sourceAssetsDir, { withFileTypes: true });
  } catch (err) {
    throw new Error(`Missing source asset directory: ${sourceAssetsDir}`);
  }

  const fileNames = dirEntries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'en'));

  const assets = [];
  const skippedNonImages = [];

  for (const filename of fileNames) {
    const fullPath = path.join(sourceAssetsDir, filename);
    const rawBuffer = await fs.readFile(fullPath);
    const mimeType = detectImageMime(filename, rawBuffer);

    if (!mimeType) {
      skippedNonImages.push({ filename, bytes: rawBuffer.length });
      continue;
    }

    const sha256 = crypto.createHash('sha256').update(rawBuffer).digest('hex');
    const canonicalPath = `/assets/aistudio/${filename}`;
    const encodedPath = `/assets/aistudio/${encodeURIComponent(filename)}`;
    const base64Data = rawBuffer.toString('base64');
    const dataUri = `data:${mimeType};base64,${base64Data}`;

    assets.push({
      filename,
      path: canonicalPath,
      encodedPath: encodedPath !== canonicalPath ? encodedPath : undefined,
      mimeType,
      bytes: rawBuffer.length,
      sha256,
      dataUri,
    });
  }

  return { assets, skippedNonImages };
}

function escapeScriptTag(jsContent) {
  return jsContent.replace(/<\/script/gi, '<\\/script');
}

function buildAssetPartials(assets) {
  const partials = [];
  let currentEntries = [];
  let currentSize = 0;

  const flushPartial = () => {
    if (currentEntries.length === 0) return;
    const partialIndex = partials.length + 1;
    const partialName = `Assets_${String(partialIndex).padStart(2, '0')}`;
    const lines = [
      '(function() {',
      '  var map = (window.__ALLONSY_GAS_ASSETS__ = window.__ALLONSY_GAS_ASSETS__ || {});',
    ];

    for (const item of currentEntries) {
      lines.push(`  map[${JSON.stringify(item.path)}] = ${JSON.stringify(item.dataUri)};`);
      if (item.encodedPath) {
        lines.push(`  map[${JSON.stringify(item.encodedPath)}] = map[${JSON.stringify(item.path)}];`);
      }
      item.partial = partialName;
    }

    lines.push('})();');
    const safeBody = escapeScriptTag(lines.join('\n'));
    const htmlContent = `<script>\n${safeBody}\n</script>\n`;
    partials.push({
      partialName,
      fileName: `${partialName}.html`,
      htmlContent,
      bytes: Buffer.byteLength(htmlContent, 'utf8'),
      assetPaths: currentEntries.map((e) => e.path),
    });

    currentEntries = [];
    currentSize = 0;
  };

  for (const asset of assets) {
    const estimatedEntrySize = asset.dataUri.length + asset.path.length * 2 + 128;

    // If a single asset exceeds MAX_ASSET_PARTIAL_BYTES, split its base64 across chunk partials
    if (estimatedEntrySize > MAX_ASSET_PARTIAL_BYTES) {
      flushPartial();
      const chunkSize = Math.max(256_000, MAX_ASSET_PARTIAL_BYTES - 1024);
      const chunks = [];
      for (let offset = 0; offset < asset.dataUri.length; offset += chunkSize) {
        chunks.push(asset.dataUri.slice(offset, offset + chunkSize));
      }

      const chunkPartialNames = [];
      chunks.forEach((chunkStr, idx) => {
        const partialIndex = partials.length + 1;
        const partialName = `Assets_${String(partialIndex).padStart(2, '0')}`;
        chunkPartialNames.push(partialName);
        const isLast = idx === chunks.length - 1;
        const chunkLines = [
          '(function() {',
          '  var chunks = (window.__ALLONSY_GAS_ASSET_CHUNKS__ = window.__ALLONSY_GAS_ASSET_CHUNKS__ || {});',
          `  var list = (chunks[${JSON.stringify(asset.path)}] = chunks[${JSON.stringify(asset.path)}] || []);`,
          `  list[${idx}] = ${JSON.stringify(chunkStr)};`,
        ];
        if (isLast) {
          chunkLines.push(
            '  var map = (window.__ALLONSY_GAS_ASSETS__ = window.__ALLONSY_GAS_ASSETS__ || {});',
            `  map[${JSON.stringify(asset.path)}] = list.join('');`,
            `  delete chunks[${JSON.stringify(asset.path)}];`
          );
          if (asset.encodedPath) {
            chunkLines.push(`  map[${JSON.stringify(asset.encodedPath)}] = map[${JSON.stringify(asset.path)}];`);
          }
        }
        chunkLines.push('})();');
        const safeChunkBody = escapeScriptTag(chunkLines.join('\n'));
        const htmlContent = `<script>\n${safeChunkBody}\n</script>\n`;
        partials.push({
          partialName,
          fileName: `${partialName}.html`,
          htmlContent,
          bytes: Buffer.byteLength(htmlContent, 'utf8'),
          assetPaths: [asset.path],
        });
      });

      asset.partial = chunkPartialNames.join(', ');
      continue;
    }

    if (currentEntries.length > 0 && currentSize + estimatedEntrySize > MAX_ASSET_PARTIAL_BYTES) {
      flushPartial();
    }

    currentEntries.push(asset);
    currentSize += estimatedEntrySize;
  }

  flushPartial();
  return partials;
}

async function removeStaleAssetPartials() {
  await fs.mkdir(gasDir, { recursive: true });
  const existing = await fs.readdir(gasDir);
  await Promise.all(
    existing
      .filter((name) => /^Assets(_\d+|Manifest)\.html$/i.test(name))
      .map((name) => fs.unlink(path.join(gasDir, name)))
  );
}

async function buildGasPackage() {
  process.env.NODE_ENV = 'production';
  console.log('[build:gas] Compiling production React bundle & embedded image assets for Google Apps Script HtmlService...');

  await build({
    root: rootDir,
    configFile: false,
    mode: 'production',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': rootDir,
      },
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    build: {
      outDir,
      emptyOutDir: true,
      cssCodeSplit: false,
      sourcemap: false,
      minify: 'esbuild',
      rollupOptions: {
        input: path.resolve(rootDir, 'src/main.tsx'),
        output: {
          format: 'iife',
          inlineDynamicImports: true,
          name: 'AllonsyTrackerApp',
          entryFileNames: 'allonsy-app.js',
          assetFileNames: 'allonsy-[name][extname]',
        },
      },
    },
  });

  const files = await fs.readdir(outDir);
  const cssFile = files.find((f) => f.endsWith('.css'));
  const jsFile = files.find((f) => f.endsWith('.js'));

  if (!jsFile) {
    throw new Error('GAS build failed: missing JS bundle in dist-gas/');
  }

  const rawJs = await fs.readFile(path.join(outDir, jsFile), 'utf8');
  const rawCss = cssFile ? await fs.readFile(path.join(outDir, cssFile), 'utf8') : '';

  const safeJs = escapeScriptTag(rawJs);
  const safeCss = rawCss.replace(/<\/style/gi, '<\\/style');

  const { assets, skippedNonImages } = await collectSourceImageAssets();
  if (assets.length === 0) {
    throw new Error(`No image assets found in ${sourceAssetsDir}`);
  }

  await removeStaleAssetPartials();

  const assetPartials = buildAssetPartials(assets);
  const manifestEntries = assets.map(({ filename, path: assetPath, encodedPath, mimeType, bytes, sha256, partial }) => ({
    filename,
    path: assetPath,
    ...(encodedPath ? { encodedPath } : {}),
    mimeType,
    bytes,
    sha256,
    partial,
  }));

  const manifestBody = escapeScriptTag(
    [
      'window.__ALLONSY_GAS_ASSETS__ = window.__ALLONSY_GAS_ASSETS__ || {};',
      `window.__ALLONSY_GAS_ASSET_MANIFEST__ = ${JSON.stringify(manifestEntries, null, 2)};`,
    ].join('\n')
  );
  const manifestHtml = `<script>\n${manifestBody}\n</script>\n`;

  const assetIncludeLines = [
    "    <?!= include('AssetsManifest'); ?>",
    ...assetPartials.map((p) => `    <?!= include('${p.partialName}'); ?>`),
  ].join('\n');

  const indexHtml = `<!doctype html>
<html lang="uk">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Allonsy Time Tracker — Облік часу та управління задачами</title>
    <?!= include('Styles'); ?>
  </head>
  <body class="bg-bg-2 text-fg">
    <div id="root"></div>
    <script>
      window.__ALLONSY_BUILD_TARGET__ = 'gas-htmlservice';
      window.__ALLONSY_GAS_ASSETS__ = window.__ALLONSY_GAS_ASSETS__ || {};
    </script>
${assetIncludeLines}
    <?!= include('AppScript'); ?>
  </body>
</html>
`;

  const stylesHtml = `<style>\n${safeCss}\n</style>\n`;
  const appScriptHtml = `<script>\n${safeJs}\n</script>\n`;

  await fs.writeFile(path.join(gasDir, 'Index.html'), indexHtml, 'utf8');
  await fs.writeFile(path.join(gasDir, 'Styles.html'), stylesHtml, 'utf8');
  await fs.writeFile(path.join(gasDir, 'AssetsManifest.html'), manifestHtml, 'utf8');
  await fs.writeFile(path.join(gasDir, 'AppScript.html'), appScriptHtml, 'utf8');

  for (const partial of assetPartials) {
    await fs.writeFile(path.join(gasDir, partial.fileName), partial.htmlContent, 'utf8');
  }

  const generatedFiles = ['Index.html', 'Styles.html', 'AssetsManifest.html', ...assetPartials.map((p) => p.fileName), 'AppScript.html'];
  const fileStats = await Promise.all(
    generatedFiles.map(async (fileName) => {
      const st = await fs.stat(path.join(gasDir, fileName));
      return { fileName, bytes: st.size };
    })
  );

  const codeGsStat = await fs.stat(path.join(gasDir, 'Code.gs'));
  const totalHtmlBytes = fileStats.reduce((sum, f) => sum + f.bytes, 0);
  const totalGasProjectBytes = totalHtmlBytes + codeGsStat.size;
  const totalSourceImageBytes = assets.reduce((sum, a) => sum + a.bytes, 0);

  if (totalGasProjectBytes > APPS_SCRIPT_PROJECT_LIMIT_BYTES) {
    throw new Error(
      `Total GAS project size (${totalGasProjectBytes} bytes) exceeds 50 MB Apps Script limit!`
    );
  }

  await fs.writeFile(
    path.join(outDir, 'gas-asset-manifest.json'),
    JSON.stringify(
      {
        includedImageCount: assets.length,
        totalSourceImageBytes,
        skippedNonImages,
        maxPartialCapBytes: MAX_ASSET_PARTIAL_BYTES,
        appsScriptProjectLimitBytes: APPS_SCRIPT_PROJECT_LIMIT_BYTES,
        totalGeneratedHtmlBytes: totalHtmlBytes,
        totalGasProjectBytes,
        generatedFiles: fileStats,
        assets: manifestEntries,
      },
      null,
      2
    ),
    'utf8'
  );

  console.log(`[build:gas] Embedded ${assets.length} source image assets (${totalSourceImageBytes.toLocaleString('en-US')} raw bytes).`);
  if (skippedNonImages.length > 0) {
    console.log(
      `[build:gas] Skipped ${skippedNonImages.length} non-image file(s): ${skippedNonImages.map((s) => `${s.filename} (${s.bytes} B)`).join(', ')}`
    );
  }
  console.log('[build:gas] Exported GAS HtmlService files successfully:');
  for (const f of fileStats) {
    console.log(`  - gas/${f.fileName.padEnd(20)} ${(f.bytes / 1024).toFixed(1).padStart(8)} KB (${f.bytes.toLocaleString('en-US')} B)`);
  }
  console.log(
    `[build:gas] Total GAS HTML bundle: ${(totalHtmlBytes / (1024 * 1024)).toFixed(2)} MB (${totalHtmlBytes.toLocaleString('en-US')} B) / 50 MB project limit.`
  );
}

buildGasPackage().catch((err) => {
  console.error('[build:gas] Failed:', err);
  process.exit(1);
});

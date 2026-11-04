// 交互可视化：viz-raw/ 里的独立 HTML 原样复制到 public/viz-raw/，
// 并读取 <title> 和 <meta name="description"> 作为图库元数据。
//
//   viz-raw/fourier.html            → /viz-raw/fourier.html（原始页面） + /viz/fourier/（带说明的浏览页）
//   viz-raw/attention/index.html    → /viz-raw/attention/index.html     + /viz/attention/
//   viz-raw/_shared/…               → 下划线开头的文件/文件夹只复制、不进图库（放公共脚本、数据）
import fs from 'node:fs';
import path from 'node:path';

export const VIZ_SRC = path.resolve('viz-raw');

/** 找出所有可视化：顶层的 *.html，以及 子文件夹/index.html */
export function listViz() {
  if (!fs.existsSync(VIZ_SRC)) return [];
  const out = [];
  for (const ent of fs.readdirSync(VIZ_SRC, { withFileTypes: true })) {
    if (ent.name.startsWith('_') || ent.name.startsWith('.')) continue;
    if (ent.isFile() && ent.name.endsWith('.html')) {
      out.push({ id: ent.name.slice(0, -5).toLowerCase(), file: ent.name });
    } else if (ent.isDirectory() && fs.existsSync(path.join(VIZ_SRC, ent.name, 'index.html'))) {
      out.push({ id: ent.name.toLowerCase(), file: `${ent.name}/index.html` });
    }
  }
  return out;
}

const decode = (s) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function meta(html, name) {
  const re = new RegExp(`<meta[^>]+name=["']${name}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return content ? decode(content.trim()) : undefined;
}

export function readVizMeta({ id, file }) {
  const abs = path.join(VIZ_SRC, file);
  const html = fs.readFileSync(abs, 'utf8');
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  return {
    id,
    data: {
      title: title ? decode(title) : id,
      description: meta(html, 'description'),
      date: meta(html, 'viz:date') ?? fs.statSync(abs).mtime.toISOString().slice(0, 10),
      tags: meta(html, 'viz:tags')?.split(/[,，]\s*/).filter(Boolean) ?? [],
      height: Number(meta(html, 'viz:height')) || undefined,
      // npm run thumbs 生成的缩略图
      thumb: fs.existsSync(path.join(VIZ_SRC, '_thumbs', `${id}.jpg`)) ? `_thumbs/${id}.jpg` : undefined,
      file,
    },
  };
}

/** 内容集合 loader：getCollection('viz') */
export function vizLoader() {
  return {
    name: 'viz-loader',
    load: async ({ store, parseData, watcher }) => {
      const sync = async () => {
        store.clear();
        for (const v of listViz()) {
          const { id, data } = readVizMeta(v);
          store.set({ id, data: await parseData({ id, data }) });
        }
      };
      await sync();
      watcher?.add(VIZ_SRC);
      watcher?.on('all', (_e, p) => p.startsWith(VIZ_SRC) && sync());
    },
  };
}

function copyAll(dest, logger) {
  fs.rmSync(dest, { recursive: true, force: true });
  if (!fs.existsSync(VIZ_SRC)) return;
  fs.cpSync(VIZ_SRC, dest, { recursive: true });
  logger?.info(`复制了 ${listViz().length} 个可视化到 public/viz-raw/`);
}

/** Astro 集成：启动和构建前复制，dev 下监听改动并刷新页面 */
export function vizIntegration() {
  return {
    name: 'viz-raw',
    hooks: {
      'astro:config:setup': ({ config, updateConfig, logger }) => {
        const dest = path.join(new URL(config.publicDir).pathname, 'viz-raw');
        copyAll(dest, logger);
        updateConfig({
          vite: {
            plugins: [
              {
                name: 'viz-raw-watch',
                configureServer(server) {
                  server.watcher.add(VIZ_SRC);
                  server.watcher.on('all', (_e, p) => {
                    if (!p.startsWith(VIZ_SRC)) return;
                    copyAll(dest);
                    server.ws.send({ type: 'full-reload' });
                  });
                },
              },
            ],
          },
        });
      },
    },
  };
}

import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { SITE } from '../site.config';

export async function GET(context) {
  const posts = (await getCollection('blog', (p) => p.data.publish)).sort(
    (a, b) => (b.data.date?.valueOf() ?? 0) - (a.data.date?.valueOf() ?? 0),
  );
  return rss({
    title: SITE.title,
    description: SITE.description,
    site: context.site,
    items: posts.map((p) => ({
      title: p.data.title ?? p.id,
      description: p.data.description,
      pubDate: p.data.date,
      link: `/blog/${p.id}/`,
    })),
    customData: `<language>${SITE.lang}</language>`,
  });
}

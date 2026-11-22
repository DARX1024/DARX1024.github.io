// 站点信息：改这里即可
export const SITE = {
  title: 'Darx',
  author: 'Darx',
  tagline: '', // 首页名字上方的一行小字，留空不显示
  bio: '在读博士，研究生成式模型，主要是扩散模型和流匹配。这里放我的笔记，还有一些为了想明白概念而做的交互图。', // 首页名字下面的一两句话
  description: 'Darx 的个人网站：生成式模型方向的笔记和交互可视化。', // 搜索引擎和分享卡片用
  lang: 'zh-CN',
  github: 'https://github.com/DARX1024',
  email: '', // 留空则不显示
};

// 背景
export const BACKDROP = {
  // 半调点阵背景（halftone）：'home' 只在首页；'all' 所有页面（文章页只在右侧页边）；'off' 关闭。背景固定在视口上，不随滚动移动
  // 预览时也可以在网址后面加 ?halftone=off 临时关掉，?halftone=static 停止流动
  halftone: 'all' as 'off' | 'home' | 'all',
  // 是否缓慢流动（系统开了「减少动态效果」时总是静止）
  animate: true,
};

export const NAV: { href: string; label: string; match?: string[] }[] = [
  { href: '/blog/', label: '博客' },
  { href: '/notes/', label: '笔记' },
  { href: '/viz/', label: '可视化' },
  { href: '/life/', label: '生活', match: ['/games/'] },
  { href: '/about/', label: '关于' },
];

// 游戏墙
export const GAMES = {
  // Steam 个人主页。同步脚本（scripts/steam-sync.mjs）从这里找到你的 SteamID，资料和「游戏详情」需要设为公开
  steamProfile: 'https://steamcommunity.com/id/DARX1024/',
  // 自动把 Steam 库里玩过这么多小时以上的游戏也放上墙（没有建档也会显示，只有封面和时长）。
  // 设为 false 则只显示 src/content/games/ 里建了档的游戏。
  libraryMinHours: 10 as number | false,
  // 不想上墙的游戏（Steam appid）。同步脚本会自动跳过 Steam 标为成人内容的游戏，
  // 这里补充自动识别不到的，以及壁纸引擎这类不算游戏的软件。
  // 列在这里的游戏如果建了档（src/content/games/），仍然会显示：建档算作你明确想放。
  hide: [
    431960, // Wallpaper Engine
    823910, 1213740, 1227890, 1619750, 1737100, 1748620, 1793250, 2190290,
  ] as number[],
  // 生活页「评测墙」展示哪几篇 Steam 评测（按 appid），评测原文由同步脚本 scripts/steam-reviews.mjs 每天抓取。
  // 墙上按发布日期从新到旧排。评测第一行如果是短标题（比如【直面死亡，诠释生命】）会当作卡片标题；
  // quote 是卡片上的摘句，最好从原文里摘，不写就取正文开头。留空数组则不显示评测墙。
  reviewWall: [
    { appid: 3720420, quote: '优秀且完整的独立游戏，融入了许多有趣的梗，也致敬了许多游戏，经常能让人看到之后会心一笑。' }, // 卡片魔王：只剩个头！
    { appid: 1030300, quote: '我不再想批评，不再想捍卫，更不想否定。我要尝试着去尊重，尝试着承认自己的不完美，尝试着和解。' }, // 空洞骑士：丝之歌
    { appid: 1196590, quote: '在一个充满传奇人物的系列里，他可能是最不像英雄的人。但恰恰是因为如此，他是让我最为感动的人。' }, // 生化危机8 村庄
    { appid: 2407270, quote: '类魂游戏不应是为难而难的痛苦折磨，不应是故弄玄虚的幼稚剧情，更不应是由于设计失败导致难度曲线不合理后的可笑借口。' }, // AI LIMIT 无限机兵
    { appid: 1868140, quote: '对于很少有机会看海更遑论潜水的人而言，这个游戏远超预期地满足了我对于海洋的大部分想象。' }, // 潜水员戴夫
    { appid: 379430, quote: '因为制作者对于“真实性”的偏执损失了游戏本身的“趣味性”，身临其境却脱离了游戏。' }, // 天国：拯救
    { appid: 413150, quote: '当时本科快毕业了，和好兄弟在宿舍里联机种地。时间一晃到了现在，我研究生快毕业了，写着毕业论文的同时自己又完全通关了一遍。人生到处知何似，应似飞鸿踏雪泥。' }, // 星露谷物语
    { appid: 2161700, quote: '对于神木秋成而言，生命的意义不再是他自己能定义的，而是他短暂的生命能否影响到他人。也许这就是对于“太阳”最好的诠释了，燃烧着自己，温暖着别人。' }, // 女神异闻录3 Reload
  ] as { appid: number; quote?: string }[],
};

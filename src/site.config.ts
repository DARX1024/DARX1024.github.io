// 站点信息：改这里即可
export const SITE = {
  title: 'Darx',
  author: 'Darx',
  tagline: '', // 首页名字上方的一行小字，留空不显示
  bio: '生成式模型方向博士生。', // 首页名字下面的一句话
  description: '生成式模型方向博士生。这里放我的课程笔记、长文，以及一些帮助建立直觉的交互可视化。', // 搜索引擎和分享卡片用
  lang: 'zh-CN',
  github: 'https://github.com/DARX1024',
  email: '', // 留空则不显示
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
};

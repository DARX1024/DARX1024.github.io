// 生成 src/lib/land.ts 里的大陆轮廓数据（Natural Earth 1:110m，公有领域）。
// 用法：在临时目录 npm i world-atlas@2 topojson-client@3，然后
//   node scripts/build-land.cjs <那个目录> 0.8 6 > land.json
// 参数：简化容差（度）、最小面积（平方度，更小的岛屿丢掉）
const dir = process.argv[2];
const topo = require(dir + '/node_modules/world-atlas/land-110m.json');
const { feature } = require(dir + '/node_modules/topojson-client');
const land = feature(topo, topo.objects.land);
const rings = [];
for (const f of land.features) {
  const g = f.geometry;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (const p of polys) rings.push(p[0]);
}
function area(r){let a=0;for(let i=0;i<r.length-1;i++)a+=r[i][0]*r[i+1][1]-r[i+1][0]*r[i][1];return Math.abs(a/2);}
function dp(pts, eps){ if(pts.length<3)return pts; let m=0,idx=0; const [a,b]=[pts[0],pts[pts.length-1]];
  const dx=b[0]-a[0],dy=b[1]-a[1],L=Math.hypot(dx,dy)||1e-9;
  for(let i=1;i<pts.length-1;i++){const d=L<1e-6?Math.hypot(pts[i][0]-a[0],pts[i][1]-a[1]):Math.abs(dy*pts[i][0]-dx*pts[i][1]+b[0]*a[1]-b[1]*a[0])/L; if(d>m){m=d;idx=i;}}
  if(m<=eps) return [a,b]; return dp(pts.slice(0,idx+1),eps).slice(0,-1).concat(dp(pts.slice(idx),eps)); }
const eps = +process.argv[3] || 0.8, minA = +process.argv[4] || 6;
const out=[]; let n=0;
for (const r of rings) {
  if (area(r) < minA) continue;
  // 拆成两半再简化，避免闭合环首尾重合导致 DP 退化
  const h = r.length>>1;
  const s = dp(r.slice(0,h+1),eps).slice(0,-1).concat(dp(r.slice(h),eps));
  if (s.length < 4) continue;
  out.push(s.flatMap(([x,y]) => [Math.round(x*2), Math.round(y*2)]));
  n += s.length;
}
console.error('rings', out.length, 'points', n);
process.stdout.write(JSON.stringify(out));

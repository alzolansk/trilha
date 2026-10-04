import { chromium } from '@playwright/test';
const [,, url, out, w='1440', h='900', scrollsArg='0'] = process.argv;
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
p.on('console', m => { if (m.type() === 'error' || m.type()==='warning') logs.push(m.type()+': '+m.text()); });
p.on('pageerror', e => logs.push('pageerror: '+e.message));
await p.goto(url, { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
const scrolls = scrollsArg.split(',').map(Number);
for (const [i, y] of scrolls.entries()) {
  await p.evaluate(y => window.scrollTo(0, y * innerHeight), y);
  await p.waitForTimeout(900);
  await p.screenshot({ path: `${out}-${i}.png` });
}
console.log(JSON.stringify({ logs: logs.slice(0,15), sw: await p.evaluate(()=>document.documentElement.scrollWidth), vw: +w }));
await b.close();

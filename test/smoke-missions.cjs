const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({
    executablePath: '/home/hatch/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const results = [];
  for (const mission of ['desert', 'arctic', 'urban']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
    page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 160)));
    await page.addInitScript(() => localStorage.setItem('shadowline_player_name', 'VIPER'));
    await page.goto('http://localhost:5175/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForSelector('.menu-root', { timeout: 15000 });
    const names = { desert: 'DESERT STRIKE', arctic: 'ARCTIC OUTPOST', urban: 'URBAN BLACKOUT' };
    await page.getByText('SELECT MISSION', { exact: true }).click();
    await page.getByText(names[mission], { exact: true }).click();
    await page.waitForSelector('canvas', { timeout: 20000 });
    await page.waitForTimeout(7000); // let enemies/AI/spawns settle
    // shoot a few rounds + reload to exercise weapon/ammo paths
    await page.mouse.move(640, 360);
    await page.mouse.down(); await page.waitForTimeout(400); await page.mouse.up();
    await page.keyboard.press('r');
    await page.waitForTimeout(2500);
    const state = await page.evaluate(() => {
      const c = document.querySelectorAll('canvas').length;
      const hud = !!document.querySelector('.hud-ammo');
      const obj = document.querySelector('.objective-title')?.textContent || null;
      return { canvases: c, hud, objective: obj };
    });
    results.push({ mission, ...state, consoleErrors: errors.length, sample: errors.slice(0, 2) });
    await page.close();
  }
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})();

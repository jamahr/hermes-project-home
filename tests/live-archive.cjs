// Live UI walk-through of the v0.6 archive view. Mutates only the "PH Picker Test" project.
const { chromium } = require('/root/.npm/_npx/314abffa6aaf2cd1/node_modules/playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
const shots = path.join(__dirname, '..', 'screenshots');
const NAME = 'PH Picker Test';
(async () => {
  const login = spawn('hermes', ['webapp', '--no-open', '--skip-build'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; login.stdout.on('data', b => output += b); login.stderr.on('data', b => output += b);
  let url; for (let i = 0; i < 150; i++) { url = output.match(/http:\/\/127[^\s]+/)?.[0]; if (url) break; await new Promise(r => setTimeout(r, 100)) }
  const browser = await chromium.launch({ headless: true, executablePath: '/root/.hermes/tools/chromium-1208/chrome-linux/chrome', args: ['--no-sandbox'] });
  const dark = process.env.PH_DARK === '1';
  const context = await browser.newContext({ viewport: { width: Number(process.env.PH_W || 1400), height: 950 }, colorScheme: dark ? 'dark' : 'light' });
  await context.addInitScript(() => localStorage.setItem('hermes.desktop.pluginDecisions.v2', JSON.stringify({ 'project-home': true })));
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) });
  const log = (...s) => console.log(...s); const tag = dark ? '-dark' : '';
  const shot = n => page.screenshot({ path: path.join(shots, `v6-${n}${tag}.png`) });
  try {
    await page.goto(url); await page.waitForTimeout(4500);
    const openHub = async () => { await page.getByText('Projects', { exact: true }).first().click(); await page.getByRole('button', { name: 'New project' }).waitFor({ timeout: 20000 }) }
    await openHub();
    await page.waitForTimeout(1500); await shot('hub-active');
    log('TABS', await page.getByRole('radio').allInnerTexts().catch(() => []), await page.getByRole('tab').allInnerTexts().catch(() => []));
    await page.getByText(/^Archived \(\d+\)$/).click(); await page.waitForTimeout(800);
    log('HASH', await page.evaluate(() => location.hash)); await shot('hub-archived');
    log('ARCHIVED BODY', (await page.locator('body').innerText()).split('Archived (')[1]?.slice(0, 500));
    // Archive the test project from its page and use the toast's "View archive"
    await page.getByText(/^Active \(\d+\)$/).click(); await page.waitForTimeout(500);
    await page.getByRole('button', { name: NAME }).first().click(); await page.getByText('Recents', { exact: true }).waitFor({ timeout: 20000 });
    await page.locator('select').first().selectOption('__archive'); await page.getByRole('button', { name: 'Archive', exact: true }).click();
    await page.waitForTimeout(1500); await shot('archived-toast');
    log('TOAST', (await page.locator('body').innerText()).match(/Archived PH Picker Test[^\n]*/)?.[0]);
    await page.getByRole('button', { name: 'View archive' }).click(); await page.waitForTimeout(1200);
    assert.match(await page.locator('body').innerText(), new RegExp(NAME)); log('IN ARCHIVE PASS');
    await page.getByRole('button', { name: `Open ${NAME}` }).click(); await page.getByText('This project is archived', { exact: false }).waitFor({ timeout: 15000 });
    await page.waitForTimeout(800); await shot('archived-project'); log('BANNER PASS');
    await page.getByRole('button', { name: 'Restore project' }).first().click(); await page.waitForTimeout(1500);
    assert.equal(await page.getByText('This project is archived', { exact: false }).count(), 0); log('RESTORE PASS');
    await page.evaluate(() => { location.hash = '#/projects-home?view=archived' }); await page.waitForTimeout(2000); await shot('archive-after-restore');
    assert.equal(await page.getByRole('button', { name: `Open ${NAME}` }).count(), 0); assert.equal(await page.getByRole('button', { name: 'Open Wpromote Severance' }).count(), 1); log('DEEP LINK + RESTORED PASS');
  } catch (e) { log('FAIL', e.message); log('BODY', (await page.locator('body').innerText()).slice(-2500)); await shot('failure'); process.exitCode = 1 }
  finally { log('JS_ERRORS', JSON.stringify(errors.slice(0, 10))); await browser.close(); login.kill() }
})();

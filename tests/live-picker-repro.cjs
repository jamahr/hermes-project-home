// Live repro: composer project picker on a fresh draft. Uses its own test project only.
const { chromium } = require('/root/.npm/_npx/314abffa6aaf2cd1/node_modules/playwright');
const { spawn } = require('child_process');
const path = require('path');
const shots = path.join(__dirname, '..', 'screenshots');
const PROJECT = process.env.PH_TEST_PROJECT || 'PH Picker Test';
const SEND = process.env.PH_SEND !== '0';
(async () => {
  const login = spawn('hermes', ['webapp', '--no-open', '--skip-build'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; login.stdout.on('data', b => output += b); login.stderr.on('data', b => output += b);
  let url; for (let i = 0; i < 150; i++) { url = output.match(/http:\/\/127[^\s]+/)?.[0]; if (url) break; await new Promise(r => setTimeout(r, 100)) }
  if (!url) throw Error('Login link unavailable: ' + output)
  const browser = await chromium.launch({ headless: true, executablePath: '/root/.hermes/tools/chromium-1208/chrome-linux/chrome', args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await context.addInitScript(() => localStorage.setItem('hermes.desktop.pluginDecisions.v2', JSON.stringify({ 'project-home': true })));
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || /project-home|Move project/i.test(m.text())) errors.push(m.type() + ': ' + m.text()) });
  const log = (...s) => console.log(...s);
  try {
    await page.goto(url); await page.waitForTimeout(5000);
    await page.goto('http://127.0.0.1:9120/#/'); await page.waitForTimeout(4000);
    const picker = page.getByRole('button', { name: 'Choose project' });
    await picker.first().waitFor({ timeout: 20000 });
    log('PICKER LABEL BEFORE', await picker.first().innerText());
    await page.screenshot({ path: path.join(shots, 'repro-before.png') });
    await picker.first().click(); await page.waitForTimeout(800);
    await page.getByRole('menuitem', { name: PROJECT, exact: true }).click();
    await page.waitForTimeout(6000);
    log('HASH AFTER PICK', await page.evaluate(() => location.hash));
    log('PICKER LABEL AFTER', await page.getByRole('button', { name: 'Choose project' }).first().innerText().catch(e => 'ERR ' + e.message));
    log('TOASTS', await page.locator('[data-sonner-toast], [role=status], [role=alert]').allInnerTexts().catch(() => []));
    await page.screenshot({ path: path.join(shots, 'repro-after-pick.png') });
    if (SEND) {
      log('EDITABLES', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[contenteditable], textarea')].map(e => ({ tag: e.tagName, ce: e.getAttribute('contenteditable'), ph: e.getAttribute('placeholder') || e.getAttribute('data-placeholder') || e.getAttribute('aria-label'), vis: !!e.offsetParent, cls: e.className.slice(0, 60) })))));
      const box = page.locator('[contenteditable=true]:visible, textarea:visible').last();
      await box.click({ force: true }); await page.keyboard.type('Test only: call desktop_project list and reply with just the active_id value, then the output of pwd. Nothing else.');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(70000);
      log('HASH AFTER SEND', await page.evaluate(() => location.hash));
      log('BODY TAIL', (await page.locator('main').last().innerText().catch(async () => await page.locator('body').innerText())).slice(-1500));
      await page.screenshot({ path: path.join(shots, 'repro-after-send.png') });
    }
  } catch (e) { log('FAIL', e.message); log('BODY', (await page.locator('body').innerText()).slice(-3000)); process.exitCode = 1 }
  finally { log('JS_ERRORS', JSON.stringify(errors.slice(0, 20))); await browser.close(); login.kill() }
})();

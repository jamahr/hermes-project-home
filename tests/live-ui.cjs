// Live integration test: only creates and mutates its own explicitly named project.
const { chromium } = require('/root/.npm/_npx/314abffa6aaf2cd1/node_modules/playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = '/root/projects/project-home-test';
const shots = path.join(__dirname, '..', 'screenshots');
(async () => {
 const login = spawn('hermes', ['webapp','--no-open','--skip-build'], {stdio:['ignore','pipe','pipe']});
 let output=''; login.stdout.on('data', b=>output+=b); login.stderr.on('data', b=>output+=b);
 let url; for(let i=0;i<100;i++){url=output.match(/http:\/\/127[^\s]+/)?.[0];if(url)break;await new Promise(r=>setTimeout(r,100));}
 if(!url) throw Error('Login link unavailable');
 const browser=await chromium.launch({headless:true,executablePath:'/root/.hermes/tools/chromium-1208/chrome-linux/chrome',args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1400,height:1000}});
 await context.addInitScript(()=>localStorage.setItem('hermes.desktop.pluginDecisions.v2',JSON.stringify({'project-home':true})));
 const page=await context.newPage(), errors=[];
 page.on('pageerror', e=>errors.push(e.message));page.on('console', m=>{if(m.type()==='error')errors.push(m.text())});
 page.on('dialog', d=>d.accept());
 const log=(...s)=>console.log(...s);
 try {
  await page.goto(url); await page.waitForTimeout(4500);
  const health=await page.evaluate(async()=>{const r=await fetch('/api/plugins/project-home/health',{headers:{'X-Hermes-Session-Token':sessionStorage.getItem(`hermes.webapp.session.v1:${JSON.stringify([location.origin, ''])}`)}});return {status:r.status,body:await r.json()}});log('HEALTH',JSON.stringify(health));assert.equal(health.status,200);assert.equal(health.body.ok,true);
  await page.goto('http://127.0.0.1:9120/#/projects-home');await page.getByRole('button',{name:'New project'}).waitFor({timeout:20000});await fs.promises.mkdir(shots,{recursive:true});await page.screenshot({path:path.join(shots,'hub.png')});
  await page.getByRole('button',{name:'New project'}).click();await page.getByPlaceholder('Name',{exact:true}).fill('Project Home Test');
  await page.getByRole('button',{name:'Create project'}).click();await page.getByText('Recents',{exact:true}).waitFor({timeout:20000});
  log('PROJECT_URL',page.url().split('?project=')[1]);await page.screenshot({path:path.join(shots,'project.png')});
  await page.locator('section').filter({hasText:'Instructions'}).getByText('Edit',{exact:true}).click();await page.locator('[role=dialog] textarea').fill('# Project Home Test\n\nE2E instruction verified.\n');await page.getByRole('button',{name:'Save',exact:true}).click();await page.locator('[role=dialog]').waitFor({state:'hidden'});assert(fs.readFileSync(path.join(root,'AGENTS.md'),'utf8').includes('E2E instruction verified.'));log('INSTRUCTIONS PASS');
  await page.locator('section').filter({hasText:'Context'}).getByText('Add',{exact:true}).click();await page.getByPlaceholder('Note title').fill('E2E note');await page.getByPlaceholder('Note text').fill('E2E note body verified.');await page.getByRole('button',{name:'Add note'}).click();await page.getByRole('button',{name:/e2e-note\.md/}).click();await page.getByText('E2E note body verified.',{exact:false}).waitFor();log('CONTEXT PASS');await page.keyboard.press('Escape');
  await page.locator('section').filter({hasText:'Memory'}).getByText('View',{exact:true}).click();await page.locator('[role=dialog] textarea').fill('# E2E memory verified\n');await page.getByRole('button',{name:'Save',exact:true}).click();await page.locator('[role=dialog]').waitFor({state:'hidden'});assert(fs.readFileSync(path.join(root,'MEMORY.md'),'utf8').includes('E2E memory verified'));await page.locator('section').filter({hasText:'Memory'}).getByText('View',{exact:true}).click();assert((await page.locator('[role=dialog] textarea').inputValue()).includes('E2E memory verified'));await page.keyboard.press('Escape');log('MEMORY PASS');
  await page.locator('section').filter({hasText:'Scheduled'}).getByText('Add',{exact:true}).click();await page.getByPlaceholder('Name',{exact:true}).fill('Project Home E2E task');await page.getByPlaceholder('Schedule, e.g. every day at 9am').fill('in 30 days');await page.getByPlaceholder('Prompt',{exact:true}).fill('reply ok');await page.getByRole('button',{name:'Add scheduled task'}).click();await page.getByText('Project Home E2E task',{exact:true}).waitFor({timeout:15000});log('TASK CREATED');await page.locator('section').filter({hasText:'Scheduled'}).getByRole('button',{name:'Remove'}).click();await page.getByText('Project Home E2E task',{exact:true}).waitFor({state:'hidden'});log('TASK REMOVED');
  await page.getByPlaceholder('New session in Project Home Test').fill('Reply with the single word: ok');await page.getByRole('button',{name:'Send',exact:true}).click();await page.waitForTimeout(3000);log('AFTER SEND', (await page.locator('body').innerText()).slice(-3500));await page.waitForTimeout(45000);log('AFTER WAIT', (await page.locator('body').innerText()).slice(-3500));
 } catch(e) {log('FAIL',e.message);log('BODY', (await page.locator('body').innerText()).slice(-5000));process.exitCode=1}
 finally {log('JS_ERRORS',JSON.stringify(errors));await page.screenshot({path:path.join(shots,'failure-or-last.png')});await browser.close();login.kill();}
})();

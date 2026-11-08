// Isolated live Project Notes E2E; never targets other projects.
const {chromium}=require('/root/.npm/_npx/314abffa6aaf2cd1/node_modules/playwright');
const {spawn}=require('child_process');
const fs=require('fs'); const path=require('path'); const assert=require('assert');
const root='/root/projects/project-home-notes-test', shots=path.join(__dirname,'../screenshots');
const notes='Objective: TEST-OBJ-7731 ship the quarterly widget review. Consider: budget limits.';
(async()=>{
 const login=spawn('hermes',['webapp','--no-open','--skip-build'],{stdio:['ignore','pipe','pipe']});let out='';login.stdout.on('data',x=>out+=x);login.stderr.on('data',x=>out+=x);
 let url;for(let i=0;i<150;i++){url=out.match(/http:\/\/127[^\s]+/)?.[0];if(url)break;await new Promise(r=>setTimeout(r,100));}if(!url)throw Error('No login URL');
 const browser=await chromium.launch({headless:true,executablePath:'/root/.hermes/tools/chromium-1208/chrome-linux/chrome',args:['--no-sandbox']});
 const ctx=await browser.newContext({viewport:{width:1400,height:1000}});await ctx.addInitScript(()=>localStorage.setItem('hermes.desktop.pluginDecisions.v2',JSON.stringify({'project-home':true})));
 const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push('pageerror: '+e.message));p.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text())});p.on('dialog',d=>d.accept());
 let projectId='';
 async function dismiss(){const toast=p.locator('[data-sonner-toast], [role=status], [role=alert]').filter({hasText:'Update ready'});if(await toast.count()){const b=toast.locator('button').last();if(await b.count())await b.click();}}
 try{
  if (!process.env.RESUME_ID) assert(!fs.existsSync(root),'Test directory already exists');fs.mkdirSync(shots,{recursive:true});
  await p.goto(url);await p.waitForTimeout(15000);await p.goto('http://127.0.0.1:9120/#/projects-home');await p.getByRole('button',{name:'New project'}).waitFor({timeout:20000});for(const name of ['Backlog','To Do','In Progress','Done']) assert(await p.getByRole('heading',{name:new RegExp('^'+name+' ·')}).count());await dismiss();await p.screenshot({path:path.join(shots,'hub.png')});
  if(process.env.RESUME_ID){await p.goto('http://127.0.0.1:9120/#/projects-home?project='+process.env.RESUME_ID);}else{await p.getByRole('button',{name:'New project'}).click();await p.getByPlaceholder('Name',{exact:true}).fill('Project Home Notes Test');await p.getByRole('button',{name:'Create project'}).click();}await p.getByText('Recents',{exact:true}).waitFor({timeout:20000});
  projectId=new URL(p.url()).hash.split('project=')[1];console.log('PROJECT_ID',projectId);assert(projectId);
  const section=p.locator('aside section').filter({has:p.getByRole('heading',{name:'Project notes'})});assert(await section.count());assert(await p.getByLabel('Provider').count());assert(await p.getByLabel('Model').count());assert(await p.getByLabel('Reasoning effort').count());const field=section.locator('textarea');if(!process.env.RESUME_ID){await field.fill(notes);await section.getByRole('button',{name:'Save',exact:true}).click();await section.getByText('Saved',{exact:true}).waitFor({timeout:20000});}
  console.log('NOTES_FILE',JSON.stringify(fs.readFileSync(path.join(root,'PROJECT_NOTES.md'),'utf8')));console.log('AGENTS_FILE',JSON.stringify(fs.readFileSync(path.join(root,'AGENTS.md'),'utf8')));assert.equal(fs.readFileSync(path.join(root,'PROJECT_NOTES.md'),'utf8'),notes);assert(fs.readFileSync(path.join(root,'AGENTS.md'),'utf8').includes('PROJECT_NOTES.md'));
  if(!process.env.RESUME_ID){await p.reload();await p.waitForTimeout(15000);await p.goto('http://127.0.0.1:9120/#/projects-home?project='+projectId);}await p.getByText('Recents',{exact:true}).waitFor({timeout:20000});await p.waitForFunction(value=>document.querySelector('textarea[placeholder="Objectives, things to consider, work to keep in mind"]')?.value===value,notes,{timeout:20000});console.log('RELOAD PASS');await dismiss();await p.screenshot({path:path.join(shots,'project.png')});
  await p.getByPlaceholder('New session in Project Home Notes Test').fill('What is the objective code in my project notes? Reply with just the code.');await p.getByRole('button',{name:'Send',exact:true}).click();await p.waitForTimeout(4000);console.log('SESSION_URL',p.url());console.log('SESSION_INITIAL',JSON.stringify((await p.locator('body').innerText()).slice(-5000)));
  await p.getByText('TEST-OBJ-7731',{exact:false}).last().waitFor({timeout:120000});await p.waitForTimeout(2000);console.log('SESSION_FINAL_URL',p.url());console.log('SESSION_FINAL',JSON.stringify((await p.locator('body').innerText()).slice(-8000)));
 }catch(e){console.log('FAIL',e.stack);console.log('FAIL_URL',p.url());console.log('FAIL_BODY',JSON.stringify((await p.locator('body').innerText()).slice(-6000)));process.exitCode=1;}
 finally{console.log('JS_ERRORS',JSON.stringify(errors));await browser.close();login.kill();}
})();
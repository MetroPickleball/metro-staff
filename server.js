// Metro Pickleball — Staff Management Server v3
const express=require('express'); const Database=require('better-sqlite3');
const path=require('path'); const fs=require('fs'); const crypto=require('crypto');
const app=express(); const PORT=process.env.PORT||3001;
const MANAGER_PIN=process.env.MANAGER_PIN||'metro2025';
app.use(express.json()); app.use(express.static(path.join(__dirname,'public')));

const dataDir=path.join(__dirname,'data'); if(!fs.existsSync(dataDir)) fs.mkdirSync(dataDir,{recursive:true});
const db=new Database(path.join(dataDir,'metro.db')); db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS employees(id TEXT PRIMARY KEY,name TEXT,role TEXT,color TEXT,init TEXT,
  pin TEXT,must_set_pin INTEGER DEFAULT 0,groups TEXT DEFAULT '[]',active INTEGER DEFAULT 1,responsibilities TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS shifts(id TEXT PRIMARY KEY,name TEXT,hours TEXT,days TEXT,sort_order INTEGER);
CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY,label TEXT,kinds TEXT,cadence TEXT,
  scope_type TEXT,scope_values TEXT,goal REAL,high_priority INTEGER DEFAULT 0,text_label TEXT,
  sort_order INTEGER,active INTEGER DEFAULT 1,completion TEXT DEFAULT 'each');
CREATE TABLE IF NOT EXISTS daily_entries(employee_id TEXT,date TEXT,shift TEXT,item_id TEXT,
  value REAL,text_value TEXT,PRIMARY KEY(employee_id,date,item_id));
CREATE TABLE IF NOT EXISTS onetime_done(employee_id TEXT,item_id TEXT,done_date TEXT,
  PRIMARY KEY(employee_id,item_id));
CREATE TABLE IF NOT EXISTS checkins(id TEXT PRIMARY KEY,employee_id TEXT,date TEXT,conductor TEXT,
  ratings TEXT DEFAULT '[]',notes TEXT,created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY,employee_id TEXT,date TEXT,category TEXT,
  message TEXT,status TEXT DEFAULT 'open',created_at TEXT DEFAULT (datetime('now')));
`);
try{db.exec("ALTER TABLE employees ADD COLUMN responsibilities TEXT DEFAULT ''");}catch(e){}
try{db.exec("ALTER TABLE items ADD COLUMN completion TEXT DEFAULT 'each'");}catch(e){}
const uid=()=>crypto.randomBytes(5).toString('hex');
const J=(s,d)=>{try{return JSON.parse(s)}catch{return d===undefined?[]:d}};
const todayISO=()=>new Date().toISOString().slice(0,10);
function weekDates(a){const d=new Date(a+'T00:00:00');const dow=(d.getDay()+6)%7;const m=new Date(d);m.setDate(d.getDate()-dow);
  return [...Array(7)].map((_,i)=>{const x=new Date(m);x.setDate(m.getDate()+i);return x.toISOString().slice(0,10)});}
function lastDays(n){const out=[];for(let i=n-1;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);out.push(d.toISOString().slice(0,10))}return out;}

// ---- SEED (fresh DB) ----
if(db.prepare('SELECT COUNT(*) c FROM employees').get().c===0){
 const E=[['jose','Jose','Front Desk Lead','#00AEAE','J','1111',["Front Desk"]],
 ['jesse','Jesse','Front Desk','#06b6d4','J','2222',["Front Desk"]],
 ['mikey','Mikey','Front Desk + Inventory','#6366f1','M','3333',["Front Desk","Inventory"]],
 ['caroline','Caroline','Front Desk','#ec4899','C','4444',["Front Desk"]],
 ['angela','Angela','Front Desk','#f97316','A','5555',["Front Desk"]],
 ['barbara','Barbara','Front Desk','#8b5cf6','B','6666',["Front Desk"]],
 ['ken','Ken','Marketing Lead + Coach','#14b8a6','K','7777',["Marketing/Social","Coaches"]],
 ['anders','Anders','Social Media','#f43f5e','A','8888',["Marketing/Social"]],
 ['matt','Matt','Coach','#0ea5e9','M','9999',["Coaches"]],
 ['bernard','Bernard','Coach','#84cc16','B','1010',["Coaches"]]];
 const ie=db.prepare('INSERT INTO employees(id,name,role,color,init,pin,groups) VALUES(?,?,?,?,?,?,?)');
 for(const e of E) ie.run(e[0],e[1],e[2],e[3],e[4],e[5],JSON.stringify(e[6]));
 const S=[['sh_morning','Morning','7:45–1:45','["Mon","Tue","Wed","Thu","Fri"]',1],
 ['sh_midday','Mid-Day','1:30–7:30','["Mon","Tue","Wed","Thu","Fri"]',2],
 ['sh_evening','Evening','5:45–11:15','["Mon","Tue","Wed","Thu","Fri"]',3],
 ['sh_wkday','Weekend Day','7:45–2:00','["Sat","Sun"]',4],
 ['sh_wknight','Weekend Night','1:45–8:15','["Sat","Sun"]',5]];
 const is=db.prepare('INSERT INTO shifts(id,name,hours,days,sort_order) VALUES(?,?,?,?,?)');
 for(const x of S) is.run(...x);
 // kinds JSON, scope_values JSON, high_priority, text_label
 const I=[
 ['People booked into L2P',["number"],'daily','all',[],null,1,null,1],
 ['Ask happy guests for a Google review',["number"],'weekly','all',[],3,0,null,2],
 ['Membership sales',["number","text"],'weekly','group',["Front Desk"],2,1,'Who did you sell to?',3],
 ['Front desk tidy & signage',["task"],'daily','group',["Front Desk"],null,0,null,4],
 ["Contact today's L2P attendees",["task"],'daily','shift',["Morning"],null,1,null,5],
 ['Open & set up courts',["task"],'daily','shift',["Morning"],null,0,null,6],
 ['Midday cleaning pass',["task"],'daily','shift',["Mid-Day"],null,0,null,7],
 ['Close & lock courts',["task"],'daily','shift',["Evening"],null,0,null,8],
 ['How did the shift go?',["text"],'daily','all',[],null,0,'A sentence or two',9],
 ['Complete onboarding paperwork',["task"],'onetime','employee',["jesse"],null,1,null,10]];
 const ii=db.prepare('INSERT INTO items(id,label,kinds,cadence,scope_type,scope_values,goal,high_priority,text_label,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?)');
 for(const x of I) ii.run(uid(),x[0],JSON.stringify(x[1]),x[2],x[3],JSON.stringify(x[4]),x[5],x[6],x[7],x[8]);
 console.log('Seeded v3.');
}

// ---- merge engine ----
function taskDone(it,empId,today){
 const shared=it.completion==='shared';
 if(it.cadence==='onetime'){
  return shared ? !!db.prepare('SELECT 1 FROM onetime_done WHERE item_id=? LIMIT 1').get(it.id)
                : !!db.prepare('SELECT 1 FROM onetime_done WHERE item_id=? AND employee_id=?').get(it.id,empId);
 }
 const dates = it.cadence==='weekly' ? weekDates(today) : [today];
 const inC=dates.map(()=>'?').join(',');
 return shared ? !!db.prepare(`SELECT 1 FROM daily_entries WHERE item_id=? AND value>=1 AND date IN (${inC}) LIMIT 1`).get(it.id,...dates)
               : !!db.prepare(`SELECT 1 FROM daily_entries WHERE item_id=? AND employee_id=? AND value>=1 AND date IN (${inC}) LIMIT 1`).get(it.id,empId,...dates);
}
function itemsFor(empId,shiftName,date){
 const emp=db.prepare('SELECT * FROM employees WHERE id=?').get(empId); if(!emp) return [];
 const groups=J(emp.groups); const today=date||todayISO();
 const applies=(it)=>{const sv=J(it.scope_values);
  if(it.scope_type==='all') return true;
  if(it.scope_type==='group') return sv.some(g=>groups.includes(g));
  if(it.scope_type==='shift') return sv.includes(shiftName);
  if(it.scope_type==='employee') return sv.includes(empId);
  return false;};
 return db.prepare('SELECT * FROM items WHERE active=1 ORDER BY high_priority DESC, sort_order').all().filter(it=>{
  if(!applies(it)) return false;
  if(J(it.kinds).includes('task') && taskDone(it,empId,today)) return false;
  return true;
 }).map(it=>({...it,kinds:J(it.kinds),scope_values:J(it.scope_values),high_priority:!!it.high_priority}));
}
function requireManager(req,res,next){ if((req.headers['x-manager-pin']||req.query.pin)===MANAGER_PIN) return next(); res.status(401).json({error:'Manager PIN required'});}
function staffOk(id,pin){const e=db.prepare('SELECT pin FROM employees WHERE id=? AND active=1').get(id); return e&&e.pin&&e.pin===String(pin);}

// ===== STAFF =====
app.get('/api/health',(q,r)=>r.json({ok:true}));
app.get('/api/shifts',(q,r)=>r.json(db.prepare('SELECT id,name,hours,days FROM shifts ORDER BY sort_order').all()));
app.get('/api/staff/roster',(q,r)=>r.json(db.prepare('SELECT id,name,role,color,init FROM employees WHERE active=1 ORDER BY name').all()));
app.get('/api/staff/:id/status',(req,res)=>{const e=db.prepare('SELECT must_set_pin,pin FROM employees WHERE id=? AND active=1').get(req.params.id);
 if(!e) return res.status(404).json({error:'no'}); res.json({mustSetPin: e.must_set_pin===1 || !e.pin});});
app.post('/api/staff/:id/login',(req,res)=>res.json({ok:staffOk(req.params.id,(req.body||{}).pin)}));
app.post('/api/staff/:id/setpin',(req,res)=>{const{currentPin,newPin}=req.body||{};
 const e=db.prepare('SELECT pin,must_set_pin FROM employees WHERE id=?').get(req.params.id); if(!e) return res.status(404).json({error:'no'});
 const needsNoCurrent = e.must_set_pin===1 || !e.pin;
 if(!needsNoCurrent && e.pin!==String(currentPin)) return res.status(401).json({error:'Wrong PIN'});
 if(!/^\d{4}$/.test(newPin||'')) return res.status(400).json({error:'PIN must be 4 digits'});
 db.prepare('UPDATE employees SET pin=?,must_set_pin=0 WHERE id=?').run(String(newPin),req.params.id); res.json({ok:true});});
app.get('/api/staff/:id/today',(req,res)=>{ if(!staffOk(req.params.id,req.headers['x-staff-pin'])) return res.status(401).json({error:'PIN required'});
 const shift=req.query.shift||'Morning', date=req.query.date||todayISO();
 const items=itemsFor(req.params.id,shift,date); const saved={},savedText={};
 db.prepare('SELECT item_id,value,text_value FROM daily_entries WHERE employee_id=? AND date=?').all(req.params.id,date)
   .forEach(r=>{saved[r.item_id]=r.value; if(r.text_value!=null) savedText[r.item_id]=r.text_value;});
 const emp=db.prepare('SELECT id,name,role,color,init,responsibilities FROM employees WHERE id=?').get(req.params.id);
 res.json({emp,date,shift,items,saved,savedText});});
app.post('/api/staff/:id/submit',(req,res)=>{const{pin,date,shift,values,texts,report,reportCategory}=req.body||{};
 if(!staffOk(req.params.id,pin)) return res.status(401).json({error:'PIN required'}); const d=date||todayISO();
 const up=db.prepare(`INSERT INTO daily_entries(employee_id,date,shift,item_id,value,text_value) VALUES(?,?,?,?,?,?)
  ON CONFLICT(employee_id,date,item_id) DO UPDATE SET value=excluded.value,text_value=excluded.text_value,shift=excluded.shift`);
 const mark=db.prepare(`INSERT INTO onetime_done(employee_id,item_id,done_date) VALUES(?,?,?) ON CONFLICT DO NOTHING`);
 const oneItems=new Set(db.prepare("SELECT id FROM items WHERE cadence='onetime'").all().map(r=>r.id));
 const tx=db.transaction(()=>{ const V=values||{},T=texts||{}; const keys=new Set([...Object.keys(V),...Object.keys(T)]);
  for(const k of keys){ const v=(V[k]===''||V[k]==null)?null:Number(V[k]); const t=T[k]!=null&&T[k]!==''?String(T[k]):null;
   up.run(req.params.id,d,shift,k,v,t); if(oneItems.has(k)&&v>=1) mark.run(req.params.id,k,d);} });
 tx();
 if(report&&report.trim()) db.prepare('INSERT INTO reports(id,employee_id,date,category,message) VALUES(?,?,?,?,?)').run(uid(),req.params.id,d,reportCategory||'note',report.trim());
 res.json({ok:true,date:d});});

// ===== MANAGER =====
function twoWeekHealth(empId){ const dates=lastDays(14);
 const inClause=dates.map(()=>'?').join(',');
 const rows=db.prepare(`SELECT de.item_id,de.value,i.kinds,i.goal,i.cadence FROM daily_entries de JOIN items i ON i.id=de.item_id
   WHERE de.employee_id=? AND de.date IN (${inClause})`).all(empId,...dates);
 let taskTot=0,taskDone=0; const goalSum={}; 
 rows.forEach(r=>{const kinds=J(r.kinds); if(kinds.includes('task')){taskTot++; if(r.value>=1)taskDone++;}
  if(kinds.includes('number')&&r.goal!=null){goalSum[r.item_id]=(goalSum[r.item_id]||0)+(r.value||0);}});
 const goalItems=db.prepare("SELECT id,goal,cadence FROM items WHERE active=1 AND goal IS NOT NULL AND kinds LIKE '%number%'").all();
 let gTot=0,gHit=0; goalItems.forEach(gi=>{ if(goalSum[gi.id]===undefined) return; gTot++; const target=gi.cadence==='weekly'?gi.goal*2:gi.goal*14; if(goalSum[gi.id]>=target)gHit++;});
 const parts=[]; if(taskTot)parts.push(taskDone/taskTot); if(gTot)parts.push(gHit/gTot);
 if(!parts.length) return {health:null,tasks:'—',goals:'—'};
 return {health:Math.round(100*parts.reduce((a,b)=>a+b,0)/parts.length), tasks:`${taskDone}/${taskTot}`, goals:gTot?`${gHit}/${gTot}`:'—'};}
app.get('/api/manager/dashboard',requireManager,(q,res)=>{const today=todayISO();
 res.json(db.prepare('SELECT id,name,role,color,init,groups,responsibilities FROM employees WHERE active=1 ORDER BY name').all().map(e=>{
  const sub=db.prepare('SELECT COUNT(*) c FROM daily_entries WHERE employee_id=? AND date=?').get(e.id,today).c>0;
  return {...e,groups:J(e.groups),submittedToday:sub,...twoWeekHealth(e.id)};}));});
app.get('/api/manager/groups',requireManager,(q,res)=>{const set=new Set();
 db.prepare('SELECT groups FROM employees WHERE active=1').all().forEach(r=>J(r.groups).forEach(g=>set.add(g))); res.json([...set]);});
app.get('/api/manager/employee/:id/rollup',requireManager,(req,res)=>{const period=req.query.period==='month'?'month':'week';
 const anchor=req.query.anchor||todayISO(); const emp=db.prepare('SELECT id,name,role,color,init,groups,responsibilities FROM employees WHERE id=?').get(req.params.id);
 const g=J(emp.groups); const applicable=db.prepare('SELECT * FROM items WHERE active=1').all().filter(it=>{const sv=J(it.scope_values);
  return it.scope_type==='all'||(it.scope_type==='group'&&sv.some(x=>g.includes(x)))||it.scope_type==='shift'||(it.scope_type==='employee'&&sv.includes(emp.id));})
  .map(it=>({...it,kinds:J(it.kinds),scope_values:J(it.scope_values),high_priority:!!it.high_priority}));
 let dates,rows; if(period==='week'){dates=weekDates(anchor);
  rows=db.prepare(`SELECT item_id,date,value,text_value FROM daily_entries WHERE employee_id=? AND date IN (${dates.map(()=>'?').join(',')})`).all(emp.id,...dates);}
 else{const ym=anchor.slice(0,7);dates=[ym];rows=db.prepare(`SELECT item_id,date,value,text_value FROM daily_entries WHERE employee_id=? AND substr(date,1,7)=?`).all(emp.id,ym);}
 const agg={}; rows.forEach(r=>{(agg[r.item_id] ||= {total:0,days:0,byDate:{},texts:[]}); agg[r.item_id].total+=(r.value||0); agg[r.item_id].days++; agg[r.item_id].byDate[r.date]=r.value; if(r.text_value)agg[r.item_id].texts.push({date:r.date,text:r.text_value});});
 res.json({emp:{...emp,groups:g},period,anchor,dates,items:applicable,agg});});
app.get('/api/manager/employee/:id/trend',requireManager,(req,res)=>{const span=['daily','weekly','monthly'].includes(req.query.span)?req.query.span:'weekly';
 // build buckets
 let buckets=[]; // {label, dates:[...]}
 if(span==='daily'){lastDays(14).forEach(d=>buckets.push({label:d.slice(5),dates:[d]}));}
 else if(span==='weekly'){for(let w=5;w>=0;w--){const anc=new Date();anc.setDate(anc.getDate()-w*7);const wd=weekDates(anc.toISOString().slice(0,10));buckets.push({label:'Wk of '+wd[0].slice(5),dates:wd});}}
 else{for(let m=5;m>=0;m--){const d=new Date();d.setMonth(d.getMonth()-m);const ym=d.toISOString().slice(0,7);buckets.push({label:ym,ym});}}
 const numItems=db.prepare("SELECT id,label FROM items WHERE active=1 AND kinds LIKE '%number%' ORDER BY sort_order").all();
 const series=numItems.map(it=>({id:it.id,label:it.label,values:[],shifts:[]}));
 buckets.forEach(b=>{ let where,params;
  if(b.ym){where=`substr(date,1,7)=?`;params=[req.params.id,b.ym];}
  else{where=`date IN (${b.dates.map(()=>'?').join(',')})`;params=[req.params.id,...b.dates];}
  const shiftsWorked=db.prepare(`SELECT COUNT(DISTINCT date) c FROM daily_entries WHERE employee_id=? AND ${where}`).get(...params).c;
  series.forEach(s=>{const sum=db.prepare(`SELECT COALESCE(SUM(value),0) t FROM daily_entries WHERE employee_id=? AND item_id='${s.id}' AND ${where}`).get(...params).t;
   s.values.push(sum); s.shifts.push(shiftsWorked);});});
 res.json({span,labels:buckets.map(b=>b.label),series});});
// items CRUD
app.get('/api/manager/items',requireManager,(q,res)=>res.json(db.prepare('SELECT * FROM items ORDER BY active DESC,high_priority DESC,sort_order').all().map(it=>({...it,kinds:J(it.kinds),scope_values:J(it.scope_values),high_priority:!!it.high_priority}))));
app.post('/api/manager/items',requireManager,(req,res)=>{const b=req.body||{}; if(!b.label)return res.status(400).json({error:'label'});
 const mx=db.prepare('SELECT MAX(sort_order) m FROM items').get().m||0; const id=uid();
 db.prepare('INSERT INTO items(id,label,kinds,cadence,scope_type,scope_values,goal,high_priority,text_label,sort_order,completion) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
  .run(id,b.label,JSON.stringify(b.kinds||['task']),b.cadence||'daily',b.scope_type||'all',JSON.stringify(b.scope_values||[]),b.goal??null,b.high_priority?1:0,b.text_label||null,mx+1,b.completion||'each');
 res.json({ok:true,id});});
app.put('/api/manager/items/:iid',requireManager,(req,res)=>{const cur=db.prepare('SELECT * FROM items WHERE id=?').get(req.params.iid); if(!cur)return res.status(404).json({error:'no'});
 const b=req.body||{}; db.prepare('UPDATE items SET label=?,kinds=?,cadence=?,scope_type=?,scope_values=?,goal=?,high_priority=?,text_label=?,active=?,completion=? WHERE id=?')
  .run(b.label??cur.label,JSON.stringify(b.kinds||J(cur.kinds)),b.cadence??cur.cadence,b.scope_type??cur.scope_type,JSON.stringify(b.scope_values||J(cur.scope_values)),b.goal===undefined?cur.goal:b.goal,(b.high_priority!==undefined?(b.high_priority?1:0):cur.high_priority),b.text_label===undefined?cur.text_label:b.text_label,(b.active!==undefined?(b.active?1:0):cur.active),b.completion??cur.completion,req.params.iid);
 res.json({ok:true});});
app.delete('/api/manager/items/:iid',requireManager,(q,res)=>{db.prepare('UPDATE items SET active=0 WHERE id=?').run(q.params.iid);res.json({ok:true});});
// reports + checkins
app.get('/api/manager/reports',requireManager,(q,res)=>res.json(db.prepare('SELECT r.*,e.name FROM reports r JOIN employees e ON e.id=r.employee_id ORDER BY r.created_at DESC').all()));
app.get('/api/manager/employee/:id/reports',requireManager,(req,res)=>res.json(db.prepare('SELECT * FROM reports WHERE employee_id=? ORDER BY created_at DESC').all(req.params.id)));
app.put('/api/manager/reports/:rid',requireManager,(req,res)=>{db.prepare('UPDATE reports SET status=? WHERE id=?').run((req.body||{}).status||'resolved',req.params.rid);res.json({ok:true});});
// full submission log (what each person actually submitted, per date) — team-wide or per-employee
function buildSubmissions(filterEmpId){
 const emps=db.prepare('SELECT id,name,role,color,init,groups FROM employees').all();
 const empMap={}; emps.forEach(e=>empMap[e.id]={id:e.id,name:e.name,role:e.role,color:e.color,init:e.init,groups:J(e.groups)});
 const w=filterEmpId?'WHERE de.employee_id=?':''; const p=filterEmpId?[filterEmpId]:[];
 const rows=db.prepare(`SELECT de.employee_id eid,de.date,de.shift,de.item_id,de.value,de.text_value,i.label,i.kinds,i.goal
   FROM daily_entries de JOIN items i ON i.id=de.item_id ${w} ORDER BY de.date DESC`).all(...p);
 const wr=filterEmpId?'WHERE employee_id=?':'';
 const reps=db.prepare(`SELECT id,employee_id eid,date,category,message,status FROM reports ${wr} ORDER BY created_at DESC`).all(...p);
 const map={};
 const key=(eid,date)=>eid+'|'+date;
 rows.forEach(r=>{const k=key(r.eid,r.date); (map[k]||(map[k]={employee_id:r.eid,date:r.date,shift:r.shift||'',items:[],reports:[]}));
   if(r.shift)map[k].shift=r.shift; map[k].items.push({label:r.label,kinds:J(r.kinds),value:r.value,text_value:r.text_value,goal:r.goal});});
 reps.forEach(r=>{const k=key(r.eid,r.date); (map[k]||(map[k]={employee_id:r.eid,date:r.date,shift:'',items:[],reports:[]}));
   map[k].reports.push({id:r.id,category:r.category,message:r.message,status:r.status});});
 const list=Object.values(map).map(s=>({...s,emp:empMap[s.employee_id]||{name:'(removed)',groups:[],color:'#94a3b8',init:'?'}}));
 list.sort((a,b)=> a.date<b.date?1:a.date>b.date?-1:0);
 return list;
}
app.get('/api/manager/submissions',requireManager,(q,res)=>res.json(buildSubmissions(null)));
app.get('/api/manager/employee/:id/submissions',requireManager,(req,res)=>res.json(buildSubmissions(req.params.id)));
app.get('/api/manager/employee/:id/checkins',requireManager,(req,res)=>res.json(db.prepare('SELECT * FROM checkins WHERE employee_id=? ORDER BY date DESC,created_at DESC').all(req.params.id).map(c=>({...c,ratings:J(c.ratings)}))));
app.post('/api/manager/employee/:id/checkins',requireManager,(req,res)=>{const b=req.body||{};
 db.prepare('INSERT INTO checkins(id,employee_id,date,conductor,ratings,notes) VALUES(?,?,?,?,?,?)').run(uid(),req.params.id,b.date||todayISO(),b.conductor||'Nick',JSON.stringify(b.ratings||[]),b.notes||'');res.json({ok:true});});
// employee CRUD
app.post('/api/manager/employees',requireManager,(req,res)=>{const b=req.body||{}; if(!b.name)return res.status(400).json({error:'name'});
 const id=(b.name.toLowerCase().replace(/[^a-z0-9]/g,'')||'emp')+crypto.randomBytes(2).toString('hex');
 const colors=['#00AEAE','#6366f1','#ec4899','#f97316','#8b5cf6','#14b8a6','#f43f5e','#0ea5e9','#84cc16','#06b6d4'];
 db.prepare('INSERT INTO employees(id,name,role,color,init,pin,must_set_pin,groups,responsibilities) VALUES(?,?,?,?,?,?,?,?,?)')
  .run(id,b.name,b.role||'Staff',b.color||colors[Math.floor(Math.random()*colors.length)],b.name[0].toUpperCase(),'0000',1,JSON.stringify(b.groups||[]),b.responsibilities||'');
 if(b.copyFrom){ // duplicate personal (employee-scoped) items
  const src=db.prepare("SELECT * FROM items WHERE active=1 AND scope_type='employee'").all().filter(it=>J(it.scope_values).includes(b.copyFrom));
  const mx0=db.prepare('SELECT MAX(sort_order) m FROM items').get().m||0; let k=1;
  src.forEach(it=>db.prepare('INSERT INTO items(id,label,kinds,cadence,scope_type,scope_values,goal,high_priority,text_label,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(uid(),it.label,it.kinds,it.cadence,'employee',JSON.stringify([id]),it.goal,it.high_priority,it.text_label,mx0+(k++)));}
 res.json({ok:true,id});});
app.put('/api/manager/employees/:id',requireManager,(req,res)=>{const b=req.body||{};const cur=db.prepare('SELECT * FROM employees WHERE id=?').get(req.params.id);if(!cur)return res.status(404).json({error:'no'});
 db.prepare('UPDATE employees SET name=?,role=?,groups=?,init=?,responsibilities=? WHERE id=?').run(b.name??cur.name,b.role??cur.role,JSON.stringify(b.groups||J(cur.groups)),(b.name||cur.name)[0].toUpperCase(),b.responsibilities??cur.responsibilities,req.params.id);res.json({ok:true});});
app.delete('/api/manager/employees/:id',requireManager,(q,res)=>{db.prepare('UPDATE employees SET active=0 WHERE id=?').run(q.params.id);res.json({ok:true});});
app.post('/api/manager/employees/:id/resetpin',requireManager,(q,res)=>{db.prepare("UPDATE employees SET pin=NULL,must_set_pin=1 WHERE id=?").run(q.params.id);res.json({ok:true});});

app.get('/api/manager/employee/:id/preview',requireManager,(req,res)=>{
 const emp=db.prepare('SELECT id,name,role,color,init,groups,responsibilities FROM employees WHERE id=?').get(req.params.id);
 if(!emp) return res.status(404).json({error:'no'});
 const shift=req.query.shift||'Morning'; const groups=J(emp.groups);
 const applies=(it)=>{const sv=J(it.scope_values);
  if(it.scope_type==='all') return true;
  if(it.scope_type==='group') return sv.some(g=>groups.includes(g));
  if(it.scope_type==='shift') return sv.includes(shift);
  if(it.scope_type==='employee') return sv.includes(emp.id);
  return false;};
 const items=db.prepare('SELECT * FROM items WHERE active=1 ORDER BY high_priority DESC,sort_order').all().filter(applies)
   .map(it=>({...it,kinds:J(it.kinds),scope_values:J(it.scope_values),high_priority:!!it.high_priority}));
 res.json({emp:{...emp,groups},shift,items});});
app.get('/api/manager/export/daily.csv',requireManager,(q,res)=>{
 const rows=db.prepare(`SELECT de.date,e.name emp,de.shift,i.label item,de.value,de.text_value FROM daily_entries de JOIN employees e ON e.id=de.employee_id JOIN items i ON i.id=de.item_id ORDER BY de.date DESC,e.name`).all();
 const esc=v=>{v=v==null?'':String(v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;};
 let csv='Date,Employee,Shift,Item,Value,Text\n';
 rows.forEach(r=>{csv+=[r.date,r.emp,r.shift,r.item,r.value==null?'':r.value,r.text_value||''].map(esc).join(',')+'\n';});
 res.setHeader('Content-Type','text/csv');res.setHeader('Content-Disposition','attachment; filename="metro-daily-'+todayISO()+'.csv"');res.send(csv);});
app.get('/api/manager/export/db',requireManager,(q,res)=>res.download(path.join(dataDir,'metro.db'),'metro-backup-'+todayISO()+'.db'));
app.get('/manager',(q,r)=>r.sendFile(path.join(__dirname,'public','manager.html')));
app.get('/',(q,r)=>r.sendFile(path.join(__dirname,'public','staff.html')));
app.listen(PORT,()=>console.log('Metro Staff System v3 on '+PORT));

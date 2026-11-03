// Metro Pickleball — Staff Management Server v3
const express=require('express'); const Database=require('better-sqlite3');
const path=require('path'); const fs=require('fs'); const crypto=require('crypto');
const app=express(); const PORT=process.env.PORT||3001;
const MANAGER_PIN=process.env.MANAGER_PIN||'metro2025';
app.use(express.json({limit:'200kb'})); app.use(express.urlencoded({extended:false,limit:'50kb'})); app.use(express.static(path.join(__dirname,'public')));

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
CREATE TABLE IF NOT EXISTS banners(id TEXT PRIMARY KEY,message TEXT,style TEXT DEFAULT 'focus',
  scope_type TEXT DEFAULT 'all',scope_values TEXT DEFAULT '[]',active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')));
`);
try{db.exec("ALTER TABLE employees ADD COLUMN responsibilities TEXT DEFAULT ''");}catch(e){}
try{db.exec("ALTER TABLE items ADD COLUMN completion TEXT DEFAULT 'each'");}catch(e){}
const uid=()=>crypto.randomBytes(5).toString('hex');
const J=(s,d)=>{try{return JSON.parse(s)}catch{return d===undefined?[]:d}};
// Eastern-time 'today' (the server clock is UTC, which rolled evening check-ins into the next day)
const todayISO=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function weekDates(a){const d=new Date(a+'T00:00:00');const dow=(d.getDay()+6)%7;const m=new Date(d);m.setDate(d.getDate()-dow);
  return [...Array(7)].map((_,i)=>{const x=new Date(m);x.setDate(m.getDate()+i);return x.toISOString().slice(0,10)});}
function lastDays(n){const t=todayISO();const out=[];for(let i=n-1;i>=0;i--){const d=new Date(t+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-i);out.push(d.toISOString().slice(0,10))}return out;}

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
// wrong-PIN lockout: 5 misses from one address = 15 minute pause (manager PIN + Claude sign-in)
const pinFails=new Map();
function clientIp(req){const s=req.socket.remoteAddress||'';const local=s==='127.0.0.1'||s==='::1'||s==='::ffff:127.0.0.1';return (local&&req.headers['x-real-ip'])||s;}
function isLocked(ip){const f=pinFails.get(ip);if(!f)return false;f.t=f.t.filter(x=>Date.now()-x<15*60*1000);return f.t.length>=5;}
function noteFail(ip){const f=pinFails.get(ip)||{t:[]};f.t.push(Date.now());pinFails.set(ip,f);if(pinFails.size>5000)pinFails.clear();}
function clearFails(ip){pinFails.delete(ip);}
function requireManager(req,res,next){const ip=clientIp(req);if(isLocked(ip))return res.status(429).json({error:'Too many wrong PINs. Try again in 15 minutes.'});
 if((req.headers['x-manager-pin']||req.query.pin)===MANAGER_PIN){clearFails(ip);return next();} noteFail(ip); res.status(401).json({error:'Manager PIN required'});}
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
app.get('/api/staff/:id/banners',(req,res)=>{
 const emp=db.prepare('SELECT id,groups FROM employees WHERE id=? AND active=1').get(req.params.id);
 if(!emp) return res.json([]);
 const groups=J(emp.groups); const shift=req.query.shift||'';
 const applies=(b)=>{const sv=J(b.scope_values);
  if(b.scope_type==='all') return true;
  if(b.scope_type==='group') return sv.some(g=>groups.includes(g));
  if(b.scope_type==='shift') return sv.includes(shift);
  if(b.scope_type==='employee') return sv.includes(emp.id);
  return false;};
 const rows=db.prepare('SELECT * FROM banners WHERE active=1 ORDER BY created_at DESC').all().filter(applies)
   .map(b=>({id:b.id,message:b.message,style:b.style||'focus',scope_type:b.scope_type}));
 res.json(rows);});
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
// focus banners
app.get('/api/manager/banners',requireManager,(q,res)=>res.json(db.prepare('SELECT * FROM banners WHERE active=1 ORDER BY created_at DESC').all().map(b=>({...b,scope_values:J(b.scope_values)}))));
app.post('/api/manager/banners',requireManager,(req,res)=>{const b=req.body||{}; if(!b.message||!String(b.message).trim())return res.status(400).json({error:'message'});
 const id=uid(); db.prepare('INSERT INTO banners(id,message,style,scope_type,scope_values) VALUES(?,?,?,?,?)')
  .run(id,String(b.message).trim(),b.style||'focus',b.scope_type||'all',JSON.stringify(b.scope_values||[]));
 res.json({ok:true,id});});
app.put('/api/manager/banners/:bid',requireManager,(req,res)=>{const cur=db.prepare('SELECT * FROM banners WHERE id=?').get(req.params.bid); if(!cur)return res.status(404).json({error:'no'});
 const b=req.body||{};
 db.prepare('UPDATE banners SET message=?,style=?,scope_type=?,scope_values=? WHERE id=?')
  .run(b.message!==undefined?String(b.message).trim():cur.message,b.style||cur.style,b.scope_type||cur.scope_type,b.scope_values!==undefined?JSON.stringify(b.scope_values||[]):cur.scope_values,req.params.bid);
 res.json({ok:true});});
app.delete('/api/manager/banners/:bid',requireManager,(q,res)=>{db.prepare('UPDATE banners SET active=0 WHERE id=?').run(q.params.bid);res.json({ok:true});});
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
const SOCIAL_SEED=[{"title":"July 4th Paddle Video","stage":"Posted","filmDate":null,"postDate":"2026-07-02","reviewed":"Reviewed","boosted":false,"type":"Promo","people":"Coach","hook":"","length":"30-45s","sound":"Original/natural","tone":"Informative","cta":"Direct ask","postedDate":"2026-07-02","reach":800,"shares":5,"notes":""},{"title":"Worst Doubles partner ever","stage":"Posted","filmDate":null,"postDate":"2026-07-07","reviewed":"Reviewed","boosted":false,"type":"Fun/culture","people":"Coach","hook":"Relatable POV","length":"45-60s","sound":"Original/natural","tone":"Funny/goofy","cta":"Follow-for-more","postedDate":"2026-07-07","reach":null,"shares":null,"notes":""},{"title":"Aloha Tournament Otterpops","stage":"Posted","filmDate":null,"postDate":"2026-07-03","reviewed":"Reviewed","boosted":false,"type":"Event/programming","people":"Owner","hook":"Question","length":"Under 15s","sound":"Original/natural","tone":"Funny/goofy","cta":"None","postedDate":"2026-07-03","reach":null,"shares":null,"notes":""},{"title":"Aloha Tournament Otterpops 2","stage":"Posted","filmDate":null,"postDate":"2026-07-06","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"Question","length":"Under 15s","sound":"Original/natural","tone":"Funny/goofy","cta":"None","postedDate":"2026-07-06","reach":null,"shares":null,"notes":""},{"title":"How has Pickleball changed your life?","stage":"Posted","filmDate":null,"postDate":"2026-07-08","reviewed":"Reviewed","boosted":false,"type":"Member spotlight","people":"Member(s)","hook":"Question","length":"Under 15s","sound":"Original/natural","tone":"Heartfelt/personal","cta":"None","postedDate":"2026-07-08","reach":null,"shares":null,"notes":""},{"title":"Owners vs. Staff 1","stage":"Posted","filmDate":null,"postDate":"2026-07-09","reviewed":"Reviewed","boosted":false,"type":"Fun/culture","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-07-09","reach":null,"shares":null,"notes":""},{"title":"Owners vs. Staff 2","stage":"Posted","filmDate":null,"postDate":null,"reviewed":"Reviewed","boosted":false,"type":"Fun/culture","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":""},{"title":"Jose Highlight","stage":"Posted","filmDate":null,"postDate":"2026-07-10","reviewed":"Reviewed","boosted":false,"type":"Member spotlight","people":"Member(s)","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-07-10","reach":null,"shares":null,"notes":""},{"title":"Mikey Highlight","stage":"Posted","filmDate":null,"postDate":"2026-07-17","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-07-17","reach":null,"shares":null,"notes":""},{"title":"Barb Highlight","stage":"Posted","filmDate":null,"postDate":null,"reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":""},{"title":"Caroline Highlight","stage":"Posted","filmDate":null,"postDate":"2026-07-24","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-07-24","reach":null,"shares":null,"notes":""},{"title":"Ken Highlight","stage":"Posted","filmDate":null,"postDate":null,"reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":""},{"title":"Bernard Highlight","stage":"Posted","filmDate":null,"postDate":null,"reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":""},{"title":"Owners Partition video 1","stage":"Posted","filmDate":null,"postDate":null,"reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":""},{"title":"Owners Partition video 2","stage":"Posted","filmDate":null,"postDate":null,"reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":""},{"title":"Sound of a Pickleball","stage":"Posted","filmDate":null,"postDate":null,"reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":""},{"title":"Bernard Coach Tips (Lesson)","stage":"Posted","filmDate":"2026-07-15","postDate":null,"reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":""},{"title":"Ken Coach (Lesson)","stage":"Posted","filmDate":null,"postDate":null,"reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":""},{"title":"Coach Voice Over Interview","stage":"Posted","filmDate":null,"postDate":null,"reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":""},{"title":"Broadcast","stage":"Posted","filmDate":null,"postDate":null,"reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":""},{"title":"Coach's Tip Ken","stage":"Posted","filmDate":null,"postDate":null,"reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":""},{"title":"Pickleball L2P video","stage":"Posted","filmDate":null,"postDate":null,"reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"Question","length":"45-60s","sound":"Trending audio","tone":"Informative","cta":"Direct ask","postedDate":"2026-06-26","reach":3000,"shares":6,"notes":""},{"title":"Lesson with Matt","stage":"Posted","filmDate":null,"postDate":null,"reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":""},{"title":"Aloha Tournament (Inviting People to Sign Up before it closes)","stage":"Posted","filmDate":"2026-07-15","postDate":null,"reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":""},{"title":"New Paddle Review For the B&B Loco","stage":"Posted","filmDate":"2026-07-13","postDate":null,"reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":""},{"title":"New Paddle Review for the color ways of Diadem/ boomstick","stage":"Posted","filmDate":"2026-07-13","postDate":null,"reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":""},{"title":"Tier List of Shots to your Game","stage":"Posted","filmDate":"2026-07-15","postDate":null,"reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":""},{"title":"Owners vs Staff #3","stage":"Posted","filmDate":"2026-07-13","postDate":null,"reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":""},{"title":"World Cup Pickleball Cross Over","stage":"Posted","filmDate":"2026-07-13","postDate":null,"reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":""},{"title":"Mary L2P","stage":"Platform Schedule","filmDate":null,"postDate":"2026-10-28","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":""},{"title":"Broadcast Clip #1 (Interview)","stage":"Posted","filmDate":null,"postDate":"2026-10-27","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-10-27","reach":null,"shares":null,"notes":""},{"title":"Broadcast Clip #2 (Interview)","stage":"Posted","filmDate":null,"postDate":"2026-10-28","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-10-28","reach":null,"shares":null,"notes":""},{"title":"Jose internal monologe","stage":"Platform Schedule","filmDate":null,"postDate":"2026-10-29","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":""},{"title":"Matt Gear Review","stage":"Platform Schedule","filmDate":null,"postDate":"2026-10-30","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":""},{"title":"Nick vs Bernard #1","stage":"Posted","filmDate":null,"postDate":"2026-10-27","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-10-27","reach":null,"shares":null,"notes":""},{"title":"Ken first 4 shots","stage":"Platform Schedule","filmDate":null,"postDate":"2026-11-01","reviewed":"Ready to review","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":""},{"title":"Haloween","stage":"Idea","filmDate":null,"postDate":"2026-10-31","reviewed":"","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":""},{"title":"Employee Highlight (Barb)","stage":"Schedule Filming","filmDate":null,"postDate":"2026-11-02","reviewed":"","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":""},{"title":"Leagues Promo Video","stage":"Schedule Filming","filmDate":null,"postDate":null,"reviewed":"","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":""},{"title":"Candy Cane Classic","stage":"Idea","filmDate":null,"postDate":null,"reviewed":"","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":""},{"title":"Holbrook Curve around Post (Gear Review)","stage":"Schedule Filming","filmDate":null,"postDate":null,"reviewed":"","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":""},{"title":"Employee Highlight (Jessie)","stage":"Schedule Filming","filmDate":null,"postDate":null,"reviewed":"","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":""},{"title":"Coach Tip Stacking (Holly)","stage":"Schedule Filming","filmDate":null,"postDate":null,"reviewed":"","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":""},{"title":"Coach Tip Lefty (Holly and Nick)","stage":"Schedule Filming","filmDate":null,"postDate":null,"reviewed":"","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":""},{"title":"TIk Tok Set Project","stage":"Idea","filmDate":null,"postDate":null,"reviewed":"","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":""},{"title":"Youtube Shorts","stage":"Idea","filmDate":null,"postDate":null,"reviewed":"","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":""},{"title":"Coaches Tip (Court positioning Matt/Holly)","stage":"Posted","filmDate":null,"postDate":"2026-09-01","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-01","reach":73737,"shares":null,"notes":""},{"title":"Kenny MDTO video","stage":"Posted","filmDate":null,"postDate":"2026-09-02","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-02","reach":13234,"shares":null,"notes":""},{"title":"Nicholas signed video","stage":"Posted","filmDate":null,"postDate":"2026-09-02","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-02","reach":7708,"shares":null,"notes":""},{"title":"Broadcast Aloha men's","stage":"Posted","filmDate":null,"postDate":"2026-09-04","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-04","reach":3053,"shares":0,"notes":""},{"title":"Hit a Serve challenge","stage":"Posted","filmDate":null,"postDate":"2026-09-07","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-07","reach":2665,"shares":null,"notes":""},{"title":"Jose Gear review","stage":"Posted","filmDate":null,"postDate":"2026-09-08","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-08","reach":3603,"shares":null,"notes":""},{"title":"Broadcast Holly intro","stage":"Posted","filmDate":null,"postDate":"2026-09-09","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-09","reach":3343,"shares":null,"notes":""},{"title":"Mikey & Nick $15 budget","stage":"Posted","filmDate":null,"postDate":"2026-09-10","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-10","reach":2081,"shares":null,"notes":""},{"title":"Broadcast Holly anticipation","stage":"Posted","filmDate":null,"postDate":"2026-09-11","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-11","reach":1670,"shares":null,"notes":""},{"title":"Guess the Athlete","stage":"Posted","filmDate":null,"postDate":"2026-09-12","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-12","reach":1823,"shares":null,"notes":""},{"title":"Coaches Tip (Spacing Matt/Holly)","stage":"Posted","filmDate":null,"postDate":"2026-09-13","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-13","reach":3137,"shares":null,"notes":""},{"title":"Broadcast Holly Dinking & Touch","stage":"Posted","filmDate":null,"postDate":"2026-09-14","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-14","reach":2162,"shares":null,"notes":""},{"title":"Coaches Tip Bernard (Forehand & Backhand)","stage":"Posted","filmDate":null,"postDate":"2026-09-15","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-15","reach":12491,"shares":null,"notes":""},{"title":"Broadcast Nicholas Serve as a weapon","stage":"Posted","filmDate":null,"postDate":"2026-09-16","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-16","reach":3908,"shares":null,"notes":""},{"title":"3 days left to sign up for the MDTO","stage":"Posted","filmDate":null,"postDate":"2026-09-17","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-17","reach":833,"shares":null,"notes":""},{"title":"Broadcast Nicholas breaks down his viral play agains Ben Johns","stage":"Posted","filmDate":null,"postDate":"2026-09-17","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-17","reach":2660,"shares":null,"notes":""},{"title":"Broadcast Matt 4.0+ games","stage":"Posted","filmDate":null,"postDate":"2026-09-18","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-18","reach":595,"shares":null,"notes":""},{"title":"Trophy shine video","stage":"Posted","filmDate":null,"postDate":"2026-09-18","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-18","reach":1614,"shares":0,"notes":""},{"title":"Ken MTDO video","stage":"Posted","filmDate":null,"postDate":"2026-09-19","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-19","reach":2359,"shares":3,"notes":""},{"title":"Broadcast Matt breaks down what makes elite players","stage":"Posted","filmDate":null,"postDate":"2026-09-19","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-19","reach":1080,"shares":2,"notes":""},{"title":"Broadcast Nicholas one day left to register","stage":"Posted","filmDate":null,"postDate":"2026-09-20","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-20","reach":1703,"shares":0,"notes":""},{"title":"MDTO Trophy Vid","stage":"Posted","filmDate":null,"postDate":"2026-09-20","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-20","reach":1422,"shares":0,"notes":""},{"title":"Your Home Court Edit","stage":"Posted","filmDate":null,"postDate":"2026-09-21","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-21","reach":2059,"shares":3,"notes":""},{"title":"Broadcast Nicholas Overhead smash","stage":"Posted","filmDate":null,"postDate":"2026-09-21","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-21","reach":967,"shares":11,"notes":""},{"title":"Broadcast Matt Third shot drop","stage":"Posted","filmDate":null,"postDate":"2026-09-22","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-22","reach":1801,"shares":0,"notes":""},{"title":"Broadcast Denny in da house","stage":"Posted","filmDate":null,"postDate":"2026-09-23","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-23","reach":2084,"shares":0,"notes":""},{"title":"Coach Ken Split step","stage":"Posted","filmDate":null,"postDate":"2026-09-23","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-23","reach":1215,"shares":0,"notes":""},{"title":"Nicholas Gear review","stage":"Posted","filmDate":null,"postDate":"2026-09-24","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-24","reach":4734,"shares":2,"notes":""},{"title":"Broadcast Nicholas Cats or Dogs","stage":"Posted","filmDate":null,"postDate":"2026-09-25","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-25","reach":1934,"shares":16,"notes":""},{"title":"MDTO Post 1 SOLOS","stage":"Posted","filmDate":null,"postDate":"2026-09-25","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-25","reach":9516,"shares":8,"notes":""},{"title":"Broadcast Denny game highlights","stage":"Posted","filmDate":null,"postDate":"2026-09-26","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-26","reach":1769,"shares":2,"notes":""},{"title":"MDTO Post 2 DUOS","stage":"Posted","filmDate":null,"postDate":"2026-09-27","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-27","reach":7793,"shares":5,"notes":""},{"title":"Broadcast Nicholas Experience with Ben Johns","stage":"Posted","filmDate":null,"postDate":"2026-09-27","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-27","reach":2052,"shares":2,"notes":""},{"title":"MDTO Post 3 MIXED","stage":"Posted","filmDate":null,"postDate":"2026-09-28","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-28","reach":6813,"shares":9,"notes":""},{"title":"Nicholas 11-0 Video","stage":"Posted","filmDate":null,"postDate":"2026-09-28","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-28","reach":14074,"shares":12,"notes":""},{"title":"Broadcast Denny Overtime","stage":"Posted","filmDate":null,"postDate":"2026-09-29","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-29","reach":1949,"shares":2,"notes":""},{"title":"MDTO RECAP POST","stage":"Posted","filmDate":null,"postDate":"2026-09-30","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-09-30","reach":4591,"shares":5,"notes":""},{"title":"Paddle Review Nicholas","stage":"Posted","filmDate":null,"postDate":"2026-10-02","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-10-02","reach":1543,"shares":4,"notes":""},{"title":"Denny MDTO Broadcast clip","stage":"Posted","filmDate":null,"postDate":"2026-10-03","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-10-03","reach":1421,"shares":3,"notes":""},{"title":"Nick+Brayden duo video","stage":"Posted","filmDate":null,"postDate":"2026-10-04","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-10-04","reach":1555,"shares":9,"notes":""},{"title":"Holly7-11","stage":"Posted","filmDate":null,"postDate":"2026-10-06","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-10-06","reach":604,"shares":3,"notes":"Filming with holly Monday"},{"title":"Neflix Docu video","stage":"Posted","filmDate":null,"postDate":"2026-10-07","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-10-07","reach":null,"shares":null,"notes":""},{"title":"Denny MDTO Broadcast clip .2","stage":"Posted","filmDate":null,"postDate":"2026-10-08","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-10-08","reach":null,"shares":null,"notes":""},{"title":"Jose Gear review","stage":"Posted","filmDate":null,"postDate":"2026-10-09","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-10-09","reach":null,"shares":null,"notes":"Wheel is needed"},{"title":"Kaylee Staff highlight","stage":"Posted","filmDate":null,"postDate":"2026-10-10","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-10-10","reach":null,"shares":null,"notes":"Needs to be filmed today"},{"title":"Candy cane classic ken 1","stage":"Posted","filmDate":null,"postDate":"2026-10-12","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-10-12","reach":null,"shares":null,"notes":""},{"title":"Holly Coaches tip","stage":"Posted","filmDate":null,"postDate":"2026-10-13","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-10-13","reach":null,"shares":null,"notes":""},{"title":"Candy cane classic ken 2","stage":"Posted","filmDate":null,"postDate":"2026-10-14","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-10-14","reach":null,"shares":null,"notes":""},{"title":"Post 50+ event","stage":"Posted","filmDate":null,"postDate":"2026-10-15","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-10-15","reach":null,"shares":null,"notes":""},{"title":"Matt MDTO Broadcast","stage":"Posted","filmDate":null,"postDate":"2026-10-16","reviewed":"Reviewed","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":"2026-10-16","reach":null,"shares":null,"notes":""},{"title":"Candy Cane Classic Nick+Brayden","stage":"Platform Schedule","filmDate":null,"postDate":"2026-10-17","reviewed":"","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":"Date has passed, status not marked in the sheet."},{"title":"Nicholas warmup video","stage":"Platform Schedule","filmDate":null,"postDate":"2026-10-18","reviewed":"","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":"Date has passed, status not marked in the sheet."},{"title":"Nicholas Gear review","stage":"Platform Schedule","filmDate":null,"postDate":"2026-10-19","reviewed":"","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":"Date has passed, status not marked in the sheet."},{"title":"Matt broadcast","stage":"Platform Schedule","filmDate":null,"postDate":"2026-10-20","reviewed":"","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":"Date has passed, status not marked in the sheet."},{"title":"Jose member highlight","stage":"Platform Schedule","filmDate":null,"postDate":"2026-10-21","reviewed":"","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":"Date has passed, status not marked in the sheet."},{"title":"Kaylee Hoolbrook announcement","stage":"Platform Schedule","filmDate":null,"postDate":"2026-10-22","reviewed":"","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":"Date has passed, status not marked in the sheet."},{"title":"Pink Ladys night post","stage":"Platform Schedule","filmDate":null,"postDate":"2026-10-22","reviewed":"","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":"Date has passed, status not marked in the sheet."},{"title":"Nicholas Gear review","stage":"Platform Schedule","filmDate":null,"postDate":"2026-10-23","reviewed":"","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":"Date has passed, status not marked in the sheet."},{"title":"Nicholas broadcast","stage":"Platform Schedule","filmDate":null,"postDate":"2026-10-24","reviewed":"","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":"Date has passed, status not marked in the sheet."},{"title":"Ken Coaches tips","stage":"Platform Schedule","filmDate":null,"postDate":"2026-10-26","reviewed":"","boosted":false,"type":"","people":"","hook":"","length":"","sound":"","tone":"","cta":"","postedDate":null,"reach":null,"shares":null,"notes":"Date has passed, status not marked in the sheet."}];

// ===================================================================
// v5: SOCIAL MEDIA HUB + per-person workdays + Claude connector (MCP)
// ===================================================================
const SOCIAL_GROUP='Social Media';
const DAY_NAMES=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DEFAULT_WORKDAYS=['Mon','Tue','Wed','Thu','Fri'];
const STAGES=['Idea','Schedule Filming','Filming','Editing','Platform Schedule','Posted'];
const STAGE_LABEL={'Idea':'Idea','Schedule Filming':'Needs a shoot date','Filming':'Filming','Editing':'Editing','Platform Schedule':'Ready to post','Posted':'Posted'};
const NEXT_STAGE={'Idea':'Schedule Filming','Schedule Filming':'Filming','Filming':'Editing','Editing':'Platform Schedule','Platform Schedule':'Posted'};
const TAG_FIELDS=['type','people','hook','length','sound','tone','cta'];
try{db.exec(`ALTER TABLE employees ADD COLUMN workdays TEXT DEFAULT '["Mon","Tue","Wed","Thu","Fri"]'`);}catch(e){}
db.exec(`
CREATE TABLE IF NOT EXISTS social_cards(id TEXT PRIMARY KEY,title TEXT,stage TEXT,film_date TEXT,edit_date TEXT,post_date TEXT,posted_date TEXT,
 reviewed TEXT DEFAULT '',boosted INTEGER DEFAULT 0,type TEXT DEFAULT '',people TEXT DEFAULT '',hook TEXT DEFAULT '',length TEXT DEFAULT '',
 sound TEXT DEFAULT '',tone TEXT DEFAULT '',cta TEXT DEFAULT '',reach INTEGER,shares INTEGER,notes TEXT DEFAULT '',active INTEGER DEFAULT 1,
 created_at TEXT DEFAULT (datetime('now')),updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS social_activity(id TEXT PRIMARY KEY,employee_id TEXT,date TEXT,kind TEXT,text TEXT,card_id TEXT,hidden INTEGER DEFAULT 0,
 created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS social_manual(id TEXT PRIMARY KEY,employee_id TEXT,date TEXT,list TEXT,text TEXT,active INTEGER DEFAULT 1,
 created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS social_reports(id TEXT PRIMARY KEY,employee_id TEXT,date TEXT,next_date TEXT,worked TEXT,next TEXT,nums TEXT,needs TEXT,
 open_steps INTEGER DEFAULT 0,created_at TEXT DEFAULT (datetime('now')));
`);
// one-time seed: Lucas's Google Sheet as of 2026-10-28
if(db.prepare('SELECT COUNT(*) c FROM social_cards').get().c===0){
 const ins=db.prepare(`INSERT INTO social_cards(id,title,stage,film_date,edit_date,post_date,posted_date,reviewed,boosted,type,people,hook,length,sound,tone,cta,reach,shares,notes)
  VALUES(@id,@title,@stage,@filmDate,@editDate,@postDate,@postedDate,@reviewed,@boosted,@type,@people,@hook,@length,@sound,@tone,@cta,@reach,@shares,@notes)`);
 db.transaction(()=>SOCIAL_SEED.forEach(c=>ins.run({editDate:null,...c,id:'v'+uid(),boosted:c.boosted?1:0})))();
 console.log('Seeded social cards:',SOCIAL_SEED.length);
}
// the five daily social metrics are ordinary items, assigned to the Social Media group (editable in Tasks & Metrics)
[['social_posted','Videos posted today',1],['social_filmed','Videos filmed',2],['social_edited','Videos edited',3],['social_ideas','New ideas added',4],['social_results','7-day results logged',5]]
 .forEach(([id,label,o])=>{ if(!db.prepare('SELECT 1 FROM items WHERE id=?').get(id))
  db.prepare('INSERT INTO items(id,label,kinds,cadence,scope_type,scope_values,goal,high_priority,text_label,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?)')
   .run(id,label,'["number"]','daily','group',JSON.stringify([SOCIAL_GROUP]),null,0,null,900+o); });

const ISO=/^\d{4}-\d{2}-\d{2}$/;
const okDate=d=>typeof d==='string'&&ISO.test(d);
function localToday(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function addDaysISO(s,n){const d=new Date(s+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
function dowName(s){return DAY_NAMES[new Date(s+'T12:00:00Z').getUTCDay()];}
function prettyD(s){if(!s)return '';const d=new Date(s+'T12:00:00Z');return d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',timeZone:'UTC'});}
function empWorkdays(emp){const w=J(emp&&emp.workdays,DEFAULT_WORKDAYS);return Array.isArray(w)&&w.length?w:DEFAULT_WORKDAYS;}
function nextShiftFor(emp,day){const w=empWorkdays(emp);let d=addDaysISO(day,1);for(let i=0;i<14&&!w.includes(dowName(d));i++)d=addDaysISO(d,1);return d;}
function isSocialEmp(emp){return !!emp&&J(emp.groups).includes(SOCIAL_GROUP);}
const cardOut=r=>r&&({id:r.id,title:r.title,stage:r.stage,filmDate:r.film_date,editDate:r.edit_date,postDate:r.post_date,postedDate:r.posted_date,
 reviewed:r.reviewed||'',boosted:!!r.boosted,type:r.type||'',people:r.people||'',hook:r.hook||'',length:r.length||'',sound:r.sound||'',tone:r.tone||'',cta:r.cta||'',
 reach:r.reach,shares:r.shares,notes:r.notes||'',updatedAt:r.updated_at});
const allCards=()=>db.prepare('SELECT * FROM social_cards WHERE active=1').all().map(cardOut);
const getCard=id=>cardOut(db.prepare('SELECT * FROM social_cards WHERE id=? AND active=1').get(id));
function logAct(empId,date,kind,text,cardId){db.prepare('INSERT INTO social_activity(id,employee_id,date,kind,text,card_id) VALUES(?,?,?,?,?,?)').run(uid(),empId,date,kind,text,cardId||null);}

// field-level patch with validation; who = 'staff' | 'manager' | 'claude'
function patchCard(id,p,who){const c=getCard(id);if(!c)return {error:'Video not found'};p=p||{};
 const set={};const err=m=>({error:m});
 if(p.title!==undefined){const t=String(p.title).trim();if(!t)return err('Title cannot be empty');set.title=t.slice(0,200);}
 if(p.stage!==undefined){if(!STAGES.includes(p.stage))return err('Unknown stage');set.stage=p.stage;}
 for(const [k,col] of [['filmDate','film_date'],['editDate','edit_date'],['postDate','post_date'],['postedDate','posted_date']])
  if(p[k]!==undefined){if(p[k]!==null&&p[k]!==''&&!okDate(p[k]))return err(k+' must be YYYY-MM-DD');set[col]=p[k]||null;}
 if(p.reviewed!==undefined){if(!['','Ready to review','Reviewed'].includes(p.reviewed))return err('reviewed must be "", "Ready to review" or "Reviewed"');
  if(who==='staff'&&p.reviewed==='Reviewed'&&c.reviewed!=='Reviewed')return err('Only Nick can approve');set.reviewed=p.reviewed;}
 if(p.boosted!==undefined)set.boosted=p.boosted?1:0;
 TAG_FIELDS.forEach(k=>{if(p[k]!==undefined)set[k]=String(p[k]||'').slice(0,60);});
 for(const k of ['reach','shares'])if(p[k]!==undefined){if(p[k]===null||p[k]==='')set[k]=null;else{const n=Number(p[k]);if(!Number.isFinite(n)||n<0)return err(k+' must be a positive number');set[k]=Math.round(n);}}
 if(p.notes!==undefined)set.notes=String(p.notes||'').slice(0,2000);
 if(set.stage==='Posted'&&!(set.posted_date||c.postedDate))set.posted_date=localToday();
 const keys=Object.keys(set);if(!keys.length)return {card:c,changed:false};
 db.prepare(`UPDATE social_cards SET ${keys.map(k=>k+'=@'+k).join(',')},updated_at=datetime('now') WHERE id=@id`).run({...set,id});
 return {card:getCard(id),before:c,changed:true};}
function createCard(p,empId,date){const t=String((p&&p.title)||'').trim();if(!t)return {error:'Give the idea a title'};
 const id='v'+uid();db.prepare(`INSERT INTO social_cards(id,title,stage) VALUES(?,?,'Idea')`).run(id,t.slice(0,200));
 const r=patchCard(id,{...p,title:t,stage:p&&STAGES.includes(p.stage)?p.stage:'Idea'},'manager');if(r.error){db.prepare('DELETE FROM social_cards WHERE id=?').run(id);return r;}
 logAct(empId,date||localToday(),'idea-added','Added idea: '+t,id);return {card:getCard(id)};}
// the Complete button: moves a video one stage forward, asking for the date that stage needs
function completeCard(id,p,empId,date){const c=getCard(id);if(!c)return {error:'Video not found'};if(c.stage==='Posted')return {error:'Already posted'};
 p=p||{};date=okDate(date)?date:localToday();const from=c.stage,to=NEXT_STAGE[from];const set={stage:to};
 const post=p.postDate||c.postDate;
 if(from!=='Platform Schedule'){if(!okDate(post))return {error:'Pick a target post date first.'};set.postDate=post;}
 if(from==='Idea'){const t=String(p.title||c.title||'').trim();if(!t)return {error:'Give it a title.'};set.title=t;}
 if(from==='Schedule Filming'){if(!okDate(p.filmDate))return {error:'Pick the shoot date.'};if(post<p.filmDate)return {error:'The post date is before the shoot date. Move one of them.'};set.filmDate=p.filmDate;}
 if(from==='Filming'){if(!okDate(p.editDate))return {error:'Pick the day it will be edited.'};if(post<p.editDate)return {error:'The post date is before the edit date. Move one of them.'};set.editDate=p.editDate;}
 if(from==='Editing'&&c.reviewed!=='Reviewed')set.reviewed='Ready to review';
 if(from==='Platform Schedule'){const pd=okDate(p.postedDate)?p.postedDate:date;set.postedDate=pd;}
 const r=patchCard(id,set,'manager');if(r.error)return r;const t=r.card.title;
 const text={'Idea':`Finalized idea: ${t} (target post ${prettyD(post)})`,'Schedule Filming':`Set shoot date for ${t}: ${prettyD(set.filmDate)}`,
  'Filming':`Filmed ${t} (editing ${prettyD(set.editDate)})`,'Editing':`Edited ${t}, sent to Nick for review`,'Platform Schedule':`Posted ${t}`}[from];
 const kind={'Idea':'idea-done','Schedule Filming':'shoot-set','Filming':'filmed','Editing':'edited','Platform Schedule':'posted'}[from];
 logAct(empId,date,kind,text,id);return {card:r.card,moved:{from,to}};}
// the plan for a day, built from each video's stage + dates
function stepsFor(day,withLate){const out=[];const L=d=>withLate?(d&&d<=day):(d===day);
 allCards().forEach(c=>{
  if(c.stage==='Filming'&&L(c.filmDate))out.push({type:'Film',card:c,late:c.filmDate<day});
  if(c.stage==='Editing'&&L(c.editDate))out.push({type:'Edit',card:c,late:c.editDate<day});
  if(c.stage==='Platform Schedule'&&c.postDate===day)out.push({type:'Post',card:c});
  if(c.stage==='Posted'&&c.postedDate&&c.reach==null&&addDaysISO(c.postedDate,7)===day)out.push({type:'Results',card:c});});
 if(['Mon','Thu'].includes(dowName(day)))out.push({type:'Ideas',label:'Idea generation block (add 3+ ideas to the board)'});
 return out;}
const stepText=s=>s.label||((s.type==='Results'?'Log 7-day reach + shares: ':s.type+': ')+s.card.title);
function socialSnapshot(empId,date){const emp=db.prepare('SELECT * FROM employees WHERE id=?').get(empId);const ns=nextShiftFor(emp,date);
 return {social:true,date,nextShift:ns,workdays:empWorkdays(emp),cards:allCards(),
  activity:db.prepare('SELECT id,kind,text,card_id cardId,created_at FROM social_activity WHERE employee_id=? AND date=? AND hidden=0 ORDER BY created_at').all(empId,date),
  manual:{worked:db.prepare("SELECT id,text FROM social_manual WHERE employee_id=? AND date=? AND list='worked' AND active=1 ORDER BY created_at").all(empId,date),
          next:db.prepare("SELECT id,text FROM social_manual WHERE employee_id=? AND date=? AND list='next' AND active=1 ORDER BY created_at").all(empId,ns)}};}
function attention(today){const cards=allCards();return {
 waitingReview:cards.filter(c=>c.reviewed==='Ready to review'&&c.stage!=='Posted'),
 pastPostDate:cards.filter(c=>c.stage!=='Posted'&&c.postDate&&c.postDate<today),
 postingToday:cards.filter(c=>c.stage!=='Posted'&&c.postDate===today),
 resultsDue:cards.filter(c=>c.stage==='Posted'&&c.postedDate&&c.reach==null&&c.postedDate<=addDaysISO(today,-7)&&c.postedDate>=addDaysISO(today,-21))};}
const socialReports=n=>db.prepare('SELECT r.*,e.name FROM social_reports r LEFT JOIN employees e ON e.id=r.employee_id ORDER BY r.created_at DESC LIMIT ?').all(n||30)
 .map(r=>({...r,worked:J(r.worked),next:J(r.next),nums:J(r.nums,{})}));

// ---- staff social routes (PIN + must be in the Social Media group) ----
function socialStaff(req,res){const emp=db.prepare('SELECT * FROM employees WHERE id=? AND active=1').get(req.params.id);
 if(!emp||!staffOk(req.params.id,req.headers['x-staff-pin'])){res.status(401).json({error:'PIN required'});return null;}
 if(!isSocialEmp(emp)){res.json({social:false});return null;}return emp;}
const reqDate=req=>okDate((req.body||{}).date)?req.body.date:okDate(req.query.date)?req.query.date:localToday();
app.get('/api/staff/:id/social',(req,res)=>{if(!socialStaff(req,res))return;res.json(socialSnapshot(req.params.id,reqDate(req)));});
app.post('/api/staff/:id/social/cards',(req,res)=>{if(!socialStaff(req,res))return;const r=createCard(req.body||{},req.params.id,reqDate(req));if(r.error)return res.status(400).json(r);res.json(r);});
app.put('/api/staff/:id/social/cards/:cid',(req,res)=>{if(!socialStaff(req,res))return;const date=reqDate(req);const r=patchCard(req.params.cid,req.body||{},'staff');if(r.error)return res.status(400).json(r);
 if(r.changed){const b=r.before,c=r.card;
  if(b.stage!==c.stage)logAct(req.params.id,date,c.stage==='Posted'?'posted':'moved',c.stage==='Posted'?'Posted '+c.title:'Moved '+c.title+' to '+STAGE_LABEL[c.stage],c.id);
  if(b.reach==null&&c.reach!=null)logAct(req.params.id,date,'results',`Logged 7-day results for ${c.title}: ${c.reach.toLocaleString('en-US')} reach`,c.id);
  if(b.reviewed!=='Ready to review'&&c.reviewed==='Ready to review'&&b.stage===c.stage)logAct(req.params.id,date,'review','Sent '+c.title+' to Nick for review',c.id);}
 res.json(r);});
app.post('/api/staff/:id/social/cards/:cid/complete',(req,res)=>{if(!socialStaff(req,res))return;const r=completeCard(req.params.cid,req.body||{},req.params.id,reqDate(req));if(r.error)return res.status(400).json(r);res.json(r);});
app.post('/api/staff/:id/social/manual',(req,res)=>{const emp=socialStaff(req,res);if(!emp)return;const b=req.body||{};const t=String(b.text||'').trim().slice(0,500);
 if(!t||!['worked','next'].includes(b.list))return res.status(400).json({error:'text and list required'});const date=reqDate(req);
 db.prepare('INSERT INTO social_manual(id,employee_id,date,list,text) VALUES(?,?,?,?,?)').run(uid(),req.params.id,b.list==='next'?nextShiftFor(emp,date):date,b.list,t);res.json({ok:true});});
app.delete('/api/staff/:id/social/manual/:mid',(req,res)=>{if(!socialStaff(req,res))return;db.prepare('UPDATE social_manual SET active=0 WHERE id=? AND employee_id=?').run(req.params.mid,req.params.id);res.json({ok:true});});
app.post('/api/staff/:id/social/activity/:aid/hide',(req,res)=>{if(!socialStaff(req,res))return;db.prepare('UPDATE social_activity SET hidden=1 WHERE id=? AND employee_id=?').run(req.params.aid,req.params.id);res.json({ok:true});});
app.post('/api/staff/:id/social/report',(req,res)=>{const emp=socialStaff(req,res);if(!emp)return;const date=reqDate(req);const s=socialSnapshot(req.params.id,date);const b=req.body||{};
 const worked=[...s.activity.map(a=>a.text),...s.manual.worked.map(m=>m.text)];
 const next=[...stepsFor(s.nextShift).map(stepText),...s.manual.next.map(m=>m.text)];
 const open=stepsFor(date,true).filter(x=>x.type==='Film'||x.type==='Edit').length;
 db.prepare('INSERT INTO social_reports(id,employee_id,date,next_date,worked,next,nums,needs,open_steps) VALUES(?,?,?,?,?,?,?,?,?)')
  .run(uid(),req.params.id,date,s.nextShift,JSON.stringify(worked),JSON.stringify(next),JSON.stringify(b.nums||{}),String(b.needs||'').slice(0,2000),open);
 res.json({ok:true});});

// ---- manager social routes ----
app.get('/api/manager/social',requireManager,(req,res)=>{const today=okDate(req.query.date)?req.query.date:localToday();
 res.json({today,cards:allCards(),reports:socialReports(30),claude:claudeStatus()});});
app.post('/api/manager/social/cards',requireManager,(req,res)=>{const r=createCard(req.body||{},'manager',reqDate(req));if(r.error)return res.status(400).json(r);res.json(r);});
app.put('/api/manager/social/cards/:cid',requireManager,(req,res)=>{const r=patchCard(req.params.cid,req.body||{},'manager');if(r.error)return res.status(400).json(r);res.json(r);});
app.post('/api/manager/social/cards/:cid/complete',requireManager,(req,res)=>{const r=completeCard(req.params.cid,req.body||{},'manager',reqDate(req));if(r.error)return res.status(400).json(r);res.json(r);});
app.put('/api/manager/employees/:id/workdays',requireManager,(req,res)=>{const w=(req.body||{}).workdays;
 if(!Array.isArray(w)||!w.every(d=>DAY_NAMES.includes(d)))return res.status(400).json({error:'workdays must be like ["Mon","Tue"]'});
 db.prepare('UPDATE employees SET workdays=? WHERE id=?').run(JSON.stringify(DAY_NAMES.filter(d=>w.includes(d))),req.params.id);res.json({ok:true});});
app.get('/api/manager/workdays',requireManager,(q,res)=>{const o={};db.prepare('SELECT id,workdays FROM employees').all().forEach(e=>o[e.id]=empWorkdays(e));res.json(o);});

// ===================================================================
// Claude connector: OAuth 2.1 (PKCE) sign-in approved with the manager PIN, then MCP tools.
// Claude can read everything and make most manager changes. It can never delete anything,
// touch employee records or PINs, or download the database.
// ===================================================================
const PUBLIC_URL=(process.env.PUBLIC_URL||'https://staff.metropickleballclub.com').replace(/\/$/,'');
db.exec(`
CREATE TABLE IF NOT EXISTS oauth_clients(client_id TEXT PRIMARY KEY,name TEXT,redirect_uris TEXT,created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS oauth_codes(code_hash TEXT PRIMARY KEY,client_id TEXT,redirect_uri TEXT,challenge TEXT,expires INTEGER);
CREATE TABLE IF NOT EXISTS oauth_tokens(token_hash TEXT PRIMARY KEY,kind TEXT,client_id TEXT,expires INTEGER,created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS claude_log(id INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT DEFAULT (datetime('now')),tool TEXT,summary TEXT,is_write INTEGER DEFAULT 0,ok INTEGER DEFAULT 1);
`);
const sha=s=>crypto.createHash('sha256').update(String(s)).digest('hex');
const rnd=()=>crypto.randomBytes(32).toString('base64url');
const nowS=()=>Math.floor(Date.now()/1000);
const redirectAllowed=u=>{try{const x=new URL(u);return x.protocol==='https:'&&['claude.ai','claude.com'].includes(x.hostname);}catch{return false}};
function claudeStatus(){const t=db.prepare("SELECT COUNT(*) c FROM oauth_tokens WHERE kind='refresh' AND expires>?").get(nowS()).c;
 return {connected:t>0,log:db.prepare('SELECT at,tool,summary,is_write,ok FROM claude_log ORDER BY id DESC LIMIT 25').all()};}
app.post('/api/manager/claude/disconnect',requireManager,(q,res)=>{db.prepare('DELETE FROM oauth_tokens').run();db.prepare('DELETE FROM oauth_codes').run();res.json({ok:true});});
const noStore=res=>res.set({'Cache-Control':'no-store','Pragma':'no-cache'});
app.get(['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp'],(q,res)=>res.json({
 resource:PUBLIC_URL+'/mcp',authorization_servers:[PUBLIC_URL],bearer_methods_supported:['header'],resource_name:'Metro Staff Portal'}));
app.get('/.well-known/oauth-authorization-server',(q,res)=>res.json({issuer:PUBLIC_URL,authorization_endpoint:PUBLIC_URL+'/oauth/authorize',
 token_endpoint:PUBLIC_URL+'/oauth/token',registration_endpoint:PUBLIC_URL+'/oauth/register',response_types_supported:['code'],
 grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none'],scopes_supported:['staff']}));
app.post('/oauth/register',(req,res)=>{const b=req.body||{};const uris=Array.isArray(b.redirect_uris)?b.redirect_uris:[];
 if(!uris.length||!uris.every(redirectAllowed))return res.status(400).json({error:'invalid_redirect_uri',error_description:'Only Claude can connect to this portal.'});
 if(db.prepare('SELECT COUNT(*) c FROM oauth_clients').get().c>50)db.prepare('DELETE FROM oauth_clients WHERE client_id IN (SELECT client_id FROM oauth_clients ORDER BY created_at LIMIT 25)').run();
 const id='c_'+crypto.randomBytes(12).toString('hex');db.prepare('INSERT INTO oauth_clients(client_id,name,redirect_uris) VALUES(?,?,?)').run(id,String(b.client_name||'Claude').slice(0,80),JSON.stringify(uris));
 res.status(201).json({client_id:id,client_id_issued_at:nowS(),client_name:b.client_name||'Claude',redirect_uris:uris,token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']});});
function authParams(src){const p={};['response_type','client_id','redirect_uri','code_challenge','code_challenge_method','state','scope','resource'].forEach(k=>p[k]=src[k]==null?'':String(src[k]));return p;}
function checkAuthParams(p){const cl=db.prepare('SELECT * FROM oauth_clients WHERE client_id=?').get(p.client_id);
 if(!cl)return 'Unknown app. Remove the connector in Claude and add it again.';
 if(!J(cl.redirect_uris).includes(p.redirect_uri))return 'This sign-in link is not valid.';
 if(p.response_type!=='code'||!p.code_challenge||p.code_challenge_method!=='S256')return 'This sign-in link is missing its security check.';return null;}
const escH=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function authPage(p,msg){const hidden=Object.entries(p).map(([k,v])=>`<input type="hidden" name="${k}" value="${escH(v)}">`).join('');
 return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Claude · Metro Staff</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f4f8;color:#1a2332;margin:0;padding:24px 16px}.c{max-width:420px;margin:40px auto;background:#fff;border-radius:14px;padding:22px;box-shadow:0 1px 4px rgba(0,0,0,.08)}
.logo{background:#00AEAE;color:#fff;font-weight:900;font-size:11px;padding:7px 11px;border-radius:7px;display:inline-block;line-height:1.25}h1{font-size:19px;margin:14px 0 6px}ul{padding-left:18px;font-size:14px;line-height:1.5}
.no{color:#b91c1c}input[type=password]{width:100%;padding:11px;border:2px solid #e2e8f0;border-radius:9px;font-size:16px;box-sizing:border-box}button{width:100%;padding:13px;border:none;border-radius:10px;background:#00AEAE;color:#fff;font-size:15px;font-weight:700;margin-top:10px;cursor:pointer}
.err{color:#b91c1c;font-size:13px;margin-top:8px}.m{color:#64748b;font-size:12px}</style></head><body><div class="c"><div class="logo">METRO<br>PICKLEBALL</div>
<h1>Connect Claude to the staff portal?</h1><p class="m">Only approve this if you just clicked Connect in Claude yourself.</p>
<ul><li>Read the team, check-ins, reports, metrics and the social media board</li><li>Make manager changes: tasks and metrics, banners, check-in notes, report status, social media videos</li><li>Draft management notes for staff (you approve every one before anyone sees it)</li>
<li class="no">Never delete anything, change employees or PINs, or download the database</li></ul>
<form method="post" action="/oauth/authorize">${hidden}<label class="m" for="pin">Manager PIN</label><input type="password" id="pin" name="pin" autocomplete="current-password" autofocus required>
<button type="submit">Approve</button></form>${msg?`<div class="err">${escH(msg)}</div>`:''}<p class="m" style="margin-top:14px">You can disconnect Claude any time from the manager dashboard, Social tab.</p></div></body></html>`;}
app.get('/oauth/authorize',(req,res)=>{const p=authParams(req.query);const e=checkAuthParams(p);noStore(res);res.set('X-Frame-Options','DENY');if(e)return res.status(400).send(authPage(p,e).replace('<form','<form hidden'));res.send(authPage(p));});
app.post('/oauth/authorize',(req,res)=>{const p=authParams(req.body||{});const e=checkAuthParams(p);noStore(res);res.set('X-Frame-Options','DENY');if(e)return res.status(400).send(authPage(p,e));
 const ip=clientIp(req);if(isLocked(ip))return res.status(429).send(authPage(p,'Too many wrong PINs. Try again in 15 minutes.'));
 if(String((req.body||{}).pin||'')!==MANAGER_PIN){noteFail(ip);return res.status(401).send(authPage(p,'That PIN did not match.'));}
 clearFails(ip);const code=rnd();db.prepare('INSERT INTO oauth_codes(code_hash,client_id,redirect_uri,challenge,expires) VALUES(?,?,?,?,?)').run(sha(code),p.client_id,p.redirect_uri,p.code_challenge,nowS()+600);
 const u=new URL(p.redirect_uri);u.searchParams.set('code',code);if(p.state)u.searchParams.set('state',p.state);res.redirect(302,u.toString());});
function issueTokens(clientId){const a=rnd(),r=rnd();db.prepare('INSERT INTO oauth_tokens(token_hash,kind,client_id,expires) VALUES(?,?,?,?)').run(sha(a),'access',clientId,nowS()+3600);
 db.prepare('INSERT INTO oauth_tokens(token_hash,kind,client_id,expires) VALUES(?,?,?,?)').run(sha(r),'refresh',clientId,nowS()+30*86400);
 db.prepare('DELETE FROM oauth_tokens WHERE expires<?').run(nowS());return {access_token:a,token_type:'Bearer',expires_in:3600,refresh_token:r,scope:'staff'};}
app.post('/oauth/token',(req,res)=>{noStore(res);const b=req.body||{};const bad=(d)=>res.status(400).json({error:'invalid_grant',error_description:d});
 if(b.grant_type==='authorization_code'){const row=db.prepare('SELECT * FROM oauth_codes WHERE code_hash=?').get(sha(b.code||''));
  if(row)db.prepare('DELETE FROM oauth_codes WHERE code_hash=?').run(row.code_hash);
  if(!row||row.expires<nowS())return bad('Code expired or already used');
  if(row.client_id!==b.client_id||row.redirect_uri!==b.redirect_uri)return bad('Code does not match this app');
  const ch=crypto.createHash('sha256').update(String(b.code_verifier||'')).digest('base64url');if(ch!==row.challenge)return bad('PKCE check failed');
  return res.json(issueTokens(row.client_id));}
 if(b.grant_type==='refresh_token'){const row=db.prepare("SELECT * FROM oauth_tokens WHERE token_hash=? AND kind='refresh'").get(sha(b.refresh_token||''));
  if(!row||row.expires<nowS())return bad('Refresh token expired. Reconnect Claude.');
  if(b.client_id&&b.client_id!==row.client_id)return bad('Wrong app');
  db.prepare('DELETE FROM oauth_tokens WHERE token_hash=?').run(row.token_hash);return res.json(issueTokens(row.client_id));}
 res.status(400).json({error:'unsupported_grant_type'});});
function bearerOk(req){const h=req.headers.authorization||'';const m=h.match(/^Bearer\s+(.+)$/i);if(!m)return false;
 const row=db.prepare("SELECT 1 FROM oauth_tokens WHERE token_hash=? AND kind='access' AND expires>?").get(sha(m[1].trim()),nowS());return !!row;}

// ---- MCP tools ----
const S_ID={type:'string',description:'Employee id (from get_team)'};
const D={type:'string',description:'Date as YYYY-MM-DD'};
const CARD_FIELDS={title:{type:'string'},filmDate:D,editDate:D,postDate:{...D,description:'Target post date, YYYY-MM-DD'},postedDate:D,
 stage:{type:'string',enum:STAGES,description:'Idea | Schedule Filming (shown as "Needs a shoot date") | Filming | Editing | Platform Schedule (shown as "Ready to post") | Posted'},
 type:{type:'string'},people:{type:'string'},hook:{type:'string'},length:{type:'string'},sound:{type:'string'},tone:{type:'string'},cta:{type:'string'},
 boosted:{type:'boolean'},reach:{type:'number',description:'7-day reach'},shares:{type:'number'},notes:{type:'string'}};
const itemOut=it=>({...it,kinds:J(it.kinds),scope_values:J(it.scope_values),high_priority:!!it.high_priority,active:!!it.active});
const TOOLS=[
 {name:'get_team',read:true,description:'Everyone on staff: role, groups, workdays, whether they checked in today, and 2-week health (tasks done and goals hit).',inputSchema:{type:'object',properties:{}},
  run:()=>{const today=todayISO();return db.prepare('SELECT id,name,role,groups,responsibilities,workdays FROM employees WHERE active=1 ORDER BY name').all().map(e=>({id:e.id,name:e.name,role:e.role,groups:J(e.groups),workdays:empWorkdays(e),responsibilities:e.responsibilities,
   checkedInToday:db.prepare('SELECT COUNT(*) c FROM daily_entries WHERE employee_id=? AND date=?').get(e.id,today).c>0,...twoWeekHealth(e.id)}));}},
 {name:'get_submissions',read:true,description:'Daily check-ins people submitted (each tracked item with its value, plus their report). Optionally for one person and/or the last N days.',
  inputSchema:{type:'object',properties:{employee_id:S_ID,days:{type:'number',description:'Only the last N days (default 14)'}}},
  run:a=>{const n=Math.min(Math.max(Number(a.days)||14,1),366);const cut=addDaysISO(localToday(),-n);return buildSubmissions(a.employee_id||null).filter(s=>s.date>cut).map(s=>({...s,emp:{name:s.emp.name,role:s.emp.role,groups:s.emp.groups}}));}},
 {name:'get_rollup',read:true,description:'Totals for each tracked number for one person over a week or month (e.g. membership sales, L2P bookings, videos posted).',
  inputSchema:{type:'object',properties:{employee_id:S_ID,period:{type:'string',enum:['week','month']},anchor:D},required:['employee_id']},
  run:a=>{const emp=db.prepare('SELECT id,name FROM employees WHERE id=?').get(a.employee_id);if(!emp)throw new Error('No such employee');const anchor=okDate(a.anchor)?a.anchor:localToday();
   let rows;if(a.period==='month')rows=db.prepare('SELECT item_id,value,text_value,date FROM daily_entries WHERE employee_id=? AND substr(date,1,7)=?').all(emp.id,anchor.slice(0,7));
   else{const ds=weekDates(anchor);rows=db.prepare(`SELECT item_id,value,text_value,date FROM daily_entries WHERE employee_id=? AND date IN (${ds.map(()=>'?').join(',')})`).all(emp.id,...ds);}
   const labels={};db.prepare('SELECT id,label,goal FROM items').all().forEach(i=>labels[i.id]=i);const agg={};
   rows.forEach(r=>{const l=labels[r.item_id];if(!l)return;const k=l.label;(agg[k]||(agg[k]={total:0,daysLogged:0,goal:l.goal,notes:[]}));agg[k].total+=r.value||0;agg[k].daysLogged++;if(r.text_value)agg[k].notes.push(r.date+': '+r.text_value);});
   return {employee:emp.name,period:a.period==='month'?'month':'week',anchor,items:agg};}},
 {name:'get_reports',read:true,description:'Notes the team sent to Nick and Brayden from their check-ins. Status is open or resolved.',inputSchema:{type:'object',properties:{status:{type:'string',enum:['open','resolved','all']}}},
  run:a=>db.prepare('SELECT r.id,r.date,r.category,r.message,r.status,e.name FROM reports r JOIN employees e ON e.id=r.employee_id ORDER BY r.created_at DESC LIMIT 200').all().filter(r=>!a.status||a.status==='all'||r.status===a.status)},
 {name:'get_items',read:true,description:'Every task and metric staff are tracked on, with who it applies to, cadence and goal.',inputSchema:{type:'object',properties:{include_inactive:{type:'boolean'}}},
  run:a=>db.prepare('SELECT * FROM items ORDER BY sort_order').all().map(itemOut).filter(i=>a.include_inactive||i.active)},
 {name:'get_banners',read:true,description:'Focus banners currently showing at the top of the staff portal.',inputSchema:{type:'object',properties:{}},
  run:()=>db.prepare('SELECT * FROM banners WHERE active=1 ORDER BY created_at DESC').all().map(b=>({...b,scope_values:J(b.scope_values)}))},
 {name:'get_checkins',read:true,description:'Manager review / check-in history for one employee (traffic-light ratings and notes).',inputSchema:{type:'object',properties:{employee_id:S_ID},required:['employee_id']},
  run:a=>db.prepare('SELECT date,conductor,ratings,notes FROM checkins WHERE employee_id=? ORDER BY date DESC').all(a.employee_id).map(c=>({...c,ratings:J(c.ratings)}))},
 {name:'get_shifts',read:true,description:'Shift names and hours.',inputSchema:{type:'object',properties:{}},run:()=>db.prepare('SELECT name,hours,days FROM shifts ORDER BY sort_order').all().map(s=>({...s,days:J(s.days)}))},
 {name:'get_social_overview',read:true,description:'Social media dashboard: what is waiting on Nick\'s review, past its target post date, posting today, results due, pipeline counts, typical reach, and the latest daily social reports.',inputSchema:{type:'object',properties:{}},
  run:()=>{const today=localToday();const at=attention(today);const cards=allCards();const pick=c=>({id:c.id,title:c.title,stage:STAGE_LABEL[c.stage],postDate:c.postDate,reviewed:c.reviewed});
   const m=cards.filter(c=>c.stage==='Posted'&&c.reach!=null&&!c.boosted).map(c=>c.reach).sort((x,y)=>x-y);
   return {today,waitingReview:at.waitingReview.map(pick),pastPostDate:at.pastPostDate.map(pick),postingToday:at.postingToday.map(pick),resultsDue:at.resultsDue.map(pick),
    pipeline:Object.fromEntries(STAGES.map(s=>[STAGE_LABEL[s],cards.filter(c=>c.stage===s).length])),measuredPosts:m.length,medianReach:m.length?m[Math.floor(m.length/2)]:null,
    planToday:stepsFor(today,true).map(stepText),latestReports:socialReports(5)};}},
 {name:'get_social_board',read:true,description:'Videos on the social media board. Filter by stage or search the title.',inputSchema:{type:'object',properties:{stage:{type:'string',enum:STAGES},search:{type:'string'},limit:{type:'number'}}},
  run:a=>{let c=allCards();if(a.stage)c=c.filter(x=>x.stage===a.stage);if(a.search){const q=String(a.search).toLowerCase();c=c.filter(x=>x.title.toLowerCase().includes(q));}
   c.sort((x,y)=>(y.postedDate||y.postDate||'').localeCompare(x.postedDate||x.postDate||''));return c.slice(0,Math.min(Number(a.limit)||60,300)).map(x=>({...x,stageLabel:STAGE_LABEL[x.stage]}));}},
 {name:'get_social_plan',read:true,description:'The social media plan for a given day (shoots, edits, posts and results to log), built from the board dates.',inputSchema:{type:'object',properties:{date:D}},
  run:a=>{const d=okDate(a.date)?a.date:localToday();return {date:d,steps:stepsFor(d,d===localToday()).map(s=>({type:s.type,text:stepText(s),videoId:s.card&&s.card.id,late:!!s.late}))};}},
 // ---- writes (no deletes, no employees, no PINs) ----
 {name:'create_item',description:'Add a task or metric to staff check-ins. scope_type: all | group | shift | employee, with scope_values naming which.',
  inputSchema:{type:'object',properties:{label:{type:'string'},kinds:{type:'array',items:{type:'string',enum:['task','number','text']}},cadence:{type:'string',enum:['daily','weekly','onetime']},
   scope_type:{type:'string',enum:['all','group','shift','employee']},scope_values:{type:'array',items:{type:'string'}},goal:{type:'number'},high_priority:{type:'boolean'},text_label:{type:'string'},completion:{type:'string',enum:['each','shared']}},required:['label','kinds']},
  run:a=>{if(!String(a.label||'').trim())throw new Error('label required');const mx=db.prepare('SELECT MAX(sort_order) m FROM items').get().m||0;const id=uid();
   db.prepare('INSERT INTO items(id,label,kinds,cadence,scope_type,scope_values,goal,high_priority,text_label,sort_order,completion) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(id,String(a.label).trim(),JSON.stringify(a.kinds||['task']),a.cadence||'daily',a.scope_type||'all',JSON.stringify(a.scope_values||[]),a.goal??null,a.high_priority?1:0,a.text_label||null,mx+1,a.completion||'each');
   return itemOut(db.prepare('SELECT * FROM items WHERE id=?').get(id));},sum:a=>'Added item "'+a.label+'"'},
 {name:'update_item',description:'Change a task or metric (label, goal, who it applies to, cadence, priority). Cannot remove items.',
  inputSchema:{type:'object',properties:{id:{type:'string'},label:{type:'string'},kinds:{type:'array',items:{type:'string',enum:['task','number','text']}},cadence:{type:'string',enum:['daily','weekly','onetime']},
   scope_type:{type:'string',enum:['all','group','shift','employee']},scope_values:{type:'array',items:{type:'string'}},goal:{type:['number','null']},high_priority:{type:'boolean'},text_label:{type:'string'},completion:{type:'string',enum:['each','shared']}},required:['id']},
  run:a=>{const cur=db.prepare('SELECT * FROM items WHERE id=?').get(a.id);if(!cur)throw new Error('No such item');
   db.prepare('UPDATE items SET label=?,kinds=?,cadence=?,scope_type=?,scope_values=?,goal=?,high_priority=?,text_label=?,completion=? WHERE id=?')
    .run(a.label??cur.label,a.kinds?JSON.stringify(a.kinds):cur.kinds,a.cadence??cur.cadence,a.scope_type??cur.scope_type,a.scope_values?JSON.stringify(a.scope_values):cur.scope_values,a.goal===undefined?cur.goal:a.goal,a.high_priority===undefined?cur.high_priority:(a.high_priority?1:0),a.text_label===undefined?cur.text_label:a.text_label,a.completion??cur.completion,a.id);
   return itemOut(db.prepare('SELECT * FROM items WHERE id=?').get(a.id));},sum:a=>'Updated item '+a.id},
 {name:'create_banner',description:'Post a focus banner at the top of the staff portal. style: focus | alert | info. scope_type all | group | shift | employee.',
  inputSchema:{type:'object',properties:{message:{type:'string'},style:{type:'string',enum:['focus','alert','info']},scope_type:{type:'string',enum:['all','group','shift','employee']},scope_values:{type:'array',items:{type:'string'}}},required:['message']},
  run:a=>{const m=String(a.message||'').trim();if(!m)throw new Error('message required');const id=uid();
   db.prepare('INSERT INTO banners(id,message,style,scope_type,scope_values) VALUES(?,?,?,?,?)').run(id,m.slice(0,500),a.style||'focus',a.scope_type||'all',JSON.stringify(a.scope_values||[]));return {ok:true,id};},sum:a=>'Posted banner: '+String(a.message).slice(0,80)},
 {name:'update_banner',description:'Edit an existing focus banner (wording, style or who sees it). Cannot remove banners.',
  inputSchema:{type:'object',properties:{id:{type:'string'},message:{type:'string'},style:{type:'string',enum:['focus','alert','info']},scope_type:{type:'string',enum:['all','group','shift','employee']},scope_values:{type:'array',items:{type:'string'}}},required:['id']},
  run:a=>{const cur=db.prepare('SELECT * FROM banners WHERE id=?').get(a.id);if(!cur)throw new Error('No such banner');
   db.prepare('UPDATE banners SET message=?,style=?,scope_type=?,scope_values=? WHERE id=?').run(a.message!==undefined?String(a.message).trim().slice(0,500):cur.message,a.style||cur.style,a.scope_type||cur.scope_type,a.scope_values?JSON.stringify(a.scope_values):cur.scope_values,a.id);return {ok:true};},sum:a=>'Edited banner '+a.id},
 {name:'set_report_status',description:'Mark a team report resolved (or reopen it).',inputSchema:{type:'object',properties:{id:{type:'string'},status:{type:'string',enum:['open','resolved']}},required:['id','status']},
  run:a=>{const r=db.prepare('UPDATE reports SET status=? WHERE id=?').run(a.status,a.id);if(!r.changes)throw new Error('No such report');return {ok:true};},sum:a=>'Marked report '+a.id+' '+a.status},
 {name:'add_checkin',description:'Record a manager review / check-in note for an employee. ratings: [{goal, light: g|y|r}].',
  inputSchema:{type:'object',properties:{employee_id:S_ID,date:D,conductor:{type:'string',enum:['Nick','Brayden']},notes:{type:'string'},ratings:{type:'array',items:{type:'object',properties:{goal:{type:'string'},light:{type:'string',enum:['g','y','r']}}}}},required:['employee_id','notes']},
  run:a=>{if(!db.prepare('SELECT 1 FROM employees WHERE id=?').get(a.employee_id))throw new Error('No such employee');
   db.prepare('INSERT INTO checkins(id,employee_id,date,conductor,ratings,notes) VALUES(?,?,?,?,?,?)').run(uid(),a.employee_id,okDate(a.date)?a.date:localToday(),a.conductor||'Nick',JSON.stringify(a.ratings||[]),String(a.notes).slice(0,4000));return {ok:true};},sum:a=>'Added check-in note for '+a.employee_id},
 {name:'social_create_video',description:'Add a new video idea to the social media board.',inputSchema:{type:'object',properties:CARD_FIELDS,required:['title']},
  run:a=>{const r=createCard(a,'claude',localToday());if(r.error)throw new Error(r.error);return r.card;},sum:a=>'Added video idea "'+a.title+'"'},
 {name:'social_update_video',description:'Edit a video on the social board: title, dates, stage, tags, results or notes.',inputSchema:{type:'object',properties:{id:{type:'string'},...CARD_FIELDS},required:['id']},
  run:a=>{const {id,...p}=a;const r=patchCard(id,p,'claude');if(r.error)throw new Error(r.error);return r.card;},sum:a=>'Edited video '+a.id},
 {name:'social_complete_video',description:'Move a video to its next stage, like Lucas\'s Complete button. Needs postDate if it has none. From "Needs a shoot date" needs filmDate; from Filming needs editDate; from Ready to post takes postedDate.',
  inputSchema:{type:'object',properties:{id:{type:'string'},title:{type:'string'},filmDate:D,editDate:D,postDate:D,postedDate:D},required:['id']},
  run:a=>{const r=completeCard(a.id,a,'claude',localToday());if(r.error)throw new Error(r.error);return r;},sum:a=>'Moved video '+a.id+' to next stage'},
 {name:'social_review_video',description:'Approve a video for posting, or send it back to Lucas.',inputSchema:{type:'object',properties:{id:{type:'string'},decision:{type:'string',enum:['approve','send_back']}},required:['id','decision']},
  run:a=>{const r=patchCard(a.id,{reviewed:a.decision==='approve'?'Reviewed':''},'manager');if(r.error)throw new Error(r.error);return r.card;},sum:a=>(a.decision==='approve'?'Approved':'Sent back')+' video '+a.id},
 {name:'set_workdays',description:'Set which days of the week someone works (used for their "next shift" plan).',inputSchema:{type:'object',properties:{employee_id:S_ID,workdays:{type:'array',items:{type:'string',enum:DAY_NAMES}}},required:['employee_id','workdays']},
  run:a=>{if(!db.prepare('SELECT 1 FROM employees WHERE id=?').get(a.employee_id))throw new Error('No such employee');db.prepare('UPDATE employees SET workdays=? WHERE id=?').run(JSON.stringify(DAY_NAMES.filter(d=>(a.workdays||[]).includes(d))),a.employee_id);return {ok:true};},sum:a=>'Set workdays for '+a.employee_id},
];

// ===================================================================
// v5.1: "My week" performance for every employee + management notes.
// Claude (or Nick) drafts a note; staff only ever see notes Nick approved.
// ===================================================================
const COACHING_GUIDE=`How management notes to Metro staff are written (Nick's rules):
1. The numbers are cut and dry. State what they did against what's expected, plainly ("2 of 3 membership sales this week"). No softening, no spin, no padding.
2. Everything around the numbers is motivational, insightful and encouraging. Open with one specific, real win from their week.
3. Never micromanage or diminish their work. No task-by-task instructions, no "you should have", no comparing them to coworkers, nothing about pay or discipline.
4. Ask 2 or 3 open questions that help them find their own next step (what got in the way, what would make it easier, what they'd like to try). Questions, not orders.
5. Short and plain: the summary is 3 sentences at most, written as Nick in first person, everyday words, no em dashes, no corporate language.
6. Only use their own data. If a number looks off or there is no data, say so kindly or leave it out rather than guess.`;
db.exec(`CREATE TABLE IF NOT EXISTS perf_notes(id TEXT PRIMARY KEY,employee_id TEXT,week_of TEXT,win TEXT,summary TEXT,questions TEXT DEFAULT '[]',
 status TEXT DEFAULT 'draft',author TEXT DEFAULT 'claude',created_at TEXT DEFAULT (datetime('now')),approved_at TEXT,seen_at TEXT);`);
try{db.exec("ALTER TABLE perf_notes ADD COLUMN for_nick TEXT DEFAULT ''");}catch(e){}
function perfFor(empId,anchor){const emp=db.prepare('SELECT * FROM employees WHERE id=?').get(empId);if(!emp)return null;
 const g=J(emp.groups);const dates=weekDates(okDate(anchor)?anchor:localToday());const inC=dates.map(()=>'?').join(',');
 const rows=db.prepare(`SELECT item_id,date,value,shift FROM daily_entries WHERE employee_id=? AND date IN (${inC})`).all(empId,...dates);
 const shiftsWorked=new Set(rows.map(r=>r.date)).size;
 const shiftDays={};rows.forEach(r=>{if(r.shift)(shiftDays[r.shift]=shiftDays[r.shift]||new Set()).add(r.date);});const byItem={};rows.forEach(r=>{(byItem[r.item_id]=byItem[r.item_id]||[]).push(r);});
 const applies=it=>{const sv=J(it.scope_values);return it.scope_type==='all'||(it.scope_type==='group'&&sv.some(x=>g.includes(x)))||(it.scope_type==='employee'&&sv.includes(empId))||(it.scope_type==='shift'&&sv.some(s=>shiftDays[s]))||!!byItem[it.id];};
 const items=db.prepare('SELECT * FROM items WHERE active=1 ORDER BY high_priority DESC,sort_order').all().filter(applies);
 const metrics=[];let tDone=0,tTot=0;
 items.forEach(it=>{const k=J(it.kinds);const ent=byItem[it.id]||[];
  if(k.includes('number')){const actual=ent.reduce((a,r)=>a+(r.value||0),0);let expected=null;
   if(it.goal!=null){const n=it.scope_type==='shift'?J(it.scope_values).reduce((a,s)=>a+(shiftDays[s]?shiftDays[s].size:0),0):shiftsWorked;expected=it.cadence==='weekly'?it.goal:it.cadence==='daily'?it.goal*n:null;}
   metrics.push({label:it.label,actual,expected,goal:it.goal,cadence:it.cadence,highPriority:!!it.high_priority});}
  else if(k.includes('task')&&it.cadence==='daily'){ent.forEach(r=>{tTot++;if(r.value>=1)tDone++;});}});
 return {weekOf:dates[0],weekEnd:dates[6],shiftsWorked,metrics,tasks:{done:tDone,total:tTot}};}
const noteOut=n=>n&&({id:n.id,employeeId:n.employee_id,weekOf:n.week_of,win:n.win||'',summary:n.summary||'',questions:J(n.questions),status:n.status,author:n.author,createdAt:n.created_at,approvedAt:n.approved_at,seenAt:n.seen_at,forNick:n.for_nick||''});
function draftNote(p,author){const emp=db.prepare('SELECT id FROM employees WHERE id=? AND active=1').get(p.employee_id);if(!emp)return {error:'No such employee'};
 const summary=String(p.summary||'').trim();if(!summary)return {error:'summary required'};
 const qs=(Array.isArray(p.questions)?p.questions:[]).map(q=>String(q).trim()).filter(Boolean).slice(0,3);
 const id='n'+uid();const wk=okDate(p.week_of)?weekDates(p.week_of)[0]:weekDates(localToday())[0];
 db.prepare('INSERT INTO perf_notes(id,employee_id,week_of,win,summary,questions,status,author,for_nick) VALUES(?,?,?,?,?,?,?,?,?)')
  .run(id,emp.id,wk,String(p.win||'').trim().slice(0,600),summary.slice(0,1500),JSON.stringify(qs.map(q=>q.slice(0,300))),'draft',author,String(p.for_nick||'').trim().slice(0,3000));
 return {note:noteOut(db.prepare('SELECT * FROM perf_notes WHERE id=?').get(id))};}
// staff: their own week + the latest note Nick approved
app.get('/api/staff/:id/performance',(req,res)=>{if(!staffOk(req.params.id,req.headers['x-staff-pin']))return res.status(401).json({error:'PIN required'});
 const today=okDate(req.query.date)?req.query.date:localToday();
 const note=db.prepare("SELECT * FROM perf_notes WHERE employee_id=? AND status='approved' ORDER BY approved_at DESC LIMIT 1").get(req.params.id);
 if(note&&!note.seen_at)db.prepare("UPDATE perf_notes SET seen_at=datetime('now') WHERE id=?").run(note.id);
 const pub=noteOut(note);if(pub)delete pub.forNick;
 res.json({thisWeek:perfFor(req.params.id,today),lastWeek:perfFor(req.params.id,addDaysISO(today,-7)),note:pub});});
// manager: review queue + history, approve / edit / send back, or write one yourself
app.get('/api/manager/notes',requireManager,(req,res)=>{const rows=db.prepare(`SELECT p.*,e.name FROM perf_notes p JOIN employees e ON e.id=p.employee_id ORDER BY p.created_at DESC LIMIT 60`).all();
 res.json({guide:COACHING_GUIDE,notes:rows.map(r=>({...noteOut(r),name:r.name}))});});
app.get('/api/manager/employee/:id/performance',requireManager,(req,res)=>res.json(perfFor(req.params.id,req.query.date)));
app.post('/api/manager/notes',requireManager,(req,res)=>{const r=draftNote(req.body||{},'nick');if(r.error)return res.status(400).json(r);res.json(r);});
app.put('/api/manager/notes/:nid',requireManager,(req,res)=>{const cur=db.prepare('SELECT * FROM perf_notes WHERE id=?').get(req.params.nid);if(!cur)return res.status(404).json({error:'no'});
 const b=req.body||{};const st=b.status||cur.status;if(!['draft','approved','returned','withdrawn'].includes(st))return res.status(400).json({error:'bad status'});
 const qs=Array.isArray(b.questions)?JSON.stringify(b.questions.map(q=>String(q).trim()).filter(Boolean).slice(0,3)):cur.questions;
 db.prepare(`UPDATE perf_notes SET win=?,summary=?,questions=?,status=?,approved_at=CASE WHEN ?='approved' AND status!='approved' THEN datetime('now') ELSE approved_at END WHERE id=?`)
  .run(b.win!==undefined?String(b.win).slice(0,600):cur.win,b.summary!==undefined?String(b.summary).slice(0,1500):cur.summary,qs,st,st,req.params.nid);
 res.json({ok:true});});
TOOLS.push(
 {name:'get_performance',read:true,description:'One employee\'s week: each tracked number against what is expected (goal per week, or daily goal x shifts worked), shifts worked and task completion. Use before drafting a management note.',
  inputSchema:{type:'object',properties:{employee_id:S_ID,week_of:{...D,description:'Any date in the week (default this week)'}},required:['employee_id']},
  run:a=>{const p=perfFor(a.employee_id,a.week_of);if(!p)throw new Error('No such employee');return {...p,previousWeek:perfFor(a.employee_id,addDaysISO(p.weekOf,-7))};}},
 {name:'get_management_notes',read:true,description:'Management notes already drafted, approved or sent back, so new notes build on what was said before.',
  inputSchema:{type:'object',properties:{employee_id:S_ID,status:{type:'string',enum:['draft','approved','returned','withdrawn']}}},
  run:a=>db.prepare('SELECT p.*,e.name FROM perf_notes p JOIN employees e ON e.id=p.employee_id ORDER BY p.created_at DESC LIMIT 100').all()
   .filter(r=>(!a.employee_id||r.employee_id===a.employee_id)&&(!a.status||r.status===a.status)).map(r=>({...noteOut(r),name:r.name}))},
 {name:'draft_management_note',description:'Draft a weekly management note for one employee. It is saved as a DRAFT for Nick to approve; the employee sees nothing until he does. Follow these rules exactly:\n'+COACHING_GUIDE,
  inputSchema:{type:'object',properties:{employee_id:S_ID,week_of:D,win:{type:'string',description:'One specific, real win from their week'},summary:{type:'string',description:'Up to 3 sentences, first person as Nick, numbers stated plainly'},
   questions:{type:'array',items:{type:'string'},description:'2 or 3 open questions'},
   for_nick:{type:'string',description:'PRIVATE, shown only to Nick on the draft, never to the employee: anything that did not line up (e.g. sales logged vs CourtReserve, schedule mismatches), context, or what to watch. Plain and short.'}},required:['employee_id','summary','questions']},
  run:a=>{const r=draftNote(a,'claude');if(r.error)throw new Error(r.error);return {...r.note,status:'draft (waiting on Nick)'};},sum:a=>'Drafted management note for '+a.employee_id});

const TOOL_MAP=Object.fromEntries(TOOLS.map(t=>[t.name,t]));
const MCP_VERSIONS=['2025-06-18','2025-03-26','2024-11-05'];
function mcpHandle(msg){const {id,method,params}=msg||{};const reply=result=>({jsonrpc:'2.0',id,result});const fail=(code,message)=>({jsonrpc:'2.0',id,error:{code,message}});
 if(id===undefined||id===null)return null; // notification
 if(method==='initialize'){const v=params&&MCP_VERSIONS.includes(params.protocolVersion)?params.protocolVersion:MCP_VERSIONS[0];
  return reply({protocolVersion:v,capabilities:{tools:{listChanged:false}},serverInfo:{name:'metro-staff-portal',version:'5.1.0'},
   instructions:'Metro Pickleball staff portal. Read team check-ins, reports, metrics and the social media board; make manager changes. Nothing can be deleted. Dates are YYYY-MM-DD, Eastern time. Management notes are drafts until Nick approves them in the manager dashboard.\n\n'+COACHING_GUIDE});}
 if(method==='ping')return reply({});
 if(method==='tools/list')return reply({tools:TOOLS.map(t=>({name:t.name,description:t.description,inputSchema:t.inputSchema,annotations:{readOnlyHint:!!t.read,destructiveHint:false}}))});
 if(method==='tools/call'){const t=TOOL_MAP[params&&params.name];if(!t)return fail(-32602,'Unknown tool');const a=(params&&params.arguments)||{};
  try{const out=t.run(a);db.prepare('INSERT INTO claude_log(tool,summary,is_write,ok) VALUES(?,?,?,1)').run(t.name,t.read?'Read':String(t.sum?t.sum(a):t.name).slice(0,200),t.read?0:1);
   return reply({content:[{type:'text',text:JSON.stringify(out,null,1)}]});}
  catch(e){db.prepare('INSERT INTO claude_log(tool,summary,is_write,ok) VALUES(?,?,?,0)').run(t.name,'Failed: '+String(e.message).slice(0,180),t.read?0:1);
   return reply({content:[{type:'text',text:'Error: '+e.message}],isError:true});}}
 return fail(-32601,'Method not found');}
app.post('/mcp',(req,res)=>{if(!bearerOk(req)){res.set('WWW-Authenticate',`Bearer resource_metadata="${PUBLIC_URL}/.well-known/oauth-protected-resource"`);return res.status(401).json({error:'unauthorized'});}
 const body=req.body;if(Array.isArray(body)){const out=body.map(mcpHandle).filter(Boolean);return out.length?res.json(out):res.status(202).end();}
 const out=mcpHandle(body);if(!out)return res.status(202).end();res.json(out);});
app.all('/mcp',(req,res)=>{res.set('Allow','POST');res.status(405).json({error:'Use POST'});});

app.get('/manager',(q,r)=>r.sendFile(path.join(__dirname,'public','manager.html')));
app.get('/',(q,r)=>r.sendFile(path.join(__dirname,'public','staff.html')));
app.listen(PORT,()=>console.log('Metro Staff System v3 on '+PORT));
// v4: focus banners + staff draft persistence
// v5: social media hub, per-person workdays, Claude connector

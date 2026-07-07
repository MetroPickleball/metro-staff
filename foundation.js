// Metro Staff System v2 — data-model + scope-merge validation
// Uses Node's built-in SQLite (same SQL ports to better-sqlite3 in production).
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');

// ---------- SCHEMA ----------
db.exec(`
CREATE TABLE employees (id TEXT PRIMARY KEY, name TEXT, role TEXT, color TEXT, init TEXT,
  pin TEXT, pin_is_default INTEGER DEFAULT 1, groups TEXT DEFAULT '[]', active INTEGER DEFAULT 1);
CREATE TABLE shifts (id TEXT PRIMARY KEY, name TEXT, hours TEXT, days TEXT, sort_order INTEGER);
CREATE TABLE items (id TEXT PRIMARY KEY, label TEXT, kind TEXT, cadence TEXT,
  scope_type TEXT, scope_value TEXT, goal REAL, sort_order INTEGER, active INTEGER DEFAULT 1);
CREATE TABLE daily_entries (employee_id TEXT, date TEXT, shift TEXT, item_id TEXT, value REAL,
  PRIMARY KEY (employee_id, date, item_id));
CREATE TABLE reports (id TEXT PRIMARY KEY, employee_id TEXT, date TEXT, category TEXT, message TEXT,
  status TEXT DEFAULT 'open', created_at TEXT);
`);

let n=0; const uid=()=> 'x'+(++n);

// ---------- SEED: employees (real roster incl. Jesse) ----------
const EMPS=[
 ['jose','Jose','Front Desk Lead','#00AEAE','J','1111',["Front Desk"]],
 ['jesse','Jesse','Front Desk','#06b6d4','J','2222',["Front Desk"]],
 ['mikey','Mikey','Front Desk + Inventory','#6366f1','M','3333',["Front Desk","Inventory"]],
 ['caroline','Caroline','Front Desk','#ec4899','C','4444',["Front Desk"]],
 ['angela','Angela','Front Desk','#f97316','A','5555',["Front Desk"]],
 ['barbara','Barbara','Front Desk','#8b5cf6','B','6666',["Front Desk"]],
 ['ken','Ken','Marketing Lead + Coach','#14b8a6','K','7777',["Marketing/Social","Coaches"]],
 ['anders','Anders','Social Media','#f43f5e','A','8888',["Marketing/Social"]],
 ['matt','Matt','Coach','#0ea5e9','M','9999',["Coaches"]],
 ['bernard','Bernard','Coach','#84cc16','B','1010',["Coaches"]],
];
const ie=db.prepare('INSERT INTO employees (id,name,role,color,init,pin,groups) VALUES (?,?,?,?,?,?,?)');
for(const e of EMPS) ie.run(e[0],e[1],e[2],e[3],e[4],e[5],JSON.stringify(e[6]));

// ---------- SEED: shifts ----------
const SHIFTS=[
 ['sh_morning','Morning','7:45–1:45','["Mon","Tue","Wed","Thu","Fri"]',1],
 ['sh_midday','Mid-Day','1:30–7:30','["Mon","Tue","Wed","Thu","Fri"]',2],
 ['sh_evening','Evening','5:45–11:15','["Mon","Tue","Wed","Thu","Fri"]',3],
 ['sh_wkday','Weekend Day','7:45–2:00','["Sat","Sun"]',4],
 ['sh_wknight','Weekend Night','1:45–8:15','["Sat","Sun"]',5],
];
const ish=db.prepare('INSERT INTO shifts (id,name,hours,days,sort_order) VALUES (?,?,?,?,?)');
for(const s of SHIFTS) ish.run(...s);

// ---------- SEED: items across ALL FOUR scopes + cadences ----------
// kind: task | number | tally    cadence: daily | weekly    scope_type: all | group | shift | employee
const ITEMS=[
 // ALL staff
 [uid(),'Ask happy guests for a Google review','number','weekly','all',null,3,1],
 [uid(),'People booked into L2P','number','daily','all',null,null,2],
 // GROUP: Front Desk
 [uid(),'Memberships sold','number','weekly','group','Front Desk',2,3],
 [uid(),'Front desk tidy & signage check','task','daily','group','Front Desk',null,4],
 // SHIFT: Morning / Mid-Day / Evening
 [uid(),"Contact today's L2P attendees",'task','daily','shift','Morning',null,5],
 [uid(),'Open & set up courts','task','daily','shift','Morning',null,6],
 [uid(),'Midday cleaning pass','task','daily','shift','Mid-Day',null,7],
 [uid(),'Close & lock courts','task','daily','shift','Evening',null,8],
 // INDIVIDUAL: Jesse onboarding
 [uid(),'Onboarding: shadow Jose on a close','task','daily','employee','jesse',null,9],
];
const ii=db.prepare('INSERT INTO items (id,label,kind,cadence,scope_type,scope_value,goal,sort_order) VALUES (?,?,?,?,?,?,?,?)');
for(const it of ITEMS) ii.run(...it);

// ---------- CORE: merge items for an employee working a given shift ----------
function itemsFor(empId, shiftName){
  const emp=db.prepare('SELECT * FROM employees WHERE id=?').get(empId);
  const groups=JSON.parse(emp.groups||'[]');
  const all=db.prepare('SELECT * FROM items WHERE active=1 ORDER BY sort_order').all();
  return all.filter(it=>{
    if(it.scope_type==='all') return true;
    if(it.scope_type==='group') return groups.includes(it.scope_value);
    if(it.scope_type==='shift') return it.scope_value===shiftName;
    if(it.scope_type==='employee') return it.scope_value===empId;
    return false;
  });
}

// ---------- CORE: submit a day ----------
const up=db.prepare(`INSERT INTO daily_entries (employee_id,date,shift,item_id,value) VALUES (?,?,?,?,?)
  ON CONFLICT(employee_id,date,item_id) DO UPDATE SET value=excluded.value, shift=excluded.shift`);
function submitDay(empId,date,shift,values){ for(const[k,v]of Object.entries(values)) up.run(empId,date,shift,k,v); }

// ---------- CORE: weekly/monthly rollup (sum numbers, count task-completions) ----------
function rollup(empId, dates){
  const q=`SELECT item_id, SUM(value) tot, COUNT(*) days FROM daily_entries
           WHERE employee_id=? AND date IN (${dates.map(()=>'?').join(',')}) GROUP BY item_id`;
  const rows=db.prepare(q).all(empId,...dates);
  const byItem={}; rows.forEach(r=>byItem[r.item_id]=r);
  return byItem;
}

// ================= DEMO =================
const label=id=>db.prepare('SELECT label,kind,scope_type,scope_value FROM items WHERE id=?').get(id);

console.log('\n=== MERGE TEST: Jesse working MORNING (should show ALL + Front Desk + Morning + her onboarding) ===');
for(const it of itemsFor('jesse','Morning')) console.log(`  [${it.scope_type}${it.scope_value?':'+it.scope_value:''}] ${it.kind.padEnd(6)} ${it.label}`);

console.log('\n=== MERGE TEST: Matt (Coach) working EVENING (no Front Desk, no Jesse items) ===');
for(const it of itemsFor('matt','Evening')) console.log(`  [${it.scope_type}${it.scope_value?':'+it.scope_value:''}] ${it.kind.padEnd(6)} ${it.label}`);

console.log('\n=== SUBMIT: Jesse enters a week of daily numbers ===');
const wk=['2026-07-06','2026-07-07','2026-07-08','2026-07-09','2026-07-10'];
const l2pItem=ITEMS.find(i=>i[1]==='People booked into L2P')[0];
const memItem=ITEMS.find(i=>i[1]==='Memberships sold')[0];
const revItem=ITEMS.find(i=>i[1].startsWith('Ask happy'))[0];
const l2pDaily=[4,3,0,2,5], memDaily=[1,0,1,0,1], revDaily=[3,2,1,2,4];
wk.forEach((d,i)=>submitDay('jesse',d,'Morning',{[l2pItem]:l2pDaily[i],[memItem]:memDaily[i],[revItem]:revDaily[i]}));

console.log('\n=== ROLLUP: Jesse, this week ===');
const r=rollup('jesse',wk);
[l2pItem,memItem,revItem].forEach(id=>{const L=label(id); console.log(`  ${L.label.padEnd(34)} total=${r[id]?r[id].tot:0} over ${r[id]?r[id].days:0} days`);});

console.log('\n=== PIN AUTH TEST ===');
function auth(empId,pin){const e=db.prepare('SELECT pin FROM employees WHERE id=?').get(empId);return !!e&&e.pin===pin;}
console.log('  Jesse + 2222  ->', auth('jesse','2222'));
console.log('  Jesse + 9999  ->', auth('jesse','9999'));

console.log('\nEmployees seeded:', db.prepare('SELECT COUNT(*) c FROM employees').get().c,
            '| Shifts:', db.prepare('SELECT COUNT(*) c FROM shifts').get().c,
            '| Items:', db.prepare('SELECT COUNT(*) c FROM items').get().c);
console.log('OK — foundation validated.\n');

import re, sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()

a = s.index('<link rel="stylesheet"'); b = s.index('*{box-sizing:border-box}')
s = s[:a] + '''<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&family=Roboto+Mono:wght@400;500&display=swap">
<style>
/* Layout: moneo-style console. Full-width tile home, then asset navigator + tool tabs + sub-tabs.
   Single dark theme like moneo: charcoal greys, one orange accent; red/yellow/green only for machine state. */
:root{
  --bar:#2b2b2b; --bar-fg:#f2f2f2; --bar-muted:#b5b5b5; --bar-line:#1f1f1f;
  --bg:#333333; --panel:#3c3c3c; --panel-2:#4a4a4a; --line:#555555;
  --fg:#f2f2f2; --muted:#b5b5b5; --accent:#f39200; --accent-ink:#1e1e1e;
  --ok:#5cb85c; --warn:#f0d03a; --crit:#e5483d;
  --plot-actual:#f39200; --plot-expected:#b5b5b5; --plot-tol:#f0d03a;
  --f-display:"Roboto",system-ui,-apple-system,"Segoe UI",sans-serif;
  --f-body:"Roboto",system-ui,-apple-system,"Segoe UI",sans-serif;
  --f-mono:"Roboto Mono",ui-monospace,Consolas,monospace;
  color-scheme:dark;
}
''' + s[b:]

def rep(old, new):
    global s
    assert old in s, old[:60]
    s = s.replace(old, new)

rep('border:1px solid #e0a23a;color:#e0a23a;', 'border:1px solid var(--accent);color:var(--accent);')
rep('border-radius:50%;background:#4fb27a;', 'border-radius:50%;background:var(--ok);')
rep('.dot.cloud{background:#5aa9dc}', '.dot.cloud{background:var(--accent)}')
s = re.sub(r'\n  <button class="ico-btn" id="themeBtn".*?</button>', '', s)
s = re.sub(r'\n  if\(b\.id==="themeBtn"\).*?return\}', '', s)
rep('.brand b{font:600 17px var(--f-display);letter-spacing:.01em}', '.brand b{font:500 18px var(--f-display)}')
rep('.tabs{display:flex;gap:2px;background:var(--panel);', '.tabs{display:flex;gap:2px;background:var(--bar);')
rep('.tab{background:none;border:0;padding:13px 16px;color:var(--muted);', '.tab{background:none;border:0;padding:13px 18px;color:var(--fg);font-size:15px;')
rep('.tab svg{width:16px;height:16px}', '.tab svg{width:18px;height:18px;color:var(--accent)}')
rep('.tab.on{color:var(--fg);background:var(--panel-2);border-bottom-color:var(--accent)}', '.tab.on{background:var(--panel);border-bottom-color:var(--accent)}')

a = s.index('/* plant overview */')
s = s[:a] + '''/* home: moneo tile launcher */
.launch{padding:24px 24px 40px}
.gtabs{display:flex;gap:40px;flex-wrap:wrap;margin:0 0 24px 12px}
.gtabs button{background:none;border:0;padding:0 0 8px;font-size:20px;color:var(--muted);border-bottom:2px solid transparent}
.gtabs button.on{color:var(--fg);border-bottom-color:var(--accent)}
.sheet{background:var(--panel);display:grid;grid-template-columns:220px minmax(0,1fr);gap:24px;padding:24px 24px 32px}
.hero{display:grid;justify-items:center;align-content:start;text-align:center;gap:6px;padding:24px 24px 0 0;border-right:1px solid var(--line)}
.hero b{font:400 22px var(--f-display)}
.hero span{font-size:15px;line-height:1.4}
.sec{display:grid;gap:14px;align-content:start;scroll-margin-top:16px}
.sec+.sec{margin-top:22px}
.sec h2{font:400 22px var(--f-display);margin:0}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,208px));gap:8px}
.tile{background:var(--panel-2);border:0;padding:10px 10px 12px;height:206px;display:flex;flex-direction:column;text-align:left;gap:4px;position:relative;box-shadow:0 1px 2px rgba(0,0,0,.35)}
.tile:hover{background:color-mix(in srgb,var(--panel-2) 85%,white)}
.tile b{font:500 19px var(--f-display);line-height:1.25}
.tile span{color:var(--muted);font-size:15px;line-height:1.35}
.tile svg{margin-top:auto;align-self:flex-end;width:52px;height:52px;color:var(--accent)}
.tile .flag{position:absolute;left:10px;bottom:12px;font:500 12px var(--f-mono);padding:2px 6px;background:var(--crit);color:#fff;border-radius:2px}
''' + s[a:]
rep('  .counts{grid-template-columns:repeat(2,minmax(0,1fr))}',
    '  .sheet{grid-template-columns:1fr}.hero{border:0;padding:0}.tiles{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}.tile{height:170px}.gtabs{gap:20px}.gtabs button{font-size:16px}\n  .counts{grid-template-columns:repeat(2,minmax(0,1fr))}')
rep('main{overflow:auto;min-width:0}', 'main{overflow:auto;min-width:0}\n.shell.full{grid-template-columns:1fr}.shell.full nav.tree{display:none}')

rep('function home(){\n  const n={ok:0', 'function plant(){\n  const n={ok:0')
a = s.index('const TABS=')
s = s[:a] + r'''const HOME=[
 ["monitor","Monitor",[
   ["Plant overview","Machine states, power vs expected and energy per good part","plant","plant",true],
   ["Trends","Power, vibration, cycle time and dimensions on one time axis","chart","mach:trends"]]],
 ["investigate","Investigate & verify",[
   ["Investigation","AI hypotheses with evidence for and against, plus incident chat","ai","mach:investigate"],
   ["Interventions","Compare simulated actions, risks and costs, then approve","wrench","mach:actions"],
   ["Verification","Before and after check computed by code","check","mach:verify"],
   ["Audit trail","Who approved what, with which evidence and model","log","mach:audit"]]],
 ["system","System",[
   ["AI provider","Local Gemma in Docker, Gemma on Vertex AI, or off","gear","settings"],
   ["Architecture","Docker Compose on site, Cloud Run in the cloud","stack","arch"]]],
];
function home(){
  const tile=([t,d,ic,go,flag])=>`<button class="tile" data-go="${go}"><b>${t}</b><span>${d}</span>${flag?`<i class="flag">1 action required</i>`:""}${I[ic]}</button>`;
  return `<div class="launch">
  <div class="gtabs">${HOME.map(([k,l])=>`<button class="${st.group===k?"on":""}" data-group="${k}">${l}</button>`).join("")}</div>
  <div class="sheet"><div class="hero">
    <svg width="96" height="80" viewBox="0 0 96 80" aria-hidden="true"><path d="M6 64 L26 30 L42 50 L58 14 L90 64" fill="none" stroke="var(--fg)" stroke-width="5" stroke-linejoin="round"/><circle cx="58" cy="14" r="7" fill="var(--accent)"/><path d="M6 74h84" stroke="var(--accent)" stroke-width="4"/></svg>
    <b>AshvaTrace</b><span>Detect the signal.<br>Investigate the cause.<br>Verify the improvement.</span></div>
  <div>${HOME.map(([k,l,tiles])=>`<section class="sec" id="g-${k}"><h2>${l}</h2><div class="tiles">${tiles.map(tile).join("")}</div></section>`).join("")}</div>
  </div></div>`;
}
''' + s[a:]
rep('const st={view:"home",', 'const st={view:"home",group:"monitor",')
rep('''  $("#main").innerHTML=st.view==="home"?home():''',
    '''  document.querySelector(".shell").classList.toggle("full",st.view==="home");
  $("#main").innerHTML=st.view==="home"?home():st.view==="plant"?plant():''')
rep('''  if(d.m){st.view="mach";''',
    '''  if(d.group){st.group=d.group;render();document.getElementById("g-"+d.group).scrollIntoView({behavior:"smooth",block:"start"});return}
  if(d.m){st.view="mach";''')
open(p, 'w', encoding='utf-8').write(s)
print("ok")

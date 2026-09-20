const { useState, useEffect, useCallback, useRef, useMemo } = React;

function SubnetSprint() {
  const { t } = useTranslation();
  // ── math helpers ─────────────────────────────────────────────
  const ip2int = ip => ip.split('.').reduce((a,b) => (a*256)+parseInt(b,10), 0) >>> 0;
  const int2ip = n  => [(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255].join('.');
  const mkMask = p  => p===0 ? 0 : ((0xffffffff << (32-p)) >>> 0);
  const hcount = p  => p >= 31 ? 0 : Math.pow(2, 32-p) - 2;
  const shuffle = a => [...a].sort(() => Math.random()-0.5);

  // ── level config ─────────────────────────────────────────────
  // Each level: {types, prefixes, timer}
  function levelConfig(lvl) {
    if (lvl <= 2) return { types:['hosts','insubnet'],                             prefixes:[24,25,26],       timer:22 };
    if (lvl <= 4) return { types:['hosts','insubnet','network','broadcast'],        prefixes:[24,25,26,27],    timer:18 };
    if (lvl <= 6) return { types:['hosts','insubnet','network','broadcast','mask','subnetcount'], prefixes:[22,23,24,25,26,27,28], timer:15 };
    return            { types:['hosts','insubnet','network','broadcast','mask','subnetcount','whichprefix'], prefixes:[8,12,16,20,22,24,25,26,27,28,29,30], timer:12 };
  }
  const QS_PER_LEVEL = 5;

  const [phase, setPhase]         = useState('start'); // start|playing|result|levelup|end
  const [level, setLevel]         = useState(1);
  const [qInLevel, setQInLevel]   = useState(0);
  const [score, setScore]         = useState(0);
  const [lives, setLives]         = useState(3);
  const [streak, setStreak]       = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [correct, setCorrect]     = useState(0);
  const [total, setTotal]         = useState(0);
  const [q, setQ]                 = useState(null);
  const [timeLeft, setTimeLeft]   = useState(22);
  const [feedback, setFeedback]   = useState(null);
  const [powerup, setPowerup]     = useState(true); // 50/50 available once
  const [eliminated, setEliminated] = useState([]); // indices of eliminated choices
  const timerRef   = useRef(null);
  // anti-repeat tracking
  const histRef    = useRef({ types: [] });          // last 6 question types (blocks same type 3x in a row)
  const seenRef    = useRef(new Set());              // deterministic fps never repeated in same session

  // Deterministic types have fixed answers per prefix — never repeat the same combo in a session
  const DET_TYPES = ['hosts', 'mask', 'whichprefix', 'subnetcount'];

  // All possible fps for a deterministic type given current cfg (used to detect exhaustion)
  function possibleFps(type, cfg) {
    if (type === 'hosts')       return cfg.prefixes.map(p => `hosts_${p}`);
    if (type === 'mask')        return cfg.prefixes.map(p => `mask_${p}`);
    if (type === 'whichprefix') return cfg.prefixes.map(p => `whichprefix_${p}`);
    // subnetcount has many combos — treat as never fully exhaustible for simplicity
    return null;
  }

  function _buildQ(type, cfg) {
    const prefix = cfg.prefixes[Math.floor(Math.random()*cfg.prefixes.length)];
    const m      = mkMask(prefix);
    const ip = [
      Math.floor(Math.random()*100)+10,
      Math.floor(Math.random()*200)+10,
      Math.floor(Math.random()*200)+10,
      Math.floor(Math.random()*200)+10,
    ].join('.');
    const ipInt    = ip2int(ip);
    const netInt   = (ipInt & m) >>> 0;
    const bcInt    = (netInt | (~m >>> 0)) >>> 0;
    const netAddr  = int2ip(netInt);
    const bcAddr   = int2ip(bcInt);
    const blockSize = Math.pow(2, 32-prefix);

    if (type === 'network') {
      const wrong = new Set();
      for (let i = 1; wrong.size < 3; i++) {
        const c = int2ip(((netInt + i * blockSize) >>> 0) & m);
        if (c !== netAddr) wrong.add(c);
      }
      return { type, fp:`network_${prefix}`, display:`${ip} / ${prefix}`, prompt: t('arcade.subnet_sprint.prompts.network'), answer:netAddr,
               choices:shuffle([netAddr,...wrong]), explanation:`${ip} AND ${int2ip(m)} = ${netAddr}` };
    }
    if (type === 'broadcast') {
      const wrong = new Set();
      for (let i = 1; wrong.size < 3; i++) {
        const wNet = ((netInt + i * blockSize) >>> 0) & m;
        const wBc  = int2ip((wNet | (~m >>> 0)) >>> 0);
        if (wBc !== bcAddr) wrong.add(wBc);
      }
      return { type, fp:`broadcast_${prefix}`, display:`${ip} / ${prefix}`, prompt: t('arcade.subnet_sprint.prompts.broadcast'), answer:bcAddr,
               choices:shuffle([bcAddr,...wrong]), explanation:`Network ${netAddr}, host bits all 1s → ${bcAddr}` };
    }
    if (type === 'insubnet') {
      const inRange = Math.random() < 0.5;
      let candidate;
      if (inRange) {
        // pick a random host inside the subnet
        const h = Math.floor(Math.random()*(blockSize-2))+1;
        candidate = int2ip((netInt | h) >>> 0);
      } else {
        // pick a host in an ADJACENT subnet block (1–4 blocks away from netInt)
        // so it looks similar but is clearly outside — requires real calculation to spot
        const offset = (Math.floor(Math.random()*4)+1) * blockSize;
        const adjNet = ((netInt + offset) >>> 0) & m;
        const h      = Math.floor(Math.random()*(blockSize-2))+1;
        candidate    = int2ip((adjNet | h) >>> 0);
      }
      const ans = inRange ? t('common.yes') : t('common.no');
      return { type, fp:`insubnet_${prefix}`, display:`${ip} / ${prefix}`, prompt: t('arcade.subnet_sprint.prompts.insubnet', { ip: candidate }), answer:ans,
               choices:[t('common.yes'), t('common.no')], explanation:`Range: ${netAddr} – ${bcAddr}. ${candidate} is ${inRange ? t('common.yes').toLowerCase() : t('common.no').toLowerCase()}.` };
    }
    if (type === 'hosts') {
      const hc = hcount(prefix);
      const dists = shuffle([-3,-2,-1,1,2,3].map(d=>prefix+d).filter(p=>p>=8&&p<=30&&p!==prefix)).slice(0,3).map(p=>String(hcount(p)));
      return { type, fp:`hosts_${prefix}`, display:`/ ${prefix}`, prompt: t('arcade.subnet_sprint.prompts.hosts'), answer:String(hc),
               choices:shuffle([String(hc),...dists.slice(0,3)]), explanation:`2^(32−${prefix}) − 2 = ${hc}` };
    }
    if (type === 'mask') {
      const maskStr = int2ip(m);
      const dists = shuffle([-2,-1,1,2].map(d=>prefix+d).filter(p=>p>=8&&p<=30)).slice(0,3).map(p=>int2ip(mkMask(p)));
      return { type, fp:`mask_${prefix}`, display:`/ ${prefix}`, prompt: t('arcade.subnet_sprint.prompts.mask'), answer:maskStr,
               choices:shuffle([maskStr,...dists.slice(0,3)]), explanation:`/${prefix} → ${maskStr}` };
    }
    if (type === 'subnetcount') {
      const bigP   = cfg.prefixes[Math.floor(Math.random()*Math.max(1,cfg.prefixes.length-3))];
      const maxDiff = Math.min(8, 30-bigP);
      const diff   = Math.floor(Math.random()*Math.min(maxDiff,6))+2;
      const smallP = bigP + diff;
      const count  = Math.pow(2, diff);
      const dists  = [diff-2,diff-1,diff+1,diff+2].filter(d=>d>0).map(d=>String(Math.pow(2,d))).filter(v=>v!==String(count));
      return { type, fp:`subnetcount_${bigP}_${smallP}`, display:`/ ${bigP}  ÷  / ${smallP}`, prompt: t('arcade.subnet_sprint.prompts.subnetcount', { small: smallP, big: bigP }), answer:String(count),
               choices:shuffle([String(count),...dists.slice(0,3)]), explanation:`2^(${smallP}−${bigP}) = 2^${diff} = ${count}` };
    }
    if (type === 'whichprefix') {
      const tgt = cfg.prefixes[Math.floor(Math.random()*cfg.prefixes.length)];
      const hc  = hcount(tgt);
      const dists = shuffle([-3,-2,-1,1,2,3].map(d=>tgt+d).filter(p=>p>=8&&p<=30&&p!==tgt)).slice(0,3).map(p=>`/${p}`);
      return { type, fp:`whichprefix_${tgt}`, display: t('arcade.subnet_sprint.hosts_needed', { n: hc.toLocaleString() }), prompt: t('arcade.subnet_sprint.prompts.whichprefix'), answer:`/${tgt}`,
               choices:shuffle([`/${tgt}`,...dists.slice(0,3)]), explanation:`/${tgt} gives 2^${32-tgt}−2 = ${hc} hosts` };
    }
  }

  function genQ(cfg) {
    const h    = histRef.current;
    const seen = seenRef.current;

    function buildTypePool(allowReset) {
      return cfg.types.filter(type => {
        if (!DET_TYPES.includes(type)) return true;
        const fps = possibleFps(type, cfg);
        if (!fps) return true; // subnetcount: always available
        const allSeen = fps.every(fp => seen.has(fp));
        if (allSeen && allowReset) fps.forEach(fp => seen.delete(fp)); // reset this type's pool
        return !fps.every(fp => seen.has(fp));
      });
    }

    let typePool = buildTypePool(false);
    if (typePool.length === 0) typePool = buildTypePool(true);
    if (typePool.length === 0) typePool = cfg.types; // fallback: use everything

    const recentTwo = h.types.slice(-2);
    const nonStuck  = typePool.filter(t => !recentTwo.every(r => r === t));
    const finalPool = nonStuck.length > 0 ? nonStuck : typePool;

    let q, attempts = 0;
    do {
      const type = finalPool[Math.floor(Math.random()*finalPool.length)];
      q = _buildQ(type, cfg);
      attempts++;
      if (!q) break;
      const isDet     = DET_TYPES.includes(q.type);
      const alreadySeen = isDet && seen.has(q.fp);
      if (!alreadySeen) break;
    } while (attempts < 15);

    if (q) {
      if (DET_TYPES.includes(q.type)) seen.add(q.fp);
      h.types = [...h.types, q.type].slice(-6);
    }
    return q;
  }

  function startGame() {
    setLevel(1); setQInLevel(0); setScore(0); setLives(3);
    setStreak(0); setBestStreak(0); setCorrect(0); setTotal(0);
    setPowerup(true); setEliminated([]);
    histRef.current = { types: [] };
    seenRef.current = new Set();
    const cfg = levelConfig(1);
    setTimeLeft(cfg.timer);
    setQ(genQ(cfg)); setFeedback(null);
    setPhase('playing');
  }

  useEffect(() => {
    if (phase !== 'playing') return;
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { handleTimeout(); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [phase, q]);

  function handleTimeout() {
    clearInterval(timerRef.current);
    const nl = lives - 1;
    setLives(nl); setStreak(0); setTotal(t=>t+1);
    setFeedback({ ok:false, explanation: q ? q.explanation : '' });
    setPhase('result');
    if (nl <= 0) { setTimeout(()=>setPhase('end'), 2500); }
    else         { setTimeout(()=>advanceQ(), 2500); }
  }

  const COMBO_LABELS = { 3:'TRIPLE!', 5:'ON FIRE!', 8:'UNSTOPPABLE!', 12:'LEGENDARY!', 20:'GODLIKE!' };

  function choose(ans) {
    if (phase !== 'playing') return;
    clearInterval(timerRef.current);
    const ok = ans === q.answer;
    setTotal(t=>t+1);
    if (ok) {
      const ns      = streak+1;
      const mult    = Math.min(4, ns);
      const speed   = Math.round(timeLeft * 3);
      const pts     = Math.round(100 * mult * (1 + (level-1)*0.1)) + speed;
      const combo   = COMBO_LABELS[ns] || null;
      setScore(s=>s+pts); setStreak(ns); setBestStreak(b=>Math.max(b,ns)); setCorrect(c=>c+1);
      setFeedback({ ok:true, pts, mult:ns, speed, combo });
    } else {
      const nl = lives-1;
      setLives(nl); setStreak(0);
      setFeedback({ ok:false, explanation: q.explanation });
      if (nl <= 0) { setPhase('result'); setTimeout(()=>setPhase('end'), 2500); return; }
    }
    setPhase('result');
    setTimeout(()=>advanceQ(), ok ? 700 : 2500);
  }

  function use5050() {
    if (!powerup || phase !== 'playing' || !q || q.choices.length <= 2) return;
    setPowerup(false);
    const wrongIdxs = q.choices.map((c,i)=>c!==q.answer?i:-1).filter(i=>i>=0);
    const toElim = shuffle(wrongIdxs).slice(0,2);
    setEliminated(toElim);
  }

  function advanceQ() {
    const nextQInLevel = qInLevel + 1;
    setEliminated([]);
    if (nextQInLevel >= QS_PER_LEVEL) {
      const nextLevel = level + 1;
      setLevel(nextLevel); setQInLevel(0);
      setPhase('levelup');
      setTimeout(() => {
        const cfg = levelConfig(nextLevel);
        setTimeLeft(cfg.timer);
        setQ(genQ(cfg)); setFeedback(null);
        setPhase('playing');
      }, 1800);
    } else {
      setQInLevel(nextQInLevel);
      const cfg = levelConfig(level);
      setTimeLeft(cfg.timer);
      setQ(genQ(cfg)); setFeedback(null);
      setPhase('playing');
    }
  }

  const cfg  = levelConfig(level);
  const pct  = (timeLeft / cfg.timer) * 100;
  const tc   = timeLeft <= 4 ? 'var(--red)' : timeLeft <= 8 ? 'var(--yellow)' : 'var(--green)';
  const fire = streak >= 6 ? '🔥🔥🔥' : streak >= 3 ? '🔥🔥' : streak >= 2 ? '🔥' : '';
  const multLabel = `×${Math.min(4,streak+1)}`;

  if (phase === 'start') return (
    <div className="fadein" style={{maxWidth:520, margin:'0 auto', textAlign:'center', padding:'40px 0'}}>
      <div style={{fontSize:42, fontWeight:900, fontFamily:'var(--mono)', color:'var(--green)', textShadow:'0 0 30px var(--green)', letterSpacing:3, marginBottom:8}}>{t('arcade.subnet_sprint.title')}</div>
      <div style={{color:'var(--muted)', fontSize:13, marginBottom:32}}>{t('arcade.subnet_sprint.desc')}</div>
      <div className="grid-mobile-1" style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:32, textAlign:'left', maxWidth:400, margin:'0 auto 32px'}}>
        {[[`❤️ ${t('arcade.subnet_sprint.stats.lives')}`,t('arcade.subnet_sprint.stats.lives_desc')],[`🔥 ${t('arcade.subnet_sprint.stats.streak')}`,t('arcade.subnet_sprint.stats.streak_desc')],[`⚡ ${t('arcade.subnet_sprint.stats.fifty_fifty')}`,t('arcade.subnet_sprint.stats.fifty_fifty_desc')],[`📈 ${t('arcade.subnet_sprint.stats.levels')}`,t('arcade.subnet_sprint.stats.levels_desc')]].map(([t,d])=>(
          <div key={t} style={{background:'var(--panel)', border:'1px solid var(--border)', borderRadius:10, padding:'10px 12px'}}>
            <div style={{fontFamily:'var(--mono)', fontSize:12, color:'var(--green)', marginBottom:3}}>{t}</div>
            <div style={{fontSize:11, color:'var(--dim)'}}>{d}</div>
          </div>
        ))}
      </div>
      <button onClick={startGame} style={{
        background:'var(--green)', 
        color:'#000', 
        border:'none', 
        borderRadius:10, 
        padding:'16px 52px', 
        fontFamily:'var(--mono)', 
        fontWeight:900, 
        fontSize:18, 
        cursor:'pointer', 
        letterSpacing:3, 
        boxShadow:'0 0 30px rgba(34, 197, 94, 0.4)',
        transition:'transform 0.2s, box-shadow 0.2s'
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.boxShadow = '0 0 40px rgba(34, 197, 94, 0.6)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 0 30px rgba(34, 197, 94, 0.4)'; }}
      >{t('arcade.subnet_sprint.play')}</button>
    </div>
  );

  const LEVEL_UNLOCKS = { 3: t('arcade.subnet_sprint.unlocks.3'), 5: t('arcade.subnet_sprint.unlocks.5'), 7: t('arcade.subnet_sprint.unlocks.7') };

  if (phase === 'levelup') return (
    <div className="fadein" style={{maxWidth:400, margin:'0 auto', textAlign:'center', padding:'50px 0'}}>
      <div style={{fontSize:13, color:'var(--dim)', fontFamily:'var(--mono)', marginBottom:8, letterSpacing:3}}>{t('arcade.subnet_sprint.level_complete')}</div>
      <div style={{fontSize:72, fontWeight:900, fontFamily:'var(--mono)', color:'var(--green)', textShadow:'0 0 50px var(--green)', lineHeight:1}}>LVL {level}</div>
      <div style={{fontSize:16, color:'var(--muted)', marginTop:10, fontFamily:'var(--mono)'}}>⏱ {t('arcade.subnet_sprint.timer_pts', { timer: cfg.timer, score: score.toLocaleString() })}</div>
      {LEVEL_UNLOCKS[level] && <div style={{marginTop:14, padding:'8px 16px', background:'var(--panel)', border:'1px solid var(--yellow)', borderRadius:8, fontSize:12, color:'var(--yellow)', fontFamily:'var(--mono)'}}>⚡ {LEVEL_UNLOCKS[level]}</div>}
    </div>
  );

  if (phase === 'end') return (
    <div className="fadein" style={{maxWidth:500, margin:'0 auto', textAlign:'center', padding:'40px 0'}}>
      <div style={{fontSize:46, fontWeight:900, fontFamily:'var(--mono)', color:'var(--red)', marginBottom:6, textShadow:'0 0 30px var(--red)'}}>{t('arcade.subnet_sprint.game_over')}</div>
      <div style={{fontSize:30, color:'var(--green)', fontFamily:'var(--mono)', fontWeight:900, marginBottom:24}}>{score.toLocaleString()} pts</div>
      <div className="grid-mobile-1" style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:28}}>
        {[[t('arcade.subnet_sprint.level'),String(level)],[t('arcade.subnet_sprint.accuracy'),total>0?Math.round(correct/total*100)+'%':'—'],[t('arcade.subnet_sprint.best_streak'),'×'+bestStreak]].map(([k,v])=>(
          <div key={k} style={{background:'var(--panel)', border:'1px solid var(--border)', borderRadius:10, padding:14}}>
            <div style={{fontSize:10, color:'var(--dim)', fontFamily:'var(--mono)', marginBottom:4}}>{k}</div>
            <div style={{fontSize:20, fontWeight:900, color:'var(--text)', fontFamily:'var(--mono)'}}>{v}</div>
          </div>
        ))}
      </div>
      <button onClick={startGame} style={{background:'var(--green)', color:'#000', border:'none', borderRadius:8, padding:'14px 40px', fontFamily:'var(--mono)', fontWeight:900, fontSize:15, cursor:'pointer', letterSpacing:2}}>{t('arcade.subnet_sprint.play_again')}</button>
    </div>
  );

  if (!q) return null;
  const flashBg  = feedback ? (feedback.ok ? '#00ff0022' : '#ff000022') : 'transparent';
  const borderC  = feedback ? (feedback.ok ? 'var(--green)' : 'var(--red)') : 'var(--border)';

  return (
    <div className="fadein" style={{maxWidth:580, margin:'0 auto', padding:'12px 0'}}>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6, fontFamily:'var(--mono)'}}>
        <div style={{fontSize:13, color:'var(--green)', fontWeight:900}}>LVL {level}  <span style={{color:'var(--dim)', fontWeight:400}}>{qInLevel+1}/{QS_PER_LEVEL}</span></div>
        <div style={{fontSize:16, fontWeight:900, color:'var(--text)'}}>{score.toLocaleString()}</div>
        <div style={{display:'flex', gap:6, alignItems:'center'}}>
          <span style={{fontFamily:'var(--mono)', fontSize:13, color:'var(--yellow)', fontWeight:900}}>{multLabel}{fire}</span>
          <span style={{marginLeft:4}}>{[...Array(3)].map((_,i)=><span key={i} style={{fontSize:15}}>{i<lives?'❤️':'🖤'}</span>)}</span>
        </div>
      </div>
      <div style={{height:5, background:'var(--panel)', borderRadius:3, marginBottom:16, overflow:'hidden'}}>
        <div style={{height:'100%', width:`${pct}%`, background:tc, borderRadius:3, transition:'width 1s linear'}}/>
      </div>
      <div style={{background:flashBg, border:`2px solid ${borderC}`, borderRadius:14, padding:'22px 24px', transition:'background 0.3s, border-color 0.3s', marginBottom:12}}>
        <div style={{fontFamily:'var(--mono)', fontSize:22, fontWeight:900, color:'var(--green)', textAlign:'center', marginBottom:8, letterSpacing:1}}>{q.display}</div>
        <div style={{fontSize:14, color:'var(--muted)', textAlign:'center', marginBottom:20}}>{q.prompt}</div>
        {phase === 'result' ? (
          <div style={{textAlign:'center', minHeight:48, display:'flex', alignItems:'center', justifyContent:'center'}}>
            {feedback && feedback.ok && (
            <div>
              {feedback.combo && <div style={{fontSize:22, fontWeight:900, fontFamily:'var(--mono)', color:'var(--yellow)', letterSpacing:2, marginBottom:4}}>{feedback.combo}</div>}
              <div style={{color:'var(--green)', fontFamily:'var(--mono)', fontWeight:900, fontSize:20}}>
                +{feedback.pts} pts {feedback.mult>=3?'🔥':''}{feedback.speed>0 && <span style={{fontSize:13, color:'var(--cyan)', marginLeft:8}}>+{feedback.speed} speed</span>}
              </div>
            </div>
          )}
            {feedback && !feedback.ok && (
              <div style={{background:'var(--panel)', border:'1px solid var(--red)', borderRadius:8, padding:'10px 14px', color:'var(--muted)', fontSize:13, fontFamily:'var(--mono)'}}>
                <span style={{color:'var(--red)', fontWeight:900, marginRight:8}}>✗</span>{feedback.explanation}
              </div>
            )}
          </div>
        ) : (
          <div className="grid-mobile-1" style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10}}>
            {q.choices.map((c,i) => {
              const elim = eliminated.includes(i);
              return (
                <button key={i} onClick={() => !elim && choose(c)} disabled={elim}
                  style={{background:'var(--panel)', border:'1px solid var(--border)', borderRadius:9, padding:'14px 10px', fontFamily:'var(--mono)', fontWeight:700, fontSize:14, color: elim ? 'var(--dim)' : 'var(--text)', cursor: elim ? 'default' : 'pointer', opacity: elim ? 0.3 : 1, transition:'all 0.15s'}}
                  onMouseEnter={e => { if(!elim){ e.currentTarget.style.borderColor='var(--green)'; e.currentTarget.style.color='var(--green)'; }}}
                  onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.color=elim?'var(--dim)':'var(--text)'; }}
                >{c}</button>
              );
            })}
          </div>
        )}
      </div>
      {phase === 'playing' && q.choices.length > 2 && (
        <div style={{textAlign:'center'}}>
          <button onClick={use5050} disabled={!powerup}
            style={{background: powerup ? 'var(--panel)' : 'transparent', border:`1px solid ${powerup?'var(--yellow)':'var(--border)'}`, borderRadius:6, padding:'5px 16px', fontFamily:'var(--mono)', fontSize:11, color: powerup ? 'var(--yellow)' : 'var(--dim)', cursor: powerup ? 'pointer' : 'default', letterSpacing:1}}>
            ⚡ 50/50 {powerup ? t('arcade.subnet_sprint.available') : t('arcade.subnet_sprint.used')}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── IPv6 Gauntlet ───────────────────────────────────────────
window.SubnetSprint = SubnetSprint;

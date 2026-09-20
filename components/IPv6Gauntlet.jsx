const { useState, useEffect, useCallback, useRef, useMemo } = React;

function IPv6Gauntlet() {
  const { t } = useTranslation();
  const shuffle = a => [...a].sort(() => Math.random()-0.5);

  const EXPAND_POOL = [
    { q:'2001:db8::1',                          a:'2001:0db8:0000:0000:0000:0000:0000:0001' },
    { q:'fe80::1',                               a:'fe80:0000:0000:0000:0000:0000:0000:0001' },
    { q:'::1',                                   a:'0000:0000:0000:0000:0000:0000:0000:0001' },
    { q:'2001:db8:85a3::8a2e:370:7334',          a:'2001:0db8:85a3:0000:0000:8a2e:0370:7334' },
    { q:'ff02::1',                               a:'ff02:0000:0000:0000:0000:0000:0000:0001' },
    { q:'2001:db8:cafe::17',                     a:'2001:0db8:cafe:0000:0000:0000:0000:0017' },
    { q:'fe80::dead:beef',                       a:'fe80:0000:0000:0000:0000:0000:dead:beef' },
    { q:'2001:db8::',                            a:'2001:0db8:0000:0000:0000:0000:0000:0000' },
    { q:'ff02::2',                               a:'ff02:0000:0000:0000:0000:0000:0000:0002' },
    { q:'2001:db8:1:2::',                        a:'2001:0db8:0001:0002:0000:0000:0000:0000' },
    { q:'::ffff:c000:201',                       a:'0000:0000:0000:0000:0000:ffff:c000:0201' },
    { q:'2001:db8:3333:4444::',                  a:'2001:0db8:3333:4444:0000:0000:0000:0000' },
  ];

  const COMPRESS_POOL = [
    { q:'2001:0db8:0000:0000:0000:0000:0000:0001', a:'2001:db8::1' },
    { q:'fe80:0000:0000:0000:0000:0000:0000:0001', a:'fe80::1' },
    { q:'0000:0000:0000:0000:0000:0000:0000:0001', a:'::1' },
    { q:'2001:0db8:85a3:0000:0000:8a2e:0370:7334', a:'2001:db8:85a3::8a2e:370:7334' },
    { q:'ff02:0000:0000:0000:0000:0000:0000:0001', a:'ff02::1' },
    { q:'2001:0db8:cafe:0000:0000:0000:0000:0017', a:'2001:db8:cafe::17' },
    { q:'0000:0000:0000:0000:0000:ffff:c000:0201', a:'::ffff:c000:201' },
    { q:'2001:0db8:0000:0000:0000:0000:0000:0000', a:'2001:db8::' },
    { q:'fe80:0000:0000:0000:0000:0000:dead:beef', a:'fe80::dead:beef' },
    { q:'2001:0db8:3333:4444:5555:6666:7777:8888', a:'2001:db8:3333:4444:5555:6666:7777:8888' },
  ];

  const CLASSIFY_POOL = [
    { q:'2001:db8::1',              a: t('tools.classify.types.global'), hint: t('arcade.ipv6_gauntlet.hints.global') },
    { q:'fe80::1',                  a: t('tools.classify.types.link_local'),     hint: t('arcade.ipv6_gauntlet.hints.link_local') },
    { q:'ff02::1',                  a: t('tools.classify.types.multicast'),      hint: t('arcade.ipv6_gauntlet.hints.multicast') },
    { q:'::1',                      a: t('tools.classify.types.loopback'),       hint: t('arcade.ipv6_gauntlet.hints.loopback') },
    { q:'2001:4860:4860::8888',     a: t('tools.classify.types.global'), hint: t('arcade.ipv6_gauntlet.hints.google') },
    { q:'fe80::dead:beef',          a: t('tools.classify.types.link_local'),     hint: t('arcade.ipv6_gauntlet.hints.link_local_2') },
    { q:'ff00::0',                  a: t('tools.classify.types.multicast'),      hint: t('arcade.ipv6_gauntlet.hints.multicast_2') },
    { q:'ff02::2',                  a: t('tools.classify.types.multicast'),      hint: t('arcade.ipv6_gauntlet.hints.multicast_3') },
    { q:'2607:f8b0::1',             a: t('tools.classify.types.global'), hint: t('arcade.ipv6_gauntlet.hints.arin') },
    { q:'fe80::1ff:fe23:4567:890a', a: t('tools.classify.types.link_local'),     hint: t('arcade.ipv6_gauntlet.hints.eui64') },
    { q:'ff05::101',                a: t('tools.classify.types.multicast'),      hint: t('arcade.ipv6_gauntlet.hints.multicast_4') },
  ];

  const EUI64_POOL = [
    { q:'00:1A:2B:3C:4D:5E', a:'021a:2bff:fe3c:4d5e', hint: t('arcade.ipv6_gauntlet.hints.eui_1') },
    { q:'AA:BB:CC:DD:EE:FF', a:'a8bb:ccff:fedd:eeff', hint: t('arcade.ipv6_gauntlet.hints.eui_2') },
    { q:'08:00:27:AB:CD:EF', a:'0a00:27ff:feab:cdef', hint: t('arcade.ipv6_gauntlet.hints.eui_3') },
    { q:'52:54:00:12:34:56', a:'5054:00ff:fe12:3456', hint: t('arcade.ipv6_gauntlet.hints.eui_4') },
    { q:'DE:AD:BE:EF:00:01', a:'dcad:beff:feef:0001', hint: t('arcade.ipv6_gauntlet.hints.eui_5') },
    { q:'00:50:56:C0:00:01', a:'0250:56ff:fec0:0001', hint: t('arcade.ipv6_gauntlet.hints.eui_6') },
    { q:'B8:27:EB:12:34:56', a:'ba27:ebff:fe12:3456', hint: t('arcade.ipv6_gauntlet.hints.eui_7') },
    { q:'3C:07:71:AA:BB:CC', a:'3e07:71ff:feaa:bbcc', hint: t('arcade.ipv6_gauntlet.hints.eui_8') },
  ];

  const ROUNDS = [
    { id:'expand',   name: t('arcade.ipv6_gauntlet.round_names.expand'),    label: t('arcade.ipv6_gauntlet.round_labels.1'), pool:EXPAND_POOL,   timer:20, color:'var(--cyan)',    desc: t('arcade.ipv6_gauntlet.round_descs.expand'), hint: t('arcade.ipv6_gauntlet.hints.expand') },
    { id:'compress', name: t('arcade.ipv6_gauntlet.round_names.compress'),  label: t('arcade.ipv6_gauntlet.round_labels.2'), pool:COMPRESS_POOL, timer:18, color:'var(--green)',   desc: t('arcade.ipv6_gauntlet.round_descs.compress'), hint: t('arcade.ipv6_gauntlet.hints.compress') },
    { id:'classify', name: t('arcade.ipv6_gauntlet.round_names.classify'),  label: t('arcade.ipv6_gauntlet.round_labels.3'), pool:CLASSIFY_POOL, timer:10, color:'var(--yellow)',  desc: t('arcade.ipv6_gauntlet.round_descs.classify'), hint: t('arcade.ipv6_gauntlet.hints.classify') },
    { id:'eui64',    name: t('arcade.ipv6_gauntlet.round_names.eui64'),     label: t('arcade.ipv6_gauntlet.round_labels.boss'),  pool:EUI64_POOL,   timer:25, color:'var(--magenta)', desc: t('arcade.ipv6_gauntlet.round_descs.eui64'), hint: t('arcade.ipv6_gauntlet.hints.eui64_main') },
  ];
  const CLASSIFY_CHOICES = [t('tools.classify.types.global'), t('tools.classify.types.link_local'), t('tools.classify.types.multicast'), t('tools.classify.types.loopback')];
  const QS_PER_ROUND = 6;

  const [phase, setPhase]             = useState('start');
  const [roundIdx, setRoundIdx]       = useState(0);
  const [qIdx, setQIdx]               = useState(0);
  const [used, setUsed]               = useState([]);
  const [score, setScore]             = useState(0);
  const [roundScore, setRoundScore]   = useState(0);
  const [lives, setLives]             = useState(3);
  const [timeLeft, setTimeLeft]       = useState(20);
  const [feedback, setFeedback]       = useState(null);
  const [currentQ, setCurrentQ]       = useState(null);
  const [choices, setChoices]         = useState([]);
  const [roundScores, setRoundScores] = useState([]);
  const timerRef    = useRef(null);
  const roundScoreRef = useRef(0);

  const round = ROUNDS[roundIdx] || ROUNDS[0];

  function pickItem(pool, usedIdxs) {
    const avail = pool.map((_,i)=>i).filter(i=>!usedIdxs.includes(i));
    const src   = avail.length > 0 ? avail : pool.map((_,i)=>i);
    return src[Math.floor(Math.random()*src.length)];
  }

  function buildChoices(r, item) {
    if (r.id === 'classify') return CLASSIFY_CHOICES;
    const others = r.pool.filter(p=>p!==item).map(p=>p.a);
    const distractors = shuffle(others).slice(0,3);
    return shuffle([item.a, ...distractors]);
  }

  function startRound(rIdx, sc, lv, prevScores) {
    const r   = ROUNDS[rIdx];
    const idx = pickItem(r.pool, []);
    const item = r.pool[idx];
    setRoundIdx(rIdx); setUsed([idx]);
    setCurrentQ(item); setChoices(buildChoices(r, item));
    setFeedback(null); setTimeLeft(r.timer);
    setRoundScore(0); roundScoreRef.current = 0;
    setScore(sc); setLives(lv); setQIdx(0);
    if (prevScores !== undefined) setRoundScores(prevScores);
    setPhase('playing');
  }

  useEffect(() => {
    if (phase !== 'playing') return;
    timerRef.current = setInterval(() => {
      setTimeLeft(t => { if (t <= 1) { handleTimeout(); return 0; } return t-1; });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [phase, currentQ]);

  function correctAns(r, item) {
    return (r.id === 'classify') ? item.a : item.a;
  }

  function handleTimeout() {
    clearInterval(timerRef.current);
    const nl = lives-1; setLives(nl);
    setFeedback({ ok:false, explanation: t('arcade.ipv6_gauntlet.correct', { a: currentQ.a }), hint: currentQ.hint });
    setPhase('result');
    if (nl <= 0) { setTimeout(()=>setPhase('end'), 2500); return; }
    setTimeout(()=>advanceQ(false), 2500);
  }

  function choose(ans) {
    if (phase !== 'playing') return;
    clearInterval(timerRef.current);
    const ok = ans === correctAns(round, currentQ);
    if (ok) {
      const pts = 150 + Math.round(timeLeft*5);
      roundScoreRef.current += pts;
      setScore(s=>s+pts); setRoundScore(rs=>rs+pts);
      setFeedback({ ok:true, pts });
      setPhase('result');
      setTimeout(()=>advanceQ(true, pts), 700);
    } else {
      const nl = lives-1; setLives(nl);
      setFeedback({ ok:false, explanation: t('arcade.ipv6_gauntlet.correct', { a: currentQ.a }), hint: currentQ.hint });
      setPhase('result');
      if (nl <= 0) { setTimeout(()=>setPhase('end'), 2500); return; }
      setTimeout(()=>advanceQ(false), 2500);
    }
  }

  function advanceQ(wasOk, ptsEarned) {
    const nextQIdx = qIdx+1;
    if (nextQIdx >= QS_PER_ROUND) {
      const newScores = [...roundScores, roundScoreRef.current];
      setRoundScores(newScores);
      if (roundIdx+1 >= ROUNDS.length) { setPhase('end'); }
      else { setPhase('roundend'); }
      return;
    }
    const idx = pickItem(round.pool, used);
    const item = round.pool[idx];
    setUsed(u=>[...u,idx]); setCurrentQ(item); setChoices(buildChoices(round, item));
    setFeedback(null); setTimeLeft(round.timer); setQIdx(nextQIdx);
    setPhase('playing');
  }

  const pct = (timeLeft / (round.timer||1)) * 100;
  const tc  = timeLeft <= 4 ? 'var(--red)' : timeLeft <= 8 ? 'var(--yellow)' : round.color;
  const flashBg  = feedback ? (feedback.ok ? '#00ff0022' : '#ff000022') : 'transparent';
  const borderC  = feedback ? (feedback.ok ? 'var(--green)' : 'var(--red)') : 'var(--border)';

  if (phase === 'start') return (
    <div className="fadein" style={{maxWidth:620, margin:'0 auto', padding:'24px 0', textAlign:'center'}}>
      <div style={{fontSize:38, fontWeight:900, fontFamily:'var(--mono)', color:'var(--magenta)', textShadow:'0 0 30px var(--magenta)', letterSpacing:2, marginBottom:8}}>{t('arcade.ipv6_gauntlet.title')}</div>
      <div style={{color:'var(--muted)', fontSize:13, marginBottom:28}}>{t('arcade.ipv6_gauntlet.desc')}</div>
      <div className="grid-mobile-1" style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:28, textAlign:'left'}}>
        {ROUNDS.map((r,i) => (
          <div key={r.id} style={{background:'var(--card)', border:`1px solid ${r.color}44`, borderRadius:10, padding:14}}>
            <div style={{fontFamily:'var(--mono)', fontWeight:900, color:r.color, fontSize:12, marginBottom:4}}>{r.label}: {r.name}</div>
            <div style={{fontSize:12, color:'var(--muted)', marginBottom:4}}>{r.desc}</div>
            <div style={{fontSize:10, color:'var(--dim)'}}>⏱ {t('arcade.ipv6_gauntlet.timer_questions', { timer: r.timer, n: QS_PER_ROUND })}</div>
          </div>
        ))}
      </div>
      <button onClick={() => startRound(0, 0, 3, [])}
        style={{
          background:'var(--magenta)', 
          color:'#000', 
          border:'none', 
          borderRadius:10, 
          padding:'16px 52px', 
          fontFamily:'var(--mono)', 
          fontWeight:900, 
          fontSize:18, 
          cursor:'pointer', 
          letterSpacing:3, 
          boxShadow:'0 0 30px rgba(244, 114, 182, 0.4)',
          transition:'transform 0.2s, box-shadow 0.2s'
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.boxShadow = '0 0 40px rgba(244, 114, 182, 0.6)'; }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 0 30px rgba(244, 114, 182, 0.4)'; }}
      >
        {t('arcade.ipv6_gauntlet.start')}
      </button>
    </div>
  );

  if (phase === 'roundend') {
    const nextR = ROUNDS[roundIdx+1];
    const isBoss = nextR.id === 'eui64';
    return (
      <div className="fadein" style={{maxWidth:500, margin:'0 auto', textAlign:'center', padding:'36px 0'}}>
        <div style={{fontSize:12, color:'var(--dim)', fontFamily:'var(--mono)', letterSpacing:2, marginBottom:4}}>{t('arcade.ipv6_gauntlet.round_complete', { label: round.label })}</div>
        <div style={{fontSize:30, fontWeight:900, color:round.color, fontFamily:'var(--mono)', marginBottom:4}}>{round.name}</div>
        <div style={{fontSize:22, color:'var(--text)', fontFamily:'var(--mono)', marginBottom:20}}>{score.toLocaleString()} pts</div>
        <div style={{background:'var(--panel)', border:`2px solid ${nextR.color}`, borderRadius:12, padding:18, marginBottom:20}}>
          {isBoss && <div style={{fontSize:10, color:nextR.color, fontFamily:'var(--mono)', letterSpacing:3, marginBottom:6}}>{t('arcade.ipv6_gauntlet.warning')}</div>}
          <div style={{fontFamily:'var(--mono)', color:nextR.color, fontWeight:900, fontSize:15, marginBottom:6}}>{nextR.label}: {nextR.name}</div>
          <div style={{fontSize:13, color:'var(--muted)', marginBottom:8}}>{nextR.hint}</div>
          <div style={{fontSize:11, color:'var(--dim)'}}>{t('arcade.ipv6_gauntlet.timer_per_question', { timer: nextR.timer })}</div>
        </div>
        <div style={{display:'flex', gap:6, justifyContent:'center', marginBottom:18}}>
          {[...Array(3)].map((_,i)=><span key={i} style={{fontSize:20}}>{i<lives?'❤️':'🖤'}</span>)}
        </div>
        <button onClick={() => startRound(roundIdx+1, score, lives)}
          style={{background:nextR.color, color:'#000', border:'none', borderRadius:8, padding:'14px 36px', fontFamily:'var(--mono)', fontWeight:900, fontSize:14, cursor:'pointer', letterSpacing:2}}>
          {isBoss ? t('arcade.ipv6_gauntlet.boss_round') : t('arcade.ipv6_gauntlet.continue')}
        </button>
      </div>
    );
  }

  if (phase === 'end') return (
    <div className="fadein" style={{maxWidth:520, margin:'0 auto', textAlign:'center', padding:'36px 0'}}>
      <div style={{fontSize:36, fontWeight:900, fontFamily:'var(--mono)', color: lives>0 ? 'var(--magenta)' : 'var(--red)', textShadow:`0 0 30px ${lives>0?'var(--magenta)':'var(--red)'}`, marginBottom:8}}>
        {lives > 0 ? t('arcade.ipv6_gauntlet.cleared') : t('arcade.ipv6_gauntlet.game_over')}
      </div>
      <div style={{fontSize:28, color:'var(--text)', fontFamily:'var(--mono)', fontWeight:900, marginBottom:20}}>{score.toLocaleString()} pts</div>
      <div style={{marginBottom:20, border:'1px solid var(--border)', borderRadius:10, overflow:'hidden'}}>
        {ROUNDS.map((r,i) => (
          <div key={r.id} style={{display:'flex', justifyContent:'space-between', padding:'10px 16px', borderBottom: i<ROUNDS.length-1 ? '1px solid var(--border)' : 'none', fontFamily:'var(--mono)', fontSize:13}}>
            <span style={{color:r.color}}>{r.label}: {r.name}</span>
            <span style={{color:'var(--text)'}}>{roundScores[i] !== undefined ? roundScores[i]+' pts' : '—'}</span>
          </div>
        ))}
      </div>
      <div style={{display:'flex', gap:6, justifyContent:'center', marginBottom:20}}>
        {[...Array(3)].map((_,i)=><span key={i} style={{fontSize:20}}>{i<lives?'❤️':'🖤'}</span>)}
      </div>
      <button onClick={() => { setPhase('start'); setRoundScores([]); }}
        style={{background:'var(--magenta)', color:'#000', border:'none', borderRadius:8, padding:'12px 36px', fontFamily:'var(--mono)', fontWeight:900, fontSize:14, cursor:'pointer', letterSpacing:2}}>
        {t('arcade.ipv6_gauntlet.play_again')}
      </button>
    </div>
  );

  if (!currentQ) return null;
  const questionDisplay = currentQ.q;

  return (
    <div className="fadein" style={{maxWidth:640, margin:'0 auto', padding:'12px 0'}}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6, fontFamily:'var(--mono)'}}>
        <div style={{fontSize:13, color:round.color, fontWeight:900}}>{round.label} · {round.name} <span style={{color:'var(--dim)', fontWeight:400}}>Q{qIdx+1}/{QS_PER_ROUND}</span></div>
        <div style={{fontSize:18, fontWeight:900, color:'var(--text)'}}>{score.toLocaleString()}</div>
        <div style={{display:'flex', gap:4}}>{[...Array(3)].map((_,i)=><span key={i} style={{fontSize:16}}>{i<lives?'❤️':'🖤'}</span>)}</div>
      </div>
      <div style={{height:5, background:'var(--panel)', borderRadius:3, marginBottom:14, overflow:'hidden'}}>
        <div style={{height:'100%', width:`${pct}%`, background:tc, borderRadius:3, transition:'width 1s linear'}}/>
      </div>
      <div style={{background:flashBg, border:`2px solid ${borderC}`, borderRadius:14, padding:'20px 22px', transition:'background 0.3s, border-color 0.3s', marginBottom:10}}>
        <div style={{fontFamily:'var(--mono)', fontSize: round.id==='compress'?12:17, fontWeight:900, color:round.color, textAlign:'center', marginBottom:8, wordBreak:'break-all', letterSpacing:round.id==='classify'?2:0}}>
          {questionDisplay}
        </div>
        <div style={{fontSize:13, color:'var(--muted)', textAlign:'center', marginBottom:16}}>{round.desc}</div>
        {phase === 'result' ? (
          <div style={{textAlign:'center', minHeight:44, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:6}}>
            {feedback && feedback.ok && <div style={{color:'var(--green)', fontFamily:'var(--mono)', fontWeight:900, fontSize:18}}>+{feedback.pts} pts</div>}
            {feedback && !feedback.ok && (
              <div style={{background:'var(--panel)', border:'1px solid var(--red)', borderRadius:8, padding:'10px 14px', color:'var(--muted)', fontSize:12, fontFamily:'var(--mono)', textAlign:'left', maxWidth:500}}>
                <div style={{color:'var(--red)', fontWeight:900, marginBottom:4}}>✗ {feedback.explanation}</div>
                {feedback.hint && <div style={{color:'var(--dim)', fontSize:11}}>{feedback.hint}</div>}
              </div>
            )}
          </div>
        ) : (
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10}}>
            {choices.map((c,i) => (
              <button key={i} onClick={() => choose(c)}
                style={{background:'var(--panel)', border:'1px solid var(--border)', borderRadius:9, padding:'12px 8px', fontFamily:'var(--mono)', fontWeight:700, fontSize: round.id==='expand'||round.id==='compress'?11:13, color:'var(--text)', cursor:'pointer', wordBreak:'break-all', transition:'all 0.15s'}}
                onMouseEnter={e => { if(e.currentTarget) { e.currentTarget.style.borderColor=round.color; e.currentTarget.style.color=round.color; }}}
                onMouseLeave={e => { if(e.currentTarget) { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.color='var(--text)'; }}}
              >{c}</button>
            ))}
          </div>
        )}
      </div>
      <div style={{fontSize:11, color:'var(--dim)', textAlign:'center', fontFamily:'var(--mono)'}}>{round.hint}</div>
    </div>
  );
}

// ─── Network Arcade ───────────────────────────────────────────
window.IPv6Gauntlet = IPv6Gauntlet;

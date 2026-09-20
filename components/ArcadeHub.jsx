const { useState, useEffect, useCallback, useRef, useMemo } = React;

function ArcadeHub({ initialData, onShare, onNav }) {
  const { t } = useTranslation();
  const [activeGame, setActiveGame] = useState(initialData?.activeGame ?? null);

  // Apply-down: sidebar sub-row or Ctrl+K deep-link → switch game
  useEffect(() => {
    if (initialData?.activeGame !== undefined && initialData.activeGame !== activeGame) {
      setActiveGame(initialData.activeGame);
    }
  }, [initialData]);

  // Report-up: game change → sidebar highlight follows
  useEffect(() => { onNav?.({ activeGame }); }, [activeGame]);

  // Share wiring
  useEffect(() => {
    const handle = (e) => (e.detail?.respond ?? onShare)({ tool: 'net-arcade', activeGame });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [activeGame, onShare]);

  const GAMES = [
    {
      id: 'packet-rain',
      title: t('arcade.packet_rain.title'),
      emoji: '📡',
      desc: t('arcade.packet_rain.desc'),
      tags: ['Layer 2-7', 'Protocols', 'Reflexes'],
      color: '#00ffff',
      difficulty: '★★★',
    },
    {
      id: 'subnet-ipv4',
      title: t('arcade.subnet_sprint.title'),
      emoji: '🔢',
      desc: t('arcade.subnet_sprint.desc'),
      tags: ['IPv4', 'CIDR', 'Subnetting'],
      color: '#39ff14',
      difficulty: '★★☆',
    },
    {
      id: 'subnet-ipv6',
      title: t('arcade.ipv6_gauntlet.title'),
      emoji: '🌐',
      desc: t('arcade.ipv6_gauntlet.desc'),
      tags: ['IPv6', 'Prefixes', 'EUI-64'],
      color: '#ff00ff',
      difficulty: '★★★',
    },
  ];

  const backBtn = (
    <button
      onClick={() => setActiveGame(null)}
      style={{marginBottom:12, background:'transparent', border:'1px solid var(--border)', color:'var(--muted)', padding:'6px 14px', borderRadius:6, cursor:'pointer', fontSize:12, fontFamily:'var(--mono)'}}
    >
      {t('arcade.hub.back_menu')}
    </button>
  );

  if (activeGame === 'packet-rain') {
    return <div>{backBtn}<NetworkArcade /></div>;
  }

  if (activeGame === 'subnet-ipv4') {
    return <div>{backBtn}<SubnetSprint /></div>;
  }

  if (activeGame === 'subnet-ipv6') {
    return <div>{backBtn}<IPv6Gauntlet /></div>;
  }

  return (
    <div className="fadein">
      <div style={{textAlign:'center', marginBottom:32, paddingTop:12}}>
        <div style={{fontSize:36, fontWeight:900, fontFamily:'var(--mono)', color:'var(--cyan)', textShadow:'0 0 30px var(--cyan)', letterSpacing:2}}>{t('arcade.hub.title')}</div>
        <div style={{color:'var(--muted)', fontSize:13, marginTop:6}}>{t('arcade.hub.select_game')}</div>
      </div>

      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:20}}>
        {GAMES.map(game => (
          <div
            key={game.id}
            onClick={() => !game.soon && setActiveGame(game.id)}
            style={{
              background:'var(--card)', border:`2px solid ${game.soon ? 'var(--border)' : game.color}`,
              borderRadius:16, padding:24, cursor: game.soon ? 'default' : 'pointer',
              transition:'all 0.2s', position:'relative', overflow:'hidden',
              boxShadow: game.soon ? 'none' : `0 0 20px ${game.color}22`,
              opacity: game.soon ? 0.55 : 1,
            }}
            onMouseEnter={e => { if (!game.soon) e.currentTarget.style.boxShadow = `0 0 40px ${game.color}55`; }}
            onMouseLeave={e => { if (!game.soon) e.currentTarget.style.boxShadow = `0 0 20px ${game.color}22`; }}
          >
            {game.soon && (
              <div style={{position:'absolute', top:12, right:12, background:'var(--panel)', border:'1px solid var(--border)', borderRadius:4, padding:'2px 8px', fontSize:10, color:'var(--dim)', fontFamily:'var(--mono)', letterSpacing:1}}>{t('arcade.hub.coming_soon')}</div>
            )}
            <div style={{fontSize:40, marginBottom:12}}>{game.emoji}</div>
            <div style={{fontFamily:'var(--mono)', fontWeight:900, fontSize:18, color: game.soon ? 'var(--muted)' : game.color, marginBottom:8, letterSpacing:1}}>{game.title}</div>
            <div style={{fontSize:13, color:'var(--muted)', lineHeight:1.6, marginBottom:14}}>{game.desc}</div>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
                {game.tags.map(tag_item => (
                  <span key={tag_item} style={{fontSize:10, padding:'2px 7px', borderRadius:20, background:'var(--panel)', border:'1px solid var(--border)', color:'var(--dim)', fontFamily:'var(--mono)'}}>{tag_item}</span>
                ))}
              </div>
              <div style={{fontSize:13, color: game.soon ? 'var(--dim)' : game.color, fontFamily:'var(--mono)'}}>{game.difficulty}</div>
            </div>
            {!game.soon && (
              <div style={{marginTop:16, textAlign:'center', padding:'8px', borderRadius:8, background:`${game.color}18`, border:`1px solid ${game.color}44`, fontSize:12, fontWeight:700, color:game.color, fontFamily:'var(--mono)', letterSpacing:2}}>
                {t('arcade.hub.play')}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

window.ArcadeHub = ArcadeHub;

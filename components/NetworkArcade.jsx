const { useState, useEffect, useCallback, useRef, useMemo } = React;

function NetworkArcade() {
  const { t } = useTranslation();
  const [gameState, setGameState] = useState("start");
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(5);
  const [packets, setPackets] = useState([]);
  const [difficulty, setDifficulty] = useState(1);
  const [level, setLevel] = useState(1);
  const [draggedId, setDraggedId] = useState(null);
  const [hoveredPort, setHoveredPort] = useState(null);
  const gameAreaRef = useRef(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  const ALL_CATEGORIES = useMemo(() => [
    { id: "route", label: t('arcade.packet_rain.categories.route'), color: "#ff00ff", desc: "OSPF / BGP" },
    { id: "sec", label: t('arcade.packet_rain.categories.sec'), color: "#ff3300", desc: "FW / VPN" },
    { id: "cloud", label: t('arcade.packet_rain.categories.cloud'), color: "#00ffff", desc: "VXLAN / K8s" },
    { id: "switch", label: t('arcade.packet_rain.categories.switch'), color: "#39ff14", desc: "STP / LACP" },
    { id: "wifi", label: t('arcade.packet_rain.categories.wifi'), color: "#ffff00", desc: "RF / 802.11" },
    { id: "icmp", label: t('arcade.packet_rain.categories.icmp'), color: "#0070ff", desc: "Ping / Trace" },
    { id: "v6", label: t('arcade.packet_rain.categories.v6'), color: "#ffffff", desc: "Next Gen" },
    { id: "mpls", label: t('arcade.packet_rain.categories.mpls'), color: "#ff8000", desc: "Labels / TE" }
  ], [t]);

  const PACKET_POOL = [
    { val: "OSPF:LSA", cat: "route" }, { val: "BGP:Prefix", cat: "route" }, { val: "EIGRP:AS", cat: "route" }, { val: "IS-IS:NET", cat: "route" },
    { val: "RIP:Hop", cat: "route" }, { val: "BGP:Med", cat: "route" }, { val: "PBR:Policy", cat: "route" }, { val: "VRF:Lite", cat: "route" },
    { val: "SEC:IPsec", cat: "sec" }, { val: "FW:Rule", cat: "sec" }, { val: "VPN:Tunnel", cat: "sec" }, { val: "SEC:X.509", cat: "sec" },
    { val: "IDS:Alert", cat: "sec" }, { val: "SEC:SSH", cat: "sec" }, { val: "NAT:Inside", cat: "sec" }, { val: "ACL:Deny", cat: "sec" },
    { val: "VXLAN:VNI", cat: "cloud" }, { val: "SDN:Flow", cat: "cloud" }, { val: "VPC:Peer", cat: "cloud" }, { val: "EVPN:RT2", cat: "cloud" },
    { val: "OTV:Edge", cat: "cloud" }, { val: "K8S:Cni", cat: "cloud" }, { val: "ACI:Tenant", cat: "cloud" }, { val: "SDWAN:Vpn", cat: "cloud" },
    { val: "STP:BPDU", cat: "switch" }, { val: "LACP:LAG", cat: "switch" }, { val: "VLAN:Tag", cat: "switch" }, { val: "MAC:Table", cat: "switch" },
    { val: "CDP:Nbor", cat: "switch" }, { val: "VTP:Domain", cat: "switch" }, { val: "QinQ:Stack", cat: "switch" }, { val: "DTP:Auto", cat: "switch" },
    { val: "802.11:SSI", cat: "wifi" }, { val: "RF:Noise", cat: "wifi" }, { val: "WPA3:Key", cat: "wifi" }, { val: "SNR:Margin", cat: "wifi" },
    { val: "AP:CAPWAP", cat: "wifi" }, { val: "SSID:Bcn", cat: "wifi" }, { val: "ISM:Band", cat: "wifi" }, { val: "DFS:Event", cat: "wifi" },
    { val: "ICMP:Echo", cat: "icmp" }, { val: "ICMP:Unreach", cat: "icmp" }, { val: "UDP:Jitter", cat: "icmp" }, { val: "TCP:SYN", cat: "icmp" },
    { val: "ICMP:TTL-Ex", cat: "icmp" }, { val: "TCP:RST", cat: "icmp" }, { val: "UDP:Probe", cat: "icmp" }, { val: "TCP:ACK", cat: "icmp" },
    { val: "IPv6:fe80", cat: "v6" }, { val: "IPv6:SLAAC", cat: "v6" }, { val: "NDP:NS", cat: "v6" }, { val: "IPv6:2001", cat: "v6" },
    { val: "NDP:RA", cat: "v6" }, { val: "IPv6:6to4", cat: "v6" }, { val: "DHCPv6:Sol", cat: "v6" }, { val: "IPv6:ULA", cat: "v6" },
    { val: "MPLS:Label", cat: "mpls" }, { val: "LDP:Hello", cat: "mpls" }, { val: "RSVP:Path", cat: "mpls" }, { val: "TE:Tunnel", cat: "mpls" },
    { val: "QoS:DSCP", cat: "mpls" }, { val: "QoS:CoS", cat: "mpls" }, { val: "WRED:Drop", cat: "mpls" }, { val: "PHP:Pop", cat: "mpls" }
  ];

  const startGame = () => {
    setGameState("playing");
    setScore(0);
    setLives(5);
    setPackets([]);
    setDifficulty(1);
    setLevel(1);
    setDraggedId(null);
  };

  useEffect(() => {
    if (gameState !== "playing") return;

    const interval = setInterval(() => {
      setPackets(prev => {
        const nextPackets = prev.map(p => {
          if (p.id === draggedId) return p;
          return { ...p, y: p.y + (0.5 + difficulty * 0.1) };
        }).filter(p => {
          if (p.id === draggedId) return true;
          if (p.y > 681) {
            setLives(l => l - 1);
            return false;
          }
          return true;
        });

        const spawnChance = 0.015 + (difficulty * 0.002);
        if (Math.random() < spawnChance && nextPackets.length < 5) {
          const activeVals = new Set(nextPackets.map(p => p.val));
          const available = PACKET_POOL.filter(p => !activeVals.has(p.val));
          const pool = available.length > 0 ? available : PACKET_POOL;
          const template = pool[Math.floor(Math.random() * pool.length)];
          if (template) {
            const occupiedX = nextPackets.filter(p => p.y < 40).map(p => p.x);
            let x;
            let attempts = 0;
            do {
              x = Math.random() * 76 + 12;
              attempts++;
            } while (attempts < 20 && occupiedX.some(ox => Math.abs(ox - x) < 14));
            nextPackets.push({
              id: Math.random(),
              val: template.val,
              cat: template.cat,
              x,
              y: -40
            });
          }
        }
        return nextPackets;
      });
    }, 30);

    return () => clearInterval(interval);
  }, [gameState, difficulty, draggedId]);

  useEffect(() => {
    const newLevel = Math.floor(score / 3000) + 1;
    if (newLevel > level) {
      setLevel(newLevel);
      setDifficulty(newLevel);
    }
  }, [score]);

  useEffect(() => {
    if (lives <= 0) setGameState("end");
  }, [lives]);

  const onPointerDown = (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    const packet = packets.find(p => p.id === id);
    if (!packet || !gameAreaRef.current) return;
    const rect = gameAreaRef.current.getBoundingClientRect();
    const cursorPctX = ((e.clientX - rect.left) / rect.width) * 100;
    const cursorPxY = e.clientY - rect.top;
    dragOffsetRef.current = { x: packet.x - cursorPctX, y: packet.y - cursorPxY };
    try { gameAreaRef.current.setPointerCapture(e.pointerId); } catch(err) {}
    setDraggedId(id);
  };

  const onPointerMove = (e) => {
    if (!draggedId || !gameAreaRef.current) return;
    const rect = gameAreaRef.current.getBoundingClientRect();
    const rawX = ((e.clientX - rect.left) / rect.width) * 100;
    const rawY = e.clientY - rect.top;
    const x = rawX + dragOffsetRef.current.x;
    const y = rawY + dragOffsetRef.current.y;
    setPackets(prev => prev.map(p => p.id === draggedId ? { ...p, x, y } : p));

    const dropThreshold = rect.height - 69;
    if (rawY > dropThreshold) {
      const portIdx = Math.floor((rawX / 100) * ALL_CATEGORIES.length);
      const port = ALL_CATEGORIES[Math.max(0, Math.min(portIdx, ALL_CATEGORIES.length - 1))];
      setHoveredPort(port?.id || null);
    } else {
      setHoveredPort(null);
    }
  };

  const onPointerUp = (e) => {
    if (!draggedId || !gameAreaRef.current) {
      setDraggedId(null);
      setHoveredPort(null);
      return;
    }
    const rect = gameAreaRef.current.getBoundingClientRect();
    const rawX = ((e.clientX - rect.left) / rect.width) * 100;
    const rawY = e.clientY - rect.top;
    const packet = packets.find(p => p.id === draggedId);

    const dropThreshold = rect.height - 69;
    if (packet && rawY > dropThreshold) {
      const portIdx = Math.floor((rawX / 100) * ALL_CATEGORIES.length);
      const port = ALL_CATEGORIES[Math.max(0, Math.min(portIdx, ALL_CATEGORIES.length - 1))];
      if (port && packet.cat === port.id) {
        setScore(s => s + 500);
        setPackets(prev => prev.filter(p => p.id !== draggedId));
      } else {
        setLives(l => l - 1);
        setPackets(prev => prev.filter(p => p.id !== draggedId));
      }
    }
    try { gameAreaRef.current.releasePointerCapture(e.pointerId); } catch(err) {}
    setDraggedId(null);
    setHoveredPort(null);
  };

  const onPointerCancel = (e) => {
    try { gameAreaRef.current.releasePointerCapture(e.pointerId); } catch(err) {}
    setDraggedId(null);
    setHoveredPort(null);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      gameAreaRef.current.requestFullscreen().catch(err => console.error(err));
    } else {
      document.exitFullscreen();
    }
  };

  return (
    <div className="fadein">
      <div className="card arcade-card" ref={gameAreaRef} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} style={{
        position: "relative", overflow: "hidden", minHeight: window.innerWidth < 768 ? 480 : 750, background: "#050508",
        border: "6px solid #1a1a2e", borderRadius: 20, display: "flex", flexDirection: "column",
        userSelect: "none", touchAction: "none"
      }}>
        <div style={{display: "flex", justifyContent: "space-between", alignItems: "center", padding: window.innerWidth < 768 ? "10px 15px" : "15px 30px", background: "#11111f", color: "#00ffff", fontFamily: "var(--mono)", borderBottom: "3px solid #222"}}>
          <div>
            <div style={{fontSize: 8, color: "var(--muted)", marginBottom: 2}}>{t('arcade.packet_rain.level')} {level}</div>
            <div style={{fontSize: window.innerWidth < 768 ? 16 : 24, fontWeight: 900, textShadow: "0 0 15px #00ffff"}}>{t('arcade.packet_rain.score')}: {score.toString().padStart(6, "0")}</div>
          </div>
          <div style={{display: "flex", alignItems: "center", gap: window.innerWidth < 768 ? 10 : 30}}>
            <div style={{textAlign: "right"}}>
              <div style={{fontSize: 8, color: "var(--muted)", marginBottom: 2}}>{t('arcade.packet_rain.uptime')}</div>
              <div style={{fontSize: window.innerWidth < 768 ? 14 : 22, color: "#ff3300", letterSpacing: 2}}>{"▮".repeat(Math.max(0, lives))}{"▯".repeat(Math.max(0, 5-lives))}</div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={toggleFullscreen} style={{fontSize: 9, padding: "4px 8px", border: "1px solid #333", borderRadius: 4, color:"#00ffff"}}>
              {t('arcade.packet_rain.fullscreen')}
            </button>
          </div>
        </div>

        {gameState === "start" && (
          <div style={{flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff", textAlign: "center", padding: 20}}>
            <div style={{background: "rgba(0,255,255,0.05)", padding: window.innerWidth < 768 ? 20 : 40, borderRadius: "50%", border: "1px solid rgba(0,255,255,0.2)", marginBottom: 20, boxShadow: "0 0 80px rgba(0,255,255,0.15)"}}>
               <div style={{fontSize: window.innerWidth < 768 ? 32 : 72, fontWeight: 900, color: "#00ffff", textShadow: "0 0 40px #00ffff", letterSpacing: "-1px"}}>{t('arcade.packet_rain.title')}</div>
            </div>
            <p style={{color: "var(--muted)", maxWidth: 500, fontSize: window.innerWidth < 768 ? 14 : 18, lineHeight: 1.5, marginBottom: 30}}>
              {t('arcade.packet_rain.desc')} <br/>
              <strong>{t('arcade.packet_rain.identify')}</strong> {t('arcade.packet_rain.drag_hint')}
            </p>
            <button className="btn btn-primary btn-lg" onClick={startGame} style={{padding: window.innerWidth < 768 ? "15px 40px" : "25px 90px", fontSize: window.innerWidth < 768 ? 18 : 28, fontWeight: 800, borderRadius: 50, background: "#00ffff", color: "#000", boxShadow: "0 10px 50px rgba(0,255,255,0.4)"}}>{t('arcade.packet_rain.initialize')}</button>
          </div>
        )}

        {gameState === "playing" && (
          <div style={{flex: 1, position: "relative", width: "100%", overflow: "hidden"}}>

            {packets.map(p => {
              const isDragged = draggedId === p.id;

              return (
              <div
                key={p.id}
                onPointerDown={(e) => onPointerDown(e, p.id)}
                style={{
                  position: "absolute", left: `${p.x}%`, top: p.y, transform: "translate(-50%, -50%)",
                  background: isDragged ? "#222228" : "#11111a",
                  border: isDragged ? "2px solid #888" : "1px solid #444",
                  padding: "4px 8px", borderRadius: 8, fontSize: window.innerWidth < 768 ? 9 : 11, fontWeight: 900, fontFamily: "var(--mono)",
                  color: isDragged ? "#ddd" : "#fff",
                  boxShadow: isDragged ? "0 0 25px rgba(180,180,180,0.25)" : "0 4px 8px rgba(0,0,0,0.5)",
                  cursor: "grab", zIndex: isDragged ? 100 : 10,
                  opacity: isDragged ? 1 : 0.85,
                  transition: isDragged ? "none" : "top 0.05s linear, left 0.2s ease-out"
                }}
              >
                {p.val}
              </div>
              );
            })}

            <div style={{position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 20}}>
              {/* Hard bar — the kill zone, above the buckets */}
              <div style={{
                height: 4,
                background: "#ff3300",
                boxShadow: "0 -4px 20px rgba(255,51,0,0.4), 0 2px 6px rgba(255,51,0,0.6)"
              }}>
              </div>
              {/* Bucket row — all 8 categories always visible */}
              <div style={{display: "flex", padding: "0 1px", background: "#0a0a10"}}>
                {ALL_CATEGORIES.map(cat => {
                  const isHovered = hoveredPort === cat.id;
                  return (
                    <div key={cat.id} style={{
                      flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                      position: "relative", padding: "2px 1px"
                    }}>
                      <div style={{
                        width: "100%", height: window.innerWidth < 768 ? 40 : 55, background: isHovered ? cat.color : "#0e0e18",
                        border: `1px solid ${cat.color}`, borderRadius: 4,
                        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                        boxShadow: isHovered ? `0 0 30px ${cat.color}` : `0 0 8px ${cat.color}22`,
                        transition: "all 0.2s ease-out"
                      }}>
                         <div style={{fontSize: window.innerWidth < 768 ? 7 : 11, fontWeight: 900, color: isHovered ? "#000" : cat.color, textShadow: isHovered ? "none" : `0 0 8px ${cat.color}aa`, textAlign:'center', lineHeight:1}}>{window.innerWidth < 768 ? cat.label.slice(0,5) : cat.label}</div>
                         <div style={{fontSize: 6, color: isHovered ? "#000" : "#888", textTransform: "uppercase", fontWeight: 700, marginTop:1, display: window.innerWidth < 768 ? 'none' : 'block'}}>{cat.desc}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {gameState === "end" && (
          <div style={{flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff", textAlign: "center", padding: 20}}>
            <div style={{fontSize: window.innerWidth < 768 ? 32 : 82, fontWeight: 900, color: "#ff3300", marginBottom: 10, textShadow: "0 0 40px rgba(255,51,0,0.6)"}}>{t('arcade.packet_rain.overflow')}</div>
            <div style={{fontSize: window.innerWidth < 768 ? 14 : 26, color: "var(--muted)", marginBottom: 10, fontFamily: "var(--mono)", letterSpacing: 2}}>{t('arcade.packet_rain.level')} {level} • {t('arcade.packet_rain.corrupted')}</div>
            <div style={{fontSize: window.innerWidth < 768 ? 20 : 36, fontWeight: 700, marginBottom: 30, color: "#00ffff"}}>{t('arcade.packet_rain.score')}: {score}</div>
            <button className="btn btn-primary btn-lg" onClick={startGame} style={{padding: window.innerWidth < 768 ? "15px 40px" : "25px 100px", borderRadius: 50, fontSize: window.innerWidth < 768 ? 16 : 22, background:"#00ffff", color:"#000"}}>{t('arcade.packet_rain.reboot')}</button>
          </div>
        )}

        <div style={{position: "absolute", inset: 0, pointerEvents: "none", background: "linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.2) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.03), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.03))", backgroundSize: "100% 2px, 3px 100%", zIndex: 200, opacity: 0.9}}></div>
      </div>
      <div className="hint" style={{marginTop: 15}}>
        <strong>{t('arcade.packet_rain.skill_update')}</strong> {t('arcade.packet_rain.neutral_headers')} <strong>{t('arcade.packet_rain.read_release')}</strong>
      </div>
    </div>
  );
}


// ─── Tool: Bandwidth & Throughput Calculator ──────────────────
window.NetworkArcade = NetworkArcade;

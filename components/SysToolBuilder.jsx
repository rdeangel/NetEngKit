const { useState, useEffect, useCallback, useRef, useMemo } = React;

function SysToolBuilder({ onShare, onNav, initialData }) {
  const { t } = useTranslation();
  const [os, setOs] = useState(initialData?.activeTab ?? initialData?.os ?? 'linux');
  const [toolId, setToolId] = useState(initialData?.toolId ?? 'netstat');
  const [options, setOptions] = useState(initialData?.options ?? {});
  const [target, setTarget] = useState(initialData?.target ?? '1.2.3.4');

  useEffect(() => {
    if (initialData) {
      const incomingOs = initialData.activeTab ?? initialData.os;
      if (incomingOs !== undefined && incomingOs !== os) {
        setOs(incomingOs);
        setToolId(incomingOs === 'windows' ? 'ipconfig' : 'netstat');
        setOptions({});
      } else {
        if (initialData.toolId !== undefined) setToolId(initialData.toolId);
        if (initialData.options !== undefined) setOptions(initialData.options);
      }
      if (initialData.target !== undefined) setTarget(initialData.target);
    }
  }, [initialData]);

  useEffect(() => { onNav?.({ activeTab: os }); }, [os]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (target || toolId) {
        (e.detail?.respond ?? onShare)({ tool: 'systools', os, toolId, options, target });
      }
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [os, toolId, options, target, onShare]);

  const LINUX_TOOLS = {
    netstat: {
      name: 'netstat',
      desc: 'Print network connections, routing tables, interface statistics, masquerade connections, and multicast memberships',
      flags: [
        { key: '-a', label: 'All', desc: 'Show both listening and non-listening sockets' },
        { key: '-n', label: 'Numeric', desc: 'Show numeric addresses instead of resolving hosts' },
        { key: '-p', label: 'Programs', desc: 'Show PID and name of the program to which each socket belongs' },
        { key: '-t', label: 'TCP', desc: 'Show TCP connections' },
        { key: '-u', label: 'UDP', desc: 'Show UDP connections' },
        { key: '-l', label: 'Listening', desc: 'Show only listening sockets' },
        { key: '-r', label: 'Routing', desc: 'Show the routing table' },
        { key: '-i', label: 'Interfaces', desc: 'Show interface table' },
        { key: '-s', label: 'Statistics', desc: 'Show summary statistics for each protocol' },
        { key: '-c', label: 'Continuous', desc: 'Reload every second' },
        { key: '-e', label: 'Extended', desc: 'Display extended information' },
        { key: '-v', label: 'Verbose', desc: 'Be verbose' },
        { key: '-W', label: 'Wide', desc: "Don't truncate IP addresses" },
      ],
      examples: [
        { label: 'Listen Ports (TULPN)', options: { '-t': true, '-u': true, '-l': true, '-p': true, '-n': true } },
        { label: 'Routing Table', options: { '-r': true, '-n': true } },
        { label: 'All TCP Conn', options: { '-a': true, '-t': true } },
        { label: 'Interface Stats', options: { '-i': true, '-e': true } },
        { label: 'Protocol Stats', options: { '-s': true } },
      ]
    },
    ss: {
      name: 'ss',
      desc: 'Socket statistics (modern netstat replacement)',
      flags: [
        { key: '-a', label: 'All', desc: 'Display all sockets' },
        { key: '-l', label: 'Listening', desc: 'Display listening sockets' },
        { key: '-t', label: 'TCP', desc: 'Display TCP sockets' },
        { key: '-u', label: 'UDP', desc: 'Display UDP sockets' },
        { key: '-n', label: 'Numeric', desc: "Don't resolve service names" },
        { key: '-p', label: 'Process', desc: 'Show process using socket' },
        { key: '-i', label: 'Internal', desc: 'Show internal TCP information' },
        { key: '-s', label: 'Summary', desc: 'Print summary statistics' },
      ],
      examples: [
        { label: 'Listen Ports', options: { '-l': true, '-t': true, '-u': true, '-n': true, '-p': true } },
        { label: 'Established TCP', options: { '-t': true, '-n': true } },
        { label: 'Summary Stats', options: { '-s': true } },
      ]
    },
    route: {
      name: 'route',
      desc: 'Manipulate the IP routing table',
      flags: [
        { key: '-n', label: 'Numeric', desc: 'Show numerical addresses' },
        { key: 'add', label: 'Add', desc: 'Add a new route' },
        { key: 'del', label: 'Delete', desc: 'Delete a route' },
      ],
      params: [
        { key: '-net', label: 'Network', placeholder: '10.0.0.0', type: 'text' },
        { key: 'netmask', label: 'Netmask', placeholder: '255.255.255.0', type: 'text' },
        { key: 'gw', label: 'Gateway', placeholder: '192.168.1.1', type: 'text' },
        { key: 'dev', label: 'Interface', placeholder: 'eth0', type: 'text' },
      ]
    },
    ip: {
      name: 'ip route',
      desc: 'Modern routing configuration (iproute2)',
      flags: [
        { key: 'show', label: 'Show', desc: 'List routes' },
        { key: 'add', label: 'Add', desc: 'Add route' },
        { key: 'del', label: 'Delete', desc: 'Delete route' },
      ],
      params: [
        { key: 'to', label: 'To (CIDR)', placeholder: '10.0.0.0/24', type: 'text' },
        { key: 'via', label: 'Via (GW)', placeholder: '192.168.1.1', type: 'text' },
        { key: 'dev', label: 'Dev', placeholder: 'eth0', type: 'text' },
      ]
    },
    hping3: {
      name: 'hping3',
      desc: 'TCP/IP packet assembler/analyzer',
      flags: [
        { key: '-S', label: 'SYN', desc: 'Set SYN flag' },
        { key: '-A', label: 'ACK', desc: 'Set ACK flag' },
        { key: '-F', label: 'FIN', desc: 'Set FIN flag' },
        { key: '-P', label: 'PUSH', desc: 'Set PUSH flag' },
        { key: '-1', label: 'ICMP', desc: 'ICMP mode' },
        { key: '-2', label: 'UDP', desc: 'UDP mode' },
        { key: '-8', label: 'Scan', desc: 'Scan mode' },
        { key: '--flood', label: 'Flood', desc: 'Sent packets as fast as possible' },
        { key: '--rand-source', label: 'Random Source', desc: 'Use random source address' },
      ],
      params: [
        { key: '-p', label: 'Port', placeholder: '80', type: 'text' },
        { key: '-c', label: 'Count', placeholder: '10', type: 'text' },
        { key: '-i', label: 'Interval', placeholder: 'u1000', type: 'text' },
        { key: '-I', label: 'Interface', placeholder: 'eth0', type: 'text' },
      ],
      examples: [
        { label: 'SYN Scan Port 80', options: { '-S': true, '-p': '80', '-c': '10' } },
        { label: 'UDP Flood', options: { '-2': true, '--flood': true, '--rand-source': true } },
        { label: 'ICMP Ping', options: { '-1': true, '-c': '4' } },
      ]
    },
    iperf3: {
      name: 'iperf3',
      desc: 'Network bandwidth measurement tool',
      flags: [
        { key: '-s', label: 'Server', desc: 'Run in server mode' },
        { key: '-c', label: 'Client', desc: 'Run in client mode (requires target)' },
        { key: '-u', label: 'UDP', desc: 'Use UDP instead of TCP' },
        { key: '-V', label: 'IPv6', desc: 'IPv6 only' },
        { key: '-R', label: 'Reverse', desc: 'Run in reverse mode (server sends, client receives)' },
      ],
      params: [
        { key: '-p', label: 'Port', placeholder: '5201', type: 'text' },
        { key: '-b', label: 'Bandwidth', placeholder: '10M', type: 'text' },
        { key: '-t', label: 'Time', placeholder: '10', type: 'text' },
        { key: '-i', label: 'Interval', placeholder: '1', type: 'text' },
        { key: '-P', label: 'Parallel', placeholder: '4', type: 'text' },
      ]
    },
    wget: {
      name: 'wget',
      desc: 'Non-interactive network downloader',
      flags: [
        { key: '-c', label: 'Continue', desc: 'Resume getting a partially-downloaded file' },
        { key: '-b', label: 'Background', desc: 'Go to background immediately after startup' },
        { key: '-r', label: 'Recursive', desc: 'Specify recursive download' },
        { key: '--no-check-certificate', label: 'No Cert Check', desc: "Don't validate SSL certificates" },
      ],
      params: [
        { key: '-O', label: 'Output File', default: 'file.zip', type: 'text' },
        { key: '-P', label: 'Directory', default: '/tmp', type: 'text' },
        { key: '-l', label: 'Level', default: '5', type: 'text' },
        { key: '--user-agent', label: 'User Agent', default: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', type: 'text' },
      ]
    },
    curl: {
      name: 'curl',
      desc: 'Transfer data from or to a server',
      flags: [
        { key: '-L', label: 'Follow Location', desc: 'Follow redirects' },
        { key: '-v', label: 'Verbose', desc: 'Make the operation more talkative' },
        { key: '-k', label: 'Insecure', desc: 'Allow insecure server connections when using SSL' },
        { key: '-I', label: 'Head Only', desc: 'Show document info only' },
        { key: '-s', label: 'Silent', desc: 'Silent mode' },
      ],
      params: [
        { key: '-X', label: 'Method', default: 'POST', type: 'text' },
        { key: '-H', label: 'Header', default: '"Content-Type: application/json"', type: 'text' },
        { key: '-d', label: 'Data', default: '{"key":"val"}', type: 'text' },
        { key: '-o', label: 'Output', default: 'result.html', type: 'text' },
        { key: '-u', label: 'User', default: 'user:pass', type: 'text' },
      ]
    },
    nload: {
      name: 'nload',
      desc: 'Real-time network traffic and bandwidth usage',
      params: [
        { key: '-u', label: 'Units', placeholder: 'm', type: 'text', desc: 'h|b|k|m|g' },
        { key: '-t', label: 'Interval', placeholder: '500', type: 'text', desc: 'Update interval in ms' },
      ]
    },
    nethogs: {
      name: 'nethogs',
      desc: 'Net top tool grouping bandwidth per process',
      flags: [
        { key: '-a', label: 'All', desc: 'Monitor all devices, even loopback' },
        { key: '-b', label: 'Buoy', desc: 'Run in buoy mode' },
      ],
      params: [
        { key: '-d', label: 'Delay', placeholder: '5', type: 'text' },
        { key: '-v', label: 'View Mode', placeholder: '0', type: 'text', desc: '0: KB/s, 1: B/s, 2: B, 3: KB' },
      ]
    },
    iftop: {
      name: 'iftop',
      desc: 'Display bandwidth usage on an interface',
      flags: [
        { key: '-n', label: 'No DNS', desc: "Don't do hostname lookups" },
        { key: '-P', label: 'Show Ports', desc: 'Show ports in display' },
        { key: '-b', label: 'No Bar', desc: "Don't display bar graphs of traffic" },
        { key: '-N', label: 'No Service', desc: "Don't convert port numbers to services" },
      ],
      params: [
        { key: '-i', label: 'Interface', placeholder: 'eth0', type: 'text' },
        { key: '-f', label: 'Filter', placeholder: '"net 192.168.1.0/24"', type: 'text' },
      ]
    },
    speedometer: {
      name: 'speedometer',
      desc: 'Measure and display the speed of data across an interface',
      params: [
        { key: '-r', label: 'RX Interface', placeholder: 'eth0', type: 'text' },
        { key: '-t', label: 'TX Interface', placeholder: 'eth0', type: 'text' },
      ]
    },
    nmtui: {
      name: 'nmtui',
      desc: 'NetworkManager TUI — configure IP, DNS, gateway, and connections interactively (requires NetworkManager)',
      flags: [
        { key: 'edit', label: 'Edit Connection', desc: 'Open connection editor (IP, gateway, DNS, MTU)' },
        { key: 'connect', label: 'Activate/Deactivate', desc: 'Bring a connection up or down' },
        { key: 'hostname', label: 'Set Hostname', desc: 'Set the system hostname' },
      ],
      params: [
        { key: 'name', label: 'Connection Name', placeholder: 'Wired connection 1', type: 'text', desc: 'Optional — opens directly to that connection' },
      ],
      examples: [
        { label: 'Edit Connections', options: { edit: true } },
        { label: 'Activate/Deactivate', options: { connect: true } },
        { label: 'Set Hostname', options: { hostname: true } },
        { label: 'Edit Named Conn', options: { edit: true, name: 'Wired connection 1' } },
      ]
    }
  };

  const WINDOWS_TOOLS = {
    ipconfig: {
      name: 'ipconfig',
      desc: 'Display all current TCP/IP network configuration values',
      flags: [
        { key: '/all', label: 'All', desc: 'Display full configuration' },
        { key: '/release', label: 'Release', desc: 'Release IPv4 address' },
        { key: '/renew', label: 'Renew', desc: 'Renew IPv4 address' },
        { key: '/flushdns', label: 'Flush DNS', desc: 'Purge DNS Resolver cache' },
        { key: '/displaydns', label: 'Display DNS', desc: 'Display content of DNS cache' },
      ]
    },
    netstat: {
      name: 'netstat',
      desc: 'Displays active TCP connections, ports, and statistics',
      flags: [
        { key: '-a', label: 'All', desc: 'Show all connections and ports' },
        { key: '-n', label: 'Numeric', desc: 'Display in numeric form' },
        { key: '-o', label: 'PID', desc: 'Show owning process ID' },
        { key: '-p tcp', label: 'TCP Only', desc: 'Show TCP protocol only' },
        { key: '-p udp', label: 'UDP Only', desc: 'Show UDP protocol only' },
        { key: '-p icmp', label: 'ICMP Only', desc: 'Show ICMP protocol only' },
        { key: '-r', label: 'Routing', desc: 'Show routing table' },
        { key: '-s', label: 'Stats', desc: 'Show per-protocol statistics' },
        { key: '-e', label: 'Ethernet', desc: 'Show Ethernet statistics' },
        { key: '-b', label: 'Executables', desc: 'Show executable involved (Admin)' },
        { key: '-q', label: 'Bound Ports', desc: 'Show all bound ports' },
        { key: '-y', label: 'TCP Template', desc: 'Show TCP template' },
      ],
      examples: [
        { label: 'Listen Ports (ANO)', options: { '-a': true, '-n': true, '-o': true } },
        { label: 'Routing Table', options: { '-r': true } },
        { label: 'Protocol Stats', options: { '-s': true } },
        { label: 'Ethernet Stats', options: { '-e': true } },
        { label: 'Show Executables', options: { '-a': true, '-b': true } },
      ]
    },
    tracert: {
      name: 'tracert',
      desc: 'Trace route to a destination',
      flags: [
        { key: '-d', label: 'No DNS', desc: "Don't resolve addresses to hostnames" },
      ],
      params: [
        { key: '-h', label: 'Max Hops', placeholder: '30', type: 'text' },
        { key: '-w', label: 'Timeout', placeholder: '1000', type: 'text', desc: 'Timeout in ms' },
      ]
    },
    ping: {
      name: 'ping',
      desc: 'Verify connectivity to a remote host',
      flags: [
        { key: '-t', label: 'Continuous', desc: 'Ping until stopped (Ctrl+C)' },
        { key: '-a', label: 'Resolve', desc: 'Resolve addresses to hostnames' },
      ],
      params: [
        { key: '-n', label: 'Count', placeholder: '4', type: 'text' },
        { key: '-l', label: 'Size', placeholder: '32', type: 'text', desc: 'Send buffer size' },
        { key: '-i', label: 'TTL', placeholder: '128', type: 'text' },
      ]
    },
    nslookup: {
      name: 'nslookup',
      desc: 'Query DNS infrastructure',
      params: [
        { key: '-type=', label: 'Type', placeholder: 'A', type: 'text', desc: 'A, AAAA, MX, NS, SOA, TXT' },
        { key: '-timeout=', label: 'Timeout', placeholder: '2', type: 'text' },
      ]
    },
    route: {
      name: 'route',
      desc: 'Manipulate network routing tables',
      flags: [
        { key: 'print', label: 'Print', desc: 'Display routing table' },
        { key: '-f', label: 'Flush', desc: 'Clear routing tables' },
        { key: 'add', label: 'Add', desc: 'Add a route' },
        { key: 'delete', label: 'Delete', desc: 'Delete a route' },
      ],
      params: [
        { key: 'network', label: 'Destination', placeholder: '10.0.0.0', type: 'text' },
        { key: 'mask', label: 'Mask', placeholder: '255.255.255.0', type: 'text' },
        { key: 'gateway', label: 'Gateway', placeholder: '192.168.1.1', type: 'text' },
        { key: 'metric', label: 'Metric', placeholder: '1', type: 'text' },
        { key: 'if', label: 'Interface Index', placeholder: '12', type: 'text' },
      ]
    },
    netsh: {
      name: 'netsh',
      desc: 'Network shell — configure MTU, TCP/IP stack, firewall, and wireless',
      flags: [
        { key: 'show-mtu', label: 'Show MTU', desc: 'Show MTU for all interfaces' },
        { key: 'set-mtu', label: 'Set MTU', desc: 'Set MTU on a named interface' },
        { key: 'tcp-global', label: 'TCP Global', desc: 'Show TCP global settings' },
        { key: 'set-autotune', label: 'Fix Autotuning', desc: 'Set TCP autotune to normal' },
        { key: 'ip-config', label: 'IP Config', desc: 'Show IPv4 configuration' },
        { key: 'wlan-if', label: 'WLAN Info', desc: 'Show wireless interface status' },
        { key: 'wlan-profiles', label: 'WLAN Profiles', desc: 'List saved WiFi profiles' },
        { key: 'firewall', label: 'Firewall Status', desc: 'Show all firewall profile states' },
        { key: 'reset-winsock', label: 'Reset Winsock', desc: 'Reset Winsock catalog (Admin)' },
        { key: 'reset-tcp', label: 'Reset TCP/IP', desc: 'Reset TCP/IP stack (Admin)' },
      ],
      params: [
        { key: 'iface', label: 'Interface Name', placeholder: 'eth0', type: 'text' },
        { key: 'mtu', label: 'MTU Value', placeholder: '1500', type: 'text' },
      ],
      examples: [
        { label: 'Show MTU (all)', options: { 'show-mtu': true } },
        { label: 'Set MTU 1500', options: { 'set-mtu': true, iface: 'eth0', mtu: '1500' } },
        { label: 'Set MTU 1400 (VPN)', options: { 'set-mtu': true, iface: 'eth0', mtu: '1400' } },
        { label: 'TCP Global Settings', options: { 'tcp-global': true } },
        { label: 'Fix Slow TCP', options: { 'set-autotune': true } },
        { label: 'Firewall Check', options: { firewall: true } },
        { label: 'WLAN Status', options: { 'wlan-if': true } },
        { label: 'Reset Network Stack', options: { 'reset-winsock': true } },
      ]
    }
  };

  const tools = os === 'linux' ? LINUX_TOOLS : WINDOWS_TOOLS;
  const tool = tools[toolId] || tools[Object.keys(tools)[0]];

  const toggleFlag = (f) => {
    setOptions(prev => {
      const n = {...prev};
      if (n[f]) delete n[f]; else n[f] = true;
      return n;
    });
  };

  const setParam = (p, val) => {
    setOptions(prev => ({...prev, [p]: val}));
  };

  const buildCmd = () => {
    let cmd = tool.name;

    // Windows route specific
    if (os === 'windows' && toolId === 'route') {
       if (options['-f']) cmd += ' -f';
       if (options['print']) cmd += ' print';
       else if (options['add']) {
          cmd += ' add';
          if (options['network']) cmd += ' ' + options['network'];
          if (options['mask']) cmd += ' mask ' + options['mask'];
          if (options['gateway']) cmd += ' ' + options['gateway'];
          if (options['metric']) cmd += ' metric ' + options['metric'];
          if (options['if']) cmd += ' if ' + options['if'];
       } else if (options['delete']) {
          cmd += ' delete';
          if (options['network']) cmd += ' ' + options['network'];
       }
       return cmd;
    }

    // Linux route specific
    if (os === 'linux' && toolId === 'route') {
       if (options['-n']) cmd += ' -n';
       if (options['add']) cmd += ' add';
       else if (options['del']) cmd += ' del';

       if (options['-net']) cmd += ' -net ' + options['-net'];
       if (options['netmask']) cmd += ' netmask ' + options['netmask'];
       if (options['gw']) cmd += ' gw ' + options['gw'];
       if (options['dev']) cmd += ' dev ' + options['dev'];
       return cmd;
    }

    // Linux ip route specific
    if (os === 'linux' && toolId === 'ip') {
       if (options['show']) cmd += ' show';
       else if (options['add']) cmd += ' add';
       else if (options['del']) cmd += ' del';

       if (options['to']) cmd += ' ' + options['to'];
       if (options['via']) cmd += ' via ' + options['via'];
       if (options['dev']) cmd += ' dev ' + options['dev'];
       return cmd;
    }

    // Linux nmtui specific
    if (os === 'linux' && toolId === 'nmtui') {
      const sub = options['edit'] ? 'edit' : options['connect'] ? 'connect' : options['hostname'] ? 'hostname' : null;
      let c = 'nmtui';
      if (sub) {
        c += ' ' + sub;
        if (sub === 'edit' && options['name']) c += ' "' + options['name'] + '"';
      }
      return c;
    }

    // Windows netsh specific
    if (os === 'windows' && toolId === 'netsh') {
      if (options['show-mtu']) return 'netsh interface ipv4 show subinterfaces';
      if (options['set-mtu']) {
        const iface = options['iface'] || 'eth0';
        const mtu = options['mtu'] || '1500';
        return `netsh interface ipv4 set subinterface "${iface}" mtu=${mtu} store=persistent`;
      }
      if (options['tcp-global']) return 'netsh int tcp show global';
      if (options['set-autotune']) return 'netsh int tcp set global autotuninglevel=normal';
      if (options['ip-config']) return 'netsh interface ipv4 show config';
      if (options['wlan-if']) return 'netsh wlan show interfaces';
      if (options['wlan-profiles']) return 'netsh wlan show profiles';
      if (options['firewall']) return 'netsh advfirewall show allprofiles';
      if (options['reset-winsock']) return 'netsh winsock reset';
      if (options['reset-tcp']) return 'netsh int ip reset';
      return 'netsh';
    }

    // Flags first
    (tool.flags || []).forEach(f => {
      if (options[f.key]) cmd += ' ' + f.key;
    });

    // Params
    (tool.params || []).forEach(p => {
      if (options[p.key]) {
        cmd += ' ' + p.key + (p.key.endsWith('=') ? '' : ' ') + options[p.key];
      }
    });

    // Target (if applicable)
    if (['hping3', 'iperf3', 'wget', 'curl', 'tracert', 'ping', 'nslookup'].includes(toolId)) {
       // iperf3 server doesn't need target
       if (toolId === 'iperf3' && options['-s']) {
          // no target
       } else {
          cmd += ' ' + target;
       }
    }

    return cmd;
  };

  const currentCmd = buildCmd();

  return (
    <div className="fadein">
      <div className="card">
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16}}>
           <div className="card-title" style={{marginBottom:0}}>{t('systools.platform')}</div>
           <div style={{display:'flex', gap:8}}>
             <button className={`btn btn-sm ${os==='linux'?'btn-primary':'btn-ghost'}`} onClick={()=>{setOs('linux'); setToolId('netstat'); setOptions({});}}>{t('systools.linux_tab', 'Linux')}</button>
             <button className={`btn btn-sm ${os==='windows'?'btn-primary':'btn-ghost'}`} onClick={()=>{setOs('windows'); setToolId('ipconfig'); setOptions({});}}>{t('systools.windows_tab', 'Windows')}</button>
           </div>
        </div>
      </div>

      <div className="grid-mobile-1" style={{display:'grid', gridTemplateColumns:'240px 1fr', gap:16}}>
        {/* Sidebar: Tool Selection */}
        <div className="card" style={{padding:12, overflow:'hidden', minHeight:0}}>
          <div className="card-title hide-mobile" style={{fontSize:10, marginBottom:8}}>{t('systools.select_utility')}</div>
          <div className="mobile-scroll-row" style={{display:'flex', flexDirection:'column', gap:2}}>
            {Object.keys(tools).map(id => (
              <div key={id}
                   className={`nav-item ${toolId===id?'active':''}`}
                   style={{margin:0, padding:'8px 10px', height: 'auto', flexShrink:0, borderRadius:6}}
                   onClick={() => {
                     setToolId(id);
                     const defs = {};
                     (tools[id].params || []).forEach(p => { if(p.default) defs[p.key] = p.default; });
                     setOptions(defs);
                     if (id === 'curl' || id === 'wget') setTarget('https://example.com/file');
                     else if (id === 'hping3' || id === 'iperf3' || id === 'tracert' || id === 'ping') setTarget('1.2.3.4');
                   }}>
                <div style={{display:'flex', flexDirection:'column', minWidth:80}}>
                  <span style={{fontWeight:600, fontSize:12}}>{t(`systools.tools.${os}.${id}.name`, tools[id].name)}</span>
                  <span className="hide-mobile" style={{fontSize:10, opacity:0.7, whiteSpace:"normal", lineHeight:"1.3"}}>{t(`systools.tools.${os}.${id}.desc`)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Main: Configuration */}
        <div style={{display:'flex', flexDirection:'column', gap:16, minWidth:0}}>
          <div className="card" style={{flex:1}}>
            <div className="card-title">{t('systools.options_for', { tool: tool.name })}</div>
   <div style={{fontSize:12, color:'var(--muted)', marginBottom:16}}>{t(`systools.tools.${os}.${toolId}.desc`)}</div>

            {['hping3', 'iperf3', 'wget', 'curl', 'tracert', 'ping', 'nslookup'].includes(toolId) && (
              <div className="field">
                <label className="label">{t('systools.target_label')}</label>
                <input className="input" value={target} onChange={e => setTarget(e.target.value)} placeholder={t('systools.target_placeholder')} />
              </div>
            )}

            {tool.examples && (
              <div style={{marginBottom:20}}>
                <div className="label" style={{marginBottom:10, display:'flex', alignItems:'center', gap:8}}>
                  {t('systools.presets')}
                  <span className="badge badge-primary" style={{fontSize:9}}>{t('systools.pro', 'PRO')}</span>
                </div>
                <div style={{display:'flex', flexWrap:'wrap', gap:8}}>
                  {tool.examples.map((ex, idx) => (
                    <button key={idx}
                            className="btn btn-ghost btn-sm"
                            style={{
                              border:'1px solid var(--border)',
                              fontSize:11,
                              background:'var(--panel)'
                            }}
                            onClick={() => {
                              const newOpts = {};
                              (tool.params || []).forEach(p => { if(p.default) newOpts[p.key] = p.default; });
                              setOptions({...newOpts, ...ex.options});
                            }}>
                      {t(`systools.tools.${os}.${toolId}.examples.${idx}.label`, ex.label)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {tool.flags && (
              <div style={{marginBottom:20}}>
                <div className="label" style={{marginBottom:10}}>{t('systools.flags')}</div>
                <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(180px, 1fr))', gap:10}}>
                  {tool.flags.map((f, idx) => (
                    <div key={f.key}
                         onClick={() => toggleFlag(f.key)}
                         style={{
                           display:'flex', alignItems:'center', gap:8, padding:'8px 10px', borderRadius:6, cursor:'pointer',
                           background: options[f.key] ? 'rgba(0, 212, 200, 0.1)' : 'var(--panel)',
                           border: `1px solid ${options[f.key] ? 'var(--cyan)' : 'var(--border)'}`,
                           transition: 'all 0.1s'
                         }}>
                      <div style={{width:14, height:14, borderRadius:3, border:'1px solid var(--dim)', background: options[f.key]?'var(--cyan)':'transparent', display:'flex', alignItems:'center', justifyContent:'center'}}>
                        {options[f.key] && <span style={{fontSize:10, color:'black'}}>✓</span>}
                      </div>
                      <div style={{display:'flex', flexDirection:'column'}}>
                        <code style={{fontSize:12, color:options[f.key]?'var(--cyan)':'var(--text)'}}>{f.key}</code>
                        <span style={{fontSize:10, color:'var(--muted)'}}>{t(`systools.tools.${os}.${toolId}.flags.${idx}.label`, f.label)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tool.params && (
              <div>
                <div className="label" style={{marginBottom:10}}>{t('systools.parameters')}</div>
                <div className="grid-mobile-1" style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
                  {tool.params.map((p, idx) => (
                    <div key={p.key} className="field" style={{marginBottom:0}}>
                      <div style={{display:'flex', justifyContent:'space-between', marginBottom:4}}>
                        <span className="label" style={{marginBottom:0}}>{t(`systools.tools.${os}.${toolId}.params.${idx}.label`, p.label)} <code style={{color:'var(--cyan)', fontSize:10}}>{p.key}</code></span>
                        {p.desc && <span style={{fontSize:10, color:'var(--dim)'}}>{t(`systools.tools.${os}.${toolId}.params.${idx}.desc`, p.desc)}</span>}
                      </div>
                      <input className="input"
                             value={options[p.key] || ''}
                             onChange={e => setParam(p.key, e.target.value)}
                             placeholder={p.placeholder ? t(`systools.tools.${os}.${toolId}.params.${idx}.placeholder`, p.placeholder) : p.default} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Command Preview Panel (Wireshark-like "Packet Details" style) */}
          <div className="card" style={{background:'var(--panel)', border:'1px solid var(--border)', padding:0, overflow:'hidden', boxShadow:'0 4px 12px rgba(0,0,0,0.1)'}}>
             <div style={{background:'rgba(0, 212, 200, 0.1)', padding:'6px 12px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                <div style={{fontSize:11, fontWeight:600, color:'var(--cyan)', textTransform:'uppercase', letterSpacing:1}}>{t('systools.generated')}</div>
                <CopyBtn text={currentCmd} label={t('systools.copy_clipboard')} id="cmd" />
             </div>
             <div style={{padding:20, fontFamily:'var(--mono)', fontSize:15, lineHeight:1.5, color:'var(--text)', position:'relative', wordBreak:'break-all'}}>
                <span style={{color:'var(--green)'}}>$</span> {currentCmd}
                <div style={{marginTop:12, paddingTop:12, borderTop:'1px dashed var(--border)', fontSize:12, color:'var(--muted)'}}>
                   # {t(`systools.tools.${os}.${toolId}.desc`, tool.desc)}
                </div>
             </div>
          </div>
        </div>
      </div>
      <style>{`
        @media (max-width: 768px) {
          .mobile-scroll-row {
            flex-direction: row !important;
            overflow-x: auto;
            padding-bottom: 8px;
          }
          .nav-item.active {
            border-bottom: 2px solid var(--cyan);
          }
        }
      `}</style>
    </div>
  );
}

window.SysToolBuilder = SysToolBuilder;

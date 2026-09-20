function ImageTransferPlanner({ initialData, onShare }) {
  const { t } = useTranslation();

  // State parameters
  const [imageSize, setImageSize] = usePersistentState('imagetransfer:imageSize', initialData?.imageSize ?? '150');
  const [protocol, setProtocol] = usePersistentState('imagetransfer:protocol', initialData?.protocol ?? 'scp');
  const [customOverhead, setCustomOverhead] = usePersistentState('imagetransfer:customOverhead', initialData?.customOverhead ?? '80');
  
  const [linkSpeed, setLinkSpeed] = usePersistentState('imagetransfer:linkSpeed', initialData?.linkSpeed ?? '100'); // in Mbps
  const [targetUtilization, setTargetUtilization] = usePersistentState('imagetransfer:targetUtilization', initialData?.targetUtilization ?? '85'); // %

  const [numDevices, setNumDevices] = usePersistentState('imagetransfer:numDevices', initialData?.numDevices ?? '10');
  const [concurrency, setConcurrency] = usePersistentState('imagetransfer:concurrency', initialData?.concurrency ?? '3');

  // Command parameters
  const [srvIp, setSrvIp] = usePersistentState('imagetransfer:srvIp', initialData?.srvIp ?? '10.1.1.5');
  const [srvVrf, setSrvVrf] = usePersistentState('imagetransfer:srvVrf', initialData?.srvVrf ?? '');
  const [srcFile, setSrcFile] = usePersistentState('imagetransfer:srcFile', initialData?.srcFile ?? 'c8000v-universalk9.17.09.04a.SPA.bin');
  const [dstFile, setDstFile] = usePersistentState('imagetransfer:dstFile', initialData?.dstFile ?? 'c8000v-universalk9.17.09.04a.SPA.bin');
  const [cliPlatform, setCliPlatform] = usePersistentState('imagetransfer:cliPlatform', initialData?.cliPlatform ?? 'iosxe');

  // Share URL synchronization
  useEffect(() => {
    const handle = (e) =>
      (e.detail?.respond ?? onShare)({
        tool: 'image-transfer-planner',
        imageSize,
        protocol,
        customOverhead,
        linkSpeed,
        targetUtilization,
        numDevices,
        concurrency,
        srvIp,
        srvVrf,
        srcFile,
        dstFile,
        cliPlatform
      });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [
    imageSize,
    protocol,
    customOverhead,
    linkSpeed,
    targetUtilization,
    numDevices,
    concurrency,
    srvIp,
    srvVrf,
    srcFile,
    dstFile,
    cliPlatform,
    onShare
  ]);

  // Protocol limits and overheads configuration
  const protocolMeta = {
    scp: { name: 'SCP', defaultEfficiency: 80, capMbps: null, notes: t('image_transfer_planner.proto_scp_notes') },
    sftp: { name: 'SFTP', defaultEfficiency: 75, capMbps: null, notes: t('image_transfer_planner.proto_sftp_notes') },
    tftp: { name: 'TFTP', defaultEfficiency: 40, capMbps: 3.5, notes: t('image_transfer_planner.proto_tftp_notes') },
    ftp: { name: 'FTP', defaultEfficiency: 90, capMbps: null, notes: t('image_transfer_planner.proto_ftp_notes') },
    http: { name: 'HTTP', defaultEfficiency: 95, capMbps: null, notes: t('image_transfer_planner.proto_http_notes') },
    https: { name: 'HTTPS', defaultEfficiency: 85, capMbps: null, notes: t('image_transfer_planner.proto_https_notes') }
  };

  // Adjust efficiency when protocol changes
  useEffect(() => {
    if (protocolMeta[protocol]) {
      setCustomOverhead(String(protocolMeta[protocol].defaultEfficiency));
    }
  }, [protocol]);

  // Calculations
  const sizeInMb = parseFloat(imageSize) || 0;
  const sizeInBits = sizeInMb * 8 * 1000 * 1000; // standard Mb
  const speedInMbps = parseFloat(linkSpeed) || 0;
  const targetUtilDec = (parseFloat(targetUtilization) || 100) / 100;
  const efficiencyDec = (parseFloat(customOverhead) || 100) / 100;

  // Max protocol limit
  const isTftp = protocol === 'tftp';
  const protocolCap = protocolMeta[protocol]?.capMbps;

  // Bandwidth allocation logic:
  // How much total bandwidth is available to this transfer planner on the link:
  const linkBwAvailable = speedInMbps * targetUtilDec;

  // Max transfer speed per device when transferring in parallel:
  // If we run multiple transfers in parallel, they share the available link bandwidth.
  // Throughput per device = min(protocolCap, linkBwAvailable / concurrency)
  let devThroughput = linkBwAvailable;
  if (concurrency > 0) {
    devThroughput = linkBwAvailable / concurrency;
  }
  if (protocolCap !== null && protocolCap < devThroughput) {
    devThroughput = protocolCap;
  }
  // Apply protocol efficiency to calculation
  devThroughput = devThroughput * efficiencyDec;

  // Time for 1 device (seconds)
  const timePerDeviceSec = devThroughput > 0 ? sizeInBits / (devThroughput * 1000000) : 0;

  // Total parallel bandwidth required on the link (in Mbps)
  // Total bandwidth = concurrency * (devThroughput / efficiencyDec)
  const singleDeviceMaxRawSpeed = protocolCap !== null ? Math.min(protocolCap, linkBwAvailable) : linkBwAvailable;
  const singleDeviceNominalSpeed = singleDeviceMaxRawSpeed * efficiencyDec;
  const singleDeviceTimeNominalSec = singleDeviceNominalSpeed > 0 ? sizeInBits / (singleDeviceNominalSpeed * 1000000) : 0;

  const totalRequiredBwMbps = Math.min(linkBwAvailable, concurrency * (devThroughput / efficiencyDec));

  // Fleet duration:
  // If we have N devices and C concurrency, total batches = ceil(N / C)
  const devicesCount = parseInt(numDevices) || 0;
  const concurrencyCount = parseInt(concurrency) || 1;
  const batches = concurrencyCount > 0 ? Math.ceil(devicesCount / concurrencyCount) : 0;
  const totalFleetTimeSec = batches * timePerDeviceSec;

  const formatTime = (seconds) => {
    if (isNaN(seconds) || seconds === Infinity || seconds <= 0) return '0s';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    let parts = [];
    if (hrs > 0) parts.push(`${hrs}h`);
    if (mins > 0 || hrs > 0) parts.push(`${mins}m`);
    parts.push(`${secs}s`);
    return parts.join(' ');
  };

  // Generate platform CLI commands
  const generateCommand = () => {
    const srv = srvIp.trim() || '10.1.1.5';
    const src = srcFile.trim() || 'firmware.bin';
    const dst = dstFile.trim() || 'firmware.bin';
    const vrfPart = srvVrf.trim() ? `vrf ${srvVrf.trim()}` : '';

    switch (cliPlatform) {
      case 'iosxe':
        return `${t('image_transfer_planner.cmd_iosxe')}\ncopy ${protocol}://${srv}/${src} flash:${dst}${srvVrf.trim() ? ` vrf ${srvVrf.trim()}` : ''}`;

      case 'iosxr':
        if (protocol === 'scp' || protocol === 'sftp') {
          return `${t('image_transfer_planner.cmd_iosxr_scp')}\ncopy ${protocol}://user@${srv}/${src} disk0:${dst}${srvVrf.trim() ? ` vrf ${srvVrf.trim()}` : ''}`;
        }
        return `${t('image_transfer_planner.cmd_iosxr')}\ncopy ${protocol}://${srv}/${src} disk0:${dst}${srvVrf.trim() ? ` vrf ${srvVrf.trim()}` : ''}`;

      case 'nxos':
        return `${t('image_transfer_planner.cmd_nxos')}\ncopy ${protocol}://${srv}/${src} bootflash:${dst}${srvVrf.trim() ? ` vrf ${srvVrf.trim()}` : ''}`;

      case 'junos':
        if (protocol === 'scp' || protocol === 'sftp') {
          return `${t('image_transfer_planner.cmd_junos')}\nfile copy scp://user@${srv}/${src} /var/tmp/${dst}`;
        }
        if (protocol === 'tftp') {
          return `${t('image_transfer_planner.cmd_junos_tftp')}\nfile copy tftp://${srv}/${src} /var/tmp/${dst}`;
        }
        return `${t('image_transfer_planner.cmd_junos')}\nfile copy ${protocol}://${srv}/${src} /var/tmp/${dst}`;

      case 'eos':
        return `${t('image_transfer_planner.cmd_eos')}\ncopy ${protocol}://${srv}/${src} flash:${dst}${srvVrf.trim() ? ` vrf ${srvVrf.trim()}` : ''}`;

      case 'fortios':
        if (protocol === 'tftp') {
          return `${t('image_transfer_planner.cmd_fortios_restore')}\nexecute restore image tftp ${src} ${srv}`;
        }
        if (protocol === 'ftp') {
          return `${t('image_transfer_planner.cmd_fortios_restore')}\nexecute restore image ftp ${src} ${srv} [user] [password]`;
        }
        return t('image_transfer_planner.cmd_fortios_note');

      case 'panos':
        if (protocol === 'scp') {
          return `> tftp import software from ${srv} file ${src}\n> scp import software to ${dst} from user@${srv}:${src}`;
        }
        return `> tftp import software from ${srv} file ${src}`;

      case 'linux':
        if (protocol === 'scp') {
          return `$ scp user@${srv}:${src} /tmp/${dst}`;
        }
        if (protocol === 'sftp') {
          return `$ sftp user@${srv}:${src} /tmp/${dst}`;
        }
        if (protocol === 'http' || protocol === 'https') {
          return `$ curl -L -o /tmp/${dst} ${protocol}://${srv}/${src}\n$ wget -O /tmp/${dst} ${protocol}://${srv}/${src}`;
        }
        if (protocol === 'tftp') {
          return `$ tftp -g -r ${src} ${srv}`;
        }
        return `${t('image_transfer_planner.cmd_linux')}\n${t('image_transfer_planner.cmd_linux_note')}`;

      case 'f5':
        return `${t('image_transfer_planner.cmd_f5')}\nscp user@${srv}:${src} /shared/images/${dst}`;

      case 'vrf_huawei':
        return `<Huawei> copy ${protocol}://${srv}/${src} flash:/${dst}`;

      default:
        return '';
    }
  };

  const getPlatformNotes = () => {
    switch (cliPlatform) {
      case 'iosxe':
        return t('image_transfer_planner.plat_iosxe_notes');
      case 'iosxr':
        return t('image_transfer_planner.plat_iosxr_notes');
      case 'nxos':
        return t('image_transfer_planner.plat_nxos_notes');
      case 'junos':
        return t('image_transfer_planner.plat_junos_notes');
      case 'eos':
        return t('image_transfer_planner.plat_eos_notes');
      case 'fortios':
        return t('image_transfer_planner.plat_fortios_notes');
      case 'panos':
        return t('image_transfer_planner.plat_panos_notes');
      case 'linux':
        return t('image_transfer_planner.plat_linux_notes');
      case 'f5':
        return t('image_transfer_planner.plat_f5_notes');
      default:
        return '';
    }
  };

  const [copiedCmd, copyCmd] = useCopy();

  return (
    <div className="fadein">
      <div className="card">
        <h2 className="card-title">{t('image_transfer_planner.title')}</h2>
        <p className="hint">{t('image_transfer_planner.subtitle')}</p>

        <div className="two-col">
          <div>
            <div className="card" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)' }}>
              <h3>{t('image_transfer_planner.image_settings')}</h3>
              <div className="two-col" style={{ gap: '0.75rem' }}>
                <div className="field">
                  <label className="label">{t('image_transfer_planner.image_size')}</label>
                  <input className="input" type="number" min="1" value={imageSize} onChange={e => setImageSize(e.target.value)} />
                </div>
                <div className="field">
                  <label className="label">{t('image_transfer_planner.protocol')}</label>
                  <select className="select" value={protocol} onChange={e => setProtocol(e.target.value)}>
                    <option value="scp">{t('image_transfer_planner.proto_scp')}</option>
                    <option value="sftp">{t('image_transfer_planner.proto_sftp')}</option>
                    <option value="tftp">{t('image_transfer_planner.proto_tftp')}</option>
                    <option value="ftp">{t('image_transfer_planner.proto_ftp')}</option>
                    <option value="http">{t('image_transfer_planner.proto_http')}</option>
                    <option value="https">{t('image_transfer_planner.proto_https')}</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <label className="label">{t('image_transfer_planner.custom_overhead')}</label>
                <input className="input" type="number" min="1" max="100" value={customOverhead} onChange={e => setCustomOverhead(e.target.value)} />
              </div>
            </div>

            <div className="card" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', marginTop: '1rem' }}>
              <h3>{t('image_transfer_planner.network_settings')}</h3>
              <div className="two-col" style={{ gap: '0.75rem' }}>
                <div className="field">
                  <label className="label">{t('image_transfer_planner.link_speed')} (Mbps)</label>
                  <input className="input" type="number" min="1" value={linkSpeed} onChange={e => setLinkSpeed(e.target.value)} />
                </div>
                <div className="field">
                  <label className="label">{t('image_transfer_planner.target_utilization')}</label>
                  <input className="input" type="number" min="1" max="100" value={targetUtilization} onChange={e => setTargetUtilization(e.target.value)} />
                </div>
              </div>
            </div>

            <div className="card" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', marginTop: '1rem' }}>
              <h3>{t('image_transfer_planner.fleet_settings')}</h3>
              <div className="two-col" style={{ gap: '0.75rem' }}>
                <div className="field">
                  <label className="label">{t('image_transfer_planner.num_devices')}</label>
                  <input className="input" type="number" min="1" value={numDevices} onChange={e => setNumDevices(e.target.value)} />
                </div>
                <div className="field">
                  <label className="label">{t('image_transfer_planner.concurrency')}</label>
                  <input className="input" type="number" min="1" value={concurrency} onChange={e => setConcurrency(e.target.value)} />
                </div>
              </div>
            </div>
          </div>

          <div>
            <div className="card" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', height: '100%' }}>
              <h3>{t('common.results')}</h3>
              
              <div className="result-grid" style={{ marginBottom: '1.5rem' }}>
                <ResultItem label={t('image_transfer_planner.single_device_time')} value={formatTime(singleDeviceTimeNominalSec)} />
                <ResultItem label={t('image_transfer_planner.time_per_device_fleet')} value={formatTime(timePerDeviceSec)} />
                <ResultItem label={t('image_transfer_planner.parallel_bw')} value={`${totalRequiredBwMbps.toFixed(1)} Mbps`} />
                <ResultItem label={t('image_transfer_planner.total_upgrade_time')} value={formatTime(totalFleetTimeSec)} />
              </div>

              <div style={{ padding: '0.75rem', background: 'rgba(0,212,200,0.05)', border: '1px solid rgba(0,212,200,0.2)', borderRadius: 'var(--spacing-radius)' }}>
                <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--primary)' }}>{t('image_transfer_planner.transfer_rates')}</h4>
                <p style={{ margin: 0, fontSize: '0.85rem' }}>
                  <strong>{protocolMeta[protocol]?.name}: </strong> {protocolMeta[protocol]?.notes}
                </p>
                {isTftp && (
                  <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.85rem', color: 'var(--warning)' }}>
                    ⚠ {t('image_transfer_planner.tftp_limit_info')}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Copy command section */}
        <div className="card" style={{ marginTop: '1.5rem', background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border)' }}>
          <h3>{t('image_transfer_planner.cli_copy_commands')}</h3>
          
          <div className="two-col" style={{ gap: '0.75rem', marginBottom: '1rem' }}>
            <div className="field">
              <label className="label">{t('image_transfer_planner.srv_ip')}</label>
              <input className="input" type="text" value={srvIp} onChange={e => setSrvIp(e.target.value)} />
            </div>
            <div className="field">
              <label className="label">{t('image_transfer_planner.srv_vrf')}</label>
              <input className="input" type="text" placeholder="Mgmt-intf" value={srvVrf} onChange={e => setSrvVrf(e.target.value)} />
            </div>
          </div>

          <div className="two-col" style={{ gap: '0.75rem', marginBottom: '1rem' }}>
            <div className="field">
              <label className="label">{t('image_transfer_planner.src_file')}</label>
              <input className="input" type="text" value={srcFile} onChange={e => setSrcFile(e.target.value)} />
            </div>
            <div className="field">
              <label className="label">{t('image_transfer_planner.dst_file')}</label>
              <input className="input" type="text" value={dstFile} onChange={e => setDstFile(e.target.value)} />
            </div>
          </div>

          <div className="field">
            <label className="label">{t('image_transfer_planner.cli_platform')}</label>
            <select className="select" value={cliPlatform} onChange={e => setCliPlatform(e.target.value)}>
              <option value="iosxe">{t('image_transfer_planner.plat_iosxe')}</option>
              <option value="iosxr">{t('image_transfer_planner.plat_iosxr')}</option>
              <option value="nxos">{t('image_transfer_planner.plat_nxos')}</option>
              <option value="junos">{t('image_transfer_planner.plat_junos')}</option>
              <option value="eos">{t('image_transfer_planner.plat_eos')}</option>
              <option value="fortios">{t('image_transfer_planner.plat_fortios')}</option>
              <option value="panos">{t('image_transfer_planner.plat_panos')}</option>
              <option value="linux">{t('image_transfer_planner.plat_linux')}</option>
              <option value="f5">{t('image_transfer_planner.plat_f5')}</option>
              <option value="vrf_huawei">{t('image_transfer_planner.plat_huawei')}</option>
            </select>
          </div>

          <div style={{ marginTop: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <label className="label" style={{ fontWeight: 'bold' }}>{t('image_transfer_planner.generated_command')}</label>
              <button className={`btn btn-sm ${copiedCmd ? 'btn-primary' : 'btn-ghost'}`} onClick={() => copyCmd(generateCommand())}>
                {copiedCmd ? `✓ ${t('common.copied')}` : t('common.copy')}
              </button>
            </div>
            <pre style={{
              fontFamily: 'var(--typography-mono)',
              fontSize: '0.85rem',
              background: 'rgba(0,0,0,0.3)',
              padding: '0.75rem',
              border: '1px solid var(--border)',
              borderRadius: 'var(--spacing-radius)',
              overflowX: 'auto',
              color: '#f8f8f2'
            }}>
              {generateCommand()}
            </pre>
          </div>

          <div style={{ marginTop: '1rem', fontSize: '0.85rem', color: 'var(--text-hint)' }}>
            <strong>{t('image_transfer_planner.platform_notes')}: </strong> {getPlatformNotes()}
          </div>
        </div>
      </div>
    </div>
  );
}

window.ImageTransferPlanner = ImageTransferPlanner;

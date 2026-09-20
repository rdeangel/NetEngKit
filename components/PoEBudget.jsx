const { useState, useEffect, useMemo } = React;

// ─── PoE Power Budget Calculator — IEEE 802.3af / at / bt ───────────────────

const POE_CLASSES = [
  { id: 'af1', watts: 4.0,  standard: '802.3af' },
  { id: 'af2', watts: 7.0,  standard: '802.3af' },
  { id: 'af3', watts: 15.4, standard: '802.3af' },
  { id: 'af0', watts: 15.4, standard: '802.3af' },
  { id: 'at4', watts: 30.0, standard: '802.3at' },
  { id: 'bt5', watts: 45.0, standard: '802.3bt' },
  { id: 'bt6', watts: 60.0, standard: '802.3bt' },
  { id: 'bt7', watts: 75.0, standard: '802.3bt' },
  { id: 'bt8', watts: 90.0, standard: '802.3bt' },
  { id: 'custom', watts: null, standard: '' },
];

// vendor field drives <optgroup> rendering
// All values confirmed from official vendor datasheets
const SWITCH_PRESETS = [
  { id: 'custom', label: '— Custom —', watts: null },
  { id: 'c9200_24p_s600',  vendor_id: 'cisco_cat_9200',  watts: 370  },
  { id: 'c9200_24p_d600',  vendor_id: 'cisco_cat_9200',  watts: 740  },
  { id: 'c9200_48p_s1k',   vendor_id: 'cisco_cat_9200',  watts: 740  },
  { id: 'c9200_48p_d1k',   vendor_id: 'cisco_cat_9200',  watts: 1440 },
  { id: 'c9200l_24p_s600', vendor_id: 'cisco_cat_9200',  watts: 370  },
  { id: 'c9200l_24p_d600', vendor_id: 'cisco_cat_9200',  watts: 740  },
  { id: 'c9200l_48p_s1k',  vendor_id: 'cisco_cat_9200',  watts: 740  },
  { id: 'c9200l_48p_d1k',  vendor_id: 'cisco_cat_9200',  watts: 1440 },
  { id: 'c9300_24p_715',   vendor_id: 'cisco_cat_9300',  watts: 445  },
  { id: 'c9300_24p_1100',  vendor_id: 'cisco_cat_9300',  watts: 720  },
  { id: 'c9300_48p_715',   vendor_id: 'cisco_cat_9300',  watts: 437  },
  { id: 'c9300_48p_1100',  vendor_id: 'cisco_cat_9300',  watts: 822  },
  { id: 'c9300_48uxm',     vendor_id: 'cisco_cat_9300',  watts: 490  },
  { id: 'c9300x_24hx',     vendor_id: 'cisco_cat_9300',  watts: 1535 },
  { id: 'c9300x_48hx',     vendor_id: 'cisco_cat_9300',  watts: 1390 },
  { id: 'c2960x_24pd_l',   vendor_id: 'cisco_cat_2960x', watts: 370 },
  { id: 'c2960x_48lpd_l',  vendor_id: 'cisco_cat_2960x', watts: 370 },
  { id: 'c2960x_48fpd_l',  vendor_id: 'cisco_cat_2960x', watts: 740 },
  { id: 'cbs350_8fp_2g',   vendor_id: 'cisco_cbs350',    watts: 120 },
  { id: 'cbs350_24p_4g',   vendor_id: 'cisco_cbs350',    watts: 195 },
  { id: 'cbs350_24fp_4g',  vendor_id: 'cisco_cbs350',    watts: 370 },
  { id: 'cbs350_48p_4g',   vendor_id: 'cisco_cbs350',    watts: 370 },
  { id: 'cbs350_48fp_4g',  vendor_id: 'cisco_cbs350',    watts: 740 },
  { id: 'ms120_8fp',   vendor_id: 'cisco_meraki',   watts: 124 },
  { id: 'ms120_24p',   vendor_id: 'cisco_meraki',   watts: 370 },
  { id: 'ms120_48fp',  vendor_id: 'cisco_meraki',   watts: 740 },
  { id: 'ms225_24p',   vendor_id: 'cisco_meraki',   watts: 370 },
  { id: 'ms225_48fp',  vendor_id: 'cisco_meraki',   watts: 740 },
  { id: 'ms250_24p',   vendor_id: 'cisco_meraki',   watts: 370 },
  { id: 'ms250_48fp',  vendor_id: 'cisco_meraki',   watts: 740 },
  { id: 'ms350_24p',   vendor_id: 'cisco_meraki',   watts: 370 },
  { id: 'ms350_48fp',  vendor_id: 'cisco_meraki',   watts: 740 },
  { id: 'ex2300_c_12p', vendor_id: 'juniper_ex',               watts: 124  },
  { id: 'ex2300_24p_s', vendor_id: 'juniper_ex',               watts: 370  },
  { id: 'ex2300_24p_d', vendor_id: 'juniper_ex',               watts: 740  },
  { id: 'ex2300_48p_s', vendor_id: 'juniper_ex',               watts: 740  },
  { id: 'ex3400_24p_s', vendor_id: 'juniper_ex',               watts: 370  },
  { id: 'ex3400_24p_d', vendor_id: 'juniper_ex',               watts: 720  },
  { id: 'ex3400_48p_s', vendor_id: 'juniper_ex',               watts: 740  },
  { id: 'ex3400_48p_d', vendor_id: 'juniper_ex',               watts: 1440 },
  { id: 'ex4300_24p_d', vendor_id: 'juniper_ex',               watts: 720  },
  { id: 'ex4300_48p_d', vendor_id: 'juniper_ex',               watts: 1440 },
  { id: 'usw_pro_24_poe',        vendor_id: 'ubiquiti_unifi',  watts: 400  },
  { id: 'usw_pro_48_poe',        vendor_id: 'ubiquiti_unifi',  watts: 600  },
  { id: 'usw_ent_24_poe',        vendor_id: 'ubiquiti_unifi',  watts: 400  },
  { id: 'usw_ent_48_poe',        vendor_id: 'ubiquiti_unifi',  watts: 720  },
  { id: 'css610_8p',  vendor_id: 'mikrotik',         watts: 140 },
  { id: 'crs328_24p', vendor_id: 'mikrotik',         watts: 450 },
  { id: 'crs354_48p', vendor_id: 'mikrotik',         watts: 750 },
  { id: 'a2530_8g',   vendor_id: 'aruba_2530',        watts: 67  },
  { id: 'a2530_24g',  vendor_id: 'aruba_2530',        watts: 195 },
  { id: 'a2530_48g',  vendor_id: 'aruba_2530',        watts: 382 },
  { id: 'a2930f_8g',  vendor_id: 'aruba_2930f',       watts: 125 },
  { id: 'a2930f_24g', vendor_id: 'aruba_2930f',       watts: 370 },
  { id: 'a2930f_48g_370', vendor_id: 'aruba_2930f',   watts: 370 },
  { id: 'a2930f_48g_740', vendor_id: 'aruba_2930f',   watts: 740 },
  { id: 'a2930m_24g_s', vendor_id: 'aruba_2930m',     watts: 370 },
  { id: 'a2930m_24g_d', vendor_id: 'aruba_2930m',     watts: 740 },
  { id: 'a2930m_48g_s', vendor_id: 'aruba_2930m',     watts: 370 },
  { id: 'a2930m_48g_d', vendor_id: 'aruba_2930m',     watts: 740 },
  { id: 'cx6000_12g', vendor_id: 'aruba_cx_6000',     watts: 139 },
  { id: 'cx6000_24g', vendor_id: 'aruba_cx_6000',     watts: 370 },
  { id: 'cx6000_48g_370', vendor_id: 'aruba_cx_6000', watts: 370 },
  { id: 'cx6000_48g_740', vendor_id: 'aruba_cx_6000', watts: 740 },
  { id: 'cx6100_12g', vendor_id: 'aruba_cx_6100',     watts: 139 },
  { id: 'cx6100_24g', vendor_id: 'aruba_cx_6100',     watts: 370 },
  { id: 'cx6100_48g_370', vendor_id: 'aruba_cx_6100', watts: 370 },
  { id: 'cx6100_48g_740', vendor_id: 'aruba_cx_6100', watts: 740 },
  { id: 'cx6200f_24g', vendor_id: 'aruba_cx_6200f',   watts: 370 },
  { id: 'cx6200f_48g', vendor_id: 'aruba_cx_6200f',   watts: 370 },
  { id: 'cx6300f_24g', vendor_id: 'aruba_cx_6300f',              watts: 370  },
  { id: 'cx6300f_48g', vendor_id: 'aruba_cx_6300f',              watts: 740  },
  { id: 'cx6300m_24g_680',  vendor_id: 'aruba_cx_6300m',         watts: 370  },
  { id: 'cx6300m_24g_1050', vendor_id: 'aruba_cx_6300m',         watts: 740  },
  { id: 'cx6300m_24g_c6',   vendor_id: 'aruba_cx_6300m',         watts: 1440 },
  { id: 'cx6300m_48g_680',  vendor_id: 'aruba_cx_6300m',         watts: 370  },
  { id: 'cx6300m_48g_1050', vendor_id: 'aruba_cx_6300m',         watts: 740  },
  { id: 'cx6300m_48g_1600', vendor_id: 'aruba_cx_6300m',         watts: 1440 },
  { id: 'cx6300m_48g_c6',   vendor_id: 'aruba_cx_6300m',         watts: 2880 },
  { id: 'cx4100i_12g_240', vendor_id: 'aruba_cx_4100i',       watts: 240 },
  { id: 'cx4100i_12g_480', vendor_id: 'aruba_cx_4100i',       watts: 480 },
  { id: 'cx4100i_24g_240', vendor_id: 'aruba_cx_4100i',       watts: 240 },
  { id: 'cx4100i_24g_480', vendor_id: 'aruba_cx_4100i',       watts: 480 },
  { id: 'ion1930_8g',      vendor_id: 'aruba_ion_1930',       watts: 124 },
  { id: 'ion1930_24g_195', vendor_id: 'aruba_ion_1930',       watts: 195 },
  { id: 'ion1930_24g_370', vendor_id: 'aruba_ion_1930',       watts: 370 },
  { id: 'ion1930_48g',     vendor_id: 'aruba_ion_1930',       watts: 370 },
  { id: 'ion1960_24g',     vendor_id: 'aruba_ion_1960',       watts: 370 },
  { id: 'ion1960_48g',     vendor_id: 'aruba_ion_1960',       watts: 600 },
];

// group field drives <optgroup> rendering
const DEVICE_PRESETS = [
  { id: 'custom', classId: 'custom', watts: null },
  { id: 'voip_handset',   group_id: 'phones', classId: 'af2', watts: 6.5  },
  { id: 'ip_desk_phone',  group_id: 'phones', classId: 'af3', watts: 10.0 },
  { id: 'conf_speaker',   group_id: 'phones', classId: 'af3', watts: 12.0 },
  { id: 'paging_speaker', group_id: 'phones', classId: 'af2', watts: 7.0  },
  { id: 'intercom',       group_id: 'phones', classId: 'af3', watts: 10.0 },
  { id: 'cam_sd',          group_id: 'cameras', classId: 'af2', watts: 7.0  },
  { id: 'cam_hd',          group_id: 'cameras', classId: 'af3', watts: 12.5 },
  { id: 'cam_ptz',         group_id: 'cameras', classId: 'at4', watts: 25.0 },
  { id: 'cam_ptz_heated',  group_id: 'cameras', classId: 'at4', watts: 30.0 },
  { id: 'cam_fisheye',     group_id: 'cameras', classId: 'af3', watts: 15.0 },
  { id: 'cam_lp',          group_id: 'cameras', classId: 'at4', watts: 20.0 },
  { id: 'cam_thermal',     group_id: 'cameras', classId: 'at4', watts: 30.0 },
  { id: 'wifi4',          group_id: 'wireless', classId: 'af3', watts: 12.95 },
  { id: 'wifi5',          group_id: 'wireless', classId: 'af3', watts: 15.4  },
  { id: 'wifi6',          group_id: 'wireless', classId: 'at4', watts: 25.0  },
  { id: 'wifi6e',         group_id: 'wireless', classId: 'at4', watts: 30.0  },
  { id: 'wifi6_multi',    group_id: 'wireless', classId: 'at4', watts: 30.0  },
  { id: 'outdoor_ap',     group_id: 'wireless', classId: 'at4', watts: 30.0  },
  { id: 'led_luminaire',      group_id: 'lighting', classId: 'af3', watts: 12.0 },
  { id: 'led_driver',         group_id: 'lighting', classId: 'at4', watts: 25.0 },
  { id: 'signage_small',      group_id: 'lighting', classId: 'at4', watts: 25.0 },
  { id: 'panel_clock',        group_id: 'lighting', classId: 'af2', watts: 5.0  },
  { id: 'card_reader',    group_id: 'access', classId: 'af2', watts: 5.0  },
  { id: 'biometric',      group_id: 'access', classId: 'af2', watts: 7.0  },
  { id: 'video_door',     group_id: 'access', classId: 'af3', watts: 15.0 },
  { id: 'electric_strike', group_id: 'access', classId: 'af2', watts: 7.0  },
  { id: 'thin_client',    group_id: 'iot', classId: 'af3', watts: 15.0 },
  { id: 'env_sensor',     group_id: 'iot', classId: 'af1', watts: 3.0  },
  { id: 'iot_gateway',    group_id: 'iot', classId: 'at4', watts: 20.0 },
  { id: 'barcode_station', group_id: 'iot', classId: 'af2', watts: 7.0  },
  { id: 'media_conv',     group_id: 'iot', classId: 'af3', watts: 13.0 },
  { id: 'charging_pad',      group_id: 'high_power', classId: 'bt5', watts: 30.0 },
  { id: 'ups_poe',           group_id: 'high_power', classId: 'bt6', watts: 60.0 },
  { id: 'small_cell',        group_id: 'high_power', classId: 'bt6', watts: 60.0 },
  { id: 'workstation',       group_id: 'high_power', classId: 'bt8', watts: 71.3 },
  { id: 'av_encoder',   group_id: 'av', classId: 'af3', watts: 15.0 },
  { id: 'av_panel',     group_id: 'av', classId: 'af3', watts: 10.0 },
  { id: 'av_amp',       group_id: 'av', classId: 'at4', watts: 28.0 },
  { id: 'av_ptz',       group_id: 'av', classId: 'at4', watts: 30.0 },
  { id: 'booking_panel',           group_id: 'building', classId: 'af3', watts: 10.0 },
  { id: 'kiosk_visitor',           group_id: 'building', classId: 'at4', watts: 20.0 },
  { id: 'emergency_call',          group_id: 'building', classId: 'af2', watts: 7.0  },
  { id: 'thermostat',              group_id: 'building', classId: 'af1', watts: 3.0  },
  { id: 'occupancy_sensor',        group_id: 'building', classId: 'af1', watts: 2.5  },
  { id: 'nurse_call',         group_id: 'healthcare', classId: 'af2', watts: 5.0  },
  { id: 'medical_display',    group_id: 'healthcare', classId: 'af3', watts: 15.0 },
  { id: 'patient_hub',        group_id: 'healthcare', classId: 'af3', watts: 12.0 },
  { id: 'medical_cart',       group_id: 'healthcare', classId: 'at4', watts: 25.0 },
  { id: 'pos_terminal',              group_id: 'retail', classId: 'af3', watts: 15.0 },
  { id: 'menu_board',                group_id: 'retail', classId: 'at4', watts: 25.0 },
  { id: 'kiosk_self',                group_id: 'retail', classId: 'at4', watts: 30.0 },
  { id: 'shelf_label',               group_id: 'retail', classId: 'af2', watts: 6.0  },
  { id: 'powered_router',   group_id: 'networking', classId: 'af3', watts: 12.0 },
  { id: 'firewall_cpe',     group_id: 'networking', classId: 'af3', watts: 15.0 },
  { id: 'media_conv_sfp',   group_id: 'networking', classId: 'af3', watts: 13.0 },
  { id: 'voip_gateway',     group_id: 'networking', classId: 'af3', watts: 12.0 },
  { id: 'time_server',      group_id: 'networking', classId: 'af3', watts: 10.0 },
  { id: 'vpn_concentrator', group_id: 'networking', classId: 'at4', watts: 20.0 },
  { id: 'cam_4k_ptz',              group_id: 'cameras_more', classId: 'at4', watts: 30.0 },
  { id: 'cam_panoramic',           group_id: 'cameras_more', classId: 'at4', watts: 30.0 },
  { id: 'cam_docking',             group_id: 'cameras_more', classId: 'at4', watts: 30.0 },
  { id: 'cam_explosion',           group_id: 'cameras_more', classId: 'at4', watts: 25.0 },
  { id: 'cam_outdoor',             group_id: 'cameras_more', classId: 'at4', watts: 20.0 },
  { id: 'cam_ir',                  group_id: 'cameras_more', classId: 'at4', watts: 25.0 },
  { id: 'cam_pinhole',             group_id: 'cameras_more', classId: 'af2', watts: 6.0  },
  { id: 'smart_lock',      group_id: 'smart_building', classId: 'af2', watts: 5.0  },
  { id: 'ceiling_speaker', group_id: 'smart_building', classId: 'af3', watts: 15.0 },
  { id: 'door_nameplate',  group_id: 'smart_building', classId: 'af2', watts: 5.0  },
  { id: 'wayfinding',      group_id: 'smart_building', classId: 'af3', watts: 15.0 },
  { id: 'window_shade',    group_id: 'smart_building', classId: 'af2', watts: 7.0  },
  { id: 'wall_clock',      group_id: 'smart_building', classId: 'af1', watts: 4.0  },
  { id: 'hvac_controller', group_id: 'smart_building', classId: 'af3', watts: 10.0 },
  { id: 'fan_controller',  group_id: 'smart_building', classId: 'af3', watts: 10.0 },
  { id: 'vehicle_sensor',   group_id: 'transportation', classId: 'af2', watts: 5.0  },
  { id: 'info_display',     group_id: 'transportation', classId: 'at4', watts: 25.0 },
  { id: 'pa_node',          group_id: 'transportation', classId: 'af3', watts: 15.0 },
  { id: 'parking_sensor',   group_id: 'transportation', classId: 'af1', watts: 3.0  },
  { id: 'serial_server',      group_id: 'industrial', classId: 'af2', watts: 7.0  },
  { id: 'io_module',          group_id: 'industrial', classId: 'af3', watts: 10.0 },
  { id: 'industrial_router',  group_id: 'industrial', classId: 'af3', watts: 15.0 },
  { id: 'edge_gateway',       group_id: 'industrial', classId: 'at4', watts: 20.0 },
  { id: 'poe_plc',            group_id: 'industrial', classId: 'at4', watts: 25.0 },
  { id: 'vibration_sensor',   group_id: 'industrial', classId: 'af1', watts: 2.0  },
];

// Build grouped <option> elements from a flat array with optional vendor/group field
function groupedOptions(items, labelFn, t) {
  const ungrouped = [];
  const groups = {};
  items.forEach((item, i) => {
    const g = item.vendor_id || item.group_id || '';
    if (!g) { ungrouped.push({ item, i }); }
    else { if (!groups[g]) groups[g] = []; groups[g].push({ item, i }); }
  });
  return [
    ...ungrouped.map(({ item, i }) => <option key={i} value={i}>{labelFn(item)}</option>),
    ...Object.entries(groups).map(([g, entries]) => {
      const gLabel = entries[0].item.vendor_id ? t(`poe_budget.vendors.${g}`) : t(`poe_budget.groups.${g}`);
      return (
        <optgroup key={g} label={gLabel}>
          {entries.map(({ item, i }) => <option key={i} value={i}>{labelFn(item)}</option>)}
        </optgroup>
      );
    }),
  ];
}

let _uid = 0;
const mkRow = (overrides) => ({ id: ++_uid, label: '', devicePreset: 0, classId: 'af3', customWatts: '', count: 1, ...overrides });

function PoEBudget({ initialData, onShare }) {
  const { t } = useTranslation();

  const [switchIdx, setSwitchIdx] = usePersistentState('poe:switchIdx', initialData?.switchIdx ?? 0);
  const [budget, setBudget] = usePersistentState('poe:budget', initialData?.budget ?? '370');
  const [rows, setRows] = usePersistentState('poe:rows', () => {
    if (initialData?.rows?.length) return initialData.rows.map(r => mkRow(r));
    return [mkRow(), mkRow(), mkRow()];
  });

  useEffect(() => {
    const handle = (e) =>
      (e.detail?.respond ?? onShare)({
        tool: 'poe-budget',
        switchIdx,
        budget,
        rows: rows.map(({ id: _id, ...rest }) => rest),
      });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [switchIdx, budget, rows, onShare]);

  const budgetW = parseFloat(budget) || 0;

  const computed = useMemo(() => rows.map(r => {
    const cls = POE_CLASSES.find(c => c.id === r.classId) || POE_CLASSES[2];
    const perPort = r.classId === 'custom' ? (parseFloat(r.customWatts) || 0) : cls.watts;
    const count = Math.max(1, parseInt(r.count, 10) || 1);
    return { ...r, perPort, subtotal: perPort * count };
  }), [rows]);

  const totalAllocated = useMemo(() => computed.reduce((s, r) => s + r.subtotal, 0), [computed]);
  const remaining = budgetW - totalAllocated;
  const pctRaw = budgetW > 0 ? (totalAllocated / budgetW) * 100 : 0;

  const statusColor = pctRaw > 95 ? 'var(--red)'
    : pctRaw > 80 ? 'var(--yellow)'
    : 'var(--green)';

  const updateRow = (id, field, value) =>
    setRows(rs => rs.map(r => r.id === id ? { ...r, [field]: value } : r));

  const applyDevicePreset = (id, idx) => {
    const p = DEVICE_PRESETS[idx];
    setRows(rs => rs.map(r => {
      if (r.id !== id) return r;
      const next = { ...r, devicePreset: idx };
      if (p.classId !== 'custom') {
        next.classId = p.classId;
        if (p.watts != null) next.customWatts = String(p.watts);
      }
      return next;
    }));
  };

  const handleSwitchPreset = (idx) => {
    setSwitchIdx(idx);
    const sw = SWITCH_PRESETS[idx];
    if (sw.watts != null) setBudget(String(sw.watts));
  };

  return (
    <div className="fadein">
      <h2 style={{ marginBottom: 4 }}>{t('poe_budget.title')}</h2>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 20 }}>{t('poe_budget.subtitle')}</p>

      {/* Switch / PSU setup */}
      <div className="card">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="field">
            <label className="label">{t('poe_budget.switch_model')}</label>
            <select
              className="select"
              value={switchIdx}
              onChange={e => handleSwitchPreset(Number(e.target.value))}
            >
              {groupedOptions(SWITCH_PRESETS, sw => {
                const label = sw.id === 'custom' ? t('poe_budget.switches.custom') : t(`poe_budget.switches.${sw.id}`);
                return sw.watts != null ? `${label} — ${sw.watts} W` : label;
              }, t)}
            </select>
          </div>
          <div className="field">
            <label className="label">{t('poe_budget.total_budget_w')}</label>
            <input
              className="input"
              type="number"
              min="0"
              value={budget}
              onChange={e => { setSwitchIdx(0); setBudget(e.target.value); }}
              placeholder="370"
            />
          </div>
        </div>
      </div>

      {/* Device / port rows */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span className="card-title" style={{ margin: 0 }}>{t('poe_budget.port_entries')}</span>
          <button
            onClick={() => setRows(rs => [...rs, mkRow()])}
            style={{ padding: '5px 14px', borderRadius: 'var(--radius)', border: '1px solid var(--blue)', background: 'transparent', color: 'var(--blue)', cursor: 'pointer', fontSize: 13 }}
          >
            + {t('poe_budget.add_row')}
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {[t('poe_budget.col_label'), t('poe_budget.col_device'), t('poe_budget.col_class'), t('poe_budget.col_watts_each'), t('poe_budget.col_count'), t('poe_budget.col_subtotal'), ''].map((h, i) => (
                  <th key={i} style={{ textAlign: i >= 3 && i <= 5 ? 'right' : 'left', padding: '6px 8px', color: 'var(--muted)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {computed.map((row) => (
                <tr key={row.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px' }}>
                    <input
                      className="input"
                      style={{ width: 110 }}
                      value={row.label}
                      onChange={e => updateRow(row.id, 'label', e.target.value)}
                      placeholder={t('poe_budget.port_label_ph')}
                    />
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <select
                      className="select"
                      style={{ width: 195 }}
                      value={row.devicePreset}
                      onChange={e => applyDevicePreset(row.id, Number(e.target.value))}
                    >
                      {groupedOptions(DEVICE_PRESETS, d => t(`poe_budget.devices.${d.id}`), t)}
                    </select>
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <select
                      className="select"
                      style={{ width: 195 }}
                      value={row.classId}
                      onChange={e => updateRow(row.id, 'classId', e.target.value)}
                    >
                      {POE_CLASSES.map(c => <option key={c.id} value={c.id}>{t(`poe_budget.classes.${c.id}`)}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                    {row.classId === 'custom' ? (
                      <input
                        className="input"
                        type="number"
                        min="0"
                        step="0.1"
                        style={{ width: 75, textAlign: 'right' }}
                        value={row.customWatts}
                        onChange={e => updateRow(row.id, 'customWatts', e.target.value)}
                        placeholder="W"
                      />
                    ) : (
                      <span style={{ fontFamily: 'var(--mono)' }}>{row.perPort.toFixed(1)} W</span>
                    )}
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                    <input
                      className="input"
                      type="number"
                      min="1"
                      max="999"
                      style={{ width: 62, textAlign: 'right' }}
                      value={row.count}
                      onChange={e => updateRow(row.id, 'count', e.target.value)}
                    />
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600 }}>
                    {row.subtotal.toFixed(1)} W
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    {rows.length > 1 && (
                      <button
                        onClick={() => setRows(rs => rs.filter(r => r.id !== row.id))}
                        title={t('poe_budget.remove_row')}
                        style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '2px 6px' }}
                      >×</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Disclaimer */}
      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.6 }}>
        {t('poe_budget.disclaimer')}
      </p>

      {/* Budget summary */}
      {budgetW > 0 && (
        <div className="card" style={{ borderColor: statusColor }}>
          <div className="card-title" style={{ color: statusColor }}>{t('poe_budget.budget_summary')}</div>

          <div style={{ background: 'var(--panel)', borderRadius: 6, height: 20, overflow: 'hidden', marginBottom: 16, position: 'relative' }}>
            <div style={{ width: `${Math.min(pctRaw, 100)}%`, height: '100%', background: statusColor, transition: 'width 0.25s ease', borderRadius: 6 }} />
            <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, fontWeight: 700, fontFamily: 'var(--mono)', color: pctRaw > 55 ? 'var(--bg)' : statusColor }}>
              {pctRaw.toFixed(1)}%
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
            {[
              { label: t('poe_budget.stat_budget'),      value: `${budgetW.toFixed(0)} W`,        color: 'var(--text)' },
              { label: t('poe_budget.stat_allocated'),   value: `${totalAllocated.toFixed(1)} W`, color: statusColor },
              { label: t('poe_budget.stat_remaining'),   value: `${remaining.toFixed(1)} W`,      color: remaining < 0 ? 'var(--red)' : 'var(--text)' },
              { label: t('poe_budget.stat_utilization'), value: `${pctRaw.toFixed(1)}%`,          color: statusColor },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: 'var(--panel)', borderRadius: 6, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--mono)', color }}>{value}</div>
              </div>
            ))}
          </div>

          {pctRaw > 100 && (
            <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid var(--red)', borderRadius: 6, fontSize: 13 }}>
              {t('poe_budget.warn_over_budget', { overage: (totalAllocated - budgetW).toFixed(1) })}
            </div>
          )}
          {pctRaw > 80 && pctRaw <= 100 && (
            <div style={{ padding: '10px 14px', background: 'rgba(245,158,11,0.1)', border: '1px solid var(--yellow)', borderRadius: 6, fontSize: 13, color: 'var(--yellow)' }}>
              {t('poe_budget.warn_high_util')}
            </div>
          )}
          {pctRaw > 0 && pctRaw <= 80 && (
            <div style={{ padding: '10px 14px', background: 'rgba(34,197,94,0.1)', border: '1px solid var(--green)', borderRadius: 6, fontSize: 13, color: 'var(--green)' }}>
              {t('poe_budget.ok_headroom', { headroom: (100 - pctRaw).toFixed(1) })}
            </div>
          )}

          <details style={{ marginTop: 16 }}>
            <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--muted)', userSelect: 'none', padding: '4px 0' }}>
              {t('poe_budget.class_reference')}
            </summary>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {[t('poe_budget.ref_class'), t('poe_budget.ref_standard'), t('poe_budget.ref_pse_max')].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--muted)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {POE_CLASSES.filter(c => c.id !== 'custom').map(c => (
                  <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '4px 8px' }}>{t(`poe_budget.classes.${c.id}`)}</td>
                    <td style={{ padding: '4px 8px', color: 'var(--muted)' }}>{c.standard}</td>
                    <td style={{ padding: '4px 8px', fontFamily: 'var(--mono)', fontWeight: 600 }}>{c.watts} W</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      )}
    </div>
  );
}

window.PoEBudget = PoEBudget;

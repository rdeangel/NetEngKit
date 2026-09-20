const { useState, useEffect, useCallback, useRef, useMemo } = React;

// ─── Cable Calculator — TIA-Compliant Signal Loss & Power Budget ────────────

const FIBER_TYPES = [
  // maxDist is a typical Ethernet reach for the type (not attenuation-limited).
  // SMF: km. MMF: metres (1000BASE-SX / 10GBASE-SR).
  { id:'os1', cat:'SMF', label:'OS1',        std:'ITU-T G.652',  atten:1.0,  attenByWl:{1310:1.0,1550:0.4},  maxDist:10,  maxDistUnit:'km', wavelength:[1310,1550], core:9,  jacket:'Yellow',  app:'Indoor / campus'},
  { id:'os2', cat:'SMF', label:'OS2',        std:'ITU-T G.652D/G.657', atten:0.4, attenByWl:{1310:0.4,1550:0.3}, maxDist:160, maxDistUnit:'km', wavelength:[1310,1550], core:9,  jacket:'Yellow',  app:'Long-haul / metro'},
  { id:'om1', cat:'MMF', label:'OM1',        std:'TIA-492AAAA',  atten:3.0,  maxDist:275, maxDistUnit:'m',  wavelength:[850],       core:62.5,jacket:'Orange', app:'Legacy 100BASE-FX / 1GbE'},
  { id:'om2', cat:'MMF', label:'OM2',        std:'TIA-492AAAB',  atten:3.0,  maxDist:550, maxDistUnit:'m',  wavelength:[850,1300],  core:50, jacket:'Orange', app:'1GbE short reach'},
  { id:'om3', cat:'MMF', label:'OM3',        std:'TIA-492AAAC',  atten:3.0,  maxDist:300, maxDistUnit:'m',  wavelength:[850],       core:50, jacket:'Aqua',    app:'10GbE (laser-optimized)'},
  { id:'om4', cat:'MMF', label:'OM4',        std:'TIA-492AAAD',  atten:3.0,  maxDist:400, maxDistUnit:'m',  wavelength:[850],       core:50, jacket:'Magenta', app:'10/40/100GbE'},
  { id:'om5', cat:'MMF', label:'OM5',        std:'TIA-492AAAE',  atten:3.0,  maxDist:400, maxDistUnit:'m',  wavelength:[850,953],   core:50, jacket:'Lime green', app:'10/25/40/100/400GbE SWDM'},
];

const COPPER_TYPES = [
  { id:'cat5e', label:'Cat 5e',  std:'TIA-568.2-D', bw:100,   maxDist:100, pairs:4, gauge:'24 AWG', app:'1GbE baseline', shield:'UTP/FTP'},
  { id:'cat6',  label:'Cat 6',   std:'TIA-568.2-D', bw:250,   maxDist:55,  pairs:4, gauge:'23 AWG', app:'1GbE / 10GbE (55 m)', shield:'UTP/FTP/STP'},
  { id:'cat6a', label:'Cat 6A',  std:'TIA-568.2-D', bw:500,   maxDist:100, pairs:4, gauge:'23 AWG', app:'10GbE full 100 m', shield:'FTP/STP/SFTP'},
  { id:'cat7',  label:'Cat 7',   std:'ISO 11801 Cl F',bw:600, maxDist:100, pairs:4, gauge:'22 AWG', app:'10GbE (GG45/TERA)', shield:'S/FTP'},
  { id:'cat8',  label:'Cat 8',   std:'TIA-568.2-D', bw:2000,  maxDist:30,  pairs:4, gauge:'22 AWG', app:'25G/40GBASE-T', shield:'S/FTP'},
];

const CONNECTORS = [
  { id:'sc',    label:'SC/APC',   loss:0.25, type:'fiber', polish:'APC', color:'Green',  app:'SMF PON / FTTx',                     fiberCat:['SMF'] },
  { id:'sc_upc',label:'SC/UPC',   loss:0.25, type:'fiber', polish:'UPC', color:'Blue',   app:'SMF/MMF backbone',                   fiberCat:['SMF','MMF'] },
  { id:'lc',    label:'LC/APC',   loss:0.25, type:'fiber', polish:'APC', color:'Green',  app:'SMF high-density',                   fiberCat:['SMF'] },
  { id:'lc_upc',label:'LC/UPC',   loss:0.25, type:'fiber', polish:'UPC', color:'Blue',   app:'SMF/MMF SFP transceivers',           fiberCat:['SMF','MMF'] },
  { id:'fc',    label:'FC/PC',    loss:0.50, type:'fiber', polish:'PC',  color:'',       app:'Test equipment / SMF',               fiberCat:['SMF'] },
  { id:'st',    label:'ST/PC',    loss:0.50, type:'fiber', polish:'PC',  color:'',       app:'Legacy MMF',                         fiberCat:['MMF'] },
  { id:'lc_simplex', label:'LC Simplex', loss:0.25, type:'fiber', polish:'UPC', color:'Blue', app:'BiDi / single-fiber WDM',            fiberCat:['SMF'] },
  { id:'mpo12', label:'MPO-12',   loss:0.50, type:'fiber', polish:'MP0', color:'',       app:'40/100GbE parallel optics',          fiberCat:['MMF'] },
  { id:'mpo16', label:'MPO-16',   loss:0.75, type:'fiber', polish:'MP0', color:'',       app:'400/800GbE octal optics',            fiberCat:['MMF'] },
  { id:'mpo24', label:'MPO-24',   loss:0.75, type:'fiber', polish:'MP0', color:'',       app:'100GbE SR10',                        fiberCat:['MMF'] },
  { id:'mpo32', label:'MPO-32',   loss:0.75, type:'fiber', polish:'MP0', color:'',       app:'400GbE SR16 (legacy)',               fiberCat:['MMF'] },
  { id:'rj45',  label:'RJ45',     loss:0.0,  type:'copper',polish:'',   color:'',       app:'Cat5e/6/6A/8 Ethernet',              fiberCat:[] },
  { id:'gg45',  label:'GG45',     loss:0.0,  type:'copper',polish:'',   color:'',       app:'Cat 7 backward-compat',              fiberCat:[] },
];

const SPLICE_TYPES = [
  { id:'fusion',     label:'Fusion Splice',   loss:0.05, app:'Single-mode / low-loss trunk'},
  { id:'mech',       label:'Mechanical Splice',loss:0.50, app:'Emergency repair / MMF'},
  { id:'connector',  label:'Connector (mated)',loss:0.50, app:'Patch panel / adapter'},
];

const ETHERNET_DISTANCE = [
  // 100M
  { standard:'100BASE-FX',      speed:'100 Mbps', fiber:'mmf_om1',  wl:1300, connector:'LC',     maxDist:'2 km'},
  { standard:'100BASE-LX10',    speed:'100 Mbps', fiber:'smf',      wl:1310, connector:'LC',     maxDist:'10 km'},
  // 1G
  { standard:'1000BASE-SX',     speed:'1 GbE',    fiber:'mmf_om1',  wl:850,  connector:'LC',     maxDist:'275 m'},
  { standard:'1000BASE-SX',     speed:'1 GbE',    fiber:'mmf_om2',  wl:850,  connector:'LC',     maxDist:'550 m'},
  { standard:'1000BASE-SX',     speed:'1 GbE',    fiber:'mmf_om3',  wl:850,  connector:'LC',     maxDist:'550 m'},
  { standard:'1000BASE-SX',     speed:'1 GbE',    fiber:'mmf_om4',  wl:850,  connector:'LC',     maxDist:'550 m'},
  { standard:'1000BASE-SX',     speed:'1 GbE',    fiber:'mmf_om5',  wl:850,  connector:'LC',     maxDist:'550 m'},
  { standard:'1000BASE-LX',     speed:'1 GbE',    fiber:'smf_os2',  wl:1310, connector:'LC',     maxDist:'5 km'},
  { standard:'1000BASE-LH',     speed:'1 GbE',    fiber:'smf_os2',  wl:1310, connector:'LC',     maxDist:'10 km',  note:'cisco_lh'},
  // 10G
  { standard:'10GBASE-SR',      speed:'10 GbE',   fiber:'mmf_om3',  wl:850,  connector:'LC',     maxDist:'300 m'},
  { standard:'10GBASE-SR',      speed:'10 GbE',   fiber:'mmf_om4',  wl:850,  connector:'LC',     maxDist:'400 m'},
  { standard:'10GBASE-SR',      speed:'10 GbE',   fiber:'mmf_om5',  wl:850,  connector:'LC',     maxDist:'400 m'},
  { standard:'10GBASE-LR',      speed:'10 GbE',   fiber:'smf_os2',  wl:1310, connector:'LC',     maxDist:'10 km'},
  { standard:'10GBASE-ER',      speed:'10 GbE',   fiber:'smf_os2',  wl:1550, connector:'LC',     maxDist:'40 km'},
  { standard:'10GBASE-ZR',      speed:'10 GbE',   fiber:'smf_os2',  wl:1550, connector:'LC',     maxDist:'80 km',  note:'oif_msa'},
  // 25G
  { standard:'25GBASE-SR',      speed:'25 GbE',   fiber:'mmf_om3',  wl:850,  connector:'LC',     maxDist:'70 m'},
  { standard:'25GBASE-SR',      speed:'25 GbE',   fiber:'mmf_om4',  wl:850,  connector:'LC',     maxDist:'100 m'},
  { standard:'25GBASE-SR',      speed:'25 GbE',   fiber:'mmf_om5',  wl:850,  connector:'LC',     maxDist:'100 m'},
  { standard:'25GBASE-LR',      speed:'25 GbE',   fiber:'smf_os2',  wl:1310, connector:'LC',     maxDist:'10 km'},
  // 40G
  { standard:'40GBASE-SR4',     speed:'40 GbE',   fiber:'mmf_om3',  wl:850,  connector:'MPO-12', maxDist:'100 m'},
  { standard:'40GBASE-SR4',     speed:'40 GbE',   fiber:'mmf_om4',  wl:850,  connector:'MPO-12', maxDist:'150 m'},
  { standard:'40GBASE-SR4',     speed:'40 GbE',   fiber:'mmf_om5',  wl:850,  connector:'MPO-12', maxDist:'150 m'},
  { standard:'40GBASE-LR4',     speed:'40 GbE',   fiber:'smf_os2',  wl:1310, connector:'LC',     maxDist:'10 km'},
  { standard:'40GBASE-ER4',     speed:'40 GbE',   fiber:'smf_os2',  wl:1310, connector:'LC',     maxDist:'40 km'},
  // 100G
  { standard:'100G-SR1.2 BiDi', speed:'100 GbE',  fiber:'mmf_om3',  wl:850,  connector:'LC',     maxDist:'100 m',  note:'cisco_bidi'},
  { standard:'100G-SR1.2 BiDi', speed:'100 GbE',  fiber:'mmf_om4',  wl:850,  connector:'LC',     maxDist:'150 m',  note:'cisco_bidi'},
  { standard:'100G-SR1.2 BiDi', speed:'100 GbE',  fiber:'mmf_om5',  wl:850,  connector:'LC',     maxDist:'150 m',  note:'cisco_bidi'},
  { standard:'100GBASE-SR10',   speed:'100 GbE',  fiber:'mmf_om3',  wl:850,  connector:'MPO-24', maxDist:'100 m'},
  { standard:'100GBASE-SR10',   speed:'100 GbE',  fiber:'mmf_om4',  wl:850,  connector:'MPO-24', maxDist:'150 m'},
  { standard:'100GBASE-SR4',    speed:'100 GbE',  fiber:'mmf_om3',  wl:850,  connector:'MPO-12', maxDist:'70 m'},
  { standard:'100GBASE-SR4',    speed:'100 GbE',  fiber:'mmf_om4',  wl:850,  connector:'MPO-12', maxDist:'100 m'},
  { standard:'100GBASE-SR4',    speed:'100 GbE',  fiber:'mmf_om5',  wl:850,  connector:'MPO-12', maxDist:'100 m'},
  { standard:'100GBASE-DR',     speed:'100 GbE',  fiber:'smf_os2',  wl:1310, connector:'LC',     maxDist:'500 m'},
  { standard:'100GBASE-CWDM4',  speed:'100 GbE',  fiber:'smf_os2',  wl:1310, connector:'LC',     maxDist:'2 km',   note:'cwdm4_msa'},
  { standard:'100GBASE-FR',     speed:'100 GbE',  fiber:'smf_os2',  wl:1310, connector:'LC',     maxDist:'2 km'},
  { standard:'100GBASE-LR4',    speed:'100 GbE',  fiber:'smf_os2',  wl:1310, connector:'LC',     maxDist:'10 km'},
  { standard:'100GBASE-ER4',    speed:'100 GbE',  fiber:'smf_os2',  wl:1310, connector:'LC',     maxDist:'40 km',  note:'er4_reach'},
  { standard:'100GBASE-ER',     speed:'100 GbE',  fiber:'smf_os2',  wl:1550, connector:'LC',     maxDist:'40 km',  note:'msa'},
  { standard:'100GBASE-ZR',     speed:'100 GbE',  fiber:'smf_os2',  wl:1550, connector:'LC',     maxDist:'80 km',  note:'openzr'},
  { standard:'100G-PSM4',       speed:'100 GbE',  fiber:'smf_os2',  wl:1310, connector:'MPO-12', maxDist:'500 m',  note:'msa'},
  // 200G
  { standard:'200GBASE-SR4',    speed:'200 GbE',  fiber:'mmf_om3',  wl:850,  connector:'MPO-12', maxDist:'70 m'},
  { standard:'200GBASE-SR4',    speed:'200 GbE',  fiber:'mmf_om4',  wl:850,  connector:'MPO-12', maxDist:'100 m'},
  { standard:'200GBASE-SR4',    speed:'200 GbE',  fiber:'mmf_om5',  wl:850,  connector:'MPO-12', maxDist:'100 m'},
  { standard:'200GBASE-LR4',    speed:'200 GbE',  fiber:'smf_os2',  wl:1310, connector:'LC',     maxDist:'10 km'},
  // 400G
  { standard:'400GBASE-SR16',   speed:'400 GbE',  fiber:'mmf_om4',  wl:850,  connector:'MPO-32', maxDist:'100 m',  note:'legacy'},
  { standard:'400GBASE-SR8',    speed:'400 GbE',  fiber:'mmf_om3',  wl:850,  connector:'MPO-16', maxDist:'70 m'},
  { standard:'400GBASE-SR8',    speed:'400 GbE',  fiber:'mmf_om4',  wl:850,  connector:'MPO-16', maxDist:'100 m'},
  { standard:'400GBASE-SR8',    speed:'400 GbE',  fiber:'mmf_om5',  wl:850,  connector:'MPO-16', maxDist:'100 m'},
  { standard:'400GBASE-SR4',    speed:'400 GbE',  fiber:'mmf_om3',  wl:850,  connector:'MPO-12', maxDist:'60 m'},
  { standard:'400GBASE-SR4',    speed:'400 GbE',  fiber:'mmf_om4',  wl:850,  connector:'MPO-12', maxDist:'100 m'},
  { standard:'400GBASE-SR4',    speed:'400 GbE',  fiber:'mmf_om5',  wl:850,  connector:'MPO-12', maxDist:'100 m'},
  { standard:'400GBASE-DR4',    speed:'400 GbE',  fiber:'smf_os2',  wl:1310, connector:'MPO-12', maxDist:'500 m'},
  { standard:'400GBASE-FR4',    speed:'400 GbE',  fiber:'smf_os2',  wl:1310, connector:'LC',     maxDist:'2 km'},
  { standard:'400GBASE-LR4',    speed:'400 GbE',  fiber:'smf_os2',  wl:1310, connector:'LC',     maxDist:'10 km'},
  { standard:'400GBASE-LR8',    speed:'400 GbE',  fiber:'smf_os2',  wl:1310, connector:'LC',     maxDist:'10 km'},
  { standard:'400GBASE-ER4',    speed:'400 GbE',  fiber:'smf_os2',  wl:1310, connector:'LC',     maxDist:'40 km',  note:'msa'},
  { standard:'400GBASE-ER8',    speed:'400 GbE',  fiber:'smf_os2',  wl:1310, connector:'LC',     maxDist:'40 km'},
  { standard:'400G-FR4',        speed:'400 GbE',  fiber:'smf_os2',  wl:1310, connector:'LC',     maxDist:'2 km',   note:'oif_msa'},
  { standard:'400G-ZR',         speed:'400 GbE',  fiber:'smf_os2',  wl:1550, connector:'LC',     maxDist:'80 km',  note:'openzr'},
  // 800G
  { standard:'800GBASE-SR8',    speed:'800 GbE',  fiber:'mmf_om3',  wl:850,  connector:'MPO-16', maxDist:'60 m'},
  { standard:'800GBASE-SR8',    speed:'800 GbE',  fiber:'mmf_om4',  wl:850,  connector:'MPO-16', maxDist:'100 m'},
  { standard:'800GBASE-SR8',    speed:'800 GbE',  fiber:'mmf_om5',  wl:850,  connector:'MPO-16', maxDist:'100 m'},
  { standard:'800GBASE-DR8',    speed:'800 GbE',  fiber:'smf_os2',  wl:1310, connector:'MPO-16', maxDist:'500 m'},
  // Copper
  { standard:'25GBASE-T',       speed:'25 GbE',   copper:'copper_cat8',     connector:'RJ45',    maxDist:'30 m'},
  { standard:'40GBASE-T',       speed:'40 GbE',   copper:'copper_cat8',     connector:'RJ45',    maxDist:'30 m'},
  // Legacy / Historical
  { standard:'1000BASE-ZX',     speed:'1 GbE',    fiber:'smf_os2',  wl:1550, connector:'LC',          maxDist:'80 km',  note:'msa',      legacy:true },
  { standard:'10GBASE-LRM',     speed:'10 GbE',   fiber:'mmf_om1',  wl:1310, connector:'LC',          maxDist:'220 m',                   legacy:true },
  { standard:'10GBASE-LRM',     speed:'10 GbE',   fiber:'mmf_om2',  wl:1310, connector:'LC',          maxDist:'220 m',                   legacy:true },
  { standard:'10GBASE-LRM',     speed:'10 GbE',   fiber:'mmf_om3',  wl:1310, connector:'LC',          maxDist:'220 m',                   legacy:true },
  { standard:'10GBASE-LX4',     speed:'10 GbE',   fiber:'mmf_om1',  wl:1310, connector:'SC',          maxDist:'300 m',                   legacy:true },
  { standard:'10GBASE-LX4',     speed:'10 GbE',   fiber:'mmf_om2',  wl:1310, connector:'SC',          maxDist:'300 m',                   legacy:true },
  { standard:'10GBASE-LX4',     speed:'10 GbE',   fiber:'smf_os2',  wl:1310, connector:'SC',          maxDist:'10 km',                   legacy:true },
  { standard:'1000BASE-BX10-U', speed:'1 GbE',    fiber:'smf_os2',  wl:1310, connector:'LC Simplex',  maxDist:'10 km',                   legacy:true },
  { standard:'1000BASE-BX10-D', speed:'1 GbE',    fiber:'smf_os2',  wl:1490, connector:'LC Simplex',  maxDist:'10 km',                   legacy:true },
  { standard:'100BASE-FX',      speed:'100 Mbps', fiber:'mmf_om2',  wl:1300, connector:'LC',          maxDist:'2 km',                    legacy:true },
  { standard:'GBIC 1000BASE-SX',speed:'1 GbE',    fiber:'mmf_om1',  wl:850,  connector:'SC',          maxDist:'275 m',                   legacy:true },
  { standard:'GBIC 1000BASE-SX',speed:'1 GbE',    fiber:'mmf_om2',  wl:850,  connector:'SC',          maxDist:'550 m',                   legacy:true },
  { standard:'GBIC 1000BASE-SX',speed:'1 GbE',    fiber:'mmf_om3',  wl:850,  connector:'SC',          maxDist:'550 m',                   legacy:true },
  { standard:'GBIC 1000BASE-SX',speed:'1 GbE',    fiber:'mmf_om4',  wl:850,  connector:'SC',          maxDist:'550 m',                   legacy:true },
  { standard:'GBIC 1000BASE-SX',speed:'1 GbE',    fiber:'mmf_om5',  wl:850,  connector:'SC',          maxDist:'550 m',                   legacy:true },
  { standard:'GBIC 1000BASE-LX',speed:'1 GbE',    fiber:'smf_os2',  wl:1310, connector:'SC',          maxDist:'5 km',                    legacy:true },
  { standard:'OC-3/STM-1 IR-1', speed:'155 Mbps', fiber:'smf_os2',  wl:1310, connector:'SC',          maxDist:'15 km',  note:'itu_g957', legacy:true },
  { standard:'OC-12/STM-4 SR-1',speed:'622 Mbps', fiber:'smf_os2',  wl:1310, connector:'SC',          maxDist:'2 km',   note:'itu_g957', legacy:true },
  { standard:'OC-12/STM-4 LR-1',speed:'622 Mbps', fiber:'smf_os2',  wl:1310, connector:'SC',          maxDist:'40 km',  note:'itu_g957', legacy:true },
];

const TX_RX_POWER = [
  // 100M
  { std:'100BASE-FX',    formFactor:'SFP',     connector:'LC/UPC',  breakout:'',            txMin:-20,   txMax:-14,  rxMin:-31,   rxMax:-14,  wl:1300, fiberCompat:['om1','om2'] },
  { std:'100BASE-LX10',  formFactor:'SFP',     connector:'LC/UPC',  breakout:'',            txMin:-15,   txMax:-8,   rxMin:-26,   rxMax:-8,   wl:1310, fiberCompat:['os1','os2'] },
  // 1G
  { std:'1000BASE-SX',   formFactor:'SFP',     connector:'LC/UPC',  breakout:'',            txMin:-9.5,  txMax:-4,   rxMin:-17,   rxMax:0,    wl:850,  fiberCompat:['om1','om2','om3','om4','om5'] },
  { std:'1000BASE-LX',   formFactor:'SFP',     connector:'LC/UPC',  breakout:'',            txMin:-11.5, txMax:-3,   rxMin:-19,   rxMax:-3,   wl:1310, fiberCompat:['os1','os2'] },
  { std:'1000BASE-LH',   formFactor:'SFP',     connector:'LC/UPC',  breakout:'',            txMin:-9.5,  txMax:-3,   rxMin:-20,   rxMax:-3,   wl:1310, fiberCompat:['os1','os2'], note:'cisco_lh' },
  // 10G
  { std:'10GBASE-SR',    formFactor:'SFP+',    connector:'LC/UPC',  breakout:'',            txMin:-7.3,  txMax:-1,   rxMin:-11.1, rxMax:0,    wl:850,  fiberCompat:['om3','om4','om5'] },
  { std:'10GBASE-LR',    formFactor:'SFP+',    connector:'LC/UPC',  breakout:'',            txMin:-8.2,  txMax:0.5,  rxMin:-14.4, rxMax:0.5,  wl:1310, fiberCompat:['os1','os2'] },
  { std:'10GBASE-ER',    formFactor:'SFP+',    connector:'LC/UPC',  breakout:'',            txMin:-4.7,  txMax:4.0,  rxMin:-15.2, rxMax:-1,   wl:1550, fiberCompat:['os1','os2'] },
  { std:'10GBASE-ZR',    formFactor:'SFP+',    connector:'LC/UPC',  breakout:'',            txMin:0,     txMax:4.0,  rxMin:-23,   rxMax:-1,   wl:1550, fiberCompat:['os1','os2'] },
  // 25G
  { std:'25GBASE-SR',    formFactor:'SFP28',   connector:'LC/UPC',  breakout:'',            txMin:-8.4,  txMax:-1,   rxMin:-11.1, rxMax:0,    wl:850,  fiberCompat:['om3','om4','om5'] },
  { std:'25GBASE-LR',    formFactor:'SFP28',   connector:'LC/UPC',  breakout:'',            txMin:-8.4,  txMax:2.3,  rxMin:-13.4, rxMax:2.3,  wl:1310, fiberCompat:['os1','os2'] },
  // 40G
  { std:'40GBASE-SR4',   formFactor:'QSFP+',   connector:'MPO-12',  breakout:'4x10g_sr',    txMin:-7.6,  txMax:2.4,  rxMin:-9.5,  rxMax:2.4,  wl:850,  fiberCompat:['om3','om4','om5'] },
  { std:'40GBASE-LR4',   formFactor:'QSFP+',   connector:'LC/UPC',  breakout:'',            txMin:-7.2,  txMax:2.6,  rxMin:-13.7, rxMax:2.6,  wl:1310, fiberCompat:['os1','os2'] },
  { std:'40GBASE-ER4',   formFactor:'QSFP+',   connector:'LC/UPC',  breakout:'',            txMin:-4.7,  txMax:4.0,  rxMin:-16,   rxMax:-1,   wl:1310, fiberCompat:['os1','os2'], note:'msa' },
  // 100G Cisco MSA
  { std:'100G-SR1.2 BiDi',formFactor:'QSFP28', connector:'LC/UPC',  breakout:'',            txMin:-8.4,  txMax:2.3,  rxMin:-9.5,  rxMax:2.3,  wl:850,  fiberCompat:['om3','om4','om5'] },
  // 100G IEEE
  { std:'100GBASE-SR10',  formFactor:'CXP',     connector:'MPO-24',  breakout:'',            txMin:-7.6,  txMax:2.4,  rxMin:-9.5,  rxMax:2.4,  wl:850,  fiberCompat:['om3','om4'] },
  { std:'100GBASE-SR4',   formFactor:'QSFP28',  connector:'MPO-12',  breakout:'4x25g_sr',    txMin:-8.4,  txMax:2.4,  rxMin:-9.5,  rxMax:2.4,  wl:850,  fiberCompat:['om3','om4','om5'] },
  { std:'100GBASE-DR',    formFactor:'QSFP28',  connector:'LC/UPC',  breakout:'',            txMin:-6,    txMax:0,    rxMin:-12.2, rxMax:0,    wl:1310, fiberCompat:['os1','os2'] },
  { std:'100GBASE-CWDM4', formFactor:'QSFP28',  connector:'LC/UPC',  breakout:'',            txMin:-7,    txMax:2,    rxMin:-11,   rxMax:4,    wl:1310, fiberCompat:['os1','os2'] },
  { std:'100GBASE-FR',    formFactor:'QSFP28',  connector:'LC/UPC',  breakout:'',            txMin:-6,    txMax:0,    rxMin:-12.2, rxMax:0,    wl:1310, fiberCompat:['os1','os2'] },
  { std:'100GBASE-LR4',   formFactor:'QSFP28',  connector:'LC/UPC',  breakout:'',            txMin:-4.3,  txMax:4.3,  rxMin:-10.6, rxMax:4.3,  wl:1310, fiberCompat:['os1','os2'] },
  { std:'100GBASE-ER4',   formFactor:'QSFP28',  connector:'LC/UPC',  breakout:'',            txMin:-4.3,  txMax:4.3,  rxMin:-12.6, rxMax:4.3,  wl:1310, fiberCompat:['os1','os2'] },
  { std:'100GBASE-ER',    formFactor:'QSFP28',  connector:'LC/UPC',  breakout:'',            txMin:-1,    txMax:4,    rxMin:-22,   rxMax:-1,   wl:1550, fiberCompat:['os1','os2'], note:'msa' },
  { std:'100GBASE-ZR',    formFactor:'QSFP28',  connector:'LC/UPC',  breakout:'',            txMin:0,     txMax:4,    rxMin:-23,   rxMax:-1,   wl:1550, fiberCompat:['os2'], note:'msa' },
  // 100G MSA
  { std:'100G-PSM4',      formFactor:'QSFP28',  connector:'MPO-12',  breakout:'4x25g_smf',   txMin:-7.5,  txMax:2.5,  rxMin:-13,   rxMax:2.5,  wl:1310, fiberCompat:['os1','os2'] },
  // 200G IEEE
  { std:'200GBASE-SR4',   formFactor:'QSFP56',  connector:'MPO-12',  breakout:'4x50g_sr',    txMin:-8.4,  txMax:2.4,  rxMin:-9.5,  rxMax:2.4,  wl:850,  fiberCompat:['om3','om4','om5'] },
  { std:'200GBASE-LR4',   formFactor:'QSFP56',  connector:'LC/UPC',  breakout:'',            txMin:-4.3,  txMax:4.3,  rxMin:-10.6, rxMax:4.3,  wl:1310, fiberCompat:['os1','os2'] },
  // 400G IEEE
  { std:'400GBASE-SR16',  formFactor:'OSFP',    connector:'MPO-32',  breakout:'',            txMin:-7.6,  txMax:2.4,  rxMin:-9.5,  rxMax:2.4,  wl:850,  fiberCompat:['om4'], note:'legacy' },
  { std:'400GBASE-SR8',   formFactor:'QSFP-DD', connector:'MPO-16',  breakout:'8x50g_sr',    txMin:-8.4,  txMax:2.4,  rxMin:-9.5,  rxMax:2.4,  wl:850,  fiberCompat:['om3','om4','om5'] },
  { std:'400GBASE-DR4',   formFactor:'QSFP-DD', connector:'MPO-12',  breakout:'4x100g_dr',   txMin:-6,    txMax:0,    rxMin:-12.2, rxMax:0,    wl:1310, fiberCompat:['os1','os2'] },
  { std:'400GBASE-FR4',   formFactor:'QSFP-DD', connector:'LC/UPC',  breakout:'',            txMin:-7,    txMax:2,    rxMin:-11,   rxMax:4,    wl:1310, fiberCompat:['os1','os2'] },
  { std:'400GBASE-LR4',   formFactor:'QSFP-DD', connector:'LC/UPC',  breakout:'',            txMin:-4,    txMax:4,    rxMin:-10.6, rxMax:4.3,  wl:1310, fiberCompat:['os1','os2'] },
  { std:'400GBASE-LR8',   formFactor:'QSFP-DD', connector:'LC/UPC',  breakout:'',            txMin:-4,    txMax:4,    rxMin:-10.6, rxMax:4.3,  wl:1310, fiberCompat:['os1','os2'] },
  { std:'400GBASE-ER4',   formFactor:'QSFP-DD', connector:'LC/UPC',  breakout:'',            txMin:-4.3,  txMax:4.3,  rxMin:-12.6, rxMax:4.3,  wl:1310, fiberCompat:['os1','os2'], note:'msa' },
  { std:'400GBASE-ER8',   formFactor:'QSFP-DD', connector:'LC/UPC',  breakout:'',            txMin:-4.3,  txMax:4.3,  rxMin:-12.6, rxMax:4.3,  wl:1310, fiberCompat:['os1','os2'], note:'msa' },
  // 400G IEEE — SR4 (802.3db-2022, 4-lane PAM4 850nm; TX/RX per-lane est. from comparable SR standards — verify datasheet)
  { std:'400GBASE-SR4',   formFactor:'QSFP-DD', connector:'MPO-12',  breakout:'4x100g_sr',   txMin:-8.4,  txMax:2.4,  rxMin:-9.5,  rxMax:2.4,  wl:850,  fiberCompat:['om3','om4','om5'], note:'verify_spec' },
  // 400G MSA
  { std:'400G-FR4',       formFactor:'QSFP-DD', connector:'LC/UPC',  breakout:'',            txMin:-7,    txMax:2,    rxMin:-11,   rxMax:4,    wl:1310, fiberCompat:['os1','os2'] },
  { std:'400G-ZR',        formFactor:'QSFP-DD', connector:'LC/UPC',  breakout:'',            txMin:-10,   txMax:0,    rxMin:-27,   rxMax:-5,   wl:1550, fiberCompat:['os2'] },
  // 800G IEEE (802.3df-2024; TX/RX per-lane est. from comparable 400G SR/DR standards — verify datasheet)
  { std:'800GBASE-SR8',   formFactor:'QSFP-DD', connector:'MPO-16',  breakout:'8x100g_sr',   txMin:-8.4,  txMax:2.4,  rxMin:-9.5,  rxMax:2.4,  wl:850,  fiberCompat:['om3','om4','om5'], note:'verify_spec' },
  { std:'800GBASE-DR8',   formFactor:'QSFP-DD', connector:'MPO-16',  breakout:'8x100g_dr',   txMin:-6,    txMax:0,    rxMin:-12.2, rxMax:0,    wl:1310, fiberCompat:['os2'],             note:'verify_spec' },
  // Legacy / Historical
  { std:'1000BASE-ZX',    formFactor:'SFP',     connector:'LC/UPC',  breakout:'',            txMin:0,     txMax:5,    rxMin:-21,   rxMax:-3,   wl:1550, fiberCompat:['os1','os2'], note:'msa',      legacy:true },
  { std:'1000BASE-BX10-U',formFactor:'SFP',     connector:'LC Simplex',breakout:'',          txMin:-9,    txMax:-3,   rxMin:-19.5, rxMax:-3,   wl:'1310↑/1490↓', fiberCompat:['os1','os2'],       legacy:true },
  { std:'1000BASE-BX10-D',formFactor:'SFP',     connector:'LC Simplex',breakout:'',          txMin:-9,    txMax:-3,   rxMin:-19.5, rxMax:-3,   wl:'1490↑/1310↓', fiberCompat:['os1','os2'],       legacy:true },
  { std:'10GBASE-LRM',    formFactor:'SFP+',    connector:'LC/UPC',  breakout:'',            txMin:-6.5,  txMax:0.5,  rxMin:-10.3, rxMax:0.5,  wl:1310, fiberCompat:['om1','om2','om3'],          legacy:true },
  { std:'10GBASE-LX4',    formFactor:'XENPAK/X2',connector:'SC/UPC', breakout:'',            txMin:-8.2,  txMax:0.5,  rxMin:-14.4, rxMax:0.5,  wl:1310, fiberCompat:['om1','om2','os1','os2'],    legacy:true, note:'verify_spec' },
  { std:'GBIC 1000BASE-SX',formFactor:'GBIC',   connector:'SC/UPC',  breakout:'',            txMin:-9.5,  txMax:-4,   rxMin:-17,   rxMax:0,    wl:850,  fiberCompat:['om1','om2','om3','om4','om5'], legacy:true },
  { std:'GBIC 1000BASE-LX',formFactor:'GBIC',   connector:'SC/UPC',  breakout:'',            txMin:-11.5, txMax:-3,   rxMin:-19,   rxMax:-3,   wl:1310, fiberCompat:['os1','os2'],                legacy:true },
  { std:'OC-3/STM-1 IR-1', formFactor:'SFP',    connector:'SC/UPC',  breakout:'',            txMin:-15,   txMax:-8,   rxMin:-28,   rxMax:-8,   wl:1310, fiberCompat:['os1','os2'], note:'itu_g957', legacy:true },
  { std:'OC-12/STM-4 SR-1',formFactor:'SFP',    connector:'SC/UPC',  breakout:'',            txMin:-15,   txMax:-8,   rxMin:-23,   rxMax:-8,   wl:1310, fiberCompat:['os1','os2'], note:'itu_g957', legacy:true },
  { std:'OC-12/STM-4 LR-1',formFactor:'SFP',    connector:'SC/UPC',  breakout:'',            txMin:-3,    txMax:2,    rxMin:-28,   rxMax:0,    wl:1310, fiberCompat:['os1','os2'], note:'itu_g957', legacy:true },
];

// IEEE amendment references — link each standard to its defining document.
// MSA/vendor entries have no IEEE URL; consult the relevant MSA organisation.
const IEEE_SPEC_REFS = {
  '100BASE-FX':        { ieee:'802.3u',        url:'https://standards.ieee.org/ieee/802.3u/' },
  '100BASE-LX10':      { ieee:'802.3ah',       url:'https://standards.ieee.org/ieee/802.3ah/' },
  '1000BASE-SX':       { ieee:'802.3z',        url:'https://standards.ieee.org/ieee/802.3z/' },
  '1000BASE-LX':       { ieee:'802.3z',        url:'https://standards.ieee.org/ieee/802.3z/' },
  '1000BASE-LH':       { ieee:'Cisco Prop.',   url:'' },
  '10GBASE-SR':        { ieee:'802.3ae',       url:'https://standards.ieee.org/ieee/802.3ae/' },
  '10GBASE-LR':        { ieee:'802.3ae',       url:'https://standards.ieee.org/ieee/802.3ae/' },
  '10GBASE-ER':        { ieee:'802.3ae',       url:'https://standards.ieee.org/ieee/802.3ae/' },
  '10GBASE-ZR':        { ieee:'OIF MSA',       url:'' },
  '25GBASE-SR':        { ieee:'802.3by',       url:'https://standards.ieee.org/ieee/802.3by/' },
  '25GBASE-LR':        { ieee:'802.3cc',       url:'https://standards.ieee.org/ieee/802.3cc/' },
  '25GBASE-T':         { ieee:'802.3bq',       url:'https://standards.ieee.org/ieee/802.3bq/' },
  '40GBASE-SR4':       { ieee:'802.3ba',       url:'https://standards.ieee.org/ieee/802.3ba/' },
  '40GBASE-LR4':       { ieee:'802.3ba',       url:'https://standards.ieee.org/ieee/802.3ba/' },
  '40GBASE-ER4':       { ieee:'802.3ba',       url:'https://standards.ieee.org/ieee/802.3ba/' },
  '40GBASE-T':         { ieee:'802.3bq',       url:'https://standards.ieee.org/ieee/802.3bq/' },
  '100G-SR1.2 BiDi':   { ieee:'Cisco MSA',     url:'https://www.cisco.com/c/en/us/products/collateral/interfaces-modules/transceiver-modules/datasheet-c78-736282.html' },
  '100GBASE-SR10':     { ieee:'802.3ba',       url:'https://standards.ieee.org/ieee/802.3ba/' },
  '100GBASE-SR4':      { ieee:'802.3bm',       url:'https://standards.ieee.org/ieee/802.3bm/' },
  '100GBASE-DR':       { ieee:'802.3cu',       url:'https://standards.ieee.org/ieee/802.3cu/' },
  '100GBASE-CWDM4':    { ieee:'CWDM4 MSA',     url:'' },
  '100GBASE-FR':       { ieee:'802.3cu',       url:'https://standards.ieee.org/ieee/802.3cu/' },
  '100GBASE-LR4':      { ieee:'802.3ba',       url:'https://standards.ieee.org/ieee/802.3ba/' },
  '100GBASE-ER4':      { ieee:'802.3ba',       url:'https://standards.ieee.org/ieee/802.3ba/' },
  '100GBASE-ER':       { ieee:'MSA',           url:'' },
  '100GBASE-ZR':       { ieee:'OpenZR+',       url:'' },
  '100G-PSM4':         { ieee:'PSM4 MSA',      url:'' },
  '200GBASE-SR4':      { ieee:'802.3cd',       url:'https://standards.ieee.org/ieee/802.3cd/' },
  '200GBASE-LR4':      { ieee:'802.3cd',       url:'https://standards.ieee.org/ieee/802.3cd/' },
  '400GBASE-SR16':     { ieee:'802.3bs',       url:'https://standards.ieee.org/ieee/802.3bs/' },
  '400GBASE-SR8':      { ieee:'802.3cm',       url:'https://standards.ieee.org/ieee/802.3cm/' },
  '400GBASE-SR4':      { ieee:'802.3db',       url:'https://standards.ieee.org/ieee/802.3db/' },
  '400GBASE-DR4':      { ieee:'802.3bs',       url:'https://standards.ieee.org/ieee/802.3bs/' },
  '400GBASE-FR4':      { ieee:'802.3cu',       url:'https://standards.ieee.org/ieee/802.3cu/' },
  '400GBASE-LR4':      { ieee:'802.3cu',       url:'https://standards.ieee.org/ieee/802.3cu/' },
  '400GBASE-LR8':      { ieee:'802.3bs',       url:'https://standards.ieee.org/ieee/802.3bs/' },
  '400GBASE-ER4':      { ieee:'MSA',           url:'' },
  '400GBASE-ER8':      { ieee:'802.3cn',       url:'https://standards.ieee.org/ieee/802.3cn/' },
  '400G-FR4':          { ieee:'OIF MSA',       url:'' },
  '400G-ZR':           { ieee:'OpenZR+',       url:'' },
  '800GBASE-SR8':      { ieee:'802.3df',       url:'https://standards.ieee.org/ieee/802.3df/' },
  '800GBASE-DR8':      { ieee:'802.3df',       url:'https://standards.ieee.org/ieee/802.3df/' },
  // Legacy
  '1000BASE-ZX':       { ieee:'MSA',           url:'' },
  '10GBASE-LRM':       { ieee:'802.3aq',       url:'https://standards.ieee.org/ieee/802.3aq/' },
  '10GBASE-LX4':       { ieee:'802.3ae',       url:'https://standards.ieee.org/ieee/802.3ae/' },
  '1000BASE-BX10-U':   { ieee:'802.3ah',       url:'https://standards.ieee.org/ieee/802.3ah/' },
  '1000BASE-BX10-D':   { ieee:'802.3ah',       url:'https://standards.ieee.org/ieee/802.3ah/' },
  'GBIC 1000BASE-SX':  { ieee:'802.3z',        url:'https://standards.ieee.org/ieee/802.3z/' },
  'GBIC 1000BASE-LX':  { ieee:'802.3z',        url:'https://standards.ieee.org/ieee/802.3z/' },
  'OC-3/STM-1 IR-1':   { ieee:'ITU-T G.957',   url:'' },
  'OC-12/STM-4 SR-1':  { ieee:'ITU-T G.957',   url:'' },
  'OC-12/STM-4 LR-1':  { ieee:'ITU-T G.957',   url:'' },
};

function CableCalculator({ onShare, initialData, onNav }) {
  const { t } = useTranslation();
  const [tab, setTab] = usePersistentState('cable:tab', initialData?.tab ?? 'fiber');
  const [fiberType, setFiberType] = usePersistentState('cable:fiberType', initialData?.fiberType ?? '');
  const [distance, setDistance] = usePersistentState('cable:distance', initialData?.distance ?? '10');
  const [distanceUnit, setDistanceUnit] = usePersistentState('cable:distanceUnit', initialData?.distanceUnit ?? 'km');
  const [numConnectors, setNumConnectors] = usePersistentState('cable:numConnectors', initialData?.numConnectors ?? '4');
  const [connectorType, setConnectorType] = usePersistentState('cable:connectorType', initialData?.connectorType ?? '');
  const [connectorLoss, setConnectorLoss] = usePersistentState('cable:connectorLoss', initialData?.connectorLoss ?? '0.25');
  const [numSplices, setNumSplices] = usePersistentState('cable:numSplices', initialData?.numSplices ?? '2');
  const [spliceLoss, setSpliceLoss] = usePersistentState('cable:spliceLoss', initialData?.spliceLoss ?? '0.05');
  const [safetyMargin, setSafetyMargin] = usePersistentState('cable:safetyMargin', initialData?.safetyMargin ?? '3');
  const [txPower, setTxPower] = usePersistentState('cable:txPower', initialData?.txPower ?? '-1');
  const [rxSens, setRxSens] = usePersistentState('cable:rxSens', initialData?.rxSens ?? '-14');
  const [copperType, setCopperType] = usePersistentState('cable:copperType', initialData?.copperType ?? 'cat6a');
  const [copperDist, setCopperDist] = usePersistentState('cable:copperDist', initialData?.copperDist ?? '100');
  const [refTab, setRefTab] = usePersistentState('cable:refTab', 'fiber');
  const [sfpPreset, setSfpPreset] = usePersistentState('cable:sfpPreset', initialData?.sfpPreset ?? '');
  const [txrxSearch, setTxrxSearch] = useState('');
  const [ethdistSearch, setEthdistSearch] = useState('');
  const [fiberRefSearch, setFiberRefSearch] = useState('');
  const [copperRefSearch, setCopperRefSearch] = useState('');
  const [connSearch, setConnSearch] = useState('');
  const skipNavReport = useRef(false);

  useEffect(() => {
    if (!initialData) return;
    if (initialData.tab && initialData.tab !== tab) {
      skipNavReport.current = true;
      setTab(initialData.tab);
    }
    if (initialData.refTab && initialData.refTab !== refTab) {
      skipNavReport.current = true;
      setRefTab(initialData.refTab);
    }
    if (initialData.fiberType) setFiberType(initialData.fiberType);
    if (initialData.distance) setDistance(initialData.distance);
    if (initialData.numConnectors) setNumConnectors(initialData.numConnectors);
    if (initialData.connectorType) setConnectorType(initialData.connectorType);
    if (initialData.connectorLoss) setConnectorLoss(initialData.connectorLoss);
    if (initialData.numSplices) setNumSplices(initialData.numSplices);
    if (initialData.spliceLoss) setSpliceLoss(initialData.spliceLoss);
    if (initialData.safetyMargin) setSafetyMargin(initialData.safetyMargin);
    if (initialData.txPower) setTxPower(initialData.txPower);
    if (initialData.rxSens) setRxSens(initialData.rxSens);
    if (initialData.copperType) setCopperType(initialData.copperType);
    if (initialData.copperDist) setCopperDist(initialData.copperDist);
    if (initialData.sfpPreset) setSfpPreset(initialData.sfpPreset);
  }, [initialData]);

  useEffect(() => {
    if (skipNavReport.current) { skipNavReport.current = false; return; }
    onNav?.({ tab, refTab });
  }, [tab, refTab]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      (e.detail?.respond ?? onShare)({
        tool:'cable', tab, fiberType, distance, distanceUnit, numConnectors,
        connectorType, connectorLoss, numSplices, spliceLoss, safetyMargin, txPower, rxSens,
        copperType, copperDist, sfpPreset
      });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [tab,fiberType,distance,distanceUnit,numConnectors,connectorType,connectorLoss,numSplices,spliceLoss,safetyMargin,txPower,rxSens,copperType,copperDist,sfpPreset,onShare]);

  const handleResetFilters = () => {
    setFiberType('');
    setConnectorType('');
    setSfpPreset('');
    setConnectorLoss('0.25');
    setTxPower('-1');
    setRxSens('-14');
  };

  const handleResetValues = () => {
    setDistance('10');
    setDistanceUnit('km');
    setNumConnectors('4');
    setConnectorLoss('0.25');
    setNumSplices('2');
    setSpliceLoss('0.05');
    setSafetyMargin('3');
    setTxPower('-1');
    setRxSens('-14');
  };

  // Fiber calculations
  const selectedFiber = fiberType ? (FIBER_TYPES.find(f => f.id === fiberType) || null) : null;

  // ── SFP presets: show all when no fiber selected, filter otherwise
  const filteredSfpPresets = useMemo(() => {
    let list = TX_RX_POWER;
    if (fiberType) list = list.filter(p => p.fiberCompat.includes(fiberType));
    if (connectorType) {
      const conn = CONNECTORS.find(c => c.id === connectorType);
      if (conn) list = list.filter(p => p.connector === conn.label);
    }
    return list;
  }, [fiberType, connectorType]);

  // Reset SFP preset when fiber type or connector type changes and current preset is no longer valid
  useEffect(() => {
    if (sfpPreset) {
      const stillValid = filteredSfpPresets.find(p => p.std === sfpPreset);
      if (!stillValid) setSfpPreset('');
    }
  }, [fiberType, connectorType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Recommended connector & splice hints based on fiber category
  const fiberCat = selectedFiber?.cat;
  const connHint = !fiberCat ? ''
    : fiberCat === 'SMF'
      ? t('cable.conn_hint_smf', 'Recommended: LC/APC (0.15 dB) or LC/UPC (0.25 dB) for single-mode links')
      : fiberType === 'om3' || fiberType === 'om4' || fiberType === 'om5'
        ? t('cable.conn_hint_mmf_parallel', 'For parallel optics (40/100GbE), MPO-12 (0.50 dB) is standard. For 400G+ octal, MPO-16 (0.75 dB). Otherwise LC/UPC (0.25 dB).')
        : t('cable.conn_hint_mmf', 'Recommended: LC/UPC (0.25 dB) or SC/UPC (0.25 dB) for multimode links');
  const spliceHint = !fiberCat ? ''
    : fiberCat === 'SMF'
      ? t('cable.splice_hint_smf', 'Fusion splice (0.05 dB) is standard for SMF trunk runs — avoids back-reflection')
      : t('cable.splice_hint_mmf', 'Fusion (0.05 dB) preferred; mechanical (0.50 dB) acceptable for short MMF runs / field repair');
  // Map fiberType id → ETHERNET_DISTANCE.fiber key
  const fiberToEthKey = { os1:'smf', os2:'smf_os2', om1:'mmf_om1', om2:'mmf_om2', om3:'mmf_om3', om4:'mmf_om4', om5:'mmf_om5' };

  const getEthMaxDist = (std, fType) => {
    const fiberKey = fiberToEthKey[fType];
    let match = fiberKey ? ETHERNET_DISTANCE.find(r => r.standard === std && r.fiber === fiberKey) : null;
    // OS1 → OS2 fallback
    if (!match && fiberKey === 'smf') match = ETHERNET_DISTANCE.find(r => r.standard === std && r.fiber === 'smf_os2');
    // Last resort: any entry for this standard (same standard, any fiber)
    if (!match) match = ETHERNET_DISTANCE.find(r => r.standard === std);
    if (!match) return null;
    const raw = match.maxDist.trim();
    if (raw.endsWith('km')) return { value: String(parseFloat(raw)), unit: 'km' };
    if (raw.endsWith('m')) return { value: String(parseFloat(raw)), unit: 'm' };
    return null;
  };

  const ethDistLimit = useMemo(() => {
    if (!sfpPreset || !fiberType) return null;
    const fiberKey = fiberToEthKey[fiberType];
    let match = ETHERNET_DISTANCE.find(r => r.standard === sfpPreset && r.fiber === fiberKey);
    if (!match && fiberKey === 'smf') match = ETHERNET_DISTANCE.find(r => r.standard === sfpPreset && r.fiber === 'smf_os2');
    if (!match) return null;
    const raw = match.maxDist.trim();
    if (raw.endsWith('km')) return parseFloat(raw) * 1000;
    if (raw.endsWith('m')) return parseFloat(raw);
    return null;
  }, [sfpPreset, fiberType]);

  const distKm = distanceUnit === 'm' ? parseFloat(distance)/1000 : parseFloat(distance) || 0;
  const distMeters = distanceUnit === 'm' ? parseFloat(distance) : parseFloat(distance) * 1000;
  const exceedsEthLimit = ethDistLimit !== null && !isNaN(distMeters) && distMeters > ethDistLimit;
  const selectedPresetData = sfpPreset ? TX_RX_POWER.find(p => p.std === sfpPreset) : null;
  const presetWl = selectedPresetData?.wl;
  const effectiveAtten = selectedFiber
    ? ((presetWl && selectedFiber.attenByWl?.[presetWl]) || selectedFiber.atten)
    : 0;
  const cableLoss = selectedFiber ? distKm * effectiveAtten : 0;
  const connLossTotal = (parseInt(numConnectors)||0) * (parseFloat(connectorLoss)||0);
  const spliceLossTotal = (parseInt(numSplices)||0) * (parseFloat(spliceLoss)||0);
  const totalLinkLoss = cableLoss + connLossTotal + spliceLossTotal;
  const linkLossWithMargin = totalLinkLoss + (parseFloat(safetyMargin)||0);
  const powerBudget = (parseFloat(txPower)||0) - (parseFloat(rxSens)||0);
  const linkMargin = powerBudget - linkLossWithMargin;
  const maxDistByBudget = selectedFiber && effectiveAtten > 0 && powerBudget > linkLossWithMargin - cableLoss
    ? ((powerBudget - connLossTotal - spliceLossTotal - (parseFloat(safetyMargin)||0)) / effectiveAtten)
    : 0;
  const maxDistByBudgetDisplay = distanceUnit === 'm' ? (maxDistByBudget * 1000).toFixed(0) : maxDistByBudget.toFixed(2);

  // Copper calculations
  const selectedCopper = COPPER_TYPES.find(c => c.id === copperType) || COPPER_TYPES[2];
  const copperDistNum = parseFloat(copperDist) || 0;
  const copperWithinSpec = copperDistNum <= selectedCopper.maxDist;
  // Approximate insertion loss for copper: 0.2 dB/m * 0.01 = dB per m (simplified model)
  const copperLossPer100m = { cat5e:2.0, cat6:2.0, cat6a:2.0, cat7:2.0, cat8:3.0 };
  const copperTotalLoss = (copperLossPer100m[copperType]||2.0) * (copperDistNum/100);
  // NEXT / Return loss reference
  const copperSpecs = {
    cat5e:{next:35.3,rl:12,il:2.0},
    cat6:{next:39.9,rl:15,il:2.0},
    cat6a:{next:39.9,rl:15,il:2.0},
    cat7:{next:51,rl:19.5,il:2.0},
    cat8:{next:51,rl:19.5,il:3.0},
  };

  const tabs = [
    { id:'fiber',  label: t('cable.tab_fiber', 'Fiber Loss Budget') },
    { id:'copper', label: t('cable.tab_copper', 'Copper Calculator') },
    { id:'ref',    label: t('cable.tab_ref', 'Reference Tables') },
  ];

  return (
    <div className="fadein">
      {/* Tab bar */}
      <div style={{display:'flex',gap:4,marginBottom:16,borderBottom:'1px solid var(--border)',paddingBottom:0}}>
        {tabs.map(tb => (
          <button key={tb.id} className={`btn btn-ghost ${tab===tb.id?'btn-primary':''}`}
            style={{borderBottom:tab===tb.id?'2px solid var(--cyan)':'2px solid transparent',borderRadius:'var(--radius) var(--radius) 0 0'}}
            onClick={()=>setTab(tb.id)}>{tb.label}</button>
        ))}
      </div>

      {tab === 'fiber' && (
        <>
          {/* Fiber Loss Budget Calculator */}
          <div className="card">
            <div className="card-title" style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              {t('cable.fiber_link_title', 'Fiber Link Loss Budget')}
              <div style={{display:'flex',gap:4}}>
                <button className="btn btn-ghost btn-sm" style={{fontSize:11,opacity:0.7,padding:'2px 8px'}} onClick={handleResetValues}>{t('cable.reset_values', 'Reset values')}</button>
                <button className="btn btn-ghost btn-sm" style={{fontSize:11,opacity:0.7,padding:'2px 8px'}} onClick={handleResetFilters}>{t('cable.reset_filters', 'Reset filters')}</button>
              </div>
            </div>
            {/* Filter strip — three dropdowns that filter each other */}
            <div className="three-col grid-mobile-1" style={{marginBottom:8}}>
              <div className="field">
                <label className="label">{t('cable.fiber_type', 'Fiber Type')}</label>
                <SearchableSelect
                  value={fiberType}
                  onChange={setFiberType}
                  placeholder={t('cable.fiber_any_placeholder', '— any fiber (select SFP to auto-fill) —')}
                  options={FIBER_TYPES.map(f => ({
                    value: f.id,
                    label: `${f.label} — ${t(`cable.cat_${f.cat.toLowerCase()}`, f.cat)} (${f.std}) — ${f.atten} ${t('common.unit_db_km', 'dB/km')}`
                  }))}
                />
                {selectedFiber
                  ? <div className="hint">
                      {t(`cable.fiber_app_${selectedFiber.id}`, selectedFiber.app)} · {t('cable.fiber_core_jacket_hint', 'Core: {{core}}µm · Jacket: {{jacket}} · λ: {{wavelength}}nm')
                        .replace('{{core}}', selectedFiber.core)
                        .replace('{{jacket}}', t(`cable.jacket_${selectedFiber.jacket.toLowerCase().replace(' ', '_')}`, selectedFiber.jacket))
                        .replace('{{wavelength}}', selectedFiber.wavelength.join('/'))}
                    </div>
                  : <div className="hint" style={{color:'var(--cyan)'}}>{t('cable.fiber_pick_sfp_hint', 'Pick an SFP preset below to auto-fill fiber type, or choose one above')}</div>
                }
              </div>
              <div className="field">
                <label className="label">{t('cable.connector_type', 'Connector Type')}</label>
                <SearchableSelect
                  value={connectorType}
                  onChange={newType => {
                    setConnectorType(newType);
                    const c = CONNECTORS.find(x => x.id === newType);
                    if (c) setConnectorLoss(String(c.loss));
                  }}
                  placeholder={t('cable.conn_type_any', '— any connector —')}
                  options={CONNECTORS.filter(c => c.type === 'fiber').map(c => ({
                    value: c.id,
                    label: `${c.label} — ${c.loss} ${t('common.unit_db', 'dB')} (${t('cable.conn_std_short', 'std')})`
                  }))}
                />
                <div className="hint" style={{color:'var(--cyan)',fontSize:10}}>{connHint}</div>
              </div>
              <div className="field">
                <label className="label">{t('cable.quick_preset', 'Quick SFP Preset')}</label>
                <SearchableSelect
                  value={sfpPreset}
                  onChange={val => {
                    setSfpPreset(val);
                    if(!val) return;
                    const p = TX_RX_POWER.find(x=>x.std===val);
                    if(p){
                      setTxPower(String(p.txMax));
                      setRxSens(String(p.rxMin));
                      const effectiveFiber = (!fiberType || !p.fiberCompat.includes(fiberType)) ? p.fiberCompat[0] : fiberType;
                      if(!fiberType && p.fiberCompat.length > 0) setFiberType(p.fiberCompat[0]);
                      const matchedConn = CONNECTORS.find(c => c.label === p.connector);
                      if (matchedConn) {
                        setConnectorType(matchedConn.id);
                        setConnectorLoss(String(matchedConn.loss));
                      }
                      const maxDist = getEthMaxDist(val, effectiveFiber);
                      if (maxDist) { setDistance(maxDist.value); setDistanceUnit(maxDist.unit); }
                    }
                  }}
                  placeholder={t('cable.preset_placeholder', '— select standard —')}
                  options={filteredSfpPresets.map(p => ({
                    value: p.std,
                    label: `${p.std} — ${p.formFactor} (${p.wl}${t('common.unit_nm', 'nm')})`
                  }))}
                />
                {!fiberType && (
                  <div className="hint" style={{color:'var(--cyan)'}}>{t('cable.preset_show_all', 'Showing all {{count}} standards — select one to auto-fill fiber type').replace('{{count}}', filteredSfpPresets.length)}</div>
                )}
                {fiberType && filteredSfpPresets.length === 0 && (() => {
                  const connLabel = connectorType ? (CONNECTORS.find(c => c.id === connectorType)?.label || '') : '';
                  const filterDesc = connLabel
                    ? t('cable.preset_no_match_with_conn', '{{label}} ({{cat}}) + {{conn}}').replace('{{label}}', selectedFiber?.label).replace('{{cat}}', fiberCat).replace('{{conn}}', connLabel)
                    : t('cable.preset_no_match_plain', '{{label}} ({{cat}})').replace('{{label}}', selectedFiber?.label).replace('{{cat}}', fiberCat);
                  return (
                    <div className="hint" style={{color:'var(--yellow)'}}>{t('cable.preset_no_match', '⚠ {{filter}} has no matching transceiver presets. Enter TX/RX manually from your transceiver datasheet.').replace('{{filter}}', filterDesc)}</div>
                  );
                })()}
                {fiberType && filteredSfpPresets.length > 0 && (() => {
                  const connLabel = connectorType ? (CONNECTORS.find(c => c.id === connectorType)?.label || '') : '';
                  const filterDesc = connLabel
                    ? t('cable.preset_compatible_with_conn', '{{label}} ({{cat}}) + {{conn}}').replace('{{label}}', selectedFiber?.label).replace('{{cat}}', fiberCat).replace('{{conn}}', connLabel)
                    : t('cable.preset_compatible_plain', '{{label}} ({{cat}})').replace('{{label}}', selectedFiber?.label).replace('{{cat}}', fiberCat);
                  return (
                    <div className="hint">{t('cable.preset_compatible', 'Showing {{count}} compatible standard{{s}} for {{filter}}').replace('{{count}}', filteredSfpPresets.length).replace('{{s}}', filteredSfpPresets.length!==1?'s':'').replace('{{filter}}', filterDesc)}</div>
                  );
                })()}
              </div>
            </div>
            <div className="two-col grid-mobile-1">
              <div>
                <div className="field">
                  <label className="label">{t('cable.distance', 'Link Distance')}</label>
                  <div className="input-row">
                    <input className="input" value={distance} onChange={e=>setDistance(e.target.value)} placeholder="10" style={{flex:1}}/>
                    <select className="select" value={distanceUnit} onChange={e=>setDistanceUnit(e.target.value)} style={{width:70}}>
                      <option value="km">{t('common.unit_km', 'km')}</option>
                      <option value="m">{t('common.unit_m', 'm')}</option>
                    </select>
                  </div>
                  {selectedFiber && <div className="hint">{t('cable.fiber_standard_max_hint', 'Standard max: {{maxDist}} {{unit}} ({{label}})').replace('{{maxDist}}', selectedFiber.maxDist).replace('{{unit}}', t(`common.unit_${selectedFiber.maxDistUnit}`, selectedFiber.maxDistUnit)).replace('{{label}}', selectedFiber.label)}</div>}
                </div>
                <div className="field">
                  <label className="label">{t('cable.num_connectors', 'Mated Connectors')}</label>
                  <input className="input" type="number" value={numConnectors} onChange={e=>setNumConnectors(e.target.value)} min="0"/>
                  <div className="hint">{t('cable.connector_pairs_hint', 'Pairs at each end (2 = one at each end)')}</div>
                </div>
                <div className="two-col grid-mobile-1">
                  <div className="field">
                    <label className="label">{t('cable.conn_loss_db', 'Loss per Connector (dB)')}</label>
                    <input className="input" type="number" step="0.01" min="0" max="2" value={connectorLoss} onChange={e=>setConnectorLoss(e.target.value)}/>
                    {(() => {
                      const c = CONNECTORS.find(x => x.id === connectorType);
                      const entered = parseFloat(connectorLoss);
                      if (!c || isNaN(entered)) return null;
                      if (Math.abs(entered - c.loss) < 1e-9) return null;
                      const warn = t('cable.conn_loss_override_warn', 'The entered loss ({{val}} dB) deviates from the {{label}} connector specification (standard: {{stdLoss}} dB). Calculated results reflect a non-standard configuration — verify against actual OTDR measurements.')
                        .replace('{{val}}', connectorLoss)
                        .replace('{{label}}', c.label)
                        .replace('{{stdLoss}}', c.loss);
                      return (
                        <div style={{marginTop:8,padding:'8px 12px',background:'rgba(245,158,11,.1)',border:'1px solid var(--yellow)',borderRadius:'var(--radius)',color:'var(--yellow)',fontSize:11}}>
                          {warn}
                        </div>
                      );
                    })()}
                  </div>
                </div>
                <div className="two-col grid-mobile-1">
                  <div className="field">
                    <label className="label">{t('cable.num_splices', 'Number of Splices')}</label>
                    <input className="input" type="number" value={numSplices} onChange={e=>setNumSplices(e.target.value)} min="0"/>
                  </div>
                  <div className="field">
                    <label className="label">{t('cable.splice_loss', 'Loss per Splice (dB)')}</label>
                    <select className="select" value={spliceLoss} onChange={e=>setSpliceLoss(e.target.value)}>
                      <option value="0.05">{t('cable.splice_opt_fusion_tia', '0.05 dB — Fusion (TIA typical)')}</option>
                      <option value="0.10">{t('cable.splice_opt_fusion_field', '0.10 dB — Fusion (field avg)')}</option>
                      <option value="0.30">{t('cable.splice_opt_fusion_poor', '0.30 dB — Fusion (poor)')}</option>
                      <option value="0.50">{t('cable.splice_opt_mech', '0.50 dB — Mechanical')}</option>
                    </select>
                    <div className="hint" style={{color:'var(--cyan)',fontSize:10}}>{spliceHint}</div>
                  </div>
                </div>
              </div>
              <div>
                <div className="field">
                  <label className="label">{t('cable.tx_power', 'TX Power (dBm)')}</label>
                  <input className="input" value={txPower} onChange={e=>setTxPower(e.target.value)} placeholder="-1"/>
                  <div className="hint">{t('cable.tx_power_hint', 'Typical: -1 to -7 dBm (check SFP datasheet)')}</div>
                </div>
                <div className="field">
                  <label className="label">{t('cable.rx_sens', 'RX Sensitivity (dBm)')}</label>
                  <input className="input" value={rxSens} onChange={e=>setRxSens(e.target.value)} placeholder="-14"/>
                  <div className="hint">{t('cable.rx_sens_hint', 'Typical: -14 to -24 dBm (check SFP datasheet)')}</div>
                </div>
                <div className="field">
                  <label className="label">{t('cable.safety_margin', 'Safety Margin (dB)')}</label>
                  <select className="select" value={safetyMargin} onChange={e=>setSafetyMargin(e.target.value)}>
                    <option value="1">{t('cable.margin_opt_lab', '1 dB — Lab / short patch')}</option>
                    <option value="3">{t('cable.margin_opt_tia', '3 dB — TIA recommended')}</option>
                    <option value="5">{t('cable.margin_opt_aged', '5 dB — Aged plant / conservative')}</option>
                    <option value="6">{t('cable.margin_opt_telco', '6 dB — Telco standard')}</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Fiber Results */}
          <div className="card fadein">
            <div className="card-title">{t('cable.loss_results', 'Link Loss Budget Results')}</div>
            <div className="result-grid grid-mobile-1">
              <ResultItem label={t('cable.cable_atten', 'Cable Attenuation')} value={`${cableLoss.toFixed(2)} ${t('common.unit_db', 'dB')}${effectiveAtten !== selectedFiber?.atten ? ` @ ${effectiveAtten} ${t('common.unit_db_km','dB/km')} (${presetWl} nm)` : ''}`} red={cableLoss>0}/>
              <ResultItem label={t('cable.conn_loss_total', 'Connector Loss')} value={`${connLossTotal.toFixed(2)} ${t('common.unit_db', 'dB')}`} yellow={connLossTotal>0}/>
              <ResultItem label={t('cable.splice_loss_total', 'Splice Loss')} value={`${spliceLossTotal.toFixed(2)} ${t('common.unit_db', 'dB')}`} yellow={spliceLossTotal>0}/>
              <ResultItem label={t('cable.total_link_loss', 'Total Link Loss')} value={`${totalLinkLoss.toFixed(2)} ${t('common.unit_db', 'dB')}`} accent/>
              <ResultItem label={t('cable.loss_w_margin', 'Loss + Margin')} value={`${linkLossWithMargin.toFixed(2)} ${t('common.unit_db', 'dB')}`} accent/>
              <ResultItem label={t('cable.power_budget', 'Power Budget')} value={`${powerBudget.toFixed(2)} ${t('common.unit_db', 'dB')}`} green={powerBudget>linkLossWithMargin} red={powerBudget<=linkLossWithMargin}/>
              <ResultItem label={t('cable.link_margin', 'Link Margin')} value={`${linkMargin.toFixed(2)} ${t('common.unit_db', 'dB')}`} green={linkMargin>3} yellow={linkMargin>0&&linkMargin<=3} red={linkMargin<=0}/>
              <ResultItem label={t('cable.max_dist_budget', 'Max Dist by Budget')} value={`${maxDistByBudgetDisplay} ${t(`common.unit_${distanceUnit}`, distanceUnit)}`} accent={maxDistByBudget>0}/>
            </div>

            {/* Visual budget bar */}
            <div style={{marginTop:16}}>
              <div className="label" style={{marginBottom:6}}>{t('cable.budget_visual', 'Power Budget Utilization')}</div>
              <div style={{height:16,background:'var(--border)',borderRadius:'var(--radius)',overflow:'hidden',display:'flex'}}>
                <div style={{width:`${powerBudget>0?Math.min(100,(cableLoss/powerBudget)*100):0}%`,background:'var(--red)',transition:'width .3s',title:'Cable'}}/>
                <div style={{width:`${powerBudget>0?Math.min(100,(connLossTotal/powerBudget)*100):0}%`,background:'var(--yellow)',transition:'width .3s',title:'Connectors'}}/>
                <div style={{width:`${powerBudget>0?Math.min(100,(spliceLossTotal/powerBudget)*100):0}%`,background:'var(--purple)',transition:'width .3s',title:'Splices'}}/>
                <div style={{width:`${powerBudget>0?Math.min(100,(parseFloat(safetyMargin)||0)/powerBudget*100):0}%`,background:'var(--blue)',transition:'width .3s',title:'Safety'}}/>
              </div>
              <div style={{display:'flex',gap:16,marginTop:6,fontSize:11,flexWrap:'wrap'}}>
                <span style={{color:'var(--red)'}}>{t('cable.legend_cable', '■ Cable: {{value}} dB').replace('{{value}}', cableLoss.toFixed(2))}</span>
                <span style={{color:'var(--yellow)'}}>{t('cable.legend_connectors', '■ Connectors: {{value}} dB').replace('{{value}}', connLossTotal.toFixed(2))}</span>
                <span style={{color:'var(--purple)'}}>{t('cable.legend_splices', '■ Splices: {{value}} dB').replace('{{value}}', spliceLossTotal.toFixed(2))}</span>
                <span style={{color:'var(--blue)'}}>{t('cable.legend_margin', '■ Margin: {{value}} dB').replace('{{value}}', safetyMargin)}</span>
                <span style={{color:'var(--green)'}}>{t('cable.legend_remaining', '■ Remaining: {{value}} dB').replace('{{value}}', Math.max(0,linkMargin).toFixed(2))}</span>
              </div>
            </div>

            {exceedsEthLimit && (() => {
              const maxStr = ethDistLimit >= 1000 ? `${(ethDistLimit/1000).toFixed(0)} km` : `${ethDistLimit} m`;
              const ethWarnText = t('cable.eth_dist_exceed_warn', 'The entered distance ({{dist}}) exceeds the IEEE-specified maximum reach for {{standard}} on this fiber ({{max}}). The optical power budget may appear sufficient, but the reach limit defined by {{standard}} is absolute — operation beyond {{max}} is outside the specification regardless of calculated margin.')
                .replace('{{dist}}', `${distance} ${distanceUnit}`)
                .replace('{{standard}}', sfpPreset)
                .replace('{{max}}', maxStr)
                .replace('{{standard}}', sfpPreset)
                .replace('{{max}}', maxStr);
              return (
                <div style={{marginTop:12,padding:'10px 14px',background:'rgba(239,68,68,.1)',border:'1px solid var(--red)',borderRadius:'var(--radius)',color:'var(--red)',fontSize:12}}>
                  {ethWarnText}
                </div>
              );
            })()}
            {linkMargin <= 0 && (
              <div style={{marginTop:12,padding:'10px 14px',background:'rgba(239,68,68,.1)',border:'1px solid var(--red)',borderRadius:'var(--radius)',color:'var(--red)',fontSize:12}}>
                {t('cable.margin_fail', '⚠ Link margin is {{value}} dB — link will likely FAIL. Reduce distance, connectors, splices, or use higher-power optics.').replace('{{value}}', linkMargin.toFixed(2))}
              </div>
            )}
            {linkMargin > 0 && linkMargin <= 3 && (
              <div style={{marginTop:12,padding:'10px 14px',background:'rgba(245,158,11,.1)',border:'1px solid var(--yellow)',borderRadius:'var(--radius)',color:'var(--yellow)',fontSize:12}}>
                {t('cable.margin_marginal', '⚠ Link margin is only {{value}} dB — marginal. Consider reducing losses or increasing budget for long-term reliability.').replace('{{value}}', linkMargin.toFixed(2))}
              </div>
            )}
            {linkMargin > 3 && (
              <div style={{marginTop:12,padding:'10px 14px',background:'rgba(34,197,94,.1)',border:'1px solid var(--green)',borderRadius:'var(--radius)',color:'var(--green)',fontSize:12}}>
                {t('cable.margin_healthy', '✓ Link margin is {{value}} dB — healthy. Budget exceeds losses by a comfortable margin.').replace('{{value}}', linkMargin.toFixed(2))}
              </div>
            )}

            {/* Formula reference */}
            <div style={{marginTop:16,padding:'10px 14px',background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)',fontFamily:'var(--mono)',fontSize:11}}>
              <div style={{color:'var(--muted)',marginBottom:4}}>{t('cable.formula_title', 'TIA-568 Loss Formula:')}</div>
              <div style={{color:'var(--cyan)'}}>{t('cable.formula_link_loss', 'Link Loss = (Atten × Distance) + (Conn_loss × N_conn) + (Splice_loss × N_splice)')}</div>
              <div style={{color:'var(--cyan)',marginTop:2}}>{t('cable.formula_margin', 'Link Margin = Power Budget − Link Loss − Safety Margin')}</div>
              <div style={{color:'var(--cyan)',marginTop:2}}>{t('cable.formula_budget', 'Power Budget = TX Power − RX Sensitivity')}</div>
            </div>

            {/* Accuracy disclaimer */}
            <div style={{marginTop:12,padding:'10px 14px',background:'rgba(245,158,11,.06)',border:'1px solid rgba(245,158,11,.4)',borderRadius:'var(--radius)',fontSize:11,lineHeight:1.6}}>
              <strong style={{color:'var(--yellow)'}}>{t('cable.accuracy_warn_title', '⚠ Accuracy notice:')}</strong>{' '}
              <span style={{color:'var(--muted)'}}>{t('cable.accuracy_warn_body', 'Transceiver preset values are representative of published IEEE specifications. Actual transceiver performance varies by manufacturer and revision. Always verify TX/RX power levels, fiber compatibility, and distance limits against your transceiver datasheet and the official IEEE standard before purchasing or deploying equipment. Incorrect assumptions can result in non-functional links or significant financial loss.')}{' '}</span>
              <a href="https://standards.ieee.org/" target="_blank" rel="noopener noreferrer" style={{color:'var(--cyan)',fontSize:11}}>IEEE Standards</a>
              <span style={{color:'var(--muted)'}}>{' · '}</span>
              <a href="https://www.tiafotc.org/ieee-802-3-ethernet-standards-update/" target="_blank" rel="noopener noreferrer" style={{color:'var(--cyan)',fontSize:11}}>TIA FOTC</a>
            </div>
          </div>
        </>
      )}

      {tab === 'copper' && (
        <>
          <div className="card">
            <div className="card-title">{t('cable.copper_title', 'Copper Cable Calculator')}</div>
            <div className="two-col grid-mobile-1">
              <div>
                <div className="field">
                  <label className="label">{t('cable.copper_type', 'Cable Category')}</label>
                  <select className="select" value={copperType} onChange={e=>{setCopperType(e.target.value);}}>
                    {COPPER_TYPES.map(c => <option key={c.id} value={c.id}>{c.label} — {c.std} — {t(`cable.copper_app_${c.id}`, c.app)}</option>)}
                  </select>
                  <div className="hint">{t('cable.copper_hint', '{{shield}} · {{gauge}} · {{pairs}} pairs · BW: {{bw}} MHz').replace('{{shield}}', selectedCopper.shield).replace('{{gauge}}', selectedCopper.gauge).replace('{{pairs}}', selectedCopper.pairs).replace('{{bw}}', selectedCopper.bw)}</div>
                </div>
                <div className="field">
                  <label className="label">{t('cable.copper_distance', 'Cable Length (m)')}</label>
                  <input className="input" type="number" value={copperDist} onChange={e=>setCopperDist(e.target.value)} min="0" max="200"/>
                </div>
              </div>
              <div>
                <div className="result-grid" style={{gridTemplateColumns:'1fr'}}>
                  <ResultItem label={t('cable.standard', 'Standard')} value={selectedCopper.std}/>
                  <ResultItem label={t('cable.max_distance', 'Max Distance')} value={`${selectedCopper.maxDist} m`} accent/>
                  <ResultItem label={t('cable.bandwidth', 'Bandwidth')} value={`${selectedCopper.bw} MHz`}/>
                  <ResultItem label={t('cable.gauge', 'Wire Gauge')} value={selectedCopper.gauge}/>
                  <ResultItem label={t('cable.shield_type', 'Shielding')} value={selectedCopper.shield}/>
                </div>
              </div>
            </div>
          </div>

          <div className="card fadein">
            <div className="card-title">{t('cable.copper_results', 'Copper Link Analysis')}</div>
            <div className="result-grid grid-mobile-1">
              <ResultItem label={t('cable.applicable_speed', 'Applicable Speed')} value={t(`cable.copper_app_${selectedCopper.id}`, selectedCopper.app)} accent/>
              <ResultItem label={t('cable.spec_compliance', 'Within Spec')} value={copperWithinSpec ? t('cable.pass', 'PASS ✓') : t('cable.fail', 'FAIL ✗')} green={copperWithinSpec} red={!copperWithinSpec}/>
              <ResultItem label={t('cable.distance_pct', 'Distance Utilization')} value={`${(copperDistNum/selectedCopper.maxDist*100).toFixed(1)}%`} yellow={copperDistNum>selectedCopper.maxDist*0.8&&!copperDistNum>selectedCopper.maxDist} red={copperDistNum>selectedCopper.maxDist}/>
              <ResultItem label={t('cable.est_insertion_loss', 'Est. Insertion Loss')} value={`${copperTotalLoss.toFixed(2)} ${t('common.unit_db', 'dB')}`}/>
              <ResultItem label={t('cable.next_headroom', 'NEXT (min)')} value={`${(copperSpecs[copperType]||copperSpecs.cat6a).next} ${t('common.unit_db', 'dB')}`}/>
              <ResultItem label={t('cable.return_loss', 'Return Loss (min)')} value={`${(copperSpecs[copperType]||copperSpecs.cat6a).rl} ${t('common.unit_db', 'dB')}`}/>
            </div>
            {!copperWithinSpec && (
              <div style={{marginTop:12,padding:'10px 14px',background:'rgba(239,68,68,.1)',border:'1px solid var(--red)',borderRadius:'var(--radius)',color:'var(--red)',fontSize:12}}>
                {t('cable.copper_fail_warn', '⚠ Cable length ({{dist}}m) exceeds {{label}} spec limit of {{max}}m. Signal degradation or link failure is expected.').replace('{{dist}}', copperDist).replace('{{label}}', selectedCopper.label).replace('{{max}}', selectedCopper.maxDist)}
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'ref' && (
        <>
          <div style={{display:'flex',gap:4,marginBottom:12,overflowX:'auto',WebkitOverflowScrolling:'touch',paddingBottom:4}}>
            {[
              {id:'fiber',label:t('cable.ref_fiber','Fiber Types')},
              {id:'copper',label:t('cable.ref_copper','Copper Categories')},
              {id:'conn',label:t('cable.ref_conn','Connectors & Splices')},
              {id:'txrx',label:t('cable.ref_txrx','Transceivers')},
              {id:'ethdist',label:t('cable.ref_ethdist','Ethernet Distances')},
            ].map(r=>(
              <button key={r.id} className={`btn btn-ghost btn-sm ${refTab===r.id?'btn-primary':''}`} style={{flexShrink:0,borderBottom:refTab===r.id?'2px solid var(--cyan)':'2px solid transparent',borderRadius:'var(--radius) var(--radius) 0 0'}} onClick={()=>setRefTab(r.id)}>{r.label}</button>
            ))}
          </div>

          {refTab==='ethdist' && (
            <div className="card fadein">
              <div className="card-title">{t('cable.eth_dist_title', 'Ethernet Standard Distance Limits')}</div>
              <div style={{marginBottom:10}}>
                <input className="input" value={ethdistSearch} onChange={e=>setEthdistSearch(e.target.value)} placeholder={t('cable.ref_table_filter','Filter...')} style={{maxWidth:320}}/>
              </div>
              <div className="table-wrap hide-mobile">
                <table>
                  <thead><tr><th>{t('cable.th_standard', 'Standard')}</th><th>{t('cable.th_speed', 'Speed')}</th><th>{t('cable.th_media', 'Media')}</th><th>{t('cable.th_wavelength', 'Wavelength')}</th><th>{t('cable.th_connector_col', 'Connector')}</th><th>{t('cable.th_max_distance', 'Max Distance')}</th><th>{t('cable.th_spec', 'Spec')}</th><th>{t('cable.th_note', 'Note')}</th></tr></thead>
                  <tbody>
                    {ETHERNET_DISTANCE.filter(r=>!r.legacy).filter(r=>{
                      if(!ethdistSearch) return true;
                      const q=ethdistSearch.toLowerCase();
                      return [r.standard,r.speed,r.fiber||r.copper,r.wl?String(r.wl):'',r.connector||'',r.maxDist,r.note||''].some(v=>String(v).toLowerCase().includes(q));
                    }).map((r,i)=>{
                      const specRef = IEEE_SPEC_REFS[r.standard];
                      return (
                        <tr key={i}>
                          <td style={{fontWeight:600,color:'var(--cyan)'}}>{r.standard}</td>
                          <td><span className="badge badge-blue">{r.speed}</span></td>
                          <td style={{color:'var(--muted)'}}>{t(`cable.media_${r.fiber||r.copper}`, r.fiber||r.copper)}</td>
                          <td style={{color:'var(--muted)'}}>{r.wl ? `${r.wl} ${t('common.unit_nm', 'nm')}` : '—'}</td>
                          <td style={{fontFamily:'var(--mono)',fontSize:11}}>{r.connector || '—'}</td>
                          <td style={{fontWeight:600}}>{r.maxDist}</td>
                          <td style={{fontSize:11,whiteSpace:'nowrap'}}>
                            {specRef ? (specRef.url
                              ? <a href={specRef.url} target="_blank" rel="noopener noreferrer" style={{color:'var(--cyan)',textDecoration:'none',fontFamily:'var(--mono)'}}>{specRef.ieee}</a>
                              : <span style={{color:'var(--muted)',fontFamily:'var(--mono)'}}>{specRef.ieee}</span>
                            ) : <span style={{color:'var(--muted)'}}>—</span>}
                          </td>
                          <td style={{fontSize:11,color:'var(--muted)'}}>{r.note ? t(`cable.note_${r.note}`, r.note) : ''}</td>
                        </tr>
                      );
                    })}
                    <tr>
                      <td colSpan={8} style={{background:'rgba(255,165,0,.06)',borderTop:'1px solid rgba(255,165,0,.25)',borderBottom:'1px solid rgba(255,165,0,.25)',color:'var(--yellow)',fontWeight:600,fontSize:11,padding:'6px 12px',letterSpacing:'0.05em',textTransform:'uppercase'}}>
                        {t('cable.legacy_section_header','Legacy / Historical Standards')}
                      </td>
                    </tr>
                    {ETHERNET_DISTANCE.filter(r=>r.legacy).filter(r=>{
                      if(!ethdistSearch) return true;
                      const q=ethdistSearch.toLowerCase();
                      return [r.standard,r.speed,r.fiber||r.copper,r.wl?String(r.wl):'',r.connector||'',r.maxDist,r.note||''].some(v=>String(v).toLowerCase().includes(q));
                    }).map((r,i)=>{
                      const specRef = IEEE_SPEC_REFS[r.standard];
                      return (
                        <tr key={`l${i}`} style={{opacity:0.85}}>
                          <td style={{fontWeight:600,color:'var(--cyan)'}}>
                            {r.standard}
                            <span className="badge badge-orange" style={{marginLeft:6,fontSize:9,verticalAlign:'middle'}}>{t('cable.legacy_badge','Legacy')}</span>
                          </td>
                          <td><span className="badge badge-blue">{r.speed}</span></td>
                          <td style={{color:'var(--muted)'}}>{t(`cable.media_${r.fiber||r.copper}`, r.fiber||r.copper)}</td>
                          <td style={{color:'var(--muted)'}}>{r.wl ? `${r.wl} ${t('common.unit_nm', 'nm')}` : '—'}</td>
                          <td style={{fontFamily:'var(--mono)',fontSize:11}}>{r.connector || '—'}</td>
                          <td style={{fontWeight:600}}>{r.maxDist}</td>
                          <td style={{fontSize:11,whiteSpace:'nowrap'}}>
                            {specRef ? (specRef.url
                              ? <a href={specRef.url} target="_blank" rel="noopener noreferrer" style={{color:'var(--cyan)',textDecoration:'none',fontFamily:'var(--mono)'}}>{specRef.ieee}</a>
                              : <span style={{color:'var(--muted)',fontFamily:'var(--mono)'}}>{specRef.ieee}</span>
                            ) : <span style={{color:'var(--muted)'}}>—</span>}
                          </td>
                          <td style={{fontSize:11,color:'var(--muted)'}}>{r.note ? t(`cable.note_${r.note}`, r.note) : ''}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="show-mobile mobile-cards">
                {ETHERNET_DISTANCE.filter(r=>!r.legacy).filter(r=>{
                  if(!ethdistSearch) return true;
                  const q=ethdistSearch.toLowerCase();
                  return [r.standard,r.speed,r.fiber||r.copper,r.wl?String(r.wl):'',r.connector||'',r.maxDist,r.note||''].some(v=>String(v).toLowerCase().includes(q));
                }).map((r,i)=>(
                  <div key={i} className="mobile-card">
                    <div className="mobile-card-row">
                      <span className="mobile-card-label" style={{fontWeight:600,color:'var(--cyan)'}}>{r.standard}</span>
                      <span className="badge badge-blue" style={{fontSize:10}}>{r.speed}</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">{t(`cable.media_${r.fiber||r.copper}`, r.fiber||r.copper)}</span>
                      <span className="mobile-card-value" style={{fontWeight:600}}>{r.maxDist}</span>
                    </div>
                    {r.connector && (
                      <div className="mobile-card-row">
                        <span className="mobile-card-label">{t('cable.th_connector_col', 'Connector')}</span>
                        <span className="mobile-card-value" style={{fontFamily:'var(--mono)',fontSize:11}}>{r.connector}</span>
                      </div>
                    )}
                  </div>
                ))}
                <div style={{padding:'6px 12px',background:'rgba(255,165,0,.06)',border:'1px solid rgba(255,165,0,.25)',borderRadius:'var(--radius)',color:'var(--yellow)',fontWeight:600,fontSize:10,letterSpacing:'0.05em',textTransform:'uppercase',margin:'4px 0'}}>
                  {t('cable.legacy_section_header','Legacy / Historical Standards')}
                </div>
                {ETHERNET_DISTANCE.filter(r=>r.legacy).filter(r=>{
                  if(!ethdistSearch) return true;
                  const q=ethdistSearch.toLowerCase();
                  return [r.standard,r.speed,r.fiber||r.copper,r.wl?String(r.wl):'',r.connector||'',r.maxDist,r.note||''].some(v=>String(v).toLowerCase().includes(q));
                }).map((r,i)=>(
                  <div key={`l${i}`} className="mobile-card" style={{opacity:0.85}}>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label" style={{fontWeight:600,color:'var(--cyan)'}}>{r.standard} <span className="badge badge-orange" style={{fontSize:9}}>{t('cable.legacy_badge','Legacy')}</span></span>
                      <span className="badge badge-blue" style={{fontSize:10}}>{r.speed}</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">{t(`cable.media_${r.fiber||r.copper}`, r.fiber||r.copper)}</span>
                      <span className="mobile-card-value" style={{fontWeight:600}}>{r.maxDist}</span>
                    </div>
                    {r.connector && (
                      <div className="mobile-card-row">
                        <span className="mobile-card-label">{t('cable.th_connector_col', 'Connector')}</span>
                        <span className="mobile-card-value" style={{fontFamily:'var(--mono)',fontSize:11}}>{r.connector}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {refTab==='fiber' && (
            <div className="card fadein">
              <div className="card-title">{t('cable.fiber_ref_title', 'Fiber Type Reference')}</div>
              <div style={{marginBottom:10}}>
                <input className="input" value={fiberRefSearch} onChange={e=>setFiberRefSearch(e.target.value)} placeholder={t('cable.ref_table_filter','Filter...')} style={{maxWidth:320}}/>
              </div>
              <div className="table-wrap hide-mobile">
                <table>
                  <thead><tr><th>{t('cable.th_type', 'Type')}</th><th>{t('cable.th_category', 'Category')}</th><th>{t('cable.th_standard', 'Standard')}</th><th>{t('cable.th_core', 'Core')}</th><th>{t('cable.th_atten', 'Atten (dB/km)')}</th><th>{t('cable.th_max_dist', 'Max Dist')}</th><th>{t('cable.th_jacket', 'Jacket')}</th><th>{t('cable.th_application', 'Application')}</th></tr></thead>
                  <tbody>
                    {FIBER_TYPES.filter(f=>{
                      if(!fiberRefSearch) return true;
                      const q=fiberRefSearch.toLowerCase();
                      return [f.label,f.cat,f.std,String(f.core),String(f.atten),String(f.maxDist),f.jacket,f.app].some(v=>String(v).toLowerCase().includes(q));
                    }).map(f=>(
                      <tr key={f.id}>
                        <td style={{fontWeight:600,color:'var(--cyan)'}}>{f.label}</td>
                        <td><span className={`badge ${f.cat==='SMF'?'badge-purple':'badge-blue'}`}>{t(`cable.cat_${f.cat.toLowerCase()}`, f.cat)}</span></td>
                        <td style={{fontSize:11,color:'var(--muted)'}}>{f.std}</td>
                        <td style={{fontFamily:'var(--mono)'}}>{f.core}{t('common.unit_um', 'µm')}</td>
                        <td style={{fontFamily:'var(--mono)',color:'var(--red)'}}>{f.atten}</td>
                        <td style={{fontFamily:'var(--mono)'}}>{f.maxDist} {t(`common.unit_${f.maxDistUnit}`, f.maxDistUnit)}</td>
                        <td>{t(`cable.jacket_${f.jacket.toLowerCase().replace(' ', '_')}`, f.jacket)}</td>
                        <td style={{color:'var(--muted)',fontSize:11}}>{t(`cable.fiber_app_${f.id}`, f.app)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="show-mobile mobile-cards">
                {FIBER_TYPES.filter(f=>{
                  if(!fiberRefSearch) return true;
                  const q=fiberRefSearch.toLowerCase();
                  return [f.label,f.cat,f.std,String(f.core),String(f.atten),String(f.maxDist),f.jacket,f.app].some(v=>String(v).toLowerCase().includes(q));
                }).map(f=>(
                  <div key={f.id} className="mobile-card">
                    <div className="mobile-card-row">
                      <span className="mobile-card-label" style={{fontWeight:600,color:'var(--cyan)'}}>{f.label}</span>
                      <span className={`badge ${f.cat==='SMF'?'badge-purple':'badge-blue'}`} style={{fontSize:10}}>{t(`cable.cat_${f.cat.toLowerCase()}`, f.cat)}</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">{t('cable.mobile_atten', 'Atten')}</span>
                      <span className="mobile-card-value" style={{color:'var(--red)'}}>{f.atten} {t('common.unit_db_km', 'dB/km')}</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">{t('cable.mobile_max', 'Max')}</span>
                      <span className="mobile-card-value">{f.maxDist} {t(`common.unit_${f.maxDistUnit}`, f.maxDistUnit)}</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">{t(`cable.fiber_app_${f.id}`, f.app)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {refTab==='copper' && (
            <div className="card fadein">
              <div className="card-title">{t('cable.copper_ref_title', 'Copper Category Reference')}</div>
              <div style={{marginBottom:10}}>
                <input className="input" value={copperRefSearch} onChange={e=>setCopperRefSearch(e.target.value)} placeholder={t('cable.ref_table_filter','Filter...')} style={{maxWidth:320}}/>
              </div>
              <div className="table-wrap hide-mobile">
                <table>
                  <thead><tr><th>{t('cable.th_category', 'Category')}</th><th>{t('cable.th_standard', 'Standard')}</th><th>{t('cable.th_bandwidth', 'Bandwidth')}</th><th>{t('cable.th_max_distance', 'Max Distance')}</th><th>{t('cable.th_gauge', 'Gauge')}</th><th>{t('cable.th_shield', 'Shield')}</th><th>{t('cable.th_application', 'Application')}</th></tr></thead>
                  <tbody>
                    {COPPER_TYPES.filter(c=>{
                      if(!copperRefSearch) return true;
                      const q=copperRefSearch.toLowerCase();
                      return [c.label,c.std,String(c.bw),String(c.maxDist),c.gauge,c.shield,c.app].some(v=>String(v).toLowerCase().includes(q));
                    }).map(c=>(
                      <tr key={c.id}>
                        <td style={{fontWeight:600,color:'var(--cyan)'}}>{c.label}</td>
                        <td style={{fontSize:11,color:'var(--muted)'}}>{c.std}</td>
                        <td style={{fontFamily:'var(--mono)'}}>{c.bw} MHz</td>
                        <td style={{fontFamily:'var(--mono)',fontWeight:600}}>{c.maxDist} m</td>
                        <td style={{color:'var(--muted)'}}>{c.gauge}</td>
                        <td>{c.shield}</td>
                        <td style={{color:'var(--muted)',fontSize:11}}>{t(`cable.copper_app_${c.id}`, c.app)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="show-mobile mobile-cards">
                {COPPER_TYPES.filter(c=>{
                  if(!copperRefSearch) return true;
                  const q=copperRefSearch.toLowerCase();
                  return [c.label,c.std,String(c.bw),String(c.maxDist),c.gauge,c.shield,c.app].some(v=>String(v).toLowerCase().includes(q));
                }).map(c=>(
                  <div key={c.id} className="mobile-card">
                    <div className="mobile-card-row">
                      <span className="mobile-card-label" style={{fontWeight:600,color:'var(--cyan)'}}>{c.label}</span>
                      <span className="mobile-card-value">{c.bw} MHz · {c.maxDist}m</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">{c.std}</span>
                      <span className="mobile-card-value" style={{fontSize:11}}>{t(`cable.copper_app_${c.id}`, c.app)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {refTab==='conn' && (
            <div className="card fadein">
              <div className="card-title">{t('cable.conn_ref_title', 'Connector & Splice Loss Reference')}</div>
              <div style={{marginBottom:10}}>
                <input className="input" value={connSearch} onChange={e=>setConnSearch(e.target.value)} placeholder={t('cable.ref_table_filter','Filter...')} style={{maxWidth:320}}/>
              </div>
              <div className="two-col grid-mobile-1">
                <div>
                  <div className="label" style={{marginBottom:8}}>{t('cable.fiber_connectors', 'Fiber Connectors')}</div>
                  <div className="table-wrap hide-mobile">
                    <table>
                      <thead><tr><th>{t('cable.th_connector', 'Connector')}</th><th>{t('cable.th_type_col', 'Type')}</th><th>{t('cable.th_typical_loss', 'Typical Loss')}</th><th>{t('cable.th_polish', 'Polish')}</th><th>{t('cable.th_fiber', 'Fiber')}</th><th>{t('cable.th_use_case', 'Use Case')}</th></tr></thead>
                      <tbody>
                        {CONNECTORS.filter(c=>c.type==='fiber').filter(c=>{
                          if(!connSearch) return true;
                          const q=connSearch.toLowerCase();
                          return [c.label,c.type,String(c.loss),c.polish,c.fiberCat.join('/'),c.app].some(v=>String(v).toLowerCase().includes(q));
                        }).map(c=>(
                          <tr key={c.id}>
                            <td style={{fontWeight:600,color:'var(--cyan)'}}>{c.label}</td>
                            <td>{t(`cable.conn_type_${c.type}`, c.type)}</td>
                            <td style={{fontFamily:'var(--mono)',color:'var(--red)'}}>{c.loss} {t('common.unit_db', 'dB')}</td>
                            <td><span className="badge badge-gray">{c.polish}</span></td>
                            <td>{c.fiberCat.length ? c.fiberCat.map(cat => (
                              <span key={cat} className={`badge ${cat==='SMF'?'badge-purple':'badge-blue'}`} style={{fontSize:10,marginRight:2}}>{t(`cable.cat_${cat.toLowerCase()}`, cat)}</span>
                            )) : '—'}</td>
                            <td style={{color:'var(--muted)',fontSize:11}}>{t(`cable.conn_app_${c.id}`, c.app)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="show-mobile mobile-cards">
                    {CONNECTORS.filter(c=>c.type==='fiber').filter(c=>{
                      if(!connSearch) return true;
                      const q=connSearch.toLowerCase();
                      return [c.label,c.type,String(c.loss),c.polish,c.fiberCat.join('/'),c.app].some(v=>String(v).toLowerCase().includes(q));
                    }).map(c=>(
                      <div key={c.id} className="mobile-card">
                        <div className="mobile-card-row">
                          <span className="mobile-card-label" style={{fontWeight:600,color:'var(--cyan)'}}>{c.label}</span>
                          <span className="mobile-card-value" style={{color:'var(--red)'}}>{c.loss} {t('common.unit_db', 'dB')}</span>
                        </div>
                        <div className="mobile-card-row">
                          <span className="mobile-card-label">{c.polish} · {c.fiberCat.length ? c.fiberCat.map(cat => t(`cable.cat_${cat.toLowerCase()}`, cat)).join('/') : '—'}</span>
                          <span className="mobile-card-value" style={{fontSize:11,color:'var(--muted)'}}>{t(`cable.conn_app_${c.id}`, c.app)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="label" style={{marginBottom:8}}>{t('cable.splice_types', 'Splice Types')}</div>
                  <div className="table-wrap hide-mobile">
                    <table>
                      <thead><tr><th>{t('cable.th_splice_type', 'Splice Type')}</th><th>{t('cable.th_typical_loss', 'Typical Loss')}</th><th>{t('cable.th_use_case', 'Use Case')}</th></tr></thead>
                      <tbody>
                        {SPLICE_TYPES.map(s=>(
                          <tr key={s.id}>
                            <td style={{fontWeight:600,color:'var(--cyan)'}}>{t(`cable.splice_lbl_${s.id}`, s.label)}</td>
                            <td style={{fontFamily:'var(--mono)',color:'var(--red)'}}>{s.loss} {t('common.unit_db', 'dB')}</td>
                            <td style={{color:'var(--muted)',fontSize:11}}>{t(`cable.splice_app_${s.id}`, s.app)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="show-mobile mobile-cards">
                    {SPLICE_TYPES.map(s=>(
                      <div key={s.id} className="mobile-card">
                        <div className="mobile-card-row">
                          <span className="mobile-card-label" style={{fontWeight:600,color:'var(--cyan)'}}>{t(`cable.splice_lbl_${s.id}`, s.label)}</span>
                          <span className="mobile-card-value" style={{color:'var(--red)'}}>{s.loss} {t('common.unit_db', 'dB')}</span>
                        </div>
                        <div className="mobile-card-row" style={{borderBottom:'none'}}>
                          <span style={{fontSize:11,color:'var(--muted)'}}>{t(`cable.splice_app_${s.id}`, s.app)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{marginTop:16,padding:'10px 14px',background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)',fontSize:11,color:'var(--muted)',lineHeight:1.7}}>
                <strong style={{color:'var(--text)'}}>{t('cable.tia_max_loss_title', 'TIA-568 Maximum Loss Budgets:')}</strong>
                <div style={{marginTop:4}}>
                  <span className="badge badge-blue" style={{marginRight:4}}>{t('cable.cat_smf', 'SMF')}</span> {t('cable.tia_smf_max', 'Max total loss: See link budget calc — Splice ≤0.1 dB, Connector ≤0.75 dB')}
                </div>
                <div style={{marginTop:2}}>
                  <span className="badge badge-purple" style={{marginRight:4}}>{t('cable.cat_mmf', 'MMF')}</span> {t('cable.tia_mmf_max', 'Max total loss per TIA-568: connector ≤0.75 dB, splice ≤0.3 dB')}
                </div>
                <div style={{marginTop:2}}>
                  <span className="badge badge-green" style={{marginRight:4}}>{t('cable.badge_otdr', 'OTDR')}</span> {t('cable.tia_otdr', 'Use OTDR testing to verify installed link loss matches calculated budget')}
                </div>
              </div>
            </div>
          )}

          {refTab==='txrx' && (
            <div className="card fadein">
              <div className="card-title">{t('cable.txrx_ref_title', 'Transceiver TX/RX Power Reference')}</div>
              <div style={{marginBottom:12,padding:'10px 14px',background:'rgba(245,158,11,.07)',border:'1px solid rgba(245,158,11,.5)',borderRadius:'var(--radius)',fontSize:12,lineHeight:1.6}}>
                <strong style={{color:'var(--yellow)'}}>{t('cable.ref_accuracy_title', '⚠ Reference data disclaimer:')}</strong>{' '}
                <span style={{color:'var(--muted)'}}>{t('cable.ref_accuracy_body', 'Specifications are derived from published IEEE 802.3 amendments and public MSA documents and are provided for planning purposes only. Distances and power levels shown are maximums defined by the standard — deployed links should be verified with actual OTDR measurements and transceiver datasheets. MSA/vendor entries are not governed by an IEEE standard. Always consult the official standard (links in the Spec column) before purchasing or deploying equipment. Inaccurate assumptions can result in link failures or significant financial loss.')}{' '}</span>
                <a href="https://standards.ieee.org/" target="_blank" rel="noopener noreferrer" style={{color:'var(--cyan)',fontSize:12}}>IEEE Standards</a>
                <span style={{color:'var(--muted)'}}>{' · '}</span>
                <a href="https://www.tiafotc.org/ieee-802-3-ethernet-standards-update/" target="_blank" rel="noopener noreferrer" style={{color:'var(--cyan)',fontSize:12}}>TIA FOTC</a>
              </div>
              <div style={{marginBottom:10}}>
                <input className="input" value={txrxSearch} onChange={e=>setTxrxSearch(e.target.value)} placeholder={t('cable.ref_table_filter','Filter...')} style={{maxWidth:320}}/>
              </div>
              <div className="table-wrap hide-mobile">
                <table>
                  <thead><tr><th>{t('cable.th_standard', 'Standard')}</th><th>{t('cable.th_form_factor', 'Form Factor')}</th><th>{t('cable.th_connector_col', 'Connector')}</th><th>{t('cable.th_breakout', 'Breakout')}</th><th>{t('cable.th_wl_nm', 'λ (nm)')}</th><th>{t('cable.th_fiber_col', 'Fiber')}</th><th>{t('cable.th_tx_min', 'TX Min (dBm)')}</th><th>{t('cable.th_tx_max', 'TX Max (dBm)')}</th><th>{t('cable.th_rx_min', 'RX Min (dBm)')}</th><th>{t('cable.th_rx_max', 'RX Max (dBm)')}</th><th>{t('cable.th_budget', 'Budget (dB)')}</th><th>{t('cable.th_spec', 'Spec')}</th></tr></thead>
                  <tbody>
                    {TX_RX_POWER.filter(p=>{
                      if(!txrxSearch) return true;
                      const q=txrxSearch.toLowerCase();
                      const compatLabels=p.fiberCompat.map(fid=>(FIBER_TYPES.find(f=>f.id===fid)||{}).label||fid).join('/');
                      return [p.std,p.formFactor,p.connector,p.breakout,String(p.wl),compatLabels].some(v=>String(v).toLowerCase().includes(q));
                    }).map((p,i,arr)=>{
                      const budget = (p.txMax - p.rxMin).toFixed(1);
                      const compatLabels = p.fiberCompat.map(fid => (FIBER_TYPES.find(f=>f.id===fid)||{}).label||fid).join('/');
                      const specRef = IEEE_SPEC_REFS[p.std];
                      const isEstimated = p.note === 'verify_spec';
                      const showHeader = p.legacy && (i === 0 || !arr[i-1].legacy);
                      return (
                        <React.Fragment key={i}>
                          {showHeader && (
                            <tr>
                              <td colSpan={12} style={{background:'rgba(255,165,0,.06)',borderTop:'1px solid rgba(255,165,0,.25)',borderBottom:'1px solid rgba(255,165,0,.25)',color:'var(--yellow)',fontWeight:600,fontSize:11,padding:'6px 12px',letterSpacing:'0.05em',textTransform:'uppercase'}}>
                                {t('cable.legacy_section_header','Legacy / Historical Standards')}
                              </td>
                            </tr>
                          )}
                          <tr style={{cursor:'pointer',opacity:(isEstimated||p.legacy)?0.85:1}} onClick={()=>{
                            setSfpPreset(p.std);
                            setTxPower(String(p.txMax));setRxSens(String(p.rxMin));
                            const effectiveFiber = p.fiberCompat.includes(fiberType) ? fiberType : p.fiberCompat[0];
                            if (!p.fiberCompat.includes(fiberType)) setFiberType(p.fiberCompat[0]);
                            const matchedConn = CONNECTORS.find(c => c.label === p.connector);
                            if (matchedConn) {
                              setConnectorType(matchedConn.id);
                              setConnectorLoss(String(matchedConn.loss));
                            }
                            const maxDist = getEthMaxDist(p.std, effectiveFiber);
                            if (maxDist) { setDistance(maxDist.value); setDistanceUnit(maxDist.unit); }
                            setTab('fiber');
                          }}>
                            <td style={{fontWeight:600,color:'var(--cyan)'}}>
                              {p.std}
                              {isEstimated && <span title={t('cable.estimated_power_hint','TX/RX values are estimated from comparable standards — verify against your datasheet')} style={{marginLeft:4,color:'var(--yellow)',fontSize:10,cursor:'help'}}>†</span>}
                              {p.legacy && <span className="badge badge-orange" style={{marginLeft:6,fontSize:9,verticalAlign:'middle'}}>{t('cable.legacy_badge','Legacy')}</span>}
                            </td>
                            <td><span className="badge badge-gray" style={{fontSize:10}}>{p.formFactor}</span></td>
                            <td style={{fontFamily:'var(--mono)',fontSize:11}}>{p.connector}</td>
                            <td>{p.breakout ? <span className="badge badge-green" style={{fontSize:10}}>{t(`cable.breakout_${p.breakout}`, p.breakout)}</span> : <span style={{color:'var(--muted)',fontSize:11}}>—</span>}</td>
                            <td style={{fontFamily:'var(--mono)'}}>{p.wl}</td>
                            <td style={{fontSize:11}}>{compatLabels}</td>
                            <td style={{fontFamily:'var(--mono)'}}>{p.txMin}</td>
                            <td style={{fontFamily:'var(--mono)',color:'var(--green)'}}>{p.txMax}</td>
                            <td style={{fontFamily:'var(--mono)',color:'var(--red)'}}>{p.rxMin}</td>
                            <td style={{fontFamily:'var(--mono)'}}>{p.rxMax}</td>
                            <td style={{fontFamily:'var(--mono)',fontWeight:700,color:'var(--cyan)'}}>{budget}</td>
                            <td style={{fontSize:11,whiteSpace:'nowrap'}}>
                              {specRef ? (specRef.url
                                ? <a href={specRef.url} target="_blank" rel="noopener noreferrer" style={{color:'var(--cyan)',textDecoration:'none',fontFamily:'var(--mono)'}} onClick={e=>e.stopPropagation()}>{specRef.ieee}</a>
                                : <span style={{color:'var(--muted)',fontFamily:'var(--mono)'}}>{specRef.ieee}</span>
                              ) : <span style={{color:'var(--muted)'}}>—</span>}
                            </td>
                          </tr>
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="show-mobile mobile-cards">
                {TX_RX_POWER.filter(p=>{
                  if(!txrxSearch) return true;
                  const q=txrxSearch.toLowerCase();
                  const compatLabels=p.fiberCompat.map(fid=>(FIBER_TYPES.find(f=>f.id===fid)||{}).label||fid).join('/');
                  return [p.std,p.formFactor,p.connector,p.breakout,String(p.wl),compatLabels].some(v=>String(v).toLowerCase().includes(q));
                }).map((p,i,arr)=>{
                  const budget = (p.txMax - p.rxMin).toFixed(1);
                  const compatLabels = p.fiberCompat.map(fid => (FIBER_TYPES.find(f=>f.id===fid)||{}).label||fid).join('/');
                  const specRef = IEEE_SPEC_REFS[p.std];
                  const isEstimated = p.note === 'verify_spec';
                  const showHeader = p.legacy && (i === 0 || !arr[i-1].legacy);
                  return (
                    <React.Fragment key={i}>
                    {showHeader && (
                      <div style={{padding:'6px 12px',background:'rgba(255,165,0,.06)',border:'1px solid rgba(255,165,0,.25)',borderRadius:'var(--radius)',color:'var(--yellow)',fontWeight:600,fontSize:10,letterSpacing:'0.05em',textTransform:'uppercase',margin:'4px 0'}}>
                        {t('cable.legacy_section_header','Legacy / Historical Standards')}
                      </div>
                    )}
                    <div className="mobile-card" style={{cursor:'pointer',opacity:(isEstimated||p.legacy)?0.85:1}} onClick={()=>{
                      setSfpPreset(p.std);
                      setTxPower(String(p.txMax));setRxSens(String(p.rxMin));
                      const effectiveFiber = p.fiberCompat.includes(fiberType) ? fiberType : p.fiberCompat[0];
                      if (!p.fiberCompat.includes(fiberType)) setFiberType(p.fiberCompat[0]);
                      const matchedConn = CONNECTORS.find(c => c.label === p.connector);
                      if (matchedConn) {
                        setConnectorType(matchedConn.id);
                        setConnectorLoss(String(matchedConn.loss));
                      }
                      const maxDist = getEthMaxDist(p.std, effectiveFiber);
                      if (maxDist) { setDistance(maxDist.value); setDistanceUnit(maxDist.unit); }
                      setTab('fiber');
                    }}>
                      <div className="mobile-card-row">
                        <span className="mobile-card-label" style={{fontWeight:600,color:'var(--cyan)'}}>
                          {p.std}
                          {isEstimated && <span style={{marginLeft:4,color:'var(--yellow)',fontSize:10}}>†</span>}
                          {p.legacy && <span className="badge badge-orange" style={{marginLeft:4,fontSize:9}}>{t('cable.legacy_badge','Legacy')}</span>}
                        </span>
                        <span className="mobile-card-value" style={{fontWeight:700,color:'var(--cyan)'}}>{budget} {t('common.unit_db', 'dB')}</span>
                      </div>
                      <div className="mobile-card-row">
                        <span className="mobile-card-label">{t('cable.mobile_form_factor', 'Form Factor')}</span>
                        <span className="mobile-card-value"><span className="badge badge-gray" style={{fontSize:10}}>{p.formFactor}</span></span>
                      </div>
                      <div className="mobile-card-row">
                        <span className="mobile-card-label">{t('cable.mobile_connector', 'Connector')}</span>
                        <span className="mobile-card-value" style={{fontFamily:'var(--mono)',fontSize:11}}>{p.connector}</span>
                      </div>
                      {p.breakout && (
                        <div className="mobile-card-row">
                          <span className="mobile-card-label">{t('cable.mobile_breakout', 'Breakout')}</span>
                          <span className="mobile-card-value"><span className="badge badge-green" style={{fontSize:10}}>{t(`cable.breakout_${p.breakout}`, p.breakout)}</span></span>
                        </div>
                      )}
                      <div className="mobile-card-row">
                        <span className="mobile-card-label">{t('cable.th_wl_nm', 'λ (nm)')}</span>
                        <span className="mobile-card-value" style={{fontFamily:'var(--mono)'}}>{p.wl}</span>
                      </div>
                      <div className="mobile-card-row">
                        <span className="mobile-card-label">{t('cable.mobile_fiber', 'Fiber')}</span>
                        <span className="mobile-card-value">{compatLabels}</span>
                      </div>
                      <div className="mobile-card-row">
                        <span className="mobile-card-label">{t('cable.mobile_tx', 'TX')}</span>
                        <span className="mobile-card-value" style={{fontFamily:'var(--mono)'}}>{p.txMin} to {p.txMax} {t('common.unit_dbm', 'dBm')}</span>
                      </div>
                      <div className="mobile-card-row">
                        <span className="mobile-card-label">{t('cable.mobile_rx', 'RX')}</span>
                        <span className="mobile-card-value" style={{fontFamily:'var(--mono)'}}>{p.rxMin} to {p.rxMax} {t('common.unit_dbm', 'dBm')}</span>
                      </div>
                      {specRef && (
                        <div className="mobile-card-row" style={{borderBottom:'none'}}>
                          <span className="mobile-card-label">{t('cable.th_spec', 'Spec')}</span>
                          <span className="mobile-card-value">
                            {specRef.url
                              ? <a href={specRef.url} target="_blank" rel="noopener noreferrer" style={{color:'var(--cyan)',fontFamily:'var(--mono)',fontSize:11}} onClick={e=>e.stopPropagation()}>{specRef.ieee}</a>
                              : <span style={{color:'var(--muted)',fontFamily:'var(--mono)',fontSize:11}}>{specRef.ieee}</span>
                            }
                          </span>
                        </div>
                      )}
                    </div>
                    </React.Fragment>
                  );
                })}
              </div>
              <div className="hint" style={{marginTop:8}}>{t('cable.click_to_load', 'Click any row to load TX/RX values into the Fiber Loss Budget calculator.')}</div>
              <div className="hint" style={{marginTop:4,color:'var(--yellow)'}}>{t('cable.estimated_legend', '† TX/RX values for these entries are estimated from comparable IEEE standards — the spec link is authoritative. Verify against your transceiver datasheet before use.')}</div>
              <div className="hint" style={{marginTop:4}}>{t('cable.msa_note', 'MSA / vendor entries (Cisco MSA, OIF MSA, OpenZR+, PSM4 MSA, CWDM4 MSA) are not governed by an IEEE standard. Consult the relevant MSA specification.')}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
window.CableCalculator = CableCalculator;

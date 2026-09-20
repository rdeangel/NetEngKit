const { useState, useEffect, useCallback, useMemo } = React;

const COUNTRY_TZ_DATA = [
  {n:"Afghanistan",i2:"AF",i3:"AFG",nu:"004",d:"+93",tz:["Asia/Kabul"]},
  {n:"Albania",i2:"AL",i3:"ALB",nu:"008",d:"+355",tz:["Europe/Tirane"]},
  {n:"Algeria",i2:"DZ",i3:"DZA",nu:"012",d:"+213",tz:["Africa/Algiers"]},
  {n:"Andorra",i2:"AD",i3:"AND",nu:"020",d:"+376",tz:["Europe/Andorra"]},
  {n:"Angola",i2:"AO",i3:"AGO",nu:"024",d:"+244",tz:["Africa/Luanda"]},
  {n:"Argentina",i2:"AR",i3:"ARG",nu:"032",d:"+54",tz:["America/Argentina/Buenos_Aires","America/Argentina/Cordoba"]},
  {n:"Armenia",i2:"AM",i3:"ARM",nu:"051",d:"+374",tz:["Asia/Yerevan"]},
  {n:"Australia",i2:"AU",i3:"AUS",nu:"036",d:"+61",tz:["Australia/Sydney","Australia/Melbourne","Australia/Brisbane","Australia/Perth","Australia/Adelaide","Australia/Darwin","Australia/Hobart"]},
  {n:"Austria",i2:"AT",i3:"AUT",nu:"040",d:"+43",tz:["Europe/Vienna"]},
  {n:"Azerbaijan",i2:"AZ",i3:"AZE",nu:"031",d:"+994",tz:["Asia/Baku"]},
  {n:"Bahrain",i2:"BH",i3:"BHR",nu:"048",d:"+973",tz:["Asia/Bahrain"]},
  {n:"Bangladesh",i2:"BD",i3:"BGD",nu:"050",d:"+880",tz:["Asia/Dhaka"]},
  {n:"Belarus",i2:"BY",i3:"BLR",nu:"112",d:"+375",tz:["Europe/Minsk"]},
  {n:"Belgium",i2:"BE",i3:"BEL",nu:"056",d:"+32",tz:["Europe/Brussels"]},
  {n:"Bolivia",i2:"BO",i3:"BOL",nu:"068",d:"+591",tz:["America/La_Paz"]},
  {n:"Bosnia and Herzegovina",i2:"BA",i3:"BIH",nu:"070",d:"+387",tz:["Europe/Sarajevo"]},
  {n:"Botswana",i2:"BW",i3:"BWA",nu:"072",d:"+267",tz:["Africa/Gaborone"]},
  {n:"Brazil",i2:"BR",i3:"BRA",nu:"076",d:"+55",tz:["America/Sao_Paulo","America/Manaus","America/Fortaleza","America/Recife"]},
  {n:"Brunei",i2:"BN",i3:"BRN",nu:"096",d:"+673",tz:["Asia/Brunei"]},
  {n:"Bulgaria",i2:"BG",i3:"BGR",nu:"100",d:"+359",tz:["Europe/Sofia"]},
  {n:"Cambodia",i2:"KH",i3:"KHM",nu:"116",d:"+855",tz:["Asia/Phnom_Penh"]},
  {n:"Cameroon",i2:"CM",i3:"CMR",nu:"120",d:"+237",tz:["Africa/Douala"]},
  {n:"Canada",i2:"CA",i3:"CAN",nu:"124",d:"+1",tz:["America/Toronto","America/Vancouver","America/Edmonton","America/Winnipeg","America/Halifax","America/St_Johns","America/Regina"]},
  {n:"Chile",i2:"CL",i3:"CHL",nu:"152",d:"+56",tz:["America/Santiago","America/Punta_Arenas"]},
  {n:"China",i2:"CN",i3:"CHN",nu:"156",d:"+86",tz:["Asia/Shanghai","Asia/Urumqi"]},
  {n:"Colombia",i2:"CO",i3:"COL",nu:"170",d:"+57",tz:["America/Bogota"]},
  {n:"Costa Rica",i2:"CR",i3:"CRI",nu:"188",d:"+506",tz:["America/Costa_Rica"]},
  {n:"Croatia",i2:"HR",i3:"HRV",nu:"191",d:"+385",tz:["Europe/Zagreb"]},
  {n:"Cuba",i2:"CU",i3:"CUB",nu:"192",d:"+53",tz:["America/Havana"]},
  {n:"Cyprus",i2:"CY",i3:"CYP",nu:"196",d:"+357",tz:["Asia/Nicosia"]},
  {n:"Czech Republic",i2:"CZ",i3:"CZE",nu:"203",d:"+420",tz:["Europe/Prague"]},
  {n:"Denmark",i2:"DK",i3:"DNK",nu:"208",d:"+45",tz:["Europe/Copenhagen"]},
  {n:"Dominican Republic",i2:"DO",i3:"DOM",nu:"214",d:"+1",tz:["America/Santo_Domingo"]},
  {n:"Ecuador",i2:"EC",i3:"ECU",nu:"218",d:"+593",tz:["America/Guayaquil"]},
  {n:"Egypt",i2:"EG",i3:"EGY",nu:"818",d:"+20",tz:["Africa/Cairo"]},
  {n:"El Salvador",i2:"SV",i3:"SLV",nu:"222",d:"+503",tz:["America/El_Salvador"]},
  {n:"Estonia",i2:"EE",i3:"EST",nu:"233",d:"+372",tz:["Europe/Tallinn"]},
  {n:"Ethiopia",i2:"ET",i3:"ETH",nu:"231",d:"+251",tz:["Africa/Addis_Ababa"]},
  {n:"Finland",i2:"FI",i3:"FIN",nu:"246",d:"+358",tz:["Europe/Helsinki"]},
  {n:"France",i2:"FR",i3:"FRA",nu:"250",d:"+33",tz:["Europe/Paris"]},
  {n:"Georgia",i2:"GE",i3:"GEO",nu:"268",d:"+995",tz:["Asia/Tbilisi"]},
  {n:"Germany",i2:"DE",i3:"DEU",nu:"276",d:"+49",tz:["Europe/Berlin"]},
  {n:"Ghana",i2:"GH",i3:"GHA",nu:"288",d:"+233",tz:["Africa/Accra"]},
  {n:"Greece",i2:"GR",i3:"GRC",nu:"300",d:"+30",tz:["Europe/Athens"]},
  {n:"Guatemala",i2:"GT",i3:"GTM",nu:"320",d:"+502",tz:["America/Guatemala"]},
  {n:"Honduras",i2:"HN",i3:"HND",nu:"340",d:"+504",tz:["America/Tegucigalpa"]},
  {n:"Hong Kong",i2:"HK",i3:"HKG",nu:"344",d:"+852",tz:["Asia/Hong_Kong"]},
  {n:"Hungary",i2:"HU",i3:"HUN",nu:"348",d:"+36",tz:["Europe/Budapest"]},
  {n:"Iceland",i2:"IS",i3:"ISL",nu:"352",d:"+354",tz:["Atlantic/Reykjavik"]},
  {n:"India",i2:"IN",i3:"IND",nu:"356",d:"+91",tz:["Asia/Kolkata"]},
  {n:"Indonesia",i2:"ID",i3:"IDN",nu:"360",d:"+62",tz:["Asia/Jakarta","Asia/Makassar","Asia/Jayapura"]},
  {n:"Iran",i2:"IR",i3:"IRN",nu:"364",d:"+98",tz:["Asia/Tehran"]},
  {n:"Iraq",i2:"IQ",i3:"IRQ",nu:"368",d:"+964",tz:["Asia/Baghdad"]},
  {n:"Ireland",i2:"IE",i3:"IRL",nu:"372",d:"+353",tz:["Europe/Dublin"]},
  {n:"Israel",i2:"IL",i3:"ISR",nu:"376",d:"+972",tz:["Asia/Jerusalem"]},
  {n:"Italy",i2:"IT",i3:"ITA",nu:"380",d:"+39",tz:["Europe/Rome"]},
  {n:"Jamaica",i2:"JM",i3:"JAM",nu:"388",d:"+1",tz:["America/Jamaica"]},
  {n:"Japan",i2:"JP",i3:"JPN",nu:"392",d:"+81",tz:["Asia/Tokyo"]},
  {n:"Jordan",i2:"JO",i3:"JOR",nu:"400",d:"+962",tz:["Asia/Amman"]},
  {n:"Kazakhstan",i2:"KZ",i3:"KAZ",nu:"398",d:"+7",tz:["Asia/Almaty","Asia/Aqtau"]},
  {n:"Kenya",i2:"KE",i3:"KEN",nu:"404",d:"+254",tz:["Africa/Nairobi"]},
  {n:"Kuwait",i2:"KW",i3:"KWT",nu:"414",d:"+965",tz:["Asia/Kuwait"]},
  {n:"Kyrgyzstan",i2:"KG",i3:"KGZ",nu:"417",d:"+996",tz:["Asia/Bishkek"]},
  {n:"Laos",i2:"LA",i3:"LAO",nu:"418",d:"+856",tz:["Asia/Vientiane"]},
  {n:"Latvia",i2:"LV",i3:"LVA",nu:"428",d:"+371",tz:["Europe/Riga"]},
  {n:"Lebanon",i2:"LB",i3:"LBN",nu:"422",d:"+961",tz:["Asia/Beirut"]},
  {n:"Libya",i2:"LY",i3:"LBY",nu:"434",d:"+218",tz:["Africa/Tripoli"]},
  {n:"Lithuania",i2:"LT",i3:"LTU",nu:"440",d:"+370",tz:["Europe/Vilnius"]},
  {n:"Luxembourg",i2:"LU",i3:"LUX",nu:"442",d:"+352",tz:["Europe/Luxembourg"]},
  {n:"Macau",i2:"MO",i3:"MAC",nu:"446",d:"+853",tz:["Asia/Macau"]},
  {n:"Malaysia",i2:"MY",i3:"MYS",nu:"458",d:"+60",tz:["Asia/Kuala_Lumpur","Asia/Kuching"]},
  {n:"Maldives",i2:"MV",i3:"MDV",nu:"462",d:"+960",tz:["Indian/Maldives"]},
  {n:"Malta",i2:"MT",i3:"MLT",nu:"470",d:"+356",tz:["Europe/Malta"]},
  {n:"Mauritius",i2:"MU",i3:"MUS",nu:"480",d:"+230",tz:["Indian/Mauritius"]},
  {n:"Mexico",i2:"MX",i3:"MEX",nu:"484",d:"+52",tz:["America/Mexico_City","America/Tijuana","America/Cancun"]},
  {n:"Moldova",i2:"MD",i3:"MDA",nu:"498",d:"+373",tz:["Europe/Chisinau"]},
  {n:"Mongolia",i2:"MN",i3:"MNG",nu:"496",d:"+976",tz:["Asia/Ulaanbaatar"]},
  {n:"Montenegro",i2:"ME",i3:"MNE",nu:"499",d:"+382",tz:["Europe/Podgorica"]},
  {n:"Morocco",i2:"MA",i3:"MAR",nu:"504",d:"+212",tz:["Africa/Casablanca"]},
  {n:"Mozambique",i2:"MZ",i3:"MOZ",nu:"508",d:"+258",tz:["Africa/Maputo"]},
  {n:"Myanmar",i2:"MM",i3:"MMR",nu:"104",d:"+95",tz:["Asia/Yangon"]},
  {n:"Namibia",i2:"NA",i3:"NAM",nu:"516",d:"+264",tz:["Africa/Windhoek"]},
  {n:"Nepal",i2:"NP",i3:"NPL",nu:"524",d:"+977",tz:["Asia/Kathmandu"]},
  {n:"Netherlands",i2:"NL",i3:"NLD",nu:"528",d:"+31",tz:["Europe/Amsterdam"]},
  {n:"New Zealand",i2:"NZ",i3:"NZL",nu:"554",d:"+64",tz:["Pacific/Auckland","Pacific/Chatham"]},
  {n:"Nicaragua",i2:"NI",i3:"NIC",nu:"558",d:"+505",tz:["America/Managua"]},
  {n:"Nigeria",i2:"NG",i3:"NGA",nu:"566",d:"+234",tz:["Africa/Lagos"]},
  {n:"North Macedonia",i2:"MK",i3:"MKD",nu:"807",d:"+389",tz:["Europe/Skopje"]},
  {n:"Norway",i2:"NO",i3:"NOR",nu:"578",d:"+47",tz:["Europe/Oslo"]},
  {n:"Oman",i2:"OM",i3:"OMN",nu:"512",d:"+968",tz:["Asia/Muscat"]},
  {n:"Pakistan",i2:"PK",i3:"PAK",nu:"586",d:"+92",tz:["Asia/Karachi"]},
  {n:"Palestine",i2:"PS",i3:"PSE",nu:"275",d:"+970",tz:["Asia/Hebron","Asia/Gaza"]},
  {n:"Panama",i2:"PA",i3:"PAN",nu:"591",d:"+507",tz:["America/Panama"]},
  {n:"Papua New Guinea",i2:"PG",i3:"PNG",nu:"598",d:"+675",tz:["Pacific/Port_Moresby"]},
  {n:"Paraguay",i2:"PY",i3:"PRY",nu:"600",d:"+595",tz:["America/Asuncion"]},
  {n:"Peru",i2:"PE",i3:"PER",nu:"604",d:"+51",tz:["America/Lima"]},
  {n:"Philippines",i2:"PH",i3:"PHL",nu:"608",d:"+63",tz:["Asia/Manila"]},
  {n:"Poland",i2:"PL",i3:"POL",nu:"616",d:"+48",tz:["Europe/Warsaw"]},
  {n:"Portugal",i2:"PT",i3:"PRT",nu:"620",d:"+351",tz:["Europe/Lisbon","Atlantic/Azores","Atlantic/Madeira"]},
  {n:"Puerto Rico",i2:"PR",i3:"PRI",nu:"630",d:"+1",tz:["America/Puerto_Rico"]},
  {n:"Qatar",i2:"QA",i3:"QAT",nu:"634",d:"+974",tz:["Asia/Qatar"]},
  {n:"Romania",i2:"RO",i3:"ROU",nu:"642",d:"+40",tz:["Europe/Bucharest"]},
  {n:"Russia",i2:"RU",i3:"RUS",nu:"643",d:"+7",tz:["Europe/Moscow","Asia/Yekaterinburg","Asia/Novosibirsk","Asia/Krasnoyarsk","Asia/Irkutsk","Asia/Yakutsk","Asia/Vladivostok","Asia/Kamchatka"]},
  {n:"Rwanda",i2:"RW",i3:"RWA",nu:"646",d:"+250",tz:["Africa/Kigali"]},
  {n:"Saudi Arabia",i2:"SA",i3:"SAU",nu:"682",d:"+966",tz:["Asia/Riyadh"]},
  {n:"Senegal",i2:"SN",i3:"SEN",nu:"686",d:"+221",tz:["Africa/Dakar"]},
  {n:"Serbia",i2:"RS",i3:"SRB",nu:"688",d:"+381",tz:["Europe/Belgrade"]},
  {n:"Singapore",i2:"SG",i3:"SGP",nu:"702",d:"+65",tz:["Asia/Singapore"]},
  {n:"Slovakia",i2:"SK",i3:"SVK",nu:"703",d:"+421",tz:["Europe/Bratislava"]},
  {n:"Slovenia",i2:"SI",i3:"SVN",nu:"705",d:"+386",tz:["Europe/Ljubljana"]},
  {n:"South Africa",i2:"ZA",i3:"ZAF",nu:"710",d:"+27",tz:["Africa/Johannesburg"]},
  {n:"South Korea",i2:"KR",i3:"KOR",nu:"410",d:"+82",tz:["Asia/Seoul"]},
  {n:"Spain",i2:"ES",i3:"ESP",nu:"724",d:"+34",tz:["Europe/Madrid","Atlantic/Canary"]},
  {n:"Sri Lanka",i2:"LK",i3:"LKA",nu:"144",d:"+94",tz:["Asia/Colombo"]},
  {n:"Sudan",i2:"SD",i3:"SDN",nu:"729",d:"+249",tz:["Africa/Khartoum"]},
  {n:"Sweden",i2:"SE",i3:"SWE",nu:"752",d:"+46",tz:["Europe/Stockholm"]},
  {n:"Switzerland",i2:"CH",i3:"CHE",nu:"756",d:"+41",tz:["Europe/Zurich"]},
  {n:"Syria",i2:"SY",i3:"SYR",nu:"760",d:"+963",tz:["Asia/Damascus"]},
  {n:"Taiwan",i2:"TW",i3:"TWN",nu:"158",d:"+886",tz:["Asia/Taipei"]},
  {n:"Tanzania",i2:"TZ",i3:"TZA",nu:"834",d:"+255",tz:["Africa/Dar_es_Salaam"]},
  {n:"Thailand",i2:"TH",i3:"THA",nu:"764",d:"+66",tz:["Asia/Bangkok"]},
  {n:"Tunisia",i2:"TN",i3:"TUN",nu:"788",d:"+216",tz:["Africa/Tunis"]},
  {n:"Turkey",i2:"TR",i3:"TUR",nu:"792",d:"+90",tz:["Europe/Istanbul"]},
  {n:"Uganda",i2:"UG",i3:"UGA",nu:"800",d:"+256",tz:["Africa/Kampala"]},
  {n:"Ukraine",i2:"UA",i3:"UKR",nu:"804",d:"+380",tz:["Europe/Kyiv"]},
  {n:"United Arab Emirates",i2:"AE",i3:"ARE",nu:"784",d:"+971",tz:["Asia/Dubai"]},
  {n:"United Kingdom",i2:"GB",i3:"GBR",nu:"826",d:"+44",tz:["Europe/London"]},
  {n:"United States",i2:"US",i3:"USA",nu:"840",d:"+1",tz:["America/New_York","America/Chicago","America/Denver","America/Los_Angeles","America/Anchorage","Pacific/Honolulu","America/Phoenix"]},
  {n:"Uruguay",i2:"UY",i3:"URY",nu:"858",d:"+598",tz:["America/Montevideo"]},
  {n:"Uzbekistan",i2:"UZ",i3:"UZB",nu:"860",d:"+998",tz:["Asia/Tashkent"]},
  {n:"Venezuela",i2:"VE",i3:"VEN",nu:"862",d:"+58",tz:["America/Caracas"]},
  {n:"Vietnam",i2:"VN",i3:"VNM",nu:"704",d:"+84",tz:["Asia/Ho_Chi_Minh"]},
  {n:"Yemen",i2:"YE",i3:"YEM",nu:"887",d:"+967",tz:["Asia/Aden"]},
  {n:"Zambia",i2:"ZM",i3:"ZMB",nu:"894",d:"+260",tz:["Africa/Lusaka"]},
  {n:"Zimbabwe",i2:"ZW",i3:"ZWE",nu:"716",d:"+263",tz:["Africa/Harare"]},
];

function flagEmoji(iso2) {
  return String.fromCodePoint(...[...iso2].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

function getTimeInZone(tz, date) {
  try {
    return (date || new Date()).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  } catch (e) { return '--:--:--'; }
}

function getOffsetStr(tz, date) {
  try {
    const fmt = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' });
    const parts = fmt.formatToParts(date || new Date());
    const p = parts.find(x => x.type === 'timeZoneName');
    return p ? p.value : '';
  } catch (e) { return ''; }
}

function getUtcOffsetMinutes(tz, date) {
  try {
    const ref = date || new Date();
    const utcStr = ref.toLocaleString('en-US', { timeZone: 'UTC' });
    const tzStr = ref.toLocaleString('en-US', { timeZone: tz });
    return Math.round((new Date(tzStr) - new Date(utcStr)) / 60000);
  } catch (e) { return 0; }
}

function isDST(tz, date) {
  try {
    const ref = date || new Date();
    const year = ref.getFullYear();
    const jan = new Date(year, 0, 1);
    const jul = new Date(year, 6, 1);
    const janOff = getUtcOffsetMinutes(tz, jan);
    const julOff = getUtcOffsetMinutes(tz, jul);
    if (janOff === julOff) return false;
    const currentOff = getUtcOffsetMinutes(tz, ref);
    const dstOff = janOff > julOff ? janOff : julOff;
    return currentOff === dstOff;
  } catch (e) { return false; }
}

function getDstTransition(tz, date) {
  try {
    const ref = date || new Date();
    const year = ref.getFullYear();
    // Check each month boundary for offset changes
    for (let m = 0; m < 12; m++) {
      const start = new Date(year, m, 1);
      const end = new Date(year, m + 1, 1);
      const startOff = getUtcOffsetMinutes(tz, start);
      const endOff = getUtcOffsetMinutes(tz, end);
      if (startOff !== endOff) {
        // Binary search for the transition day
        let lo = start.getTime(), hi = end.getTime();
        while (hi - lo > 86400000) {
          const mid = lo + Math.floor((hi - lo) / 2);
          if (getUtcOffsetMinutes(tz, new Date(mid)) === startOff) lo = mid; else hi = mid;
        }
        const transDate = new Date(hi);
        const direction = endOff > startOff ? '+' : '-';
        return { date: transDate, from: startOff, to: endOff, direction };
      }
    }
    return null;
  } catch (e) { return null; }
}

function workingHoursOverlap(offA, offB) {
  const aStart = 9 * 60 - offA;
  const aEnd = 17 * 60 - offA;
  const bStart = 9 * 60 - offB;
  const bEnd = 17 * 60 - offB;
  const overlapStart = Math.max(aStart, bStart);
  const overlapEnd = Math.min(aEnd, bEnd);
  const overlap = overlapEnd - overlapStart;
  return { overlap, overlapStart, overlapEnd };
}

function formatMinutes(m) {
  const h = Math.floor(Math.abs(m) / 60);
  const min = Math.abs(m) % 60;
  const sign = m >= 0 ? '+' : '-';
  return h > 0 ? 'UTC' + sign + h + (min > 0 ? ':' + String(min).padStart(2, '0') : '') : 'UTC';
}

function formatOverlapMins(m) {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return h > 0 ? h + 'h' + (min > 0 ? ' ' + min + 'm' : '') : min + 'm';
}

function CountryTimezone({ initialData, onShare, onNav }) {
  const { t } = useTranslation();
  const [tab, setTab] = usePersistentState('ctz:tab', initialData?.activeTab ?? initialData?.tab ?? 'lookup');
  const [search, setSearch] = usePersistentState('ctz:search', '');
  const [selected, setSelected] = usePersistentState('ctz:selected', null);
  const [compare, setCompare] = usePersistentState('ctz:compare', []);
  const [now, setNow] = useState(Date.now());
  const [refDateInput, setRefDateInput] = useState('');
  const refDate = useMemo(() => {
    if (!refDateInput) return null;
    try {
      const d = new Date(refDateInput + 'Z');
      return isNaN(d.getTime()) ? null : d;
    } catch (e) { return null; }
  }, [refDateInput]);
  const effectiveDate = refDate || new Date(now);

  useEffect(() => {
    if (initialData) {
      const incomingTab = initialData.activeTab ?? initialData.tab;
      if (incomingTab) setTab(incomingTab);
      if (initialData.selected) setSelected(initialData.selected);
      if (initialData.compare) setCompare(initialData.compare);
    }
  }, [initialData]);

  useEffect(() => { onNav?.({ activeTab: tab }); }, [tab]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handle = (e) =>
      (e.detail && e.detail.respond ? e.detail.respond : onShare)({ tool: 'country-tz', tab, selected, compare });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [tab, selected, compare, onShare]);

  const filtered = useMemo(() => {
    const query = search.trim();
    if (!query) return COUNTRY_TZ_DATA;

    let regex = null;
    try {
      regex = new RegExp(query, 'i');
    } catch (e) {
      // Fallback if regex is incomplete/invalid while user is typing
    }

    if (regex) {
      return COUNTRY_TZ_DATA.filter(c =>
        regex.test(c.n) ||
        regex.test(c.i2) ||
        regex.test(c.i3) ||
        regex.test(c.d) ||
        c.tz.some(z => regex.test(z))
      );
    }

    const q = query.toLowerCase();
    return COUNTRY_TZ_DATA.filter(c =>
      c.n.toLowerCase().includes(q) ||
      c.i2.toLowerCase() === q ||
      c.i3.toLowerCase() === q ||
      c.d.includes(q) ||
      c.tz.some(z => z.toLowerCase().includes(q))
    );
  }, [search]);

  const selectedCountry = useMemo(() => {
    if (!selected) return null;
    return COUNTRY_TZ_DATA.find(c => c.i2 === selected) || null;
  }, [selected]);

  const [compareSearch, setCompareSearch] = useState('');
  const [compareDropdownOpen, setCompareDropdownOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);

  const addCompare = (iso2) => {
    if (!compare.includes(iso2)) {
      setCompare([...compare, iso2]);
    }
    setCompareSearch('');
    setCompareDropdownOpen(false);
    setHighlightIndex(-1);
  };

  const removeCompare = (iso2) => {
    setCompare(compare.filter(x => x !== iso2));
  };

  const compareFiltered = useMemo(() => {
    const available = COUNTRY_TZ_DATA.filter(c => !compare.includes(c.i2));
    if (!compareSearch.trim()) return available;
    const q = compareSearch.toLowerCase();
    return available.filter(c =>
      c.n.toLowerCase().includes(q) ||
      c.i2.toLowerCase() === q ||
      c.i3.toLowerCase() === q
    );
  }, [compare, compareSearch]);

  const compareVisibleCount = compareFiltered.length;

  const handleCompareKeyDown = useCallback((e) => {
    if (!compareDropdownOpen || compareVisibleCount === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex(i => (i + 1) % compareVisibleCount);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex(i => i <= 0 ? compareVisibleCount - 1 : i - 1);
    } else if (e.key === 'Enter' && highlightIndex >= 0 && highlightIndex < compareVisibleCount) {
      e.preventDefault();
      addCompare(compareFiltered[highlightIndex].i2);
    } else if (e.key === 'Escape') {
      setCompareDropdownOpen(false);
      setHighlightIndex(-1);
    }
  }, [compareDropdownOpen, compareVisibleCount, highlightIndex, compareFiltered]);

  useEffect(() => { setHighlightIndex(-1); }, [compareSearch]);

  const tabs = [
    { id: 'lookup', icon: '🔍' },
    { id: 'compare', icon: '🌍' },
  ];

  return (
    <div className="fadein">
      {/* Tab Bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {tabs.map(tb => (
          <button
            key={tb.id}
            className={tab === tb.id ? 'btn btn-primary' : 'btn btn-ghost'}
            onClick={() => setTab(tb.id)}
          >
            {tb.icon} {t('country_tz.tab_' + tb.id)}
          </button>
        ))}
      </div>

      {tab === 'lookup' && (
        <div>
          {/* Search */}
          <div className="field">
            <label className="label">{t('country_tz.search_label')}</label>
            <input
              className="input"
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('country_tz.search_placeholder')}
            />
            <div className="hint">{t('country_tz.search_hint')}</div>
          </div>

          {/* Country Detail Card */}
          {selectedCountry && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <span style={{ fontSize: 32 }}>{flagEmoji(selectedCountry.i2)}</span>
                <div>
                  <div className="card-title">{selectedCountry.n}</div>
                  <span className="badge badge-cyan" style={{ marginRight: 4 }}>{selectedCountry.i2}</span>
                  <span className="badge badge-blue" style={{ marginRight: 4 }}>{selectedCountry.i3}</span>
                  <span className="badge badge-purple">{t('country_tz.numeric')}: {selectedCountry.nu}</span>
                </div>
              </div>

              <div className="result-grid">
                <div className="result-item">
                  <span className="result-label">{t('country_tz.dial_code')}</span>
                  <span className="result-value">{selectedCountry.d}</span>
                </div>
                <div className="result-item">
                  <span className="result-label">{t('country_tz.iso_alpha2')}</span>
                  <span className="result-value">{selectedCountry.i2}</span>
                </div>
                <div className="result-item">
                  <span className="result-label">{t('country_tz.iso_alpha3')}</span>
                  <span className="result-value">{selectedCountry.i3}</span>
                </div>
                <div className="result-item">
                  <span className="result-label">{t('country_tz.numeric')}</span>
                  <span className="result-value">{selectedCountry.nu}</span>
                </div>
              </div>

              {/* Timezones */}
              <div style={{ marginTop: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>{t('country_tz.timezones')}</div>
                {selectedCountry.tz.map(tz => (
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 12px',
                    background: 'var(--card)',
                    borderRadius: 6,
                    marginBottom: 4,
                  }}>
                    <div>
                      <div style={{ fontWeight: 500, color: 'var(--text)' }}>{tz}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {getOffsetStr(tz, effectiveDate)} {isDST(tz, effectiveDate) ? '• ' + t('country_tz.dst_active') : ''}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 18, fontFamily: 'monospace', fontWeight: 600, color: 'var(--text)' }}>
                        {getTimeInZone(tz, effectiveDate)}
                      </div>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ marginTop: 2, fontSize: 11 }}
                        onClick={() => addCompare(selectedCountry.i2)}
                      >
                        + {t('country_tz.add_compare')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setSelected(null)}>
                ✕ {t('country_tz.close')}
              </button>
            </div>
          )}

          {/* Country List */}
          <div className="card">
            <div className="card-title" style={{ marginBottom: 8 }}>
              {t('country_tz.countries_count', { count: filtered.length })}
            </div>
            <div style={{ maxHeight: 'calc(100vh - 330px)', overflowY: 'auto' }}>
              {filtered.map(c => (
                <div
                  key={c.i2}
                  onClick={() => setSelected(c.i2)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '6px 10px',
                    cursor: 'pointer',
                    borderRadius: 6,
                    background: selected === c.i2 ? 'rgba(0,200,255,0.1)' : 'transparent',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => { if (selected !== c.i2) e.currentTarget.style.background = 'var(--card)'; }}
                  onMouseLeave={e => { if (selected !== c.i2) e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ fontSize: 20 }}>{flagEmoji(c.i2)}</span>
                  <span style={{ flex: 1, color: 'var(--text)' }}>{c.n}</span>
                  <span className="badge badge-cyan" style={{ fontSize: 11 }}>{c.i2}</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--muted)' }}>{c.d}</span>
                  {c.tz.length === 1 && (
                    <span style={{ fontFamily: 'monospace', fontSize: 12, minWidth: 64, textAlign: 'right', color: 'var(--text)' }}>
                      {getTimeInZone(c.tz[0], effectiveDate)}
                    </span>
                  )}
                  {c.tz.length > 1 && (
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {c.tz.length} {t('country_tz.tz_count')}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'compare' && (
        <div>
          {/* Add country to compare — searchable select */}
          <div className="field">
            <label className="label">{t('country_tz.add_country')}</label>
            <div style={{ position: 'relative' }}>
              <input
                className="input"
                type="text"
                value={compareSearch}
                onChange={e => { setCompareSearch(e.target.value); setCompareDropdownOpen(true); }}
                onFocus={() => setCompareDropdownOpen(true)}
                onKeyDown={handleCompareKeyDown}
                placeholder={t('country_tz.select_country')}
                autoComplete="off"
              />
              {compareDropdownOpen && compareFiltered.length > 0 && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  zIndex: 50,
                  maxHeight: 240,
                  overflowY: 'auto',
                  background: 'var(--panel)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  marginTop: 2,
                  boxShadow: '0 8px 24px rgba(0,0,0,.25)',
                }}>
                  {compareFiltered.map((c, idx) => (
                    <div
                      key={c.i2}
                      onClick={() => addCompare(c.i2)}
                      onMouseEnter={() => setHighlightIndex(idx)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '7px 12px',
                        cursor: 'pointer',
                        fontSize: 13,
                        transition: 'background 0.1s',
                        background: idx === highlightIndex ? 'var(--card)' : 'transparent',
                      }}
                    >
                      <span style={{ fontSize: 18 }}>{flagEmoji(c.i2)}</span>
                      <span style={{ flex: 1, color: 'var(--text)' }}>{c.n}</span>
                      <span className="badge badge-cyan" style={{ fontSize: 10 }}>{c.i2}</span>
                    </div>
                  ))}
                </div>
              )}
              {/* Close dropdown when clicking outside */}
              {compareDropdownOpen && (
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 40 }}
                  onClick={() => setCompareDropdownOpen(false)}
                />
              )}
            </div>
            <div className="hint">{t('country_tz.compare_hint')}</div>
          </div>

          {/* Future date/time picker */}
          <div className="field" style={{ marginBottom: 16 }}>
            <label className="label">{t('country_tz.ref_datetime')}</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                className="input"
                type="datetime-local"
                value={refDateInput}
                onChange={e => setRefDateInput(e.target.value)}
                style={{ flex: 1 }}
              />
              {refDateInput && (
                <button className="btn btn-ghost btn-sm" onClick={() => setRefDateInput('')}>
                  ✕
                </button>
              )}
            </div>
            <div className="hint">
              {refDate
                ? t('country_tz.ref_showing_for', { date: refDate.toLocaleString('en-GB', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }) })
                : t('country_tz.ref_hint')
              }
            </div>
          </div>

          {compare.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>🌍</div>
              <div>{t('country_tz.compare_empty')}</div>
            </div>
          )}

          {/* Side-by-side comparison */}
          {compare.length > 0 && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 12,
              marginBottom: 16,
            }}>
              {compare.map(iso2 => {
                const c = COUNTRY_TZ_DATA.find(x => x.i2 === iso2);
                if (!c) return null;
                const primaryTz = c.tz[0];
                const offsetMin = getUtcOffsetMinutes(primaryTz, effectiveDate);
                return (
                  <div key={iso2} className="card" style={{ position: 'relative' }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ position: 'absolute', top: 4, right: 4, padding: '2px 6px', fontSize: 12 }}
                      onClick={() => removeCompare(iso2)}
                    >✕</button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 24 }}>{flagEmoji(iso2)}</span>
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--text)' }}>{c.n}</div>
                        <span className="badge badge-cyan" style={{ fontSize: 10 }}>{iso2}</span>
                        <span style={{ marginLeft: 6, fontSize: 12, color: 'var(--muted)' }}>{c.d}</span>
                      </div>
                    </div>
                    {c.tz.map(tz => (
                      <div key={tz} style={{
                        padding: '8px 10px',
                        background: 'var(--card)',
                        borderRadius: 6,
                        marginBottom: 4,
                      }}>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{tz}</div>
                        <div style={{ fontSize: 22, fontFamily: 'monospace', fontWeight: 700, color: 'var(--text)' }}>
                          {getTimeInZone(tz, effectiveDate)}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {getOffsetStr(tz, effectiveDate)} {isDST(tz, effectiveDate) ? '• ' + t('country_tz.dst_badge') : ''}
                        </div>
                        {(() => {
                          const trans = getDstTransition(tz, effectiveDate);
                          if (!trans) return null;
                          return (
                            <div style={{ fontSize: 10, color: 'var(--yellow)', marginTop: 2 }}>
                              {t('country_tz.dst_transition', {
                                date: trans.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
                                from: formatMinutes(trans.from),
                                to: formatMinutes(trans.to),
                                dir: trans.direction === '+' ? '↑' : '↓'
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {/* Time Difference table */}
          {compare.length >= 2 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title" style={{ marginBottom: 8 }}>{t('country_tz.time_diff_title')}</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}></th>
                      {compare.map(iso2 => {
                        const c = COUNTRY_TZ_DATA.find(x => x.i2 === iso2);
                        return (
                          <th key={iso2} style={{ padding: '6px 10px', textAlign: 'center', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                            {flagEmoji(iso2)} {c ? c.n : iso2}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {compare.map((iso2A) => {
                      const cA = COUNTRY_TZ_DATA.find(x => x.i2 === iso2A);
                      const offA = cA ? getUtcOffsetMinutes(cA.tz[0], effectiveDate) : 0;
                      return (
                        <tr key={iso2A}>
                          <td style={{ padding: '6px 10px', fontWeight: 500, whiteSpace: 'nowrap' }}>
                            {flagEmoji(iso2A)} {cA ? cA.n : iso2A}
                            <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--muted)' }}>
                              ({formatMinutes(offA)})
                            </span>
                          </td>
                          {compare.map(iso2B => {
                            if (iso2A === iso2B) {
                              return (
                                <td key={iso2B} style={{ padding: '6px 10px', textAlign: 'center', color: 'var(--dim)', borderBottom: '1px solid var(--border)' }}>
                                  —
                                </td>
                              );
                            }
                            const cB = COUNTRY_TZ_DATA.find(x => x.i2 === iso2B);
                            const offB = cB ? getUtcOffsetMinutes(cB.tz[0], effectiveDate) : 0;
                            const diff = offB - offA;
                            return (
                              <td key={iso2B} style={{ padding: '6px 10px', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>
                                <div style={{ fontWeight: 600, color: diff === 0 ? 'var(--green)' : 'var(--text)' }}>
                                  {diff === 0 ? t('country_tz.same') : (diff > 0 ? '+' : '') + formatMinutes(diff)}
                                </div>
                                {(() => {
                                  const dstA = isDST(cA?.tz[0], effectiveDate);
                                  const dstB = isDST(cB?.tz[0], effectiveDate);
                                  if (dstA !== dstB) {
                                    return (
                                      <div style={{ fontSize: 10, color: 'var(--yellow)', marginTop: 2 }}>
                                        {dstB ? '↑' : '↓'} {t('country_tz.dst_mismatch')}
                                      </div>
                                    );
                                  }
                                  return null;
                                })()}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="hint" style={{ marginTop: 8 }}>{t('country_tz.time_diff_note')}</div>
            </div>
          )}

          {/* Working hours overlap table */}
          {compare.length >= 2 && (
            <div className="card">
              <div className="card-title" style={{ marginBottom: 8 }}>{t('country_tz.working_overlap')}</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}></th>
                      {compare.map(iso2 => {
                        const c = COUNTRY_TZ_DATA.find(x => x.i2 === iso2);
                        return (
                          <th key={iso2} style={{ padding: '6px 10px', textAlign: 'center', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                            {flagEmoji(iso2)} {c ? c.n : iso2}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {compare.map((iso2A, i) => {
                      const cA = COUNTRY_TZ_DATA.find(x => x.i2 === iso2A);
                      const offA = cA ? getUtcOffsetMinutes(cA.tz[0], effectiveDate) : 0;
                      return (
                        <tr key={iso2A}>
                          <td style={{ padding: '6px 10px', fontWeight: 500, whiteSpace: 'nowrap' }}>
                            {flagEmoji(iso2A)} {cA ? cA.n : iso2A}
                            <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--muted)' }}>
                              ({formatMinutes(offA)})
                            </span>
                          </td>
                          {compare.map(iso2B => {
                            const cB = COUNTRY_TZ_DATA.find(x => x.i2 === iso2B);
                            const offB = cB ? getUtcOffsetMinutes(cB.tz[0], effectiveDate) : 0;
                            if (iso2A === iso2B) {
                              return (
                                <td key={iso2B} style={{ padding: '6px 10px', textAlign: 'center', color: 'var(--dim)', borderBottom: '1px solid var(--border)' }}>
                                  —
                                </td>
                              );
                            }
                            const diff = offB - offA;
                            const ov = workingHoursOverlap(offA, offB);
                            const hasOverlap = ov.overlap > 0;
                            return (
                              <td key={iso2B} style={{ padding: '6px 10px', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>
                                <div style={{ fontWeight: 600, color: diff === 0 ? 'var(--green)' : 'var(--text)' }}>
                                  {diff === 0 ? t('country_tz.same') : (diff > 0 ? '+' : '') + formatMinutes(diff)}
                                </div>
                                {hasOverlap && (
                                  <div style={{ fontSize: 11, color: 'var(--green)' }}>
                                    {t('country_tz.overlap')}: {formatOverlapMins(ov.overlap)}
                                  </div>
                                )}
                                {!hasOverlap && (
                                  <div style={{ fontSize: 11, color: 'var(--red)' }}>
                                    {t('country_tz.no_overlap')}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="hint" style={{ marginTop: 8 }}>{t('country_tz.overlap_note')}</div>
            </div>
          )}

          {compare.length > 0 && (
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setCompare([])}>
              {t('country_tz.clear_compare')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

window.CountryTimezone = CountryTimezone;

// Orion — enrichissement Threat Intelligence.
// Pour tout acteur externe : géolocalisation + ASN + réputation IOC.
// NOTE : géo/ASN synthétisés de façon déterministe (démo, zéro dépendance). En production,
// brancher MaxMind GeoIP2 + flux IOC réels (MISP, AbuseIPDB) derrière la même interface.

const COUNTRIES = [
  { cc: 'RU', flag: '🇷🇺', name: 'Russie', asn: 'AS49505 Selectel' },
  { cc: 'CN', flag: '🇨🇳', name: 'Chine', asn: 'AS4134 Chinanet' },
  { cc: 'NL', flag: '🇳🇱', name: 'Pays-Bas', asn: 'AS60781 LeaseWeb' },
  { cc: 'IR', flag: '🇮🇷', name: 'Iran', asn: 'AS44244 Irancell' },
  { cc: 'KP', flag: '🇰🇵', name: 'Corée du Nord', asn: 'AS131279 Star JV' },
  { cc: 'US', flag: '🇺🇸', name: 'États-Unis', asn: 'AS14061 DigitalOcean' },
  { cc: 'DE', flag: '🇩🇪', name: 'Allemagne', asn: 'AS24940 Hetzner' },
  { cc: 'BR', flag: '🇧🇷', name: 'Brésil', asn: 'AS27699 Telefónica' },
];

// Plages connues malveillantes (démo). En prod : flux IOC live.
const BAD_PREFIXES = ['185.220.', '45.83.', '193.142.', '5.188.'];
const CATEGORIES = ['Tor exit node', 'C2 connu', 'Scanner de masse', 'Botnet', 'Bulletproof hosting'];

function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }

function extractIp(ev) {
  return ev.raw?.attacker || ev.raw?.src_ip || ev.raw?.dest_ip
    || (typeof ev.src === 'string' && /\d+\.\d+/.test(ev.src) ? ev.src.replace(/^ext-/, '') : null)
    || (typeof ev.dst === 'string' && /\d+\.\d+/.test(ev.dst) ? ev.dst.replace(/^ext-/, '') : null);
}

function geoFor(ip) {
  const c = COUNTRIES[hashStr(ip || 'x') % COUNTRIES.length];
  return { cc: c.cc, flag: c.flag, country: c.name, asn: c.asn };
}

function intelFor(ip) {
  if (!ip) return { match: false, score: 0 };
  const bad = BAD_PREFIXES.some((p) => ip.startsWith(p));
  const h = hashStr(ip);
  if (!bad) return { match: false, score: h % 25 };          // bruit de fond faible
  const cats = [CATEGORIES[h % CATEGORIES.length]];
  if ((h >> 3) % 2) cats.push(CATEGORIES[(h >> 5) % CATEGORIES.length]);
  return {
    match: true, score: 70 + (h % 30),
    categories: [...new Set(cats)],
    source: 'Orion Threat Feed', firstSeen: '2024-11-02',
  };
}

// Enrichit un Event : ajoute ev.geo et ev.intel si un acteur externe est impliqué.
export function enrich(ev) {
  const hasExternal = [ev.src, ev.dst].some((x) => x && !String(x).startsWith('host-'));
  if (!hasExternal) return ev;
  const ip = extractIp(ev);
  ev.geo = geoFor(ip || ev.src || ev.dst);
  ev.intel = intelFor(ip);
  return ev;
}

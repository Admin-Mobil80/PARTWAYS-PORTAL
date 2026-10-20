// Country picker options from ISO 3166-1 codes, named in the browser's language.
const CODES = 'AD AE AF AG AI AL AM AO AR AT AU AW AZ BA BB BD BE BF BG BH BI BJ BM BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FO FR GA GB GD GE GG GH GI GL GM GN GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PR PS PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS XK YE ZA ZM ZW'.split(' ');

export function countryOptions() {
  let names;
  try { names = new Intl.DisplayNames([navigator.language || 'en'], { type: 'region' }); } catch { names = { of: (c) => c }; }
  return CODES.map((code) => [code, names.of(code) || code]).sort((a, b) => a[1].localeCompare(b[1]));
}

// A sensible default from the browser's locale, for example en-GB → GB.
export function guessCountry() {
  const m = String(navigator.language || '').match(/-([A-Z]{2})$/i);
  const c = m ? m[1].toUpperCase() : '';
  return CODES.includes(c) ? c : '';
}

// Ported from public/admin.js's dashboard program-matching engine (the
// "Recognized" vs "Other" lead classifier), so the WhatsApp bot itself can
// recognize a bare program name/mention with the same fuzzy-matching
// tolerance (typos, abbreviations, extra filler words) the dashboard
// already has - not just the small curated abbreviation list index.js
// used before.
//
// NOTE: this is a COPY, not a shared single source of truth. admin.js runs
// in the browser (plain <script> tag, no bundler/module system) and this
// runs in Node via require() - the two files can't literally share one
// module without adding a build step. If MUL_CANONICAL_PROGRAMS or the
// alias map in normalizeProgramKey ever gets updated in one file, the
// other should be updated to match. Keep this in mind before editing
// either copy.

function titleCase(str) {
  return String(str)
    .split(" ")
    .map(word => word ? word.charAt(0).toUpperCase() + word.slice(1) : "")
    .join(" ");
}

const MUL_CANONICAL_PROGRAMS = [
  "BS Aesthetics and Cosmetology", "ADP Digital Marketing",
  "Accounting & Finance", "Artificial Intelligence", "B.Com (Hons)", "BBA",
  "BS Accounting & Finance", "BS Artificial Intelligence", "BS Bio Chemistry",
  "BS Biotechnology", "BS Business Analytics", "BS Chemistry & Industrial Entrepreneurship",
  "BS Computational Plant Sciences", "BS Computer Science", "BS Criminology and Forensic Sciences",
  "BS Cyber Security", "BS Data Science", "BS Defense and Strategic Studies",
  "BS Digital Marketing", "BS Digital Media Communication", "BS E-Commerce",
  "BS Economics", "BS Economics & Data Science", "BS Economics & Financial Technology",
  "BS Education", "BS Chemical Engineering", "BS Electrical Engineering", "BS Financial Technology",
  "BS Food Science and Technology", "BS Human Nutrition & Dietetics",
  "BS Information Management", "BS Information System & Technology Management",
  "BS Information Technology", "BS International Relations", "BS Islamic Banking & Finance",
  "BS Islamic Banking & Finance Technology", "BS Mathematics & Data Science",
  "BS Medical Lab Technology", "BS Multimedia Arts", "BS Peace & Conflict Studies",
  "BS Political Science", "BS Psychology", "BS Sociology", "BS Software Engineering",
  "BS Statistics & Data Science", "Bioinformatics", "Business Administration",
  "Commerce", "Computer Science", "Cyber Security", "Data Science", "Digital Marketing",
  "Doctor of Pharmacy", "Doctor of Physiotherapy", "Education", "English",
  "Information System & Technology Management", "Information Technology",
  "Islamic Banking and Finance", "LLB", "Bachelor of Laws (LLB)",
  "M.Phil Accounting & Finance", "M.Phil Applied Psychology", "M.Phil Bio Chemistry",
  "M.Phil Botany", "M.Phil Chemistry", "M.Phil Clinical Nutrition", "M.Phil Computer Science",
  "M.Phil Economics", "M.Phil Education", "M.Phil English (Linguistics)",
  "M.Phil English (Literature)", "M.Phil Food Science & Technology",
  "M.Phil Halal Food Safety Management", "M.Phil International Relations",
  "M.Phil Library Information Science", "M.Phil Management Science", "M.Phil Mathematics",
  "M.Phil Peace & Counter Terrorism", "M.Phil Pharmacology", "M.Phil Physics",
  "M.Phil Political Science", "M.Phil Sociology", "M.Phil Statistics",
  "M.Phil Theology and Religious Studies", "M.Phil Urdu", "M.Phil Zoology",
  "MBA Executive", "MBA Professional", "MS Data Science", "MS Islamic Banking & Finance",
  "Mass Communication", "PhD Bio Chemistry", "PhD Economics", "PhD Education",
  "PhD English Linguistics", "PhD Food Science & Technology", "PhD International Relations",
  "PhD Islamic Economics & Finance", "PhD Library & Information Science",
  "PhD Management Science", "PhD Mass Communication", "PhD Mathematics",
  "PhD Peace and Counter Terrorism", "PhD Pharmacology", "PhD Political Science",
  "PhD Sociology", "PhD Urdu", "Political Science", "Psychology", "Sociology",
  "Software Engineering"
];

function tightClean(str) {
  return String(str || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function levenshteinDistance(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function stringSimilarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (!maxLen) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

const PROGRAM_MATCH_STOP_WORDS = new Set([
  "bs", "ms", "phd", "and", "or", "of", "the", "in", "for", "m", "phil", "mphil",
  "science", "sciences", "studies", "with", "program", "programme", "course",
  "degree", "non", "but", "one", "only", "how", "who", "why", "not", "you",
  "apply", "applying", "admission", "through", "graduate", "guide", "about"
]);

function significantProgramWords(str) {
  return tightClean(str)
    ? String(str).toLowerCase().replace(/[^a-z0-9]/g, " ").split(/\s+/).filter(w => w.length > 2 && !PROGRAM_MATCH_STOP_WORDS.has(w))
    : [];
}

const CANONICAL_WORD_PROGRAM_COUNT = {};
MUL_CANONICAL_PROGRAMS.forEach(p => {
  significantProgramWords(p).forEach(w => {
    CANONICAL_WORD_PROGRAM_COUNT[w] = (CANONICAL_WORD_PROGRAM_COUNT[w] || 0) + 1;
  });
});
function isDistinctiveProgramWord(word) {
  return (CANONICAL_WORD_PROGRAM_COUNT[word] || 0) <= 1;
}

function wordsMatch(a, b) {
  if (a === b) return true;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return true;
  return stringSimilarity(a, b) >= 0.8;
}

function matchSingleProgramString(rawProgram, allowFuzzy = true, strict = false) {
  if (!rawProgram) return null;

  const aliasResult = normalizeProgramKey(rawProgram);
  const aliasMatch = MUL_CANONICAL_PROGRAMS.find(p => p.toLowerCase() === aliasResult.toLowerCase());
  if (aliasMatch) return aliasMatch;

  const inputTight = tightClean(rawProgram);
  if (inputTight) {
    const tightMatch = MUL_CANONICAL_PROGRAMS.find(p => tightClean(p) === inputTight);
    if (tightMatch) return tightMatch;
  }

  if (!allowFuzzy) return null;

  const inputWords = significantProgramWords(rawProgram);
  if (inputWords.length) {
    let bestMatch = null;
    let bestScore = 0;
    let bestMatchedCount = 0;
    for (const canonical of MUL_CANONICAL_PROGRAMS) {
      const canonicalWords = significantProgramWords(canonical);
      if (!canonicalWords.length) continue;
      // strict mode (bot use, scanning arbitrary sentences rather than a
      // dedicated program-name field): skip canonicals with only one
      // significant word ("BS E-Commerce" -> just "commerce") from this
      // fuzzy tier - a single ordinary English word that's merely similar
      // in spelling ("commence" ~ "commerce") would otherwise "fully
      // cover" a one-word canonical and false-match.
      if (strict && canonicalWords.length < 2) continue;
      const matched = canonicalWords.filter(cw => inputWords.some(iw => wordsMatch(iw, cw))).length;
      const score = matched / canonicalWords.length;
      if (score > bestScore || (score === bestScore && matched > bestMatchedCount)) {
        bestScore = score;
        bestMatch = canonical;
        bestMatchedCount = matched;
      }
    }
    if (bestScore >= 1) return bestMatch;

    // Narrow single-keyword typo fallback - deliberately skipped in strict
    // mode. It's tuned for a dedicated program-name field ("criminilogy"
    // typed as someone's whole answer to "which program?"); against
    // arbitrary free-text sentences it false-matches ordinary words that
    // happen to be a close spelling of a distinctive program keyword
    // ("applied" in "I already applied" matching "M.Phil Applied
    // Psychology").
    if (!strict && inputWords.length <= 2) {
      let bestKeywordScore = 0;
      let bestKeywordMatch = null;
      for (const canonical of MUL_CANONICAL_PROGRAMS) {
        for (const cw of significantProgramWords(canonical)) {
          if (cw.length < 7 || !isDistinctiveProgramWord(cw)) continue;
          for (const iw of inputWords) {
            if (iw.length < 7) continue;
            const sim = stringSimilarity(iw, cw);
            if (sim > bestKeywordScore) { bestKeywordScore = sim; bestKeywordMatch = canonical; }
          }
        }
      }
      if (bestKeywordScore >= 0.85) return bestKeywordMatch;
    }
  }

  return null;
}

function findMatchingCanonicalProgram(rawProgram, strict = false) {
  if (!rawProgram) return null;

  const exactWhole = matchSingleProgramString(rawProgram, false);
  if (exactWhole) return exactWhole;

  const trySplit = (regex) => {
    if (!regex.test(rawProgram)) return null;
    for (const piece of rawProgram.split(regex)) {
      const pieceMatch = matchSingleProgramString(piece.trim(), true, strict);
      if (pieceMatch) return pieceMatch;
    }
    return null;
  };

  const splitMatch = trySplit(/[,;]/) || trySplit(/\s+or\s+/i) || trySplit(/\s*&\s*|\s+and\s+/i);
  if (splitMatch) return splitMatch;

  return matchSingleProgramString(rawProgram, true, strict);
}

// Bot-facing variant: same engine, but scanning an arbitrary sentence
// rather than a dedicated "program" field, so the riskiest fuzzy tiers are
// dialed back (see the `strict` branches in matchSingleProgramString).
// Exact/alias/tight-clean matches (a real program name, cleanly typed,
// however punctuated) are unaffected either way.
function findMatchingCanonicalProgramStrict(rawProgram) {
  return findMatchingCanonicalProgram(rawProgram, true);
}

function isRecognizedProgram(rawProgram) {
  return !!findMatchingCanonicalProgram(rawProgram);
}

// Extracted to module scope (not just local to normalizeProgramKey) so it
// can also be used to seed initial keywords for existing fee_programs rows
// (see index.js's startup migration) - a reverse lookup of "which aliases
// point at this canonical program name" gives new admin-editable keyword
// fields a real starting point instead of launching empty.
const PROGRAM_ALIAS_MAP = {
    "bscs": "BS Computer Science", "bs cs": "BS Computer Science", "cs": "BS Computer Science",
    "computer science": "BS Computer Science", "bs computer science": "BS Computer Science",

    "bsse": "BS Software Engineering", "bs se": "BS Software Engineering", "se": "BS Software Engineering",
    "software engineering": "BS Software Engineering", "bs software engineering": "BS Software Engineering",

    "bsai": "BS Artificial Intelligence", "bs ai": "BS Artificial Intelligence", "ai": "BS Artificial Intelligence",
    "artificial intelligence": "BS Artificial Intelligence", "bs artificial intelligence": "BS Artificial Intelligence",

    "bscys": "BS Cyber Security", "bs cys": "BS Cyber Security", "cyber security": "BS Cyber Security",
    "cybersecurity": "BS Cyber Security", "bs cyber security": "BS Cyber Security",

    "bsds": "BS Data Science", "bs ds": "BS Data Science", "data science": "BS Data Science",
    "bs data science": "BS Data Science", "ms data science": "MS Data Science",

    "bsit": "BS Information Technology", "bs it": "BS Information Technology", "it": "BS Information Technology",
    "information technology": "BS Information Technology", "bs information technology": "BS Information Technology",

    "bs im": "BS Information Management", "information management": "BS Information Management",

    "istm": "BS Information System & Technology Management", "bs istm": "BS Information System & Technology Management",

    "af": "BS Accounting & Finance", "accounting and finance": "BS Accounting & Finance",
    "accounting & finance": "BS Accounting & Finance", "bs accounting & finance": "BS Accounting & Finance",
    "bs accounting and finance": "BS Accounting & Finance",

    "business analytics": "BS Business Analytics", "bs business analytics": "BS Business Analytics",

    "bba": "BBA", "business administration": "BBA",

    "bcom": "B.Com (Hons)", "b.com": "B.Com (Hons)", "b com": "B.Com (Hons)", "bcom hons": "B.Com (Hons)",

    "biotech": "BS Biotechnology", "biotechnology": "BS Biotechnology", "bs biotechnology": "BS Biotechnology",

    "biochemistry": "BS Bio Chemistry", "bio chemistry": "BS Bio Chemistry",

    "criminology": "BS Criminology and Forensic Sciences", "forensics": "BS Criminology and Forensic Sciences",
    "forensic science": "BS Criminology and Forensic Sciences",

    "digital marketing": "BS Digital Marketing", "bs digital marketing": "BS Digital Marketing",

    "digital media": "BS Digital Media Communication",

    "ecommerce": "BS E-Commerce", "e-commerce": "BS E-Commerce",

    "economics": "BS Economics", "eco": "BS Economics", "bs economics": "BS Economics",

    "education": "BS Education", "bs education": "BS Education",

    "fintech": "BS Financial Technology", "financial technology": "BS Financial Technology",

    "food science": "BS Food Science and Technology",

    "nutrition": "BS Human Nutrition & Dietetics", "dietetics": "BS Human Nutrition & Dietetics",

    "ir": "BS International Relations", "international relations": "BS International Relations",
    "bs international relations": "BS International Relations",

    "islamic banking": "BS Islamic Banking & Finance", "ibf": "BS Islamic Banking & Finance",
    "islamic banking and finance": "BS Islamic Banking & Finance", "ms ibf": "MS Islamic Banking & Finance",

    "mlt": "BS Medical Lab Technology", "medical lab technology": "BS Medical Lab Technology",

    "multimedia": "BS Multimedia Arts", "multimedia arts": "BS Multimedia Arts",

    "peace studies": "BS Peace & Conflict Studies",

    "political science": "BS Political Science", "poli sci": "BS Political Science", "ps": "BS Political Science",
    "bs political science": "BS Political Science",

    "psychology": "BS Psychology", "psych": "BS Psychology", "bs psychology": "BS Psychology",

    "sociology": "BS Sociology", "socio": "BS Sociology", "bs sociology": "BS Sociology",

    "statistics": "BS Statistics & Data Science",

    "dpt": "Doctor of Physiotherapy",

    "pharmd": "Doctor of Pharmacy", "pharm-d": "Doctor of Pharmacy", "pharm d": "Doctor of Pharmacy",
    "d pharm": "Doctor of Pharmacy", "d-pharm": "Doctor of Pharmacy", "dpharm": "Doctor of Pharmacy",
    "doctor of pharmacy": "Doctor of Pharmacy", "pharmacy": "Doctor of Pharmacy",

    "llb": "Bachelor of Laws (LLB)", "bs llb": "Bachelor of Laws (LLB)", "law": "Bachelor of Laws (LLB)",
    "bachelor of law": "Bachelor of Laws (LLB)", "bachelor of laws": "Bachelor of Laws (LLB)",

    "mass comm": "Mass Communication", "masscom": "Mass Communication", "mass communication": "Mass Communication",

    "mba": "MBA Professional", "mba professional": "MBA Professional",
    "mba executive": "MBA Executive", "executive mba": "MBA Executive",

    "english": "English",

    "m.phil education": "M.Phil Education", "mphil education": "M.Phil Education",
    "m.phil sociology": "M.Phil Sociology", "mphil sociology": "M.Phil Sociology",
    "m.phil computer science": "M.Phil Computer Science", "mphil computer science": "M.Phil Computer Science",
    "m.phil economics": "M.Phil Economics", "mphil economics": "M.Phil Economics",

    "phd economics": "PhD Economics", "phd education": "PhD Education", "phd mass communication": "PhD Mass Communication",

    "mphil linguistics": "M.Phil English (Linguistics)", "mphill linguistics": "M.Phil English (Linguistics)",
    "m.phil linguistics": "M.Phil English (Linguistics)", "phd linguistics": "PhD English Linguistics",
    "linguistics": "M.Phil English (Linguistics)",

    "bs ir": "BS International Relations", "mphil ir": "M.Phil International Relations",
    "phd ir": "PhD International Relations",

    "chemical engineering": "BS Chemical Engineering", "bsc chemical engineering": "BS Chemical Engineering",
    "bs chemical engineering": "BS Chemical Engineering", "b.sc chemical engineering": "BS Chemical Engineering",

    "electrical engineering": "BS Electrical Engineering", "bsc electrical": "BS Electrical Engineering",
    "b.sc electrical engineering": "BS Electrical Engineering",

    "bs law": "Bachelor of Laws (LLB)",

    "bs human nutrition and dietician": "BS Human Nutrition & Dietetics",
    "human nutrition and dietician": "BS Human Nutrition & Dietetics",
    "bs hnd": "BS Human Nutrition & Dietetics", "hnd": "BS Human Nutrition & Dietetics",

    "bs mlt": "BS Medical Lab Technology",

    "bs accounts and finance": "BS Accounting & Finance", "bs accounting and financial": "BS Accounting & Finance",
    "accounts and finance": "BS Accounting & Finance",

    "mphil biochem": "M.Phil Bio Chemistry", "mphill biochem": "M.Phil Bio Chemistry", "biochem": "M.Phil Bio Chemistry",

    "ms food science": "M.Phil Food Science & Technology", "phd food sci": "PhD Food Science & Technology",
    "mphil in food sciences": "M.Phil Food Science & Technology", "mphil food science": "M.Phil Food Science & Technology",

    "bs media and communication studies": "Mass Communication", "bs media and communications": "Mass Communication",
    "media and communication": "Mass Communication",

    "bs cs 5th semester": "BS Computer Science",

    "emba": "MBA Executive",

    "pharm.d": "Doctor of Pharmacy", "pham d": "Doctor of Pharmacy",

    "bsenglish": "English",

    "mphil criminolology": "BS Criminology and Forensic Sciences", "mphil criminology": "BS Criminology and Forensic Sciences",
    "m.phill linguistics": "M.Phil English (Linguistics)",

    "bs doctor of physical therapy": "Doctor of Physiotherapy", "doctor of physical therapy": "Doctor of Physiotherapy",
    "physical therapy": "Doctor of Physiotherapy",

    "bs physcology": "BS Psychology", "physcology": "BS Psychology",

    "bsc electrical engineering": "BS Electrical Engineering", "bs electrical engineering": "BS Electrical Engineering",

    "bs nutrition": "BS Human Nutrition & Dietetics",

    "adp digital marking": "ADP Digital Marketing", "adp digital marketing": "ADP Digital Marketing",

    "bssc": "BS Computer Science",

    "bsaf": "BS Accounting & Finance",

    "mphil pct": "M.Phil Peace & Counter Terrorism", "pct": "M.Phil Peace & Counter Terrorism",

    "bs ai program": "BS Artificial Intelligence", "ai program": "BS Artificial Intelligence",
    "bs al": "BS Artificial Intelligence"
};

function normalizeProgramKey(name) {
  if (!name) return "";
  const raw = String(name)
    .trim()
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/^[,.\-()\s]+/, "")
    .replace(/[,.\-()\s]+$/, "")
    .replace(/\s+/g, " ");

  return PROGRAM_ALIAS_MAP[raw] || titleCase(raw);
}

function escapeRegExpLiteralExport(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  MUL_CANONICAL_PROGRAMS,
  PROGRAM_ALIAS_MAP,
  findMatchingCanonicalProgram,
  findMatchingCanonicalProgramStrict,
  isRecognizedProgram,
  normalizeProgramKey,
  // Lower-level primitives, exported for reuse by index.js's live
  // fee_programs catalog matcher (matchFeeProgramFromCatalog) - avoids a
  // third copy of the same string-matching logic.
  tightClean,
  stringSimilarity,
  significantProgramWords,
  escapeRegExpLiteral: escapeRegExpLiteralExport
};

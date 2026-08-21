// MUL's own numeric program IDs (the "id,0" values from admission.mul.edu.pk's
// registration.php Program dropdown) - scraped directly from the live site,
// not guessed. cms.mul.edu.pk's registration API rejects a plain program
// name ("BS Data Science") with "Validation failed" but accepted this exact
// numeric format in testing, so every registration submission needs to
// resolve to one of these IDs before it's sent.
//
// Scoped by category (adp/bs/mphil/phd/course) because the same bare name
// can exist in more than one category with a DIFFERENT id - our own
// fee_programs table uses short bare names for Associate Degree programs
// ("Artificial Intelligence", "Business Administration"...) that would
// otherwise collide with the identically-named BS program.
//
// Keys are tightClean()'d (lowercased, "&" normalized to "and", all other
// non-alphanumeric characters stripped) by the lookup function below - not
// meant to be read directly.

const MUL_PROGRAM_IDS = {
  adp: {
    "adpinformationsystemandtechnologymanagement": "360,0",
    "informationsystemandtechnologymanagement": "360,0",
    "artificialintelligence": "261,0",
    "cybersecurity": "262,0",
    "accountingandfinance": "224,0",
    "bioinformatics": "347,0",
    "businessadministration": "223,0",
    "computerscience": "230,0",
    "datascience": "304,0",
    "adpdigitalmarketing": "284,0",
    "digitalmarketing": "284,0",
    "education": "15,0",
    "english": "234,0",
    "informationtechnology": "259,0",
    "islamicbankingandfinance": "225,0",
    "islamicbankingfinance": "225,0",
    "masscommunication": "233,0",
    "politicalscience": "274,0",
    "psychology": "503,0",
    "sociology": "275,0",
    "softwareengineering": "260,0",
    "commerce": "3,0",
    "bcom": "3,0",
    "bcomassociatedegreeincommerce": "3,0"
  },

  bs: {
    "bszoologyandentomology": "362,0",
    "bcom4year": "92,0",
    "bcomhons": "92,0",
    "bscchemicalengineering": "130,0",
    "bschemicalengineering": "130,0",
    "bscelectricalengineering": "135,0",
    "bselectricalengineering": "135,0",
    "bacheloroflawsllb4years": "491,0",
    "bacheloroflawsllb": "491,0",
    "llb": "491,0",
    "bachelorofscienceinfinancialtechnology": "338,0",
    "bsfinancialtechnology": "338,0",
    "bba": "4,0",
    "businessadministration": "4,0",
    "bsaccountingandfinance": "93,0",
    "accountingandfinance": "93,0",
    "bsaesthetesandcosmetology": "515,0",
    "bsaestheticsandcosmetology": "515,0",
    "aestheticsandcosmetology": "515,0",
    "bsartificialintelligence": "240,0",
    "bsbiochemistry": "172,0",
    "bsbiochemistery": "172,0",
    "bsbiotechnology": "243,0",
    "bsbusinessanalytics": "492,0",
    "bschemistryandindustrialentrepreneurship": "356,0",
    "bscomputationalplantsciences": "357,0",
    "bscomputerscience": "1,0",
    "computerscience": "1,0",
    "bscriminologyandforensicsciences": "281,0",
    "bscybersecurity": "241,0",
    "bsdatascience": "292,0",
    "bsdefenseandstrategicstudies": "371,0",
    "bsdigitalmarketing": "286,0",
    "bsecommerce": "302,0",
    "bseconomics": "64,0",
    "bseconomicsanddatascience": "353,0",
    "bseconomicsandfinancialtechnology": "66,0",
    "bseducation": "155,0",
    "bsenglish": "10,0",
    "english": "10,0",
    "bsfoodscienceandtechnology": "166,0",
    "bsfoodsciencetechnology": "166,0",
    "bshumannutritionanddietetics": "245,0",
    "bshumannutritiondietetics": "245,0",
    "bsindigitalmediacommunication": "311,0",
    "bsdigitalmediacommunication": "311,0",
    "bsinmultimediaartsanimation": "312,0",
    "bsmultimediaarts": "312,0",
    "bsinformationmanagement": "365,0",
    "bsinformationsystemandtechnologymanagement": "361,0",
    "informationsystemandtechnologymanagement": "361,0",
    "bsinformationtechnology": "2,0",
    "informationtechnology": "2,0",
    "bsinternationalrelations": "14,0",
    "bsislamicbankingandfinancialtechnology": "366,0",
    "bsislamicbankingandfinancetechnology": "366,0",
    "bsislamicbankingandfinance": "71,0",
    "islamicbankingandfinance": "71,0",
    "bsmathematicsanddatascience": "367,0",
    "bsmedicallaboratorytechnology": "24,0",
    "bsmedicallabtechnology": "24,0",
    "bspeaceandconflictstudies": "180,0",
    "bspoliticalscience": "13,0",
    "politicalscience": "13,0",
    "bspsychology": "507,0",
    "psychology": "507,0",
    "bssociology": "121,0",
    "sociology": "121,0",
    "bssoftwareengineering": "9,0",
    "softwareengineering": "9,0",
    "bsstatisticsanddatascience": "358,0",
    "doctorofpharmacy": "256,0",
    "doctorofphysicaltherapy": "508,0",
    "doctorofphysicaltherapydpt": "508,0",
    "doctorofphysiotherapy": "508,0"
  },

  mphil: {
    "mphilaccountingandfinance": "88,0",
    "accountingandfinance": "88,0",
    "mphilappliedpsychology": "289,0",
    "mphilbiochemistry": "152,0",
    "mphilbiochemistery": "152,0",
    "mphilbotany": "117,0",
    "mphilchemistry": "53,0",
    "mphilclinicalnutrition": "153,0",
    "mphilcomputerscience": "46,0",
    "mphilcriminologyandcriminaljusticesystem": "173,0",
    "mphilcriminology": "173,0",
    "mphileconomics": "69,0",
    "mphileducation": "99,0",
    "mphilfoodscienceandtechnology": "165,0",
    "mphilinhalalfoodsafetymanagement": "370,0",
    "mphilhalalfoodsafetymanagement": "370,0",
    "mphilintheologyandreligiousstudies": "174,0",
    "mphiltheologyandreligiousstudies": "174,0",
    "mphilinternationalrelations": "114,0",
    "mphillibraryandinformationscience": "102,0",
    "mphillibraryinformationscience": "102,0",
    "mphilmanagementscience": "74,0",
    "mphilmathematics": "44,0",
    "mphilpeaceandcounterterrorism": "182,0",
    "mphilpharmacology": "314,0",
    "mphilphysics": "116,0",
    "mphilpoliticalscience": "115,0",
    "mphilsociology": "128,0",
    "mphilstatistics": "45,0",
    "mphilurdu": "59,0",
    "mphilzoology": "118,0",
    "masterofphilosophyinenglishlinguistics": "502,0",
    "mphilenglishlinguistics": "502,0",
    "masterofphilosophyinenglishliterature": "501,0",
    "mphilenglishliterature": "501,0",
    "masterofstudiesinmediaandcommunicationstudies": "495,0",
    "mediaandcommunicationstudies": "495,0",
    "mbaprofessional2year": "202,0",
    "mbaprofessional": "202,0",
    "mbaexecutive": "78,0",
    "mphilinmasscommunication": "96,0",
    "mphilmasscommunication": "96,0",
    "masscommunication": "96,0",
    "msdatascience": "266,0",
    "msislamicbankingandfinance": "178,0",
    "mssoftwareengineering": "267,0"
  },

  phd: {
    "doctorofphilosophyinpeaceandcounterterrorismstudies": "506,0",
    "phdpeaceandcounterterrorism": "506,0",
    "doctorofphilosophyinpharmacypharmacology": "505,0",
    "phdpharmacology": "505,0",
    "phdmasscommunication": "336,0",
    "phdbiochemistry": "252,0",
    "phdbiochemistery": "252,0",
    "phdeconomics": "221,0",
    "phdeducation": "238,0",
    "phdenglishlinguistics": "254,0",
    "phdfoodscienceandtechnology": "253,0",
    "phdinternationalrelations": "219,0",
    "phdislamiceconomicsandfinance": "246,0",
    "phdlibraryandinformationscience": "185,0",
    "phdmanagementscience": "251,0",
    "phdmathematics": "220,0",
    "phdpoliticalscience": "54,0",
    "phdsociology": "329,0",
    "phdurdu": "55,0"
  },

  // Short Courses / Diplomas - was entirely missing before (never scraped
  // into this file), so every single one of these failed with "no MUL
  // program id mapping found" until now.
  course: {
    "diplomaincorpuslinguistics": "511,0",
    "diplomaininternationalaffairs": "257,0",
    "postgraduatediplomainautismspectrumdisorder": "350,0",
    "postgraduatediplomaincomputationallinguistics": "512,0",
    "postgraduatediplomaincorpuslinguistics": "349,0",
    "postgraduatediplomainhalalstandardsandmangementsystems": "237,0",
    "appliedcomputationalfluiddynamics": "382,0",
    "advanceddiplomainhospitalityandtourismmanagement": "332,0",
    "artofrecipecreation": "381,0",
    "autocadforengineers": "437,0",
    "awarifalmaarifaclassicalgatewaytotasawwuf": "525,0",
    "bloodbankingtechniques": "393,0",
    "blueeconomyandgeopolitics": "496,0",
    "certificateinarchivesandrecordmanagement": "396,0",
    "certificateinbaristaskills": "517,0",
    "certificateinchemistryandentrepreneurship": "403,0",
    "certificateincopingwithlossandgrief": "379,0",
    "certificateinhealthprofessioneducation": "348,0",
    "certificateinprofessionalbaking": "333,0",
    "certificateinprofessionalethics": "397,0",
    "certificateinpsychologicalfirstaid": "380,0",
    "chemicalsafety": "398,0",
    "communitydevelopmentandsocialmobilization": "391,0",
    "contentwriting": "407,0",
    "cybercrimeandsecuritysystem": "435,0",
    "dataanalysiswithspss": "418,0",
    "dataanalyticsforbeginners": "412,0",
    "diplomaincomputationallinguistics": "513,0",
    "diplomainculinaryarts": "334,0",
    "diplomainelectronics": "409,0",
    "diplomaintaxlaw": "481,0",
    "djangorestframeworkspecialization": "434,0",
    "fishfarminganditsmanagement": "415,0",
    "handsonanalysisofdnaproteinsequences": "389,0",
    "handsoncomputervisionwithopencvandpython": "432,0",
    "healwithmealfoodasmedicine": "439,0",
    "honeybeefarming": "431,0",
    "machinelearningthroughmatlab": "385,0",
    "mobilephonerepairing": "479,0",
    "optimizationthroughmatlab": "384,0",
    "professionalcertificateindigitalbusiness": "438,0",
    "researchsimulationessentialapracticalapproach": "425,0",
    "sapfinancial": "451,0",
    "specializedcuppingtherapyhijama": "372,0",
    "sustainableshrimpaquaculturefromhatcherytoharvest": "480,0",
    "theartofreportingandanchoring": "423,0",
    "tunnelfarming": "420,0"
  }
};

function tightCleanLocal(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");
}

// Returns MUL's numeric program ID for a given program name, or null if
// nothing matches closely enough - callers must treat null as "can't
// safely submit this", never fall back to sending the plain name (already
// confirmed rejected with "Validation failed").
//
// category (adp/bs/mphil/phd/course, mapCategoryLabelToMulCode's output) is
// required and the lookup is STRICTLY scoped to it - deliberately no
// cross-category fallback. The same bare name means a different program in
// a different category ("Artificial Intelligence" is both an Associate
// Degree and a BS program, with different ids) - guessing across
// categories risks silently submitting the WRONG program with a
// success-looking response, which is worse than an honest failure here.
function getMulProgramId(programName, category) {
  const key = tightCleanLocal(programName);
  if (!key || !category || !MUL_PROGRAM_IDS[category]) return null;

  return MUL_PROGRAM_IDS[category][key] || null;
}

module.exports = { getMulProgramId, MUL_PROGRAM_IDS };

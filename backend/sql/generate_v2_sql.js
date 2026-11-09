const fs = require('fs');
const crypto = require('crypto');

// Authoritative 15-Group Spreadsheet Data (G01 through G15)
const rawCsv = `
,,,GROUP 1,,,
,1,Mulemwa ,Muchima,202402387,M,BSCS
,2,Edwin,Kampamba,202406643,M,BSCS
,3,Ivwananji,Chipasha,202400442,F,BSCS
,4,Alinani,Sinyangwe,202305208,M,BSCS
,5,Grace,Chilufya,202408399,F,BSCS
,6,Charity,Namangolwa,202402615,F,BSCS
,7,Memory,Mutemwa,202404528,F,BSCS
,8,Mwila ,Siaciti,202409048,F,BSCS
,9,Hope,Nsana,202402859,F,BSCS
,10,Judith,Mushabati,202403063,F,BSCS
,11,Mcnaldo,Chilanga,202406887,M,BSCS
,12,Collins,Kalela,202403266,M,BSCS
,13,Nancy ,Mailoni,202409163,F,BSCS
,14,Onester,Kalunga,202408720,F,BSCS
,15,Mayamiko ,Phiri,202409779,F,BSCS
,16,Atupele,Andende,202408882,M,BSCS
,,,,,,
,,,GROUP 2,,,
,1,JOSEPH,CHIWUSWA,202400549,M,BsCS
,2,MALUBA,B AKAKANDELWA,202400526,M,BsCS
,3,EMMANUEL,VIAZI,202403134,M,BsCS
,4,MEMORY,TEMBO,202408701,F,BsCS
,5,SALOME,SITWALA,202401737,F,BsCS
,6,MWANSA ,MUBANGA,202405690,F,BsCS
,7,PAUL,MUNENE,202404540,M,BsCS
,8,BLESSINGS,SINKAMBA,202408808,M,BsCS
,9,JOSHUA,CHIBALE,202308808,M,BsCS
,10,BLESSINGS,TEMBO,202408439,M,BsCS
,11,MWAKA,HAMILEMBA,202402633,F,BsCS
,12,LUUMBI,MALAMBO,202408554,F,BsCS
,13,LISELI FAUSTINA,KALOWA,202406948,F,BsCS
,14,LUTE WALUSUNGU,GONDWE,202407170,F,BsCS
,15,MATILDAH,YUSIKU,202405590,F,BsCS
,,,,,,
,,,GROUP 3,,,
,1,GIFT ,CHABUKA,202404194,F,COMPUTER SCIENCE
,2,RUTH, KANGWA,202307232,F,COMPUTER SCIENCE
,3,JASON,MBAO,202406919,M,COMPUTER SCIENCE
,4,CHIKO,MUTALE,202404164,M,COMPUTER SCIENCE
,5,FABIAN,MULOONGO,202407862,M,COMPUTER SCIENCE
,6,RICHARD,MWANSA,202402069,M,COMPUTER SCIENCE
,7,MEMORY,MWELA,202410371,F,COMPUTER SCIENCE
,8,GILLIAN,MPOLA,202406543,F,IT
,9,CHRISTABEL,CHIKOMONA,201901101,F,ICT WITH EDUCATION
,10,STEVEN,ZULU,202301795,M,COMPUTER SCIENCE
,11,KAPUNZA,GWENANI,202409282,F,COMPUTER SCIENCE
,12,LENGANJI,SIMWANZA,202408164,F,COMPUTER SCIENCE
,13,EUSTANE,CHULU,202403669,F,COMPUTER SCIENCE
,14,ERASTAS,MICHELO,202401965,M,COMPUTER SCIENCE
,15,,,,,
,,,,,,
,,,GROUP 4,,,
,1,Manda ,Dickson ,202405342,M,CS
,2,Nemar,kanyondwi ,202405228,F,CS
,3,Michael,Mutale,202402427,M,IT
,4,Sikumbuzo ,Monde,202402839,F,CS
,5,Cleopatra,Ngulube,202107598,F,CS
,6,Hellen ,Mwanza,202404130,F,CS
,7,Lloyd ,Bulaya,202306274,M,CS
,8,Gedan,Simbeye,202407149,M,CS
,9,Muleba,Mwashi,202408185,M,CS
,10,Nkonde R ,Zimba,202402132,F,IT
,11,Memory,Sokontwe,202105977,F,BICTED
,12,David ,Kanyama ,202408941,M,BSCS
,13,Frackson,Mkandawire,202302576,M,IT
,14,Andrew,moyo,202203671,M,BSCS
,15,Thabo,Muliwana ,202404135,M,CS
,16,Mwila ,Stephen,202402261,M,CS
,,,,,,
,,,,,,
,,,GROUP 5,,,
,1,SIMAZUWO,BRIAN ,202406213,M,BCSC
,2,SANALUMBA,WAKUN’OLI ,202406222,M,BCSC
,3,DAVID,MBILIMA,202406591,M,BCSC
,4,TEMBO,KUNDA ,202410059,F,BCSC
,5,CHABU, CHILELEKO,202407895,F,BCSC
,6,NACHINGA,THELMA ,202400756,F,BCSC
,7,KAMWANA,MIRIAM ,202406797,F,BCSC
,8,MWELWA,MAGGIE ,202409524,F,BCSC
,9, MSHISHA,DADA,202200670,M,BCSC
,10, MUKANGWA,BRIAN,202409126,M,BCSC
,11, SHIKUPA,CHARLES,202408328,M,BCSC
,12, MWAPE,PRISCA,202307112,F,BCSC
,13, SHIKABANGA,CECILIA,202400260,F,BCSC
,14,NEVERS,MWABA,202403973,M,BCSC
,15,FEBBY,NG'ANWE,202403184,F,BCSC
,,,,,,
,,,,,,
,,,GROUP 6,,,
,1,Muyoba,Mulako,202407184,M,BSCS
,2,Owen M.,Mukela,202400975,M,BSCS
,3,Previous,Mukosha,202407403,F,BSCS
,4,Immaculate,Mwanangombe,202400421,F,BSCS
,5,Houghton,Chibozyi,202301165,M,BSCS
,6,Winnia,Mwanza,202402071,F,BSCS
,7,Bosswell,Habenzu,202400957,M,BSCS
,8,Kamwemba,Kulumuku,202402043,M,BSCS
,9,Wilfred,Lungo,202409550,M,BSCS
,10,Chakuletela,Musukwa,202405691,M,BSCS
,11,Charles,Chisala,202403830,M,BSCS
,12,Namasiku Beauty,Siemisa,202407202,F,BSCS
,13,Fridah,Muzungu,202401889,F,BSCS
,14,Mundia,Mundia,202406520,M,BSCS
,15,Marcus,Malulu,202408897,M,BSCS
,,,,,,
,,,,,,
,,,GROUP 7,,,
,1,Mwendalubi Mike ,Manyika,202303351,Male,BSc in Computer Science
,2,Bwalya ,Manyando,202406767,Female,BSc in Computer Science
,3,Rachael ,Shabolyo,202404746,Female,BSc in Computer Science
,4,Edwin ,Makuya,202408031,Male,BSc in Computer Science
,5,Cryvet ,Simfukwe,202408025,Male,BSc in Computer Science
,6,Yeshua ,Owen,202404317,Male,BSc in Computer Science
,7,Reagan ,Chisanga,202407565,Male,BSc in Computer Science
,8,Chanda ,Mubanga,202408138,Male,BSc in Computer Science
,9,Isaiah ,Mbangweta,202405883,Male,BSc in Computer Science
,10,Mapalo ,Mwape,202409469,Female,BSc in Computer Science
,11,Ngosa ,Florence,202402434,Female,BSc in Computer Science
,12,M'manga ,Modester,202403931,Female,BSc in Computer Science
,13,Kazembe ,Sing'ambwa,202400114,Male,BSc in Computer Science
,14,Temwini ,Phiri,202404096,Male,Bsc in Computer Science
,15,Caleb Mukelabai ,Kalimina,202401761,Male,BSc in Computer Science
,,,,,,
,,,,,,
,,,GROUP 8,,,
,1,Bwalya ,Marvelous ,202406501,M,Computer Science 
,2,Soko ,Zilombo Choolwe ,202408157,M,Computer Science 
,3,Mbewe ,Mathews ,202408295,M,Computer Science 
,4,Sakala ,Blessings ,202404634,F,Computer Science 
,5,Moyo,Sibongile,202409794,F,Computer Science 
,6,Gumbo,Dailess ,202406011,F,Computer Science 
,7,Shaba,Patience ,202409214,F,Computer Science 
,8,Chishala,Juliet,202400397,F,Computer Science 
,9,Chileshe ,Sampa,202407247,M,Computer Science 
,10,Kabengele,Remmy,201802185,M,Computer Science 
,11,Miyambo ,Emmanuel ,202402295,M,Information Technology 
,12,Kanjela,Musenge,202106741,M,Computer Science 
,13,,,,,
,14,,,,,
,15,,,,,
,,,,,,
,,,,,,
,,,GROUP 9,,,
,1,FLORENCE SHIMPA ,MUSONDA,202406031,F,BsCS
,2,Gerald, Gondwe,202407879,F,BsCS
,3,Bernadette ,Chanda,202400653,F,IT
,4,William,Simbeye,202403271,M,BsCS
,5,Derrick ,Kabonso,202402510,M,BsCS
,6,Miti ,Steven,202405283,M,BsCS
,7,Kampamba ,Charity,202409051,F,BsCS
,8,BENZU ,HIMOONDE,202403132,F,BsCS
,9,Frazer ,Macha,202405388,M,BsCS
,10,Timothy ,Malasha,202408282,M,BsCS
,11,Kalunga ,Mervis ,202410672,F,IT
,12,Violet ,Ngoma,202407064,F,BsCS
,13,Mweene ,Simon,201701343,M,BsCS
,14,CHIMBALA ,CHRISTOPHER,202406408,M,BsCS
,15,Enock ,Simumba ,202406593,M,BsCS
,16,EUSTUCE ,KASONGO,202406805,M,BsCS
,,,,,,
,,,,,,
,,,GROUP 10,,,
,1,Beatrice,Chibesa,202404114,F,Computer Science
,2,Angel,Bwalya,202400350,F,Computer Science
,3,Evans,Saikolo,202400550,M,Computer Science
,4,Titus,Bwalya,202402843,M,Computer Science
,5,Ezron,Chiluba,202404621,M,Computer Science
,6,Juliet,Mulenga,202410470,F,Computer Science
,7,Ilukena,Mundia,202402030,M,Computer Science
,8,Cascious,Nyambe,202409245,M,Computer Science
,9,Aquirina,Mulauzi,202410007,F,Computer Science
,10,Tobias,Phiri,202402824,M,Information Technology
,11,Mary,Mula,202410384,F,Computer Science
,12,Weston,Mulenga,202407468,M,Information Technology
,13,Christopher,C.Chimfwembe,202404891,M,Computer Science
,14,Choolwe,Mweembe,202405964,M,Computer Science
,15,Oscar,Chipango,202410253,M,Computer Science
,16,Gaidon,Sichone,202109428,M,Computer Science
,,,,,,
,,,GROUP 11,,,
,1,MITI,KATANGA,202407015,M,BCSC
,2,MBASELA,FABIAN,202404688,M,BCSC
,3,CHOLA,BEN,202404172,M,BCSC
,4,HAMASUKWA,AGRIPPA C.,202403019,F,BCSC
,5,MUUNDA,MAINZA,202401150,M,BCSC
,6,MUMBI,CHIBESA,202001699,M,BCSC
,7,SIMASIKU,ABEL,202407015,M,BCSC
,8,CHANDA,COLLINS,202403846,M,BCSC
,9,TRAORE,MORDECAI SALIM,202403846,M,BCSC
,10,CHILUFYA,MAPALO,202405943,M,BCSC
,11,MWAPE,KELVIN,202203897,M,BCSC
,12,KANSAMBA,AUXIRIA,202206607,F,BCSC
,13,MAKUYU,EDWIN,202408031,M,BCSC
,14,BANDA,SALIMA,202305732,F,BCSC
,15,TRAORE,LAMIN,202403844,M,BCSC
,16,DAKA,RACHEAL,202303375,F,BCSC
,,,,,,
,,,GROUP12,,,
,1,MOON,CLIVE,202401321,M,BSIT
,2,ZIMBA,EMMANUEL,202404407,M,BSIT
,3,KAONGA,MEMORY,202405095,F,BSCS
,4,MUKUPA,FRANSCINE,202405321,F,BSCS
,5,NAKANYIKA,NSUNGANI,202409728,F,BSCS
,6,CHIPAMPE,STANSLOUS,202406233,M,BSCS
,7,MUKONTA,DAVIS,202401475,M,BSCS
,8,CHISHALA,ALFRED,202406877,M,BSCS
,9,PHIRI,BRIAN,202301116,M,BSCS
,10,CHOLA,SIMON,202301173,M,BSCS
,11,NG'OMBA,KANGWA,202300654,M,BSCS
,12,KABUTU,ETHEL,202404608,F,BSIT
,13,MWENDA HAMULAMBO ,SOSTERN,202409694,M,BSCS
,14,MASAMBU,KALENGA,202404703,M,BSCS
,15,,,,,
,,,,,,
,,,,,,
,,,GROUP 13,,,
,1,Silunji,Victor,202408913,M,BCSC
,2,Sakala,Daniel,202404454,M,BCSC
,3,Mawere,Saidi,202410021,M,BCSC
,4,Mwanza,Taizya,202408632,F,BCSC
,5,Mwitwa,Clement,202406171,M,BCSC
,6,Banda,Agness,202408752,F,BCSC
,7,N'Gandwe,Charles,202400961,M,BCSC
,8,M'Soni,Deborah,202409714,F,BCSC
,9,Ng'andu,Lwendo,202402226,M,BCSC
,10,Chile,Bwalya,202400014,M,BCSC
,11,Banda,Mphaso,202404480,M,BCSC
,12,Tembo,Patience,202406515,F,BCSC
,13,Mwambazi,Grace,202407984,F,BCSC
,14,Ndhlovu,Godfrey,202401433,M,BCSC
,15,Lungu,Rebecca,202406496,F,BCSC
,,,,,,
,,,GROUP 14,,,
,1,JUMBE,THABO,202406168,M,Computer Science
,2,GONDWE,JOYCE,202410082,F,Computer Science
,3,KAPINGA ,ANTONETTE,202401120,F,Computer Science
,4,LUNGU,JOSEPHAT,202403000,M,Computer Science
,5,NAMUKANZYE,FOSTER,202407636,F,Computer Science
,6,SIKUBEKA,EMMANUEL,202308118,M,Computer Science
,7,JUDGE,EZEKIEL,202410125,M,Computer Science
,8,NDUBA,JOEL,202408068,M,Computer Science
,9,Maseba,Neo,202407198,M,Bsc Computer Science
,10,Mapulanga,Henry,202402976,M,Bsc Computer Science
,11,Kalengo,Andrew,202406795,M,Bsc Computer Science
,12,Kamfwa,Nathan,202408447,M,Bsc Computer Science
,13,Chansa,Sylvester,202406183,M,Bsc Computer Science
,14,Njunga ,Emmanuel ,202301847,M,Bsc Computer Science
,15,,,,,
,,,,,,
,,,,,,
,,,GROUP 15,,,
,1,Chabota ,Siyingwa,202407073,M,BScIT
,2,Reagan ,Chikumbutso Mbao,202404367,M,BScCS
,3,Fedness ,Malilwe,202406336,F,BScIT
,4,Musonda, Amos,202408460,M,BScCS
,5,Munesu, Lemba,202409112,M,BScCS
,6,Arthur ,sinyenga,202408468,M,BScCS
,7,Libuku, Libuku,202403876,M,BScCS
,8,Alicia ,Kunda Muteba,202402399,F,BScIT
,9,Lutema, Jutine Lutangu,202405510,M,BScCS
,10,Lushomo ,Muteteete,202407579,F,BScCS
,11,Chirwa ,Janet,202106055,F,BScIT
,12,John ,Kabemba,202408026,M,BScIT
,13,Victor ,Lupenga ,202403212,M,BScCS
,14,George ,Kunda,202407907,M,BScCS
,15,Temwananji ,Mutambo,202404116,M,BScIT
`;

function normalizeProgram(raw) {
  const upper = (raw || '').trim().toUpperCase();
  if (upper.includes('EDU') || upper.includes('BICTED') || upper.includes('ITED')) {
    return { code: 'ITED', id: 3 };
  }
  if (upper.includes('IT') || upper.includes('INFORMATION') || upper.includes('BSIT') || upper.includes('BSCIT')) {
    return { code: 'IT', id: 2 };
  }
  return { code: 'CS', id: 1 };
}

function cleanPart(str) {
  const s = (str || '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  return s.split(' ').map(w => {
    if (w.length <= 1) return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ');
}

function cleanName(first, last) {
  return `${cleanPart(first)} ${cleanPart(last)}`.trim().replace(/\s+/g, ' ');
}

// Parse all rows; first pass: collect all IDs that are unique vs duplicated
// Notice Edwin Makuya (202408031) is in G07 (#4) and Makuyu Edwin (202408031) is in G11 (#13).
// In G11: Miti Katanga (#1) & Simasiku Abel (#7) both have 202407015.
// In G11: Chanda Collins (#8) & Traore Mordecai Salim (#9) both have 202403846.
// For any duplicate ID, the first student keeps the ID and the second is kept without an ID (null / '').
const lines = rawCsv.split(/\r?\n/);
let currentGroup = null;
const seenNumbers = new Set();
const cleanedStudents = [];

for (const line of lines) {
  const grpMatch = line.match(/GROUP\s*(\d+)/i);
  if (grpMatch) {
    const gNum = parseInt(grpMatch[1], 10);
    currentGroup = 'G' + String(gNum).padStart(2, '0');
    continue;
  }
  const parts = line.split(',');
  const slotStr = (parts[1] || '').trim();
  const rawFirst = (parts[2] || '').trim();
  const rawLast = (parts[3] || '').trim();
  const rawId = (parts[4] || '').trim();
  const rawGender = (parts[5] || '').trim();
  const rawProg = (parts[6] || '').trim();

  if (!currentGroup || !/^\d+$/.test(slotStr) || (!rawFirst && !rawLast)) continue;

  let studentNo = rawId;
  if (studentNo && seenNumbers.has(studentNo)) {
    console.log(`[Duplicate ID] Keeping ${studentNo} on first student; leaving ${rawFirst} ${rawLast} (${currentGroup}) without ID`);
    studentNo = null;
  } else if (studentNo) {
    seenNumbers.add(studentNo);
  }

  const prog = normalizeProgram(rawProg);
  const firstName = cleanPart(rawFirst);
  const lastName = cleanPart(rawLast);
  const fullName = cleanName(rawFirst, rawLast);
  const slotNum = parseInt(slotStr, 10);

  // Strict 15/15 group capacity rule: any member beyond 15 is placed in UNASSIGNED (group = null)
  const assignedGroup = slotNum > 15 ? null : currentGroup;
  if (slotNum > 15) {
    console.log(`[15/15 Rule] Moving #${slotNum} ${fullName} (${studentNo || 'No ID'}) from ${currentGroup} to UNASSIGNED`);
  }

  cleanedStudents.push({
    slot: slotNum,
    group: assignedGroup,
    studentNo: studentNo, // string or null
    firstName,
    lastName,
    name: fullName,
    programId: prog.id,
    programCode: prog.code,
    rawProgram: rawProg || prog.code,
    gender: rawGender || 'M'
  });
}

console.log(`Total students parsed: ${cleanedStudents.length}`);

// 15 Lab Groups with Schedule Slots & strict 15/15 max capacity
const groupDefinitions = [
  { id: 1,  code: 'G01', capacity: 15, day: 'MON', start: '15:00:00', end: '17:00:00', room: 'CS - Old Dining Hall B' },
  { id: 2,  code: 'G02', capacity: 15, day: 'MON', start: '15:00:00', end: '17:00:00', room: 'CS - Old Dining Hall B' },
  { id: 3,  code: 'G03', capacity: 15, day: 'TUE', start: '07:00:00', end: '09:00:00', room: 'CS - Engineering Lab 3' },
  { id: 4,  code: 'G04', capacity: 15, day: 'TUE', start: '07:00:00', end: '09:00:00', room: 'CS - Engineering Lab 3' },
  { id: 5,  code: 'G05', capacity: 15, day: 'WED', start: '13:00:00', end: '15:00:00', room: 'CS - SSS Block-C RM 2' },
  { id: 6,  code: 'G06', capacity: 15, day: 'WED', start: '13:00:00', end: '15:00:00', room: 'CS - SSS Block-C RM 2' },
  { id: 7,  code: 'G07', capacity: 15, day: 'WED', start: '15:00:00', end: '17:00:00', room: 'CS - SSS Block-E RM 1' },
  { id: 8,  code: 'G08', capacity: 15, day: 'WED', start: '15:00:00', end: '17:00:00', room: 'CS - SSS Block-E RM 1' },
  { id: 9,  code: 'G09', capacity: 15, day: 'WED', start: '17:00:00', end: '19:00:00', room: 'IT - Old Dining Hall B' },
  { id: 10, code: 'G10', capacity: 15, day: 'WED', start: '17:00:00', end: '19:00:00', room: 'IT - Old Dining Hall B' },
  { id: 11, code: 'G11', capacity: 15, day: 'THU', start: '07:00:00', end: '09:00:00', room: 'IT - Multi Purpose Hall' },
  { id: 12, code: 'G12', capacity: 15, day: 'THU', start: '07:00:00', end: '09:00:00', room: 'IT - Multi Purpose Hall' },
  { id: 13, code: 'G13', capacity: 15, day: 'FRI', start: '11:00:00', end: '13:00:00', room: 'ITED - SSS Block-B RM 2' },
  { id: 14, code: 'G14', capacity: 15, day: 'FRI', start: '11:00:00', end: '13:00:00', room: 'ITED - SSS Block-B RM 2' },
  { id: 15, code: 'G15', capacity: 15, day: 'FRI', start: '11:00:00', end: '13:00:00', room: 'CS - SSS Block-B RM 2' }
];

// Generate deterministic UUIDs for SQL
const studentSqlRows = cleanedStudents.map((s) => {
  let uuid;
  if (s.studentNo === '202408138') {
    uuid = '11111111-1111-4111-8111-111111111111';
  } else {
    const key = s.studentNo ? ('std_' + s.studentNo) : (`std_noid_${s.group || 'UNASSIGNED'}_${s.slot}_${s.name}`);
    const hash = crypto.createHash('md5').update(key).digest('hex');
    uuid = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  }
  s.uuid = uuid;
  const grpSql = s.group ? parseInt(s.group.replace('G', ''), 10) : 'NULL';
  const safeName = s.name.replace(/'/g, "''");
  const numSql = s.studentNo ? `'${s.studentNo}'` : 'NULL';
  return `  ('${uuid}', ${numSql}, '${safeName}', ${s.programId}, ${grpSql}, 'active', 1)`;
}).join(',\n');

const groupSql = groupDefinitions.map(g =>
  `  (${g.id}, '${g.code}', ${g.capacity}, '${g.day}', '${g.start}', '${g.end}', '${g.room}')`
).join(',\n');

const fullSql = `-- ================================================================================
-- CAMPUS COMPANION — DATABASE VERSION 2.1 (15 GROUPS & SPREADSHEET INGESTION)
-- ================================================================================
-- Database Engine: MySQL 8.0+ / MariaDB / InnoDB
-- Character Set:   utf8mb4 / utf8mb4_unicode_ci
-- Release Tag:     v2.1.0 (Authoritative 15-Group Spreadsheet Release)
--
-- USAGE:
--   mysql -u root -p < v2.0_schema_and_spreadsheet_seed.sql
-- ================================================================================

CREATE DATABASE IF NOT EXISTS student_registration
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE student_registration;

-- --------------------------------------------------------------------------------
-- 0. SCHEMA VERSION TRACKING
-- --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_version (
  version_id   INT AUTO_INCREMENT PRIMARY KEY,
  version_tag  VARCHAR(20) NOT NULL UNIQUE,
  description  VARCHAR(255) NOT NULL,
  applied_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

DELETE FROM schema_version WHERE version_tag IN ('2.0.0', '2.1.0');
INSERT INTO schema_version (version_tag, description)
VALUES ('2.1.0', 'Campus Companion V2.1.0 — 15 Lab Groups, Updated Roster & Nullable Duplicate IDs');

-- --------------------------------------------------------------------------------
-- 1. REFERENCE TABLES: PROGRAMMES & LAB GROUPS
-- --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS programmes (
  program_id    INT AUTO_INCREMENT PRIMARY KEY,
  program_code  VARCHAR(10)  NOT NULL UNIQUE,   -- CS, IT, ITED
  program_name  VARCHAR(100) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS lab_groups (
  group_id      INT AUTO_INCREMENT PRIMARY KEY,
  group_code    VARCHAR(10) NOT NULL UNIQUE,      -- G01 through G15
  capacity      INT NOT NULL DEFAULT 15,
  schedule_day  ENUM('MON','TUE','WED','THU','FRI','SAT') NULL,
  start_time    TIME        NULL,
  end_time      TIME        NULL,
  room          VARCHAR(60) NULL
) ENGINE=InnoDB;

-- --------------------------------------------------------------------------------
-- 2. STUDENTS TABLE
-- --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS students (
  student_id      CHAR(36)     NOT NULL PRIMARY KEY,        -- UUID
  student_number  CHAR(9)      NULL UNIQUE,                 -- 9 digits (or NULL when duplicate left blank)
  student_name    VARCHAR(100) NOT NULL,
  program_id      INT          NOT NULL,
  group_id        INT          NULL,                        -- NULL = Unassigned, 1..15 = G01..G15
  status          ENUM('active','deleted') NOT NULL DEFAULT 'active',
  version         INT          NOT NULL DEFAULT 1,          -- Optimistic locking
  deleted_at      DATETIME     NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_students_program FOREIGN KEY (program_id) REFERENCES programmes(program_id),
  CONSTRAINT fk_students_group FOREIGN KEY (group_id) REFERENCES lab_groups(group_id),
  INDEX idx_students_name (student_name),
  INDEX idx_students_group_status (group_id, status),
  INDEX idx_students_program_status (program_id, status)
) ENGINE=InnoDB;

-- Ensure existing tables allow NULL student_number for duplicate-ID students left without an ID
ALTER TABLE students MODIFY COLUMN student_number CHAR(9) NULL;

-- --------------------------------------------------------------------------------
-- 3. ACCOUNTS (AUTH IDENTITY)
-- --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (
  account_id     INT AUTO_INCREMENT PRIMARY KEY,
  student_id     CHAR(36)     NULL UNIQUE,
  username       VARCHAR(100) NOT NULL UNIQUE,
  display_name   VARCHAR(100) NULL,
  avatar         VARCHAR(40)  NULL,
  password_hash  VARCHAR(255) NOT NULL,
  role           ENUM('student','lecturer') NOT NULL,
  is_active      TINYINT(1)   NOT NULL DEFAULT 1,
  last_login_at  DATETIME     NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_accounts_student FOREIGN KEY (student_id) REFERENCES students(student_id)
) ENGINE=InnoDB;

-- --------------------------------------------------------------------------------
-- 4. CLAIM CODES (STUDENT OWNERSHIP VERIFICATION)
-- --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claim_codes (
  claim_code      VARCHAR(30) NOT NULL PRIMARY KEY,
  student_number  CHAR(9)     NULL,
  used_at         DATETIME    NULL,
  used_by_student CHAR(36)    NULL,

  CONSTRAINT fk_claim_used_by FOREIGN KEY (used_by_student) REFERENCES students(student_id)
) ENGINE=InnoDB;

-- --------------------------------------------------------------------------------
-- 5. CORRECTION & GROUP TRANSFER REQUESTS
-- --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS correction_requests (
  request_id      INT AUTO_INCREMENT PRIMARY KEY,
  student_id      CHAR(36)    NOT NULL,
  requested_by    INT         NOT NULL,
  field_name      VARCHAR(50) NOT NULL,
  current_value   VARCHAR(100) NOT NULL,
  requested_value VARCHAR(100) NOT NULL,
  status          ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  resolved_by     INT NULL,
  resolved_at     DATETIME NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_corr_student FOREIGN KEY (student_id) REFERENCES students(student_id),
  CONSTRAINT fk_corr_requested_by FOREIGN KEY (requested_by) REFERENCES accounts(account_id),
  CONSTRAINT fk_corr_resolved_by FOREIGN KEY (resolved_by) REFERENCES accounts(account_id)
) ENGINE=InnoDB;

-- --------------------------------------------------------------------------------
-- 6. MOBILE SYNC & IDEMPOTENCY
-- --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_events (
  event_id       BIGINT AUTO_INCREMENT PRIMARY KEY,
  student_id     CHAR(36) NOT NULL,
  event_type     ENUM('created','updated','group_changed','deleted') NOT NULL,
  event_version  INT NOT NULL,
  event_payload  JSON NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_sync_student FOREIGN KEY (student_id) REFERENCES students(student_id),
  INDEX idx_sync_created (created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS operation_receipts (
  operation_id     CHAR(36)     NOT NULL PRIMARY KEY,
  account_id       INT          NOT NULL,
  endpoint         VARCHAR(150) NOT NULL,
  request_hash     CHAR(64)     NOT NULL,
  response_status  INT          NOT NULL,
  response_body    JSON         NOT NULL,
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_receipt_account FOREIGN KEY (account_id) REFERENCES accounts(account_id)
) ENGINE=InnoDB;

-- --------------------------------------------------------------------------------
-- 7. COURSES, GRADES, ATTENDANCE & TIMETABLE
-- --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS courses (
  course_id           INT AUTO_INCREMENT PRIMARY KEY,
  course_code         VARCHAR(20)  NOT NULL UNIQUE,
  course_name         VARCHAR(150) NOT NULL,
  lecturer_account_id INT NULL,

  CONSTRAINT fk_courses_lecturer FOREIGN KEY (lecturer_account_id) REFERENCES accounts(account_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS course_programmes (
  course_id  INT NOT NULL,
  program_id INT NOT NULL,
  PRIMARY KEY (course_id, program_id),
  CONSTRAINT fk_cp_course FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE CASCADE,
  CONSTRAINT fk_cp_program FOREIGN KEY (program_id) REFERENCES programmes(program_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS grades (
  grade_id     INT AUTO_INCREMENT PRIMARY KEY,
  student_id   CHAR(36)    NOT NULL,
  course_id    INT         NOT NULL,
  grade_value  VARCHAR(10) NOT NULL,
  recorded_by  INT         NOT NULL,
  recorded_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_grades_student FOREIGN KEY (student_id) REFERENCES students(student_id),
  CONSTRAINT fk_grades_course FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE CASCADE,
  CONSTRAINT fk_grades_recorder FOREIGN KEY (recorded_by) REFERENCES accounts(account_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS attendance (
  attendance_id   INT AUTO_INCREMENT PRIMARY KEY,
  student_id      CHAR(36)    NOT NULL,
  course_id       INT         NOT NULL,
  attendance_date DATE        NOT NULL,
  status          ENUM('present','absent','excused','late') NOT NULL DEFAULT 'present',
  recorded_by     INT         NOT NULL,
  recorded_at     TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_attendance_entry (student_id, course_id, attendance_date),
  CONSTRAINT fk_att_student FOREIGN KEY (student_id) REFERENCES students(student_id),
  CONSTRAINT fk_att_course FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE CASCADE,
  CONSTRAINT fk_att_recorder FOREIGN KEY (recorded_by) REFERENCES accounts(account_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS timetable (
  timetable_id INT AUTO_INCREMENT PRIMARY KEY,
  course_id    INT         NOT NULL,
  day_of_week  ENUM('MON','TUE','WED','THU','FRI','SAT') NOT NULL,
  start_time   TIME        NOT NULL,
  end_time     TIME        NOT NULL,
  room         VARCHAR(60) NOT NULL,

  CONSTRAINT fk_tt_course FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- --------------------------------------------------------------------------------
-- 8. VERSION 2.1 SEED DATA (15 GROUPS & 224 STUDENTS)
-- --------------------------------------------------------------------------------

INSERT INTO programmes (program_id, program_code, program_name) VALUES
  (1, 'CS', 'Computer Science'),
  (2, 'IT', 'Information Technology'),
  (3, 'ITED', 'ICT with Education')
ON DUPLICATE KEY UPDATE program_name = VALUES(program_name);

INSERT INTO lab_groups (group_id, group_code, capacity, schedule_day, start_time, end_time, room) VALUES
${groupSql}
ON DUPLICATE KEY UPDATE
  capacity = VALUES(capacity),
  schedule_day = VALUES(schedule_day),
  start_time = VALUES(start_time),
  end_time = VALUES(end_time),
  room = VALUES(room);

-- Remove synthetic IDs generated in older seed versions so duplicate-ID students cleanly use NULL
DELETE FROM students WHERE student_number IN ('202407016', '202403847');

INSERT INTO students (student_id, student_number, student_name, program_id, group_id, status, version) VALUES
${studentSqlRows}
ON DUPLICATE KEY UPDATE
  student_number = VALUES(student_number),
  student_name = VALUES(student_name),
  program_id = VALUES(program_id),
  group_id = VALUES(group_id),
  status = 'active';

-- Demo Accounts (Bcrypt cost 12):
-- Lecturer password: Lecturer#2026
-- Student password:  Student#2026
INSERT INTO accounts (account_id, student_id, username, display_name, avatar, password_hash, role, is_active) VALUES
  (1, NULL, 'lecturer1', 'Dr. Mwansa', 'dog-1', '$2b$12$k6089QWfCglmb6Z/FJsCBOaE28JoXY84dB2s0MPfivvbAfI6pLI/O', 'lecturer', 1),
  (2, '11111111-1111-4111-8111-111111111111', '202408138', 'Chanda Mubanga', 'cat-1', '$2b$12$fRPiwaizqXHRoMkQXUQuKOcELqxctQuu5jDLWAwSOo61S6kAkvMhG', 'student', 1)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  avatar = VALUES(avatar),
  password_hash = VALUES(password_hash),
  role = VALUES(role),
  is_active = 1;

INSERT INTO claim_codes (claim_code, student_number) VALUES
  ('MU-STUDENT-2026', NULL),
  ('CLAIM-AAA111', NULL),
  ('CLAIM-BBB222', NULL),
  ('CLAIM-CCC333', NULL),
  ('CLAIM-PRESET-01', '202408138')
ON DUPLICATE KEY UPDATE student_number = VALUES(student_number);

INSERT INTO courses (course_id, course_code, course_name, lecturer_account_id) VALUES
  (1, 'ICT361', 'Systems Analysis & Design (Mobile App Lab)', 1),
  (2, 'ICS341', 'Software Architecture & Theory', 1),
  (3, 'ICT351', 'Advanced Web & Cloud Systems', 1),
  (4, 'ICT381', 'Computer Networks & Distributed Systems', 1),
  (5, 'ICT371', 'Information Systems Project', 1)
ON DUPLICATE KEY UPDATE course_name = VALUES(course_name);

INSERT INTO course_programmes (course_id, program_id) VALUES
  (1, 1), (1, 2), (1, 3),
  (2, 1), (2, 2),
  (3, 1), (3, 2), (3, 3),
  (4, 1), (4, 2),
  (5, 1), (5, 3)
ON DUPLICATE KEY UPDATE program_id = VALUES(program_id);

INSERT INTO timetable (timetable_id, course_id, day_of_week, start_time, end_time, room) VALUES
  (1, 1, 'MON', '15:00:00', '17:00:00', 'Old Dining Hall B'),
  (2, 2, 'TUE', '07:00:00', '09:00:00', 'New Dining Hall'),
  (3, 3, 'WED', '13:00:00', '15:00:00', 'SSS Block-C RM 2'),
  (4, 4, 'WED', '15:00:00', '17:00:00', 'SSS Block-E RM 1'),
  (5, 5, 'THU', '09:00:00', '11:00:00', 'Old Dining Hall B'),
  (6, 1, 'FRI', '11:00:00', '13:00:00', 'SSS Block-B RM 2')
ON DUPLICATE KEY UPDATE room = VALUES(room);
`;

const sqlPath = 'C:/Users/Chanda Mubanga/Downloads/Project/Student_Registration_Android_App/backend/sql/v2.0_schema_and_spreadsheet_seed.sql';
fs.writeFileSync(sqlPath, fullSql, 'utf8');
console.log('Successfully wrote v2.0_schema_and_spreadsheet_seed.sql!');

const offlineData = {
  version: '2.1.0',
  groups: groupDefinitions,
  students: cleanedStudents
};
const jsonPath = 'C:/Users/Chanda Mubanga/Downloads/Project/Student_Registration_Android_App/backend/sql/v2.0_seed_data.json';
fs.writeFileSync(jsonPath, JSON.stringify(offlineData, null, 2), 'utf8');
console.log('Successfully wrote v2.0_seed_data.json!');

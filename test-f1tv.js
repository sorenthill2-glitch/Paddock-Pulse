// Checks the F1 TV session picker against real label lists from both F1 TV eras. Run: node test-f1tv.js
const fs=require('fs');const src=fs.readFileSync('index.html','utf8');
const i=src.indexOf('function findSession(S,Y){'),j=src.indexOf('function f1tvScripts');const fnSrc=src.slice(i,j);
const run=(labels,S,Y)=>{const anchors=labels.map((t,k)=>({innerText:t,getAttribute:()=>'/detail/'+k+'/'+t.slice(0,12).replace(/\W+/g,'-')}));
 const document={querySelectorAll:()=>anchors};return new Function('document',fnSrc+';return findSession('+JSON.stringify(S)+','+JSON.stringify(Y)+')')(document)};
// real labels captured from F1 TV
const old2021=['Watch now','2021 Abu Dhabi Grand Prix 02:18:27 | Replay','2021 Abu Dhabi GP - Qualifying 01:24:07 | Replay','2021 Abu Dhabi GP - Practice 3 01:14:45 | Replay','2021 Abu Dhabi GP - Practice 2 01:14:41 | Replay','2021 Abu Dhabi GP - Practice 1 01:13:18 | Replay','2021 Abu Dhabi GP - F2 Feature Race 01:21:11 | Replay','2021 Abu Dhabi GP - F2 Sprint Race 2 01:10:16 | Replay','2021 Abu Dhabi GP - F2 Sprint Race 1 01:05:01 | Replay','2021 Abu Dhabi GP - F2 Qualifying 00:37:18 | Replay','2021 Abu Dhabi GP - Post-Race Show 00:30:00 | Replay','2021 Abu Dhabi GP - Race Highlights 00:30:00 | Replay'];
const new2025=['F1 Weekend Warm-Up','F3 Practice','F2 Practice','F1 Practice 1','F3 Qualifying','F2 Qualifying','F1 Practice 2','PSC Practice','F3 Sprint Race','PSC Qualifying','F1 Practice 3','F2 Sprint Race','F1 Pre-Qualifying Show','F1 Qualifying','F1 Post-Qualifying Show','F3 Feature Race','F2 Feature Race','PSC Race','F1 Pre-Race Show','F1 Race','F1 F1 Kids','F1 Post-Race Show','Race 02:06:43 | Replay','Qualifying 01:28:13 | Replay','Practice 1 01:31:06 | Replay'];
const sprint2023=['F1 Sprint Shootout','F1 Sprint','F1 Qualifying','F1 Practice 1','F1 Race','F2 Sprint Race','2023 Azerbaijan GP - Sprint Shootout 00:45:00 | Replay'];
const sprint2024=['F1 Sprint Qualifying','F1 Sprint','F1 Qualifying','F1 Practice 1','F1 Race','F1 Sprint Show'];
// real 2024 labels (British GP weekend page), followed by the "more like this" row of other years
const new2024=['F1 Weekend Warm-Up','F1 Practice 1 Replay','F1 Practice 2 Replay','F1 Practice 3 Replay','F1 Pre-Qualifying Show','F1 Qualifying Replay','F2 Feature Race','F1 Pre-Race Show','F1 F1 Kids','F1 Race Replay','F1 Post-Race Show','Race Replay 01:57:43 | Replay','2013 Spanish Grand Prix 01:35:00 | Replay','2017 British Grand Prix 01:30:00 | Replay','2000 Austrian Grand Prix 01:25:00 | Replay'];
const railOnly=['F1 Weekend Warm-Up','2013 Spanish Grand Prix 01:35:00 | Replay','2017 British Grand Prix 01:30:00 | Replay'];
// 2025 Australia weekend page: plain labels with a duration, F2/F3 tiles with the same names further down
const plain2025=['Race 02:30:37 | Replay','Pre-Race Show 01:05:05 | Replay','Qualifying 01:20:21 | Replay','Practice 3 01:33:12 | Replay','Practice 2 01:33:24 | Replay','Practice 1 01:34:31 | Replay','Weekend Warm-Up 00:32:55 | Replay','Feature Race 01:10:22 | Replay','Sprint Race 01:04:24 | Replay','Qualifying 00:38:52 | Replay','Practice 00:54:18 | Replay','Qualifying 00:42:37 | Replay','Race Highlights 00:12:54 | Race Highlight'];
let pass=0,fail=0;const t=(name,got,want)=>{const ok=got===want;ok?pass++:fail++;console.log((ok?'  ok   ':'  FAIL ')+name.padEnd(46)+(ok?'':' got '+got+', wanted '+want))};
const lab=(labels,got)=>got==null?null:labels[+got.split('/')[2]];
for(const [s,w] of [['Race','2021 Abu Dhabi Grand Prix 02:18:27 | Replay'],['Qualifying','2021 Abu Dhabi GP - Qualifying 01:24:07 | Replay'],['Practice 1','2021 Abu Dhabi GP - Practice 1 01:13:18 | Replay'],['Practice 2','2021 Abu Dhabi GP - Practice 2 01:14:41 | Replay'],['Practice 3','2021 Abu Dhabi GP - Practice 3 01:14:45 | Replay'],['Sprint',null]])
  t('2021-style weekend: '+s,lab(old2021,run(old2021,s.toLowerCase())),w);
for(const [s,w] of [['Race','F1 Race'],['Qualifying','F1 Qualifying'],['Practice 1','F1 Practice 1'],['Practice 2','F1 Practice 2'],['Practice 3','F1 Practice 3'],['Sprint',null]])
  t('2025-style weekend: '+s,lab(new2025,run(new2025,s.toLowerCase())),w);
t('2023 sprint weekend: Sprint Shootout',lab(sprint2023,run(sprint2023,'sprint shootout')),'F1 Sprint Shootout');
t('2023 sprint weekend: Sprint',lab(sprint2023,run(sprint2023,'sprint')),'F1 Sprint');
t('2024 sprint weekend: Sprint Qualifying',lab(sprint2024,run(sprint2024,'sprint qualifying')),'F1 Sprint Qualifying');
t('2024 sprint weekend: Sprint',lab(sprint2024,run(sprint2024,'sprint')),'F1 Sprint');
t('2024 sprint weekend: Race',lab(sprint2024,run(sprint2024,'race')),'F1 Race');
t('F2/F3 never chosen for Qualifying (2021)',lab(old2021,run(old2021,'qualifying')).includes('F2'),false);
for(const [s,w] of [['Race','F1 Race Replay'],['Qualifying','F1 Qualifying Replay'],['Practice 1','F1 Practice 1 Replay'],['Practice 2','F1 Practice 2 Replay'],['Practice 3','F1 Practice 3 Replay'],['Sprint',null]])
  t('2024-style weekend (Replay labels): '+s,lab(new2024,run(new2024,s.toLowerCase(),'2024')),w);
t('never picks another year from a rail (Race)',lab(railOnly,run(railOnly,'race','2024')),null);
t('without a year the old behaviour is kept',lab(railOnly,run(railOnly,'race')),'2013 Spanish Grand Prix 01:35:00 | Replay');
t('2021 weekend still works with the year given',lab(old2021,run(old2021,'race','2021')),'2021 Abu Dhabi Grand Prix 02:18:27 | Replay');
// weekend picker: season-page cards (real wording: country, official name, round and dates), several races share a country or sponsor
{
  const i2 = src.indexOf('function findSeason('), j2 = src.indexOf('// Every F1 TV box goes to the replay');
  const lib = src.slice(i2, j2).replace(/const F1TV[^\n]*\n/, '');
  const cards = ['Australia\nFORMULA 1 LOUIS VUITTON AUSTRALIAN GRAND PRIX 2025\nR114 MAR - 16 MAR', 'Italy\nFORMULA 1 AWS GRAN PREMIO DEL MADE IN ITALY E DELL\'EMILIA ROMAGNA 2025\nR716 MAY - 18 MAY', 'United States\nFORMULA 1 CRYPTO.COM MIAMI GRAND PRIX 2025\nR62 MAY - 4 MAY', 'Austria\nFORMULA 1 MSC CRUISES AUSTRIAN GRAND PRIX 2025\nR1127 JUN - 29 JUN', 'Italy\nFORMULA 1 PIRELLI GRAN PREMIO D\'ITALIA 2025\nR1629 AUG - 31 AUG', 'United States\nFORMULA 1 PIRELLI UNITED STATES GRAND PRIX 2025\nR1817 OCT - 19 OCT', 'Brazil\nFORMULA 1 MSC CRUISES GRANDE PREMIO DE SAO PAULO 2025\nR217 NOV - 9 NOV', 'United States\nFORMULA 1 HEINEKEN SILVER LAS VEGAS GRAND PRIX 2025\nR2220 NOV - 22 NOV'];
  const anchors = cards.map((c, k) => ({ innerText: c, getAttribute: () => '/page/' + k }));
  const pick = meta => {
    const document = { querySelectorAll: q => /^a\[href/.test(q) ? anchors : [] };
    const sc = new Function('document', lib + ';return f1tvScripts(' + JSON.stringify(meta) + ')')(document);
    const h = new Function('document', 'return ' + sc.meeting)(document);
    return h == null ? null : cards[+h.split('/')[2]].split('\n')[1];
  };
  const m = (path, meeting, official, country, location) => ({ year: 2025, path, meeting, official, country, location, session: 'Race' });
  t('weekend: Italian GP is Monza, not Imola', pick(m('2025/2025-08-31_Italian_Grand_Prix/2025-08-31_Race/', 'Italian Grand Prix', 'FORMULA 1 PIRELLI GRAN PREMIO D\u2019ITALIA 2025', 'Italy', 'Monza')), cards[4].split('\n')[1]);
  t('weekend: Emilia Romagna GP is Imola', pick(m('2025/2025-05-18_Emilia_Romagna_Grand_Prix/2025-05-18_Race/', 'Emilia Romagna Grand Prix', 'FORMULA 1 AWS GRAN PREMIO DEL MADE IN ITALY E DELL\u2019EMILIA ROMAGNA 2025', 'Italy', 'Imola')), cards[1].split('\n')[1]);
  t('weekend: Las Vegas GP is not Miami', pick(m('2025/2025-11-22_Las_Vegas_Grand_Prix/2025-11-22_Race/', 'Las Vegas Grand Prix', 'FORMULA 1 HEINEKEN SILVER LAS VEGAS GRAND PRIX 2025', 'United States', 'Las Vegas')), cards[7].split('\n')[1]);
  t('weekend: United States GP is Austin', pick(m('2025/2025-10-19_United_States_Grand_Prix/2025-10-19_Race/', 'United States Grand Prix', 'FORMULA 1 PIRELLI UNITED STATES GRAND PRIX 2025', 'United States', 'Austin')), cards[5].split('\n')[1]);
  t('weekend: Sao Paulo GP is not Austria (shared sponsor)', pick(m('2025/2025-11-09_Sao_Paulo_Grand_Prix/2025-11-09_Race/', 'S\u00e3o Paulo Grand Prix', 'FORMULA 1 MSC CRUISES GRANDE PR\u00caMIO DE S\u00c3O PAULO 2025', 'Brazil', 'S\u00e3o Paulo')), cards[6].split('\n')[1]);
  cards.push('Austria\nFORMULA 1 MYWORLD GROSSER PREIS VON \u00d6STERREICH 2019\nR928 JUN - 30 JUN', 'Hungary\nFORMULA 1 ROLEX MAGYAR NAGYD\u00cdJ 2019\nR122 AUG - 4 AUG', 'Bahrain\nFORMULA 1 GULF AIR BAHRAIN GRAND PRIX 2025\nR229 MAR - 31 MAR', 'Bahrain\nFORMULA 1 ARAMCO PRE-SEASON TESTING 2025\n26 FEB - 28 FEB');
  anchors.length = 0; cards.forEach((c, k) => anchors.push({ innerText: c, getAttribute: () => '/page/' + k }));
  t('weekend: local-language race name (Austria, by date)', pick(m('2019/2019-06-30_Austrian_Grand_Prix/2019-06-30_Race/', 'Austrian Grand Prix', 'FORMULA 1 MYWORLD GROSSER PREIS VON \u00d6STERREICH 2019', 'Austria', 'Spielberg')), 'FORMULA 1 MYWORLD GROSSER PREIS VON \u00d6STERREICH 2019');
  t('weekend: Magyar Nagydij (Hungary, by date)', pick(m('2019/2019-08-04_Hungarian_Grand_Prix/2019-08-04_Race/', 'Hungarian Grand Prix', 'FORMULA 1 ROLEX MAGYAR NAGYD\u00cdJ 2019', 'Hungary', 'Budapest')), 'FORMULA 1 ROLEX MAGYAR NAGYD\u00cdJ 2019');
  t('weekend: pre-season testing is not the Bahrain GP', pick(m('2025/2025-02-28_Pre-Season_Testing/2025-02-28_Day_3/', 'Pre-Season Testing', 'FORMULA 1 ARAMCO PRE-SEASON TESTING 2025', 'Bahrain', 'Sakhir')), 'FORMULA 1 ARAMCO PRE-SEASON TESTING 2025');
  t('weekend: no date known falls back to names', pick(m('', 'Austrian Grand Prix', 'FORMULA 1 MSC CRUISES AUSTRIAN GRAND PRIX 2025', 'Austria', 'Spielberg')), cards[3].split('\n')[1]);
}
for(const [sn,w] of [['race','Race 02:30:37 | Replay'],['qualifying','Qualifying 01:20:21 | Replay'],['practice 1','Practice 1 01:34:31 | Replay'],['practice 3','Practice 3 01:33:12 | Replay'],['sprint',null]])
  t('plain-label weekend: '+sn,lab(plain2025,run(plain2025,sn,'2025')),w);
// real labels from other eras
const fp2019 = ['2019 British Grand Prix 01:55:58 | Replay', '2019 British GP - F1 Qualifying 01:17:33 | Replay', '2019 British GP - F1 FP3 01:13:07 | Replay', '2019 British GP - F1 FP2 01:41:17 | Replay', '2019 British GP - F1 FP1 01:42:06 | Replay', '2019 British GP - F2 Practice 00:46:15 | Replay', '2019 British GP - F3 Practice 00:52:16 | Replay', '2019 British GP - Supercup Practice 00:52:43 | Replay'];
for (const [sn, w] of [['practice 1', '2019 British GP - F1 FP1 01:42:06 | Replay'], ['practice 2', '2019 British GP - F1 FP2 01:41:17 | Replay'], ['practice 3', '2019 British GP - F1 FP3 01:13:07 | Replay'], ['qualifying', '2019 British GP - F1 Qualifying 01:17:33 | Replay'], ['race', '2019 British Grand Prix 01:55:58 | Replay']])
  t('2019-style weekend (FP labels): ' + sn, lab(fp2019, run(fp2019, sn, '2019')), w);
const s2021 = ['2021 British Grand Prix 02:34:45 | Replay', '2021 British GP - F1 Sprint 00:51:57 | Replay', '2021 British GP - Practice 2 01:13:29 | Replay', '2021 British GP - Qualifying 01:23:48 | Replay', '2021 British GP - Practice 1 01:13:12 | Replay', '2021 British GP - F2 Feature Race 01:16:03 | Replay', '2017 British Grand Prix 02:02:35 | Replay', '2022 British Grand Prix 02:52:11 | Replay'];
t('2021: Sprint Qualifying is the Saturday sprint', lab(s2021, run(s2021, 'sprint qualifying', '2021')), '2021 British GP - F1 Sprint 00:51:57 | Replay');
t('2021: Race is not another year', lab(s2021, run(s2021, 'race', '2021')), '2021 British Grand Prix 02:34:45 | Replay');
const dbl = ['F1 Practice', 'F1 Practice 1', 'F1 Sprint Qualifying', 'F1 F1 Sprint', 'F1 Qualifying', 'F1 Pre-Sprint Show'];
t('2025 sprint weekend: doubled F1 prefix, Sprint', lab(dbl, run(dbl, 'sprint', '2025')), 'F1 F1 Sprint');
t('2025 sprint weekend: Sprint Qualifying', lab(dbl, run(dbl, 'sprint qualifying', '2025')), 'F1 Sprint Qualifying');
const imola = ['2020 Emilia Romagna Grand Prix 02:04:57 | Replay', '2020 Emilia Romagna GP - Qualifying 01:18:16 | Replay', '2020 Emilia Romagna GP - Practice 01:40:08 | Replay'];
t('2020 Imola: single Practice session', lab(imola, run(imola, 'practice', '2020')), '2020 Emilia Romagna GP - Practice 01:40:08 | Replay');
console.log(`\n${pass} ok, ${fail} failed`);process.exit(fail?1:0);

/**
 * Profilo di specie: porcino nero, Boletus aereus.
 *
 * PREMESSA ONESTA, da leggere prima dei numeri. Per il gruppo edulis avevamo
 * due studi quantitativi; per B. aereus la letteratura e' molto piu' magra, e
 * una delle poche affermazioni nette che si trovano e' proprio che **gli
 * inneschi della fruttificazione di questa specie non sono caratterizzati**:
 * anche dove il micelio e' confermato nel suolo con metodi molecolari, il
 * passaggio alla fase riproduttiva non e' prevedibile a partire dalle fonti.
 *
 * Questo profilo quindi non e' un modello misurato: e' il modello dell'edulis
 * spostato dove l'ecologia delle due specie divergerebbe, con ogni scelta
 * marcata per provenienza. Serve a rispondere "qui e adesso le condizioni
 * assomigliano a quelle in cui l'aereus si trova?", non a promettere una resa.
 *
 * Le marche:
 *
 *  [GEN]   Intervallo termico valido per il genere Boletus in letteratura
 *          divulgativa e agronomica: ottimale 15-24 C, mai sotto 6 C ne'
 *          sopra 28-30 C nelle ore diurne. E' l'unico ancoraggio numerico
 *          diretto che ho trovato per la fascia calda, ed e' quello su cui
 *          poggia la regola primaria.
 *
 *  [ECO]   Ecologia della specie, concorde fra le fonti consultate: specie
 *          **termofila mediterranea**, in simbiosi con Quercus (sughera e
 *          leccio in particolare), Castanea e Fagus, e con arbusti
 *          sclerofilli; raccolta da fine primavera a inizio autunno, con i
 *          ritrovamenti concentrati nelle ondate di caldo di estate e
 *          autunno. Uno studio su leccete iberiche la riporta raccolta in
 *          luglio e agosto.
 *
 *  [WB23]  Studio su castagneti italiani (Frontiers in Soil Science 2023) su
 *          micelio di B. edulis e B. reticulatus: eccesso e deficit idrico e
 *          la differenza P-PET dei **precedenti 1-2 mesi** influenzano
 *          significativamente il micelio, mentre la temperatura dell'aria non
 *          mostra effetto sul micelio. Conferma il meccanismo idrico del
 *          motore; nota bene: parla di micelio nel suolo, non di carpofori.
 *
 *  [DERIV] Derivato dal profilo boletus-edulis spostando un parametro dove le
 *          due ecologie divergono. Nessuna fonte quantitativa: sono i numeri
 *          da tarare per primi, ed e' per questo che il profilo si esporta in
 *          YAML e si ricarica senza toccare il codice.
 *
 * COSA DIFFERISCE DALL'EDULIS, e nient'altro:
 *
 *   1. l'ottimo termico dell'aria, spostato al caldo            [GEN]
 *   2. l'ottimo del suolo, che segue l'aria dello stesso scarto [DERIV]
 *   3. la preferenza di quota e le fasce fenologiche            [ECO]
 *   4. la soglia dell'inibitore caldo-e-secco, conseguenza di 1 [GEN]
 *   5. nessun modello di resa, perche' quello disponibile e' tarato su
 *      un'altra specie in un altro bosco
 *
 * Tutto il resto - bilancio idrico, soglie d'innesco, incubazione, siccita',
 * shock termico - e' **identico**, e non per pigrizia.
 *
 * La prima versione aveva spostato anche quelli, con l'argomento "la fascia
 * mediterranea e' piu' secca e piu' calda". E' un ragionamento rovesciato, e
 * l'ho scoperto perche' mi e' stato chiesto se davvero l'aereus avesse bisogno
 * di cosi' poca acqua: confondeva **quanta acqua serve al fungo** con **quanta
 * acqua il clima fornisce di solito**. Le due cose non hanno lo stesso verso.
 * Un clima piu' secco non abbassa il bisogno dell'organismo: gli fa
 * fruttificare meno spesso. E il clima e' gia' nel modello, perche' l'ETo di
 * Hargreaves lo calcola dalla temperatura e il serbatoio si svuota da solo -
 * misurato, 4,21 mm/giorno di ETo e 0,38 di riempimento a 500-699 m contro
 * 2,84 e 0,66 a 1400 m. Spostare le soglie ci metteva sopra una compensazione
 * che cancellava proprio quel segnale.
 *
 * La regola generale che ne resta: un parametro di specie si sposta solo se
 * cambia cio' che l'**organismo** chiede. Se cambia solo cio' che
 * l'**ambiente** offre, il posto giusto e' il bilancio idrico, e li' e' gia'
 * sistemato.
 */

import type { SpeciesProfile } from '../types.js';

export const BOLETUS_AEREUS: SpeciesProfile = {
  species: 'boletus-aereus',
  version: 1,
  label: 'Porcino nero (B. aereus)',

  water: {
    // Identico all'edulis, per due ragioni che convergono.
    //
    // La prima e' fisica: `awcMm` e `kc` descrivono il **suolo e la chioma**,
    // non il fungo. Due specie nello stesso bosco bevono dallo stesso
    // serbatoio, e se un giorno vorremo un kc diverso per la lecceta
    // sempreverde - che traspira anche d'inverno, al contrario della faggeta -
    // il posto giusto sara' il sito, non il profilo di specie.
    //
    // La seconda e' tecnica, e va detta perche' e' un vincolo vero: il feature
    // store ha chiave (stazione, giorno), non (stazione, giorno, modello).
    // Due profili con blocchi `water` diversi si sovrascriverebbero a vicenda
    // il bilancio idrico, e l'ultimo a girare vincerebbe. Finche' la chiave e'
    // quella, i due profili devono condividere questi due numeri.
    awcMm: 120,
    kc: 0.85,
  },

  trigger: {
    // Identico all'edulis, e la storia di come ci si e' arrivati vale piu' dei
    // numeri.
    //
    // La prima versione li aveva spostati tutti: soglia di pioggia 25 mm,
    // riempimento minimo 0,35, magnitudine di riferimento 50 mm. Il
    // ragionamento era "la fascia mediterranea e' piu' secca", ed era
    // rovesciato: confondeva **quanta acqua serve al fungo** con **quanta
    // acqua il clima fornisce di solito**. Che una regione sia piu' secca non
    // significa che l'organismo che vi abita ne abbia bisogno di meno per
    // fruttificare - significa che fruttifica piu' raramente. Un carpoforo e'
    // acqua per il 90% in entrambe le specie.
    //
    // Ed era anche un doppio conteggio del clima, perche' l'ETo lo modella
    // gia'. Misurato sulle celle: a 500-699 m l'evapotraspirazione e' 4,21
    // mm/giorno e il serbatoio si ferma a 0,38 di riempimento; a 1400 m sono
    // 2,84 mm/giorno e 0,66. Il bilancio idrico sa benissimo che nei siti
    // caldi l'acqua se ne va prima: abbassare le soglie ci metteva sopra una
    // compensazione che cancellava proprio quel segnale.
    windowDays: 5,
    minPrecipMm: 20,
    minSwi: 0.45,
    magnitudeRefMm: 60,
  },

  incubation: {
    // Invariato rispetto all'edulis, deliberatamente.
    //
    // La tentazione era accorciarlo: i tassi biologici crescono con la
    // temperatura, e su suolo caldo il micelio dovrebbe rispondere prima.
    // Ma e' un'inferenza generica, non un dato su questa specie, e sarebbe
    // finita nel modello travestita da conoscenza. Resta il parametro meno
    // sostenuto di entrambi i profili e il primo da tarare sul campo.
    minDays: 8,
    optDaysFrom: 12,
    optDaysTo: 18,
    maxDays: 28,
  },

  rules: [
    {
      // [GEN] La regola che distingue davvero le due specie.
      //
      // L'edulis ha il plateau fra 10 e 16 C e si azzera sopra i 21: con le
      // temperature di una Maremma di inizio settembre - misurate, 26,6 C di
      // media a 5 giorni sotto i 200 m - dichiara impossibile l'habitat
      // dell'aereus. Qui il plateau copre l'intervallo ottimale del genere
      // (15-24 C) e i fianchi arrivano ai limiti citati, 6-8 C in basso e
      // 28-30 C in alto.
      id: 'air-temperature',
      feature: 'tMean5',
      membership: { type: 'trapezoid', a: 8, b: 15, c: 24, d: 29 },
      weight: 1,
    },
    {
      // [DERIV] Il suolo segue l'aria, spostato dello stesso scarto e con la
      // stessa finestra piu' larga e peso minore dell'edulis: e' il driver
      // fisico, ma nessuna fonte ne pubblica un ottimo per questa specie.
      // Saltata dove il dato manca, non penalizzata.
      id: 'soil-temperature',
      feature: 'soilTMean7',
      membership: { type: 'trapezoid', a: 8, b: 14, c: 24, d: 29 },
      weight: 0.5,
      onMissing: 'skip',
    },
    {
      // [WB23] Il residuo idrico e' una regola limitante di peso pieno: e' il
      // fattore che lo studio sui castagneti trova significativo. Soglie
      // identiche all'edulis, per la ragione spiegata sopra nel blocco
      // `trigger`: la differenza fra i due climi la fa il bilancio idrico, non
      // una soglia piu' indulgente.
      id: 'soil-water',
      feature: 'swi',
      membership: { type: 'trapezoid', a: 0.3, b: 0.5, c: 0.95, d: 1.01 },
      weight: 1,
    },
    {
      // [WB23] La cumulata a tre settimane come proxy dell'eccesso idrico del
      // mese precedente. Riferimento identico all'edulis: quanta pioggia
      // "basta" e' una proprieta' del fungo, non del regime pluviometrico.
      id: 'cumulated-rain',
      feature: 'p21',
      membership: { type: 'saturating', ref: 90 },
      weight: 0.7,
    },
    {
      // [ECO] La preferenza di quota, detta esplicitamente.
      //
      // MISURATO E CORRETTO: senza questa regola il profilo si rovesciava. Il
      // plateau termico 15-24 copre praticamente ogni giorno appenninico di
      // settembre, quindi la regola primaria contribuiva 0,98 in media e non
      // discriminava piu' niente; restavano le regole idriche, e in quota
      // piove di piu' e si evapora di meno. Risultato: 28,2 di media a
      // 500-699 m contro 52,0 a 1000-1399 m - un profilo per una termofila di
      // bassa quota che raccomandava il crinale.
      //
      // La quota entra come regola sua e non nascosta nella temperatura,
      // perche' e' cio' che le fonti dicono davvero: l'areale e' la quercia
      // mediterranea, sughera e leccio, non la faggeta d'altura. Plateau fino
      // a 600 m, poi discesa: a 900 m vale ancora la meta', sopra i 1000 la
      // fascia fenologica non c'e' piu' e il punteggio e' zero comunque.
      id: 'altitude-preference',
      feature: 'altitude',
      membership: { type: 'trapezoid', a: -1, b: 0, c: 600, d: 1200 },
      weight: 1,
      onMissing: 'skip',
    },
    {
      // [ECO] I ritrovamenti si concentrano nelle ondate di caldo seguite da
      // rottura, quindi il raffreddamento resta un bonus. Finestra identica
      // all'edulis: l'avevo allargata dicendo "qui gli sbalzi sono maggiori",
      // che e' di nuovo una proprieta' del clima spacciata per preferenza
      // della specie. Bonus e non limitante: la sua assenza non azzera.
      id: 'thermal-shock',
      feature: 'thermalShock',
      membership: { type: 'trapezoid', a: 0, b: 2, c: 8, d: 14 },
      weight: 0.4,
      mode: 'bonus',
      onMissing: 'skip',
    },
  ],

  inhibitors: [
    {
      // [DERIV] L'inibitore caldo-e-secco dell'edulis scatta sopra 17,5 C, che
      // per l'aereus e' il centro dell'ottimo: applicarlo tale e quale
      // spegnerebbe la specie nella sua stagione. Qui la soglia sale oltre il
      // limite superiore del genere: non e' il caldo a fermarlo, e' il caldo
      // **senza acqua**. La condizione di siccita' resta la stessa, 5 mm sui
      // cinque giorni.
      id: 'heat-drought',
      when: {
        all: [
          { feature: 'tMean5', op: 'gt', value: 27 },
          { feature: 'p5', op: 'lt', value: 5 },
        ],
      },
      factor: 0,
    },
    {
      // [GEN] Sotto i 6 C il genere non fruttifica, e per una termofila la
      // prima gelata chiude la stagione. Persistente: il danno non finisce col
      // disgelo del mattino dopo.
      id: 'frost',
      when: { feature: 'frostDays', op: 'gte', value: 1 },
      factor: 0,
      persistDays: 5,
    },
    {
      // [MP12] Soglia identica all'edulis. L'avevo portata a 20 giorni
      // argomentando che in Mediterraneo due settimane asciutte sono l'estate
      // normale - ma "normale" non vuol dire "innocuo": quindici giorni senza
      // pioggia disidratano il micelio allo stesso modo a Grosseto e a
      // Pievepelago. Che l'inibitore scatti spesso, in quella fascia, e' cio'
      // che il modello deve dire, non un difetto da tarare via.
      id: 'drought',
      when: { feature: 'droughtStreak', op: 'gt', value: 12 },
      factor: 0.25,
    },
  ],

  phenology: {
    // [ECO] Fine primavera - inizio autunno, con la coda che si accorcia
    // salendo. Le fasce NON si sovrappongono: il punteggio fenologico vale 1
    // se una qualsiasi fascia copre il giorno, quindi con fasce sovrapposte
    // vincerebbe sempre la piu' permissiva.
    //
    // Sopra i 1000 m non c'e' fascia, ed e' una scelta esplicita: nessuna
    // fascia significa punteggio fenologico zero, cioe' "qui questa specie non
    // fruttifica".
    //
    // CORRETTO: la prima versione arrivava a 1400 m, perche' fra gli ospiti
    // dell'aereus le fonti citano anche il faggio. Ma un ospite possibile non
    // e' un areale: in Appennino questa specie sta sulla quercia mediterranea
    // e sul castagno, e quei 400 metri in piu' servivano solo a farle prendere
    // i punteggi migliori dove non vive. Sopra i 1000 m la risposta giusta e'
    // il profilo edulis.
    altitudeBands: [
      { fromM: 0, toM: 499, doyFrom: 152, doyTo: 305 }, //   1 giu - 1 nov
      { fromM: 500, toM: 999, doyFrom: 166, doyTo: 288 }, // 15 giu - 15 ott
    ],
  },

  // Nessun `yieldModel`: l'equazione di resa disponibile e' quella di
  // Martinez-Pena, tarata su B. edulis in pineta di Pinus sylvestris a Soria.
  // Prestarla a una specie mediterranea di quercia vorrebbe dire spacciare
  // per stima una calibrazione fatta su un altro fungo in un altro bosco.
  // Il campo e' opzionale proprio per poter dire "non lo so".

  // Le stesse soglie dell'edulis, cosi' che "buona" voglia dire la stessa cosa
  // passando da una specie all'altra: i punteggi sono comparabili solo se la
  // scala e' la stessa.
  classThresholds: { scarsa: 15, discreta: 35, buona: 60, eccezionale: 80 },
};

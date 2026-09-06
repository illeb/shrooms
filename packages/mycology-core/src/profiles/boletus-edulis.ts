/**
 * Profilo di specie: porcino, gruppo Boletus edulis.
 *
 * OGNI numero qui dentro e' annotato con la sua provenienza. Le fonti sono due,
 * e vanno tenute distinte perche' rispondono a domande diverse:
 *
 *  [BH25] Brejon Lamartiniere & Hoffman (2025), bioRxiv 10.64898/2025.12.12.693895
 *         Dieci anni (2015-2024) di monitoraggio quasi esaustivo in faggeta
 *         presso Bielefeld, 1.905 carpofori mappati con GPS, visite 2-4 volte
 *         a settimana. GLMM binomiale negativa su finestre di 5 giorni.
 *         Risponde a: "quando, dentro la stagione".
 *
 *  [MP12] Martinez-Pena et al. (2012), For. Ecol. Manage. 282:63-69.
 *         Quindici anni in pineta di Pinus sylvestris a Soria, 18 plot.
 *         Risponde a: "quanto, in tutta la stagione".
 *
 *  [LIT]  Letteratura generale e conoscenza corrente, senza una singola fonte
 *         quantitativa fra le due sopra. Sono i numeri piu' incerti e i primi
 *         da tarare sul campo.
 *
 * ATTENZIONE, punto che cambia il modello: l'ottimo di 13,2 C di [BH25] e'
 * sulla temperatura dell'ARIA (dati Copernicus E-OBS, media giornaliera a 2 m),
 * non del suolo. La regola termica primaria e' quindi sull'aria; il suolo entra
 * come regola secondaria, con peso minore, perche' e' fisicamente il driver ma
 * per esso non abbiamo un ottimo pubblicato nelle nostre fonti.
 */

import type { SpeciesProfile } from '../types.js';
import { MARTINEZ_PENA_BOLETUS } from '../scoring/yield-model.js';

export const BOLETUS_EDULIS: SpeciesProfile = {
  species: 'boletus-edulis',
  version: 1,
  label: 'Porcino (gruppo edulis)',

  water: {
    // [LIT] Suolo forestale con ~60 cm di zona radicale esplorata.
    awcMm: 120,
    // [LIT] Coefficiente colturale per bosco di latifoglie.
    kc: 0.85,
  },

  trigger: {
    // Finestra di 5 giorni: [BH25] la indica come "the typical timescale of
    // sporocarp development", ed e' quella su cui il paper trova il segnale.
    //
    // TARATO SUI DATI: con 3 giorni e 25 mm nessun evento veniva riconosciuto
    // nel settembre 2025 appenninico, dove il massimo su 3 giorni e' stato
    // 20,6 mm - eppure il suolo si e' inzuppato (SWI da 0,46 a 0,68 con 46 mm
    // in tre settimane). La pioggia d'autunno qui arriva distribuita, non in
    // un unico scroscio: una soglia da temporale estivo la manca.
    windowDays: 5,
    minPrecipMm: 20,
    // [LIT] Sotto questo riempimento il suolo assorbe senza accumulare: sono i
    // 40 mm d'agosto su terreno arido che evaporano senza produrre nulla.
    minSwi: 0.45,
    // [LIT] Oltre ~60 mm il beneficio satura: piove "abbastanza".
    magnitudeRefMm: 60,
  },

  incubation: {
    // [LIT] E' il parametro meno sostenuto dalle fonti e il primo da tarare.
    // [BH25] usa 5 giorni come "typical timescale of sporocarp development",
    // ma e' la finestra su cui misura il meteo, non il ritardo dalla pioggia.
    // Karavani et al. (2018), citato da [BH25]: in pineta mediterranea
    // l'effetto della pioggia sull'umidita' del suolo puo' ritardare fino a
    // un mese, il che giustifica la coda lunga.
    minDays: 8,
    optDaysFrom: 12,
    optDaysTo: 18,
    maxDays: 28,
  },

  rules: [
    {
      // [BH25] Regola primaria. Ottimo quadratico a 13,2 C sull'aria; picco
      // della kernel density a 15 C; carpofori osservati fra 7 e 19 C.
      // Il plateau 10-16 contiene entrambi i riferimenti, e 16 C - il valore
      // dell'esperienza sul campo - cade sul bordo alto.
      id: 'air-temperature',
      feature: 'tMean5',
      membership: { type: 'trapezoid', a: 4, b: 10, c: 16, d: 21 },
      weight: 1,
    },
    {
      // Regola secondaria: il suolo e' il driver fisico, ma nessuna delle due
      // fonti ne pubblica un ottimo. Finestra piu' larga e peso minore.
      // Saltata dove il dato manca, non penalizzata.
      id: 'soil-temperature',
      feature: 'soilTMean7',
      membership: { type: 'trapezoid', a: 4, b: 9, c: 17, d: 23 },
      weight: 0.5,
      onMissing: 'skip',
    },
    {
      // [LIT] Il "residuo al suolo": e' il bilancio idrico, non la pioggia
      // cumulata, a dire se l'acqua c'e' ancora.
      id: 'soil-water',
      feature: 'swi',
      membership: { type: 'trapezoid', a: 0.3, b: 0.5, c: 0.95, d: 1.01 },
      weight: 1,
    },
    {
      // [BH25] Effetto della precipitazione: lineare positivo, senza ottimo.
      // Tradotto in una saturante, che e' la forma monotona con rendimenti
      // decrescenti piu' onesta su una scala limitata.
      id: 'cumulated-rain',
      feature: 'p21',
      membership: { type: 'saturating', ref: 90 },
      weight: 0.7,
    },
    {
      // [MP12] Fra i fattori inibenti gli autori citano il "calo improvviso
      // delle temperature notturne". Qui e' il suo opposto usato come bonus:
      // un raffreddamento di 2-8 K dopo il caldo favorisce l'emergenza.
      // Bonus e non limitante: la sua assenza non deve azzerare nulla.
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
      // [BH25] Regola secca, l'unico pattern netto del paper: nessun carpoforo
      // osservato con temperatura media a 5 giorni sopra 17,5 C E precipitazione
      // media sotto 1 mm/giorno (qui: 5 mm sui 5 giorni).
      id: 'heat-drought',
      when: {
        all: [
          { feature: 'tMean5', op: 'gt', value: 17.5 },
          { feature: 'p5', op: 'lt', value: 5 },
        ],
      },
      factor: 0,
    },
    {
      // [MP12] "the appearance of the first frost" fra i fattori che inibiscono
      // la comparsa dei carpofori. Effetto persistente: il danno non finisce
      // col disgelo del mattino dopo.
      id: 'frost',
      when: { feature: 'frostDays', op: 'gte', value: 1 },
      factor: 0,
      persistDays: 5,
    },
    {
      // [MP12] "prolonged drought" fra i fattori inibenti. Non azzera:
      // penalizza, perche' una pioggia recente puo' averla interrotta.
      id: 'drought',
      when: { feature: 'droughtStreak', op: 'gt', value: 12 },
      factor: 0.25,
    },
  ],

  phenology: {
    // [LIT] I porcini salgono di quota in estate e scendono in autunno.
    //
    // Le fasce NON devono sovrapporsi: il punteggio fenologico vale 1 se una
    // qualsiasi fascia copre il giorno, quindi con fasce sovrapposte vince
    // sempre la piu' permissiva e le altre non hanno effetto. Con la versione
    // precedente Pievepelago (1083 m) ereditava la finestra della fascia
    // bassa e prendeva "eccezionale" a novembre, a quota e stagione sbagliate.
    altitudeBands: [
      { fromM: 1000, toM: 2000, doyFrom: 152, doyTo: 293 }, // 1 giu  - 20 ott
      { fromM: 500, toM: 999, doyFrom: 196, doyTo: 319 }, //  15 lug - 15 nov
      { fromM: 0, toM: 499, doyFrom: 244, doyTo: 350 }, //    1 set  - 16 dic
    ],
  },

  yieldModel: MARTINEZ_PENA_BOLETUS,

  // [LIT] Taratura iniziale, da rivedere guardando le distribuzioni reali.
  classThresholds: { scarsa: 15, discreta: 35, buona: 60, eccezionale: 80 },
};

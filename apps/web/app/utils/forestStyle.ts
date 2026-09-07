/**
 * Aspetto dei tipi di bosco: colore, icona, nome.
 *
 * Sta in un modulo suo e non nel componente mappa perche' lo leggono in tre -
 * mappa, legenda, filtri - e una tabella sola evita che la legenda dica una
 * cosa e la mappa ne disegni un'altra.
 *
 * Le icone sono tracciati SVG di Lucide **inlinati**, non classi `i-lucide-*`:
 * i marker di Leaflet si costruiscono con una stringa di HTML, fuori dal ciclo
 * di render di Vue, dove un componente `<UIcon>` non arriva.
 *
 * Una nota onesta sulla scelta delle icone: nessun set ne ha una per il faggio
 * e una diversa per il cerro, perche' sono due latifoglie e si somigliano. Le
 * icone qui distinguono la fisionomia - latifoglia d'alto fusto, conifera,
 * bosco magro di versante, castagneto da frutto - e il colore fa il resto. La
 * legenda tiene insieme le due cose.
 *
 * La palette e' qualitativa e non una rampa: i tipi non stanno in scala fra
 * loro. Le tinte seguono comunque la quota - verdi freddi in alto, ocra e
 * bruni in basso - cosi' la mappa dice qualcosa anche a chi non legge la
 * legenda.
 */

export interface ForestTypeStyle {
  label: string;
  color: string;
  note: string;
  /** Corpo dell'SVG, viewBox 0 0 24 24. */
  icon: string;
}

export const FOREST_STYLE: Record<string, ForestTypeStyle> = {
  FAGGETA: {
    label: 'Faggeta',
    color: '#2f6b3f',
    note: 'Fagus sylvatica. Il bosco del porcino d’alta quota.',
    // lucide/tree-deciduous
    icon: "<path d='M8 19a4 4 0 0 1-2.24-7.32A3.5 3.5 0 0 1 9 6.03V6a3 3 0 1 1 6 0v.04a3.5 3.5 0 0 1 3.24 5.65A4 4 0 0 1 16 19Zm4 0v3'/>",
  },
  CONIFERE: {
    label: 'Conifere',
    color: '#1e5f6b',
    note: 'Pinete, abetine, rimboschimenti.',
    // lucide/tree-pine
    icon: "<path d='m17 14l3 3.3a1 1 0 0 1-.7 1.7H4.7a1 1 0 0 1-.7-1.7L7 14h-.3a1 1 0 0 1-.7-1.7L9 9h-.2A1 1 0 0 1 8 7.3L12 3l4 4.3a1 1 0 0 1-.8 1.7H15l3 3.3a1 1 0 0 1-.7 1.7zm-5 8v-3'/>",
  },
  MISTO: {
    label: 'Bosco misto',
    color: '#4f8f5f',
    note: 'Nessuna specie nettamente prevalente.',
    // lucide/trees
    icon: "<g><path d='M10 10v.2A3 3 0 0 1 8.9 16H5a3 3 0 0 1-1-5.8V10a3 3 0 0 1 6 0m-3 6v6m6-3v3'/><path d='M12 19h8.3a1 1 0 0 0 .7-1.7L18 14h.3a1 1 0 0 0 .7-1.7L16 9h.2a1 1 0 0 0 .8-1.7L13 3l-1.4 1.5'/></g>",
  },
  CASTAGNETO: {
    label: 'Castagneto',
    color: '#8b4a2f',
    note: 'Castanea sativa. Fascia media, spesso il primo a partire.',
    // lucide/bean
    icon: "<g><path d='M10.165 6.598C9.954 7.478 9.64 8.36 9 9s-1.521.954-2.402 1.165A6 6 0 0 0 8 22c7.732 0 14-6.268 14-14a6 6 0 0 0-11.835-1.402'/><path d='M5.341 10.62a4 4 0 1 0 5.279-5.28'/></g>",
  },
  CERRETA: {
    label: 'Cerreta',
    color: '#7d8b2b',
    note: 'Quercus cerris. Collina e bassa montagna.',
    // lucide/leaf
    icon: "<g><path d='M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8c0 5.5-4.78 10-10 10'/><path d='M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12'/></g>",
  },
  ORNO_OSTRIETO: {
    label: 'Orno-ostrieto',
    color: '#b9a97a',
    note: 'Carpino nero e orniello: il bosco magro di versante.',
    // lucide/shrub
    icon: "<g><path d='M12 22v-5.172a2 2 0 0 0-.586-1.414L9.5 13.5m5 1L12 17'/><path d='M17 8.8A6 6 0 0 1 13.8 20H10A6.5 6.5 0 0 1 7 8a5 5 0 0 1 10 0z'/></g>",
  },
  QUERCETO: {
    label: 'Querceto',
    color: '#c9922e',
    note: 'Roverella, rovere, farnia.',
    // lucide/clover
    icon: "<path d='M16.17 7.83L2 22m2.02-10a2.827 2.827 0 1 1 3.81-4.17A2.827 2.827 0 1 1 12 4.02a2.827 2.827 0 1 1 4.17 3.81A2.827 2.827 0 1 1 19.98 12a2.827 2.827 0 1 1-3.81 4.17A2.827 2.827 0 1 1 12 19.98a2.827 2.827 0 1 1-4.17-3.81A1 1 0 1 1 4 12m3.83-4.17l8.34 8.34'/>",
  },
  ALTRO: {
    label: 'Altro bosco',
    color: '#9a9a9a',
    note: 'Robinieti, pioppeti, arbusteti.',
    // lucide/sprout
    icon: "<path d='M14 9.536V7a4 4 0 0 1 4-4h1.5a.5.5 0 0 1 .5.5V5a4 4 0 0 1-4 4a4 4 0 0 0-4 4c0 2 1 3 1 5a5 5 0 0 1-1 3M4 9a5 5 0 0 1 8 4a5 5 0 0 1-8-4m1 12h14'/>",
  },
};

/** Dal crinale al fondovalle, che e' anche l'ordine della legenda. */
export const FOREST_STYLE_ORDER = [
  'FAGGETA',
  'CONIFERE',
  'MISTO',
  'CASTAGNETO',
  'CERRETA',
  'ORNO_OSTRIETO',
  'QUERCETO',
  'ALTRO',
] as const;

export function styleOf(forestType: string): ForestTypeStyle {
  return FOREST_STYLE[forestType] ?? FOREST_STYLE['ALTRO']!;
}

/** Marker di Leaflet: l'icona del tipo in un pallino del suo colore. */
export function markerHtml(forestType: string, size = 22): string {
  const s = styleOf(forestType);
  const glyph = Math.round(size * 0.62);
  return `<span style="display:flex;align-items:center;justify-content:center;
      width:${size}px;height:${size}px;border-radius:999px;background:${s.color};
      box-shadow:0 0 0 1.5px #fff, 0 1px 3px rgb(0 0 0 / .35)">
      <svg viewBox="0 0 24 24" width="${glyph}" height="${glyph}" fill="none" stroke="#fff"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${s.icon}</svg>
    </span>`;
}

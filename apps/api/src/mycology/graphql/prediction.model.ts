import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';

@ObjectType({ description: 'Punto di misura da cui si valutano le condizioni.' })
export class StationType {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;

  @Field(() => Float)
  latitude!: number;

  @Field(() => Float)
  longitude!: number;

  @Field(() => Float, { nullable: true, description: 'Quota in metri s.l.m.' })
  altitudeM!: number | null;

  @Field(() => String, { nullable: true, description: 'Sigla: PR, MO, BO...' })
  province!: string | null;

  @Field(() => String, { nullable: true })
  provinceName!: string | null;

  @Field(() => String, { nullable: true })
  region!: string | null;
}

@ObjectType({
  description:
    'Condizioni di fruttificazione per una stazione in un giorno. ' +
    'Valuta il passato: non e una previsione meteo.',
})
export class FruitingPredictionType {
  @Field(() => ID)
  id!: string;

  @Field(() => String, {
    description:
      'Giorno valutato, YYYY-MM-DD. Stringa e non data: e un giorno locale ' +
      'italiano, e passarlo come istante lo esporrebbe a slittamenti di fuso.',
  })
  date!: string;

  @Field(() => Float, { description: 'Punteggio 0-100.' })
  score!: number;

  @Field(() => String, { description: 'nulla | scarsa | discreta | buona | eccezionale' })
  class!: string;

  @Field(() => Float, { description: 'Quanto il giorno e dentro una finestra di incubazione.' })
  triggerScore!: number;

  @Field(() => Float, { description: 'Stagione e quota compatibili: 1 o 0.' })
  phenologyScore!: number;

  @Field(() => Int, { nullable: true, description: "Giorni dall'evento di pioggia." })
  daysSinceWetEvent!: number | null;

  @Field(() => Boolean, {
    description: 'Il bilancio idrico non ha ancora dimenticato la condizione iniziale.',
  })
  warmup!: boolean;

  @Field(() => Float, {
    nullable: true,
    description:
      "Acqua trattenuta dal suolo, mm. E' il contenuto del serbatoio del " +
      'bilancio idrico: la pioggia che e ancora li, non quella caduta.',
  })
  soilWaterMm!: number | null;

  @Field(() => Float, {
    nullable: true,
    description: 'Riempimento del suolo, 0-1: soilWaterMm sulla riserva utile.',
  })
  swi!: number | null;

  @Field(() => Float, { nullable: true, description: 'Pioggia degli ultimi 21 giorni, mm.' })
  precip21dMm!: number | null;

  @Field(() => StationType)
  station!: StationType;
}

@ObjectType({ description: 'Profilo di specie con cui i punteggi sono stati calcolati.' })
export class SpeciesModelType {
  @Field(() => String)
  species!: string;

  @Field(() => Int)
  version!: number;

  @Field(() => String)
  label!: string;

  @Field(() => Boolean)
  active!: boolean;
}

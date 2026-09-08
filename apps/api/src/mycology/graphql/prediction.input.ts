import { Field, Float, InputType, Int } from '@nestjs/graphql';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

/**
 * Che tipo di riga elencare.
 *
 * Le celle di bosco sono stazioni sintetiche: vivono nella stessa tabella
 * `station`, distinte solo da `network = 'bosco'`. Comodo per il calcolo -
 * feature e punteggi passano dallo stesso codice - ma nelle viste vanno
 * separate, perche' una lista che le mescola ordinata per punteggio e tagliata
 * al limite mostra soprattutto celle e sembra mostrare termometri.
 */
export const PREDICTION_KINDS = ['stations', 'cells', 'all'] as const;

/**
 * Filtri per la lista delle condizioni.
 *
 * I decoratori di class-validator non sono ornamentali: la ValidationPipe
 * globale gira con `whitelist` e `forbidNonWhitelisted`, quindi un campo non
 * dichiarato qui viene rifiutato. Meglio cosi': l'input GraphQL e quello
 * validato restano per forza allineati.
 */
@InputType({ description: 'Filtri per la lista delle condizioni.' })
export class PredictionsInput {
  @Field(() => String, { nullable: true, defaultValue: 'boletus-edulis' })
  @IsOptional()
  @IsString()
  species?: string;

  @Field(() => String, {
    nullable: true,
    description: "Giorno YYYY-MM-DD. Omesso: l'ultimo calcolato.",
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date deve essere nel formato YYYY-MM-DD' })
  date?: string;

  @Field(() => Float, { nullable: true, defaultValue: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  minScore?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  minAltitudeM?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  maxAltitudeM?: number;

  @Field(() => [String], {
    nullable: true,
    description: 'Regioni da includere, per nome ("Toscana"). Vuoto = tutte.',
  })
  @IsOptional()
  @IsString({ each: true })
  regions?: string[];

  @Field(() => String, {
    nullable: true,
    defaultValue: 'stations',
    description:
      'Cosa elencare: `stations` le stazioni meteo osservate, `cells` le celle ' +
      'di bosco della griglia, `all` entrambe. Il default sono le stazioni: ' +
      'mescolarle era il modo per far sembrare celle sintetiche dei termometri.',
  })
  @IsOptional()
  @IsIn(PREDICTION_KINDS)
  kind?: string;

  @Field(() => Int, { nullable: true, defaultValue: 200 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}

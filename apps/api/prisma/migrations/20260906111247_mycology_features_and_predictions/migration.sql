-- CreateTable
CREATE TABLE "daily_station_feature" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "stationId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "features" JSONB NOT NULL,
    "warmup" BOOLEAN NOT NULL DEFAULT false,
    "computedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_station_feature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "species_model" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "species" VARCHAR(64) NOT NULL,
    "version" INTEGER NOT NULL,
    "label" VARCHAR(160) NOT NULL,
    "profile" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "source" VARCHAR(255),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "species_model_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fruiting_prediction" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "stationId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "modelId" UUID NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "class" VARCHAR(16) NOT NULL,
    "triggerScore" DOUBLE PRECISION NOT NULL,
    "phenologyScore" DOUBLE PRECISION NOT NULL,
    "daysSinceWetEvent" INTEGER,
    "warmup" BOOLEAN NOT NULL DEFAULT false,
    "detail" JSONB NOT NULL,
    "computedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fruiting_prediction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_station_feature_date_idx" ON "daily_station_feature"("date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_station_feature_stationId_date_key" ON "daily_station_feature"("stationId", "date");

-- CreateIndex
CREATE INDEX "species_model_species_active_idx" ON "species_model"("species", "active");

-- CreateIndex
CREATE UNIQUE INDEX "species_model_species_version_key" ON "species_model"("species", "version");

-- CreateIndex
CREATE INDEX "fruiting_prediction_date_score_idx" ON "fruiting_prediction"("date", "score" DESC);

-- CreateIndex
CREATE INDEX "fruiting_prediction_modelId_date_idx" ON "fruiting_prediction"("modelId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "fruiting_prediction_stationId_date_modelId_key" ON "fruiting_prediction"("stationId", "date", "modelId");

-- AddForeignKey
ALTER TABLE "daily_station_feature" ADD CONSTRAINT "daily_station_feature_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fruiting_prediction" ADD CONSTRAINT "fruiting_prediction_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fruiting_prediction" ADD CONSTRAINT "fruiting_prediction_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "species_model"("id") ON DELETE CASCADE ON UPDATE CASCADE;


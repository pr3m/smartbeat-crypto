-- CreateTable
CREATE TABLE "AIMarketAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pair" TEXT NOT NULL DEFAULT 'XRPEUR',
    "model" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "conviction" TEXT,
    "confidence" REAL,
    "entryLow" REAL,
    "entryHigh" REAL,
    "stopLoss" REAL,
    "targets" TEXT,
    "riskReward" REAL,
    "analysis" TEXT NOT NULL,
    "inputData" TEXT NOT NULL,
    "tokens" TEXT,
    "priceAtAnalysis" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "AIMarketAnalysis_createdAt_idx" ON "AIMarketAnalysis"("createdAt");

-- CreateIndex
CREATE INDEX "AIMarketAnalysis_action_idx" ON "AIMarketAnalysis"("action");

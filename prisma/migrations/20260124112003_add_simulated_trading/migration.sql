-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "krakenRefId" TEXT,
    "krakenOrderId" TEXT,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "pair" TEXT,
    "side" TEXT,
    "price" REAL,
    "cost" REAL,
    "fee" REAL,
    "feeAsset" TEXT,
    "leverage" TEXT,
    "margin" REAL,
    "posstatus" TEXT,
    "positionTxId" TEXT,
    "openingTradeId" TEXT,
    "closingTradeId" TEXT,
    "closePrice" REAL,
    "closeCost" REAL,
    "closeFee" REAL,
    "closeVolume" REAL,
    "closeMargin" REAL,
    "netPnl" REAL,
    "costBasis" REAL,
    "proceeds" REAL,
    "gain" REAL,
    "timestamp" DATETIME NOT NULL,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT
);

-- CreateTable
CREATE TABLE "AssetHolding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "asset" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "acquisitionDate" DATETIME NOT NULL,
    "acquisitionCost" REAL NOT NULL,
    "costPerUnit" REAL NOT NULL,
    "remainingAmount" REAL NOT NULL,
    "isFullyDisposed" BOOLEAN NOT NULL DEFAULT false,
    "transactionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TaxEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transactionId" TEXT NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "acquisitionDate" DATETIME NOT NULL,
    "acquisitionCost" REAL NOT NULL,
    "disposalDate" DATETIME NOT NULL,
    "disposalProceeds" REAL NOT NULL,
    "gain" REAL NOT NULL,
    "taxableAmount" REAL NOT NULL,
    "taxRate" REAL NOT NULL DEFAULT 0.24,
    "taxDue" REAL NOT NULL,
    "costBasisMethod" TEXT NOT NULL DEFAULT 'FIFO',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaxEvent_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "krakenPositionId" TEXT,
    "pair" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "volume" REAL NOT NULL,
    "entryPrice" REAL NOT NULL,
    "currentPrice" REAL,
    "leverage" TEXT NOT NULL,
    "margin" REAL NOT NULL,
    "unrealizedPnl" REAL,
    "openedAt" DATETIME NOT NULL,
    "closedAt" DATETIME,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TaxReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taxYear" INTEGER NOT NULL,
    "totalProceeds" REAL NOT NULL,
    "totalCostBasis" REAL NOT NULL,
    "totalGains" REAL NOT NULL,
    "totalLosses" REAL NOT NULL,
    "netGain" REAL NOT NULL,
    "taxableAmount" REAL NOT NULL,
    "taxRate" REAL NOT NULL DEFAULT 0.24,
    "estimatedTax" REAL NOT NULL,
    "reportData" TEXT NOT NULL,
    "table83Export" TEXT,
    "csvExport" TEXT,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "defaultTaxYear" INTEGER NOT NULL DEFAULT 2024,
    "costBasisMethod" TEXT NOT NULL DEFAULT 'FIFO',
    "taxRate" REAL NOT NULL DEFAULT 0.24,
    "country" TEXT NOT NULL DEFAULT 'EE',
    "defaultPair" TEXT NOT NULL DEFAULT 'XRPEUR',
    "maxPositionSize" REAL NOT NULL DEFAULT 2000,
    "stopLossPercent" REAL NOT NULL DEFAULT 8,
    "maxDailyLoss" REAL NOT NULL DEFAULT 150,
    "maxHoldHours" INTEGER NOT NULL DEFAULT 72,
    "lastSyncAt" DATETIME,
    "autoSyncEnabled" BOOLEAN NOT NULL DEFAULT true,
    "syncIntervalMin" INTEGER NOT NULL DEFAULT 60,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "syncType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "recordsFound" INTEGER NOT NULL DEFAULT 0,
    "recordsImported" INTEGER NOT NULL DEFAULT 0,
    "recordsSkipped" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "error" TEXT
);

-- CreateTable
CREATE TABLE "SimulatedOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pair" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "orderType" TEXT NOT NULL,
    "price" REAL,
    "volume" REAL NOT NULL,
    "leverage" INTEGER NOT NULL DEFAULT 10,
    "status" TEXT NOT NULL,
    "filledVolume" REAL NOT NULL DEFAULT 0,
    "marketPriceAtOrder" REAL NOT NULL,
    "entryConditions" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "positionId" TEXT,
    CONSTRAINT "SimulatedOrder_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "SimulatedPosition" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SimulatedFill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "volume" REAL NOT NULL,
    "fee" REAL NOT NULL,
    "filledAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SimulatedFill_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SimulatedOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SimulatedPosition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pair" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "volume" REAL NOT NULL,
    "avgEntryPrice" REAL NOT NULL,
    "leverage" INTEGER NOT NULL DEFAULT 10,
    "totalCost" REAL NOT NULL,
    "totalFees" REAL NOT NULL,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "realizedPnl" REAL,
    "entryConditions" TEXT,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME
);

-- CreateTable
CREATE TABLE "SimulatedBalance" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "eurBalance" REAL NOT NULL DEFAULT 2000,
    "cryptoHoldings" TEXT NOT NULL DEFAULT '{}',
    "cryptoValue" REAL NOT NULL DEFAULT 0,
    "equity" REAL NOT NULL DEFAULT 2000,
    "marginUsed" REAL NOT NULL DEFAULT 0,
    "freeMargin" REAL NOT NULL DEFAULT 20000,
    "marginLevel" REAL,
    "totalRealizedPnl" REAL NOT NULL DEFAULT 0,
    "totalFeesPaid" REAL NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TradeAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "positionId" TEXT,
    "tradeType" TEXT NOT NULL,
    "entryPrice" REAL NOT NULL,
    "exitPrice" REAL,
    "realizedPnl" REAL,
    "pnlPercent" REAL,
    "outcome" TEXT,
    "entrySnapshot" TEXT NOT NULL,
    "aiAnalysis" TEXT,
    "successFactors" TEXT,
    "failureFactors" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_krakenRefId_key" ON "Transaction"("krakenRefId");

-- CreateIndex
CREATE INDEX "Transaction_timestamp_idx" ON "Transaction"("timestamp");

-- CreateIndex
CREATE INDEX "Transaction_asset_idx" ON "Transaction"("asset");

-- CreateIndex
CREATE INDEX "Transaction_type_idx" ON "Transaction"("type");

-- CreateIndex
CREATE INDEX "AssetHolding_asset_isFullyDisposed_idx" ON "AssetHolding"("asset", "isFullyDisposed");

-- CreateIndex
CREATE INDEX "AssetHolding_acquisitionDate_idx" ON "AssetHolding"("acquisitionDate");

-- CreateIndex
CREATE INDEX "TaxEvent_taxYear_idx" ON "TaxEvent"("taxYear");

-- CreateIndex
CREATE INDEX "TaxEvent_transactionId_idx" ON "TaxEvent"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "Position_krakenPositionId_key" ON "Position"("krakenPositionId");

-- CreateIndex
CREATE INDEX "Position_isOpen_idx" ON "Position"("isOpen");

-- CreateIndex
CREATE INDEX "Position_pair_idx" ON "Position"("pair");

-- CreateIndex
CREATE UNIQUE INDEX "TaxReport_taxYear_key" ON "TaxReport"("taxYear");

-- CreateIndex
CREATE INDEX "SyncLog_syncType_startedAt_idx" ON "SyncLog"("syncType", "startedAt");

-- CreateIndex
CREATE INDEX "SimulatedOrder_status_createdAt_idx" ON "SimulatedOrder"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SimulatedFill_orderId_idx" ON "SimulatedFill"("orderId");

-- CreateIndex
CREATE INDEX "SimulatedPosition_isOpen_pair_idx" ON "SimulatedPosition"("isOpen", "pair");

-- CreateIndex
CREATE INDEX "TradeAnalysis_outcome_createdAt_idx" ON "TradeAnalysis"("outcome", "createdAt");

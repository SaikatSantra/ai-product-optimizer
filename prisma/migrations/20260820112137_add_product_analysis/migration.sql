-- CreateTable
CREATE TABLE "ProductAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "analysis" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "ProductAnalysis_shop_productId_idx" ON "ProductAnalysis"("shop", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAnalysis_shop_productId_contentHash_key" ON "ProductAnalysis"("shop", "productId", "contentHash");

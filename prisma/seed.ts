import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create default SimulatedBalance
  const balance = await prisma.simulatedBalance.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      eurBalance: 2000,
      cryptoValue: 0,
      equity: 2000,
      marginUsed: 0,
      freeMargin: 20000, // 2000 * 10 (max leverage)
      marginLevel: null,
      totalRealizedPnl: 0,
      totalFeesPaid: 0,
    },
  });

  console.log('Created default simulated balance:', balance);

  // Create default Settings
  const settings = await prisma.settings.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      defaultTaxYear: 2024,
      costBasisMethod: 'FIFO',
      taxRate: 0.24,
      country: 'EE',
      defaultPair: 'XRPEUR',
      maxPositionSize: 2000,
      stopLossPercent: 8,
      maxDailyLoss: 150,
      maxHoldHours: 72,
      autoSyncEnabled: true,
      syncIntervalMin: 60,
    },
  });

  console.log('Created default settings:', settings);

  console.log('Seeding completed!');
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

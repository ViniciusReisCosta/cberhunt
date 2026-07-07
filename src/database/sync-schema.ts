import AppDataSource from './data-source';

async function main() {
  await AppDataSource.initialize();
  await AppDataSource.synchronize(false);
  await AppDataSource.destroy();
  console.log('Database tables are ready');
}

main().catch(async (error) => {
  console.error(error);
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
  process.exit(1);
});


import cron from 'node-cron';
import { run } from './getSerp';

const schedule = '0 0 * * *'; // every day at midnight

console.log(`Scheduling getSerp at schedule: ${schedule} (server timezone)`);

cron.schedule(schedule, async () => {
  console.log(new Date().toISOString(), 'Running scheduled getSerp');
  try {
    await run();
    console.log(new Date().toISOString(), 'getSerp completed');
  } catch (err) {
    console.error(new Date().toISOString(), 'getSerp failed:', err);
  }
});

// keep process alive
process.on('SIGINT', () => {
  console.log('Received SIGINT, exiting');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, exiting');
  process.exit(0);
});

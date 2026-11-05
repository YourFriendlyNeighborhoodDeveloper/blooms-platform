import fs from 'node:fs';

// Local convenience: read .env when one exists. Hosts set real environment variables, and those
// always win, because loadEnvFile never overwrites a variable that is already set.
if (fs.existsSync('.env')) process.loadEnvFile('.env');

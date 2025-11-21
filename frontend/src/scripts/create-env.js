import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Helper script to create .env.local file from example
 */
const examplePath = path.join(__dirname, '../../env.example.txt');
const envPath = path.join(__dirname, '../../.env.local');

if (fs.existsSync(envPath)) {
  console.log('⚠️  .env.local file already exists. Skipping creation.');
  process.exit(0);
}

if (!fs.existsSync(examplePath)) {
  console.error('❌ env.example.txt not found!');
  process.exit(1);
}

try {
  fs.copyFileSync(examplePath, envPath);
  console.log('✅ Created .env.local file from env.example.txt');
  console.log('📝 Please edit .env.local and fill in your values');
} catch (error) {
  console.error('❌ Error creating .env.local file:', error.message);
  process.exit(1);
}


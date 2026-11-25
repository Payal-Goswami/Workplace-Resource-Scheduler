import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const backendDirectory = path.resolve(scriptDirectory, '..');
const seedFile = path.join(backendDirectory, 'db', 'seed', 'resources.json');
const outputFile = path.join(
  backendDirectory,
  'db',
  'migrations',
  '0005_seed_resources.sql'
);

const resources = JSON.parse(fs.readFileSync(seedFile, 'utf8'));

function sqlString(value) {
  if (value === null || value === undefined) {
    return 'NULL';
  }

  return `'${String(value).replaceAll("'", "''")}'`;
}

if (!Array.isArray(resources) || resources.length === 0) {
  throw new Error('The seed file must contain at least one resource.');
}

const locations = new Set();
const imageNames = new Set();

for (const resource of resources) {
  const location = `${resource.block}|${resource.floor}|${resource.room_number}`;

  if (locations.has(location)) {
    throw new Error(`Duplicate location in seed data: ${location}`);
  }

  locations.add(location);

  if (imageNames.has(resource.image_filename)) {
    throw new Error(`Duplicate image filename in seed data: ${resource.image_filename}`);
  }

  imageNames.add(resource.image_filename);

  if (!Number.isInteger(resource.capacity) || resource.capacity < 1) {
    throw new Error(`Invalid capacity for: ${resource.name}`);
  }
}

const insertRows = resources.map(
  (resource) => `(
  gen_random_uuid(),
  ${sqlString(resource.name)},
  ${sqlString(resource.type)}::resource_type,
  ${resource.capacity},
  ${sqlString(resource.description)},
  ${sqlString(resource.image_path)},
  ${sqlString(resource.block)},
  ${resource.floor},
  ${sqlString(resource.room_number)},
  ${resource.is_active ? 'true' : 'false'}
)`
);

const migration = `INSERT INTO resources (
  id,
  name,
  type,
  capacity,
  description,
  image_path,
  block,
  floor,
  room_number,
  is_active
) VALUES
${insertRows.join(',\n')}
ON CONFLICT DO NOTHING;
`;

fs.writeFileSync(outputFile, migration);
console.log(`Generated ${outputFile} with ${resources.length} resources.`);

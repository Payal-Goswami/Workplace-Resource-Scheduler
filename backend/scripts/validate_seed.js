import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const resourceFile = path.join(__dirname, '../db/seed/resources.json');

const raw = fs.readFileSync(resourceFile, 'utf8');
const resources = JSON.parse(raw);

if (!Array.isArray(resources)) {
  throw new Error('Seed file does not contain an array of resources.');
}

if (resources.length === 0) {
  throw new Error('The seed file has no resources.');
}

const locations = new Set();
const imageFiles = new Set();

for (const item of resources) {
  const locationKey = `${item.block}|${item.floor}|${item.room_number}`;
  if (locations.has(locationKey)) {
    throw new Error(`Duplicate location found: ${locationKey}`);
  }
  locations.add(locationKey);

  const imageName = item.image_filename || item.image_path?.split('/').pop();
  if (!imageName) {
    throw new Error(`Missing image reference for resource: ${item.name}`);
  }

  if (imageFiles.has(imageName)) {
    throw new Error(`Duplicate image filename found: ${imageName}`);
  }
  imageFiles.add(imageName);

  if (!Number.isInteger(item.capacity) || item.capacity < 1 || item.capacity > 250) {
    throw new Error(`Capacity out of range for resource: ${item.name}`);
  }

  if (!['MEETING_ROOM', 'SEMINAR_HALL', 'CONFERENCE_ROOM', 'BOARDROOM', 'HUDDLE_ROOM', 'FOCUS_BOOTH'].includes(item.type)) {
    throw new Error(`Invalid resource type for resource: ${item.name}`);
  }
}

console.log(`Seed validation passed: ${resources.length} resources validated.`);
console.log(`Unique locations: ${locations.size}`);
console.log(`Unique image files: ${imageFiles.size}`);

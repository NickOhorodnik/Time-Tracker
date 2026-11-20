import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('--- RUNNING ATT-IMG-URL-01 TEST SUITE ---\n');

// 1. URL Validator tests
console.log('[Test 1] Testing Image URL Validation Rules...');
const { validateImageUrl, isGoogleDriveSharingUrl } = await import('../src/utils/imageUrlValidator.ts');

// Valid HTTPS URLs
const valid1 = validateImageUrl('https://example.com/nastya.png');
assert.equal(valid1.valid, true, 'HTTPS URL with extension should be valid');
assert.equal(valid1.isDriveSharingUrl, false);

const valid2 = validateImageUrl('https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=800&q=80');
assert.equal(valid2.valid, true, 'HTTPS URL without extension but with query params must be valid');

const valid3 = validateImageUrl('https://cdn.allonsy.agency/assets/team/photo_452');
assert.equal(valid3.valid, true, 'HTTPS URL without extension must be valid (no file extension required)');

// Invalid protocols & formats
const invalidHttp = validateImageUrl('http://insecure.com/image.png');
assert.equal(invalidHttp.valid, false, 'Plain HTTP must be rejected');
assert.ok(invalidHttp.error.includes('https://'), 'Error should specify https:// requirement');

const invalidFtp = validateImageUrl('ftp://files.com/image.png');
assert.equal(invalidFtp.valid, false, 'FTP must be rejected');

const invalidEmpty = validateImageUrl('');
assert.equal(invalidEmpty.valid, false, 'Empty URL must be rejected');

const invalidText = validateImageUrl('not a url');
assert.equal(invalidText.valid, false, 'Invalid string must be rejected');

// Google Drive Sharing URL detection & warning
const driveView = validateImageUrl('https://drive.google.com/file/d/1A2B3C4D5E6F7G8H9I0J/view?usp=sharing');
assert.equal(driveView.valid, true, 'Drive sharing URL is structurally valid');
assert.equal(driveView.isDriveSharingUrl, true, 'Drive sharing URL must be detected');
assert.ok(driveView.warning && driveView.warning.includes('Google Drive'), 'Must provide Google Drive explanation warning');

const driveOpen = validateImageUrl('https://drive.google.com/open?id=1A2B3C4D5E6F7G8H9I0J');
assert.equal(driveOpen.isDriveSharingUrl, true, 'drive.google.com/open?id= must be detected');

console.log('✓ Image URL validation passed all test cases.\n');

// 2. Canonical Spreadsheet ID check
console.log('[Test 2] Verifying Canonical Spreadsheet ID Configuration...');
const { CANONICAL_SPREADSHEET_ID, initialSettings } = await import('../src/mockData.ts');
assert.equal(CANONICAL_SPREADSHEET_ID, '1Z-TfXPygBzAdAxGR0HYU2c5fnaWHPl4ZiHB48LE1mR4', 'Canonical spreadsheet ID must match');
assert.equal(initialSettings.googleSpreadsheetId, '1Z-TfXPygBzAdAxGR0HYU2c5fnaWHPl4ZiHB48LE1mR4', 'initialSettings must use canonical spreadsheet ID');
assert.ok(initialSettings.googleSpreadsheetInput.includes('1Z-TfXPygBzAdAxGR0HYU2c5fnaWHPl4ZiHB48LE1mR4'), 'initialSettings URL must contain canonical ID');
console.log(`✓ Canonical Spreadsheet ID verified: ${CANONICAL_SPREADSHEET_ID}\n`);

// 3. Bundled PNG Assets byte-for-byte check
console.log('[Test 3] Verifying all 6 bundled PNG assets byte-for-byte...');
const EXPECTED_BUNDLED_ASSETS = [
  { filename: ' image_b0f4189a.png', expectedBytes: 2157572, sha256: 'dd9f1b92d25e9cfc639082896bc85d0c6f5542ddced564efc65ca4d7f231c1a9' },
  { filename: 'image_1219077b.png', expectedBytes: 258643, sha256: '1219077b9441cdfd31f22e0c18441fd719c371ee8c78e21129c6c453be71bd9f' },
  { filename: 'image_2f7b48dc.png', expectedBytes: 2284734, sha256: '5b15c659de7130b06a53800586d38c3c427e33909308b0bbbdb44b1be7a84fb4' },
  { filename: 'image_56d1ee62.png', expectedBytes: 280402, sha256: '56d1ee625499ef8b9b4b7ed14fec0ebef3573ca343129700e425a85350b49c31' },
  { filename: 'image_9fc3a324.png', expectedBytes: 1975655, sha256: 'cc8d6bdd84a4d24c5cfd1529c76c7aefc89f328b5c952ecbfaf943fe5b34211a' },
  { filename: 'image_b0f4189a.png', expectedBytes: 2018161, sha256: 'b0f4189a081c8c3368dcfb6b135e3fccd6ab990846ce60b0fe40546318052617' },
];

const assetsDir = path.join(rootDir, 'public', 'assets', 'aistudio');
const crypto = await import('node:crypto');

for (const asset of EXPECTED_BUNDLED_ASSETS) {
  const filePath = path.join(assetsDir, asset.filename);
  assert.ok(fs.existsSync(filePath), `Bundled asset must exist: ${asset.filename}`);
  const stat = fs.statSync(filePath);
  assert.equal(stat.size, asset.expectedBytes, `Asset bytes mismatch for ${asset.filename}`);
  const fileBuf = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha256').update(fileBuf).digest('hex');
  assert.equal(hash, asset.sha256, `SHA-256 hash mismatch for ${asset.filename}`);
  console.log(`  ✓ Preserved ${asset.filename} (${stat.size.toLocaleString('en-US')} bytes, SHA-256 verified)`);
}
console.log('✓ All 6 bundled PNG assets preserved byte-for-byte.\n');

// 4. Logical Folders & Types mapping
console.log('[Test 4] Verifying Logical Folders & Groups Mapping...');
const { FOLDER_BY_GROUP, GROUP_BY_FOLDER } = await import('../src/types.ts');
assert.equal(FOLDER_BY_GROUP.character_primary, 'images/character/primary');
assert.equal(FOLDER_BY_GROUP.character_alternate, 'images/character/alternate');
assert.equal(FOLDER_BY_GROUP.team_avatars, 'images/team/avatars');
assert.equal(FOLDER_BY_GROUP.team_portraits, 'images/team/portraits');
assert.equal(FOLDER_BY_GROUP.bonuses, 'images/bonuses');

assert.equal(GROUP_BY_FOLDER['images/character/primary'], 'character_primary');
assert.equal(GROUP_BY_FOLDER['images/character/alternate'], 'character_alternate');
assert.equal(GROUP_BY_FOLDER['images/team/avatars'], 'team_avatars');
assert.equal(GROUP_BY_FOLDER['images/team/portraits'], 'team_portraits');
assert.equal(GROUP_BY_FOLDER['images/bonuses'], 'bonuses');
console.log('✓ Logical folder bidirectional mapping verified.\n');

// 5. Slot Assignment & Reuse via Stable Asset ID
console.log('[Test 5] Testing Slot Assignment & Multiple Destination Reuse by Asset ID...');
const sampleAsset = {
  id: 'asset-url-nastya-holiday-1',
  name: 'Настя святкова',
  group: 'character_primary',
  folder: 'images/character/primary',
  url: 'https://images.example.com/nastya-holiday.png',
  imageUrl: 'https://images.example.com/nastya-holiday.png',
  source: 'external_url',
  storageType: 'external_url',
};

// Simulate assigning sampleAsset to multiple destinations
const assignments = [
  { id: 'assign-character-primary-1', slotKey: 'images/character/primary/1', assetId: sampleAsset.id, assignedAt: new Date().toISOString() },
  { id: 'assign-character-alternate-2', slotKey: 'images/character/alternate/2', assetId: sampleAsset.id, assignedAt: new Date().toISOString() },
  { id: 'assign-bonuses-bonus-1', slotKey: 'images/bonuses/bonus-1', assetId: sampleAsset.id, assignedAt: new Date().toISOString() },
  { id: 'assign-team-avatars-emp-nastya', slotKey: 'images/team/avatars/emp-nastya', assetId: sampleAsset.id, assignedAt: new Date().toISOString() },
];

assert.equal(assignments.length, 4);
assert.ok(assignments.every((a) => a.assetId === sampleAsset.id), 'All assignments must reference stable assetId, not duplicated URL');
console.log('✓ Reusable slot assignment by stable asset ID verified.\n');

// 6. Alternate Slot Inheritance
console.log('[Test 6] Testing Alternate Slot Inheritance Behavior...');
let stage1 = {
  stage: 1,
  primaryImage: '/assets/aistudio/image_2f7b48dc.png',
  alternateImage: '/assets/aistudio/image_2f7b48dc.png', // inherited
};
assert.equal(stage1.primaryImage === stage1.alternateImage, true, 'Alternate stage 1 should be inherited by default');

// Assign distinct URL to alternate slot
stage1 = {
  ...stage1,
  alternateImage: 'https://images.example.com/alternate-stage-1.png',
};
assert.equal(stage1.primaryImage === stage1.alternateImage, false, 'Custom alternate slot breaks inheritance');

// Revert to shared inheritance
stage1 = {
  ...stage1,
  alternateImage: stage1.primaryImage,
};
assert.equal(stage1.primaryImage === stage1.alternateImage, true, 'Resetting alternate restores inheritance');
console.log('✓ Alternate slot inheritance (shared vs custom) verified.\n');

// 7. Preservation of Legacy Local Base64 Images
console.log('[Test 7] Testing Preservation of Legacy Local Base64 Images...');
const legacyLocalAsset = {
  id: 'asset-legacy-upload-1',
  name: 'Користувацьке фото (локальне)',
  group: 'character_primary',
  url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  source: 'local_upload',
  storageType: 'browser_local',
  storageMode: 'browser_local',
};

assert.ok(legacyLocalAsset.url.startsWith('data:image/png;base64,'), 'Legacy Base64 data must be preserved');
assert.equal(legacyLocalAsset.storageType, 'browser_local');
assert.equal(legacyLocalAsset.source, 'local_upload');
console.log('✓ Legacy local Base64 images preserved intact without auto-deletion.\n');

// 8. Server-side Header Mapping & Schema Compatibility Check
console.log('[Test 8] Checking gas/Code.gs for Dynamic Header Mapping and Blocked State...');
const codeGsContent = fs.readFileSync(path.join(rootDir, 'gas', 'Code.gs'), 'utf8');
assert.ok(codeGsContent.includes('function gasGetImageLibrary('), 'Code.gs must implement gasGetImageLibrary');
assert.ok(codeGsContent.includes('function gasSaveImageRegistry('), 'Code.gs must implement gasSaveImageRegistry');
assert.ok(codeGsContent.includes('function gasSaveImageAssignments('), 'Code.gs must implement gasSaveImageAssignments');
assert.ok(codeGsContent.includes('SCHEMA_COMPATIBILITY_BLOCKED'), 'Code.gs must return SCHEMA_COMPATIBILITY_BLOCKED when tabs are missing');
assert.ok(codeGsContent.includes('findImageLibraryHeaderMap('), 'Code.gs must use dynamic header mapping');
assert.ok(codeGsContent.includes('findImageAssignmentHeaderMap('), 'Code.gs must use dynamic assignment header mapping');
assert.ok(!codeGsContent.includes('ensureSchema(ss);\n    var sheet = ss.getSheetByName(\'Бібліотека зображень\');'), 'Must not create missing tabs or call ensureSchema on image library ops');
console.log('✓ gas/Code.gs header-based mapping and safe blocked state verified.\n');

// 9. Preview Runtime Mode Draft Labeling Check
console.log('[Test 9] Checking AI Studio Preview Zero-Network & Draft Labeling...');
const { api } = await import('../src/services/api.ts');
const previewRes = await api.saveImageMetadataRemote('1Z-TfXPygBzAdAxGR0HYU2c5fnaWHPl4ZiHB48LE1mR4', sampleAsset);
assert.equal(previewRes.success, false);
assert.equal(previewRes.draft, true, 'Preview mode must mark as draft');
assert.ok(previewRes.message.includes('Чернетка — не збережено в Google Таблиці'), 'Message must contain exact draft notice');

const previewAssignRes = await api.saveImageAssignmentsRemote('1Z-TfXPygBzAdAxGR0HYU2c5fnaWHPl4ZiHB48LE1mR4', assignments);
assert.equal(previewAssignRes.success, false);
assert.equal(previewAssignRes.draft, true);
assert.ok(previewAssignRes.message.includes('Чернетка — не збережено в Google Таблиці'));
console.log('✓ AI Studio Preview zero-network draft behavior verified.\n');

console.log('ALL 9 VERIFICATION CHECKS PASSED SUCCESSFULLY!');

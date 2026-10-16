import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dialogSource = readFileSync(new URL('./ImportVaultDialog.tsx', import.meta.url), 'utf8');
const hookSource = readFileSync(new URL('../../application/state/usePluginVaultImporter.ts', import.meta.url), 'utf8');

test('closing the importer dialog invalidates, cancels, and clears an active plugin request', () => {
  assert.match(hookSource, /pluginImportGenerationRef\.current \+= 1;/u);
  assert.match(hookSource, /const requestId = activePluginImportRequestRef\.current;[\s\S]*activePluginImportRequestRef\.current = null;[\s\S]*pluginExtensionBridge\.cancelRequest\(requestId\)/u);
  assert.match(hookSource, /setPluginPreview\(null\);[\s\S]*setPluginProgress\(null\);[\s\S]*setPluginBusy\(false\);/u);
});

test('late plugin importer results cannot repopulate state after close or replacement', () => {
  assert.match(hookSource, /const generation = \+\+pluginImportGenerationRef\.current;/u);
  assert.match(hookSource, /const isCurrent = \(\) => pluginImportGenerationRef\.current === generation;/u);
  assert.match(hookSource, /if \(!selection \|\| !isCurrent\(\)\) return;/u);
  assert.match(hookSource, /if \(isCurrent\(\)\) setPluginPreview\(preview\);/u);
  assert.match(hookSource, /if \(isCurrent\(\)\) setPluginError/u);
  assert.match(hookSource, /if \(selection && !consumed\)[\s\S]*releaseImporterFile\(selection\.selectionToken\)/u);
});

test('importer detection is cancellable before awaiting provider work', () => {
  assert.match(
    hookSource,
    /requestId = crypto\.randomUUID\(\);[\s\S]*activePluginImportRequestRef\.current = requestId;[\s\S]*await pluginExtensionBridge\.detectImporter\(\{\s*requestId,/u,
  );
});

test('plugin importer bridge lifecycle is owned by application state, not the dialog component', () => {
  assert.match(hookSource, /pluginExtensionBridge\.selectImporterFile/u);
  assert.match(hookSource, /pluginExtensionBridge\.parseImporterFile/u);
  assert.doesNotMatch(dialogSource, /pluginExtensionBridge/u);
});

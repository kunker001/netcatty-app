import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_HTTP_NETWORK_PROXY,
  areHttpNetworkProxySettingsEqual,
  buildElectronProxyConfig,
  buildNodeProxyEnv,
  normalizeHttpNetworkProxySettings,
  type HttpNetworkProxySettings,
} from './httpNetworkProxy.ts';

test('normalizeHttpNetworkProxySettings defaults to system mode', () => {
  assert.deepEqual(normalizeHttpNetworkProxySettings(undefined), DEFAULT_HTTP_NETWORK_PROXY);
  assert.deepEqual(normalizeHttpNetworkProxySettings(null), DEFAULT_HTTP_NETWORK_PROXY);
  assert.equal(DEFAULT_HTTP_NETWORK_PROXY.mode, 'system');
});

test('normalizeHttpNetworkProxySettings accepts direct and custom modes', () => {
  assert.deepEqual(normalizeHttpNetworkProxySettings({ mode: 'direct' }), {
    mode: 'direct',
    url: '',
    bypass: '<local>',
  });

  assert.deepEqual(
    normalizeHttpNetworkProxySettings({
      mode: 'custom',
      url: '  http://127.0.0.1:7890  ',
      bypass: ' localhost, 127.0.0.1 ',
    }),
    {
      mode: 'custom',
      url: 'http://127.0.0.1:7890',
      bypass: 'localhost, 127.0.0.1',
    },
  );
});

test('normalizeHttpNetworkProxySettings keeps custom draft when url is empty', () => {
  assert.deepEqual(normalizeHttpNetworkProxySettings({ mode: 'custom', url: '   ' }), {
    mode: 'custom',
    url: '',
    bypass: '<local>',
  });
});

test('normalizeHttpNetworkProxySettings strips proxy credentials from URL', () => {
  assert.deepEqual(
    normalizeHttpNetworkProxySettings({
      mode: 'custom',
      url: 'http://user:secret@127.0.0.1:7890',
      bypass: '<local>',
    }),
    {
      mode: 'custom',
      url: 'http://127.0.0.1:7890',
      bypass: '<local>',
    },
  );
});

test('normalizeHttpNetworkProxySettings strips credentials from incomplete draft URLs', () => {
  assert.deepEqual(
    normalizeHttpNetworkProxySettings({
      mode: 'custom',
      url: 'http://user:secret@',
      bypass: '<local>',
    }),
    {
      mode: 'custom',
      url: 'http://',
      bypass: '<local>',
    },
  );
  assert.equal(
    normalizeHttpNetworkProxySettings({
      mode: 'custom',
      url: 'socks4://user:secret@',
      bypass: '<local>',
    }).url,
    'socks4://',
  );
  assert.equal(
    normalizeHttpNetworkProxySettings({
      mode: 'custom',
      url: 'user:secret@proxy.example:8080',
      bypass: '<local>',
    }).url,
    'proxy.example:8080',
  );
});

test('normalizeHttpNetworkProxySettings preserves trailing colon while typing a port', () => {
  assert.equal(
    normalizeHttpNetworkProxySettings({
      mode: 'custom',
      url: 'http://127.0.0.1:',
      bypass: '<local>',
    }).url,
    'http://127.0.0.1:',
  );
});

test('areHttpNetworkProxySettingsEqual compares mode/url/bypass', () => {
  const a = { mode: 'custom' as const, url: 'http://127.0.0.1:7890', bypass: '<local>' };
  assert.equal(areHttpNetworkProxySettingsEqual(a, { ...a }), true);
  assert.equal(areHttpNetworkProxySettingsEqual(a, { ...a, url: 'http://127.0.0.1:1' }), false);
});

test('buildElectronProxyConfig maps modes to session.setProxy payloads', () => {
  assert.deepEqual(buildElectronProxyConfig({ mode: 'system', url: '', bypass: '<local>' }), {
    mode: 'system',
  });
  assert.deepEqual(buildElectronProxyConfig({ mode: 'direct', url: '', bypass: '<local>' }), {
    mode: 'direct',
  });

  const custom: HttpNetworkProxySettings = {
    mode: 'custom',
    url: 'http://proxy.example:8080',
    bypass: 'localhost,*.internal',
  };
  assert.deepEqual(buildElectronProxyConfig(custom), {
    mode: 'fixed_servers',
    proxyRules: 'http://proxy.example:8080',
    proxyBypassRules: 'localhost,*.internal',
  });
});

test('buildNodeProxyEnv mirrors custom proxy into HTTP(S)_PROXY', () => {
  assert.deepEqual(buildNodeProxyEnv({ mode: 'direct', url: '', bypass: '<local>' }), {
    HTTP_PROXY: '',
    HTTPS_PROXY: '',
    NO_PROXY: '',
    http_proxy: '',
    https_proxy: '',
    no_proxy: '',
  });

  assert.deepEqual(
    buildNodeProxyEnv({
      mode: 'custom',
      url: 'http://proxy.example:8080',
      bypass: 'localhost,127.0.0.1',
    }),
    {
      HTTP_PROXY: 'http://proxy.example:8080',
      HTTPS_PROXY: 'http://proxy.example:8080',
      NO_PROXY: 'localhost,127.0.0.1',
      http_proxy: 'http://proxy.example:8080',
      https_proxy: 'http://proxy.example:8080',
      no_proxy: 'localhost,127.0.0.1',
    },
  );

  // System mode leaves Node env alone — Chromium resolveProxy handles it.
  assert.equal(buildNodeProxyEnv({ mode: 'system', url: '', bypass: '<local>' }), null);
});

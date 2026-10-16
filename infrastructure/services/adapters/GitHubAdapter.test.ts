import assert from 'node:assert/strict';
import test from 'node:test';

import { downloadGistRevision, downloadSyncGist } from './GitHubAdapter.ts';
import { SYNC_CONSTANTS } from '../../../domain/sync.ts';

type FetchCall = {
  url: string;
  headers?: HeadersInit;
};

function installFetchMock(
  handler: (url: string, init?: RequestInit) => Promise<Response> | Response,
): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, headers: init?.headers });
    return handler(url, init);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const FULL_SYNCED_FILE = {
  meta: {
    version: 3,
    updatedAt: 1_700_000_000_000,
    deviceId: 'device-1',
    deviceName: 'Test',
  },
  payload: `ENC:${'A'.repeat(50_000)}`,
};

const FULL_CONTENT = JSON.stringify(FULL_SYNCED_FILE, null, 2);
// Reproduce #2643: Gist API embeds a truncated mid-string payload (~900 KiB cut).
const TRUNCATED_CONTENT = FULL_CONTENT.slice(0, 900);
const utf8ByteLength = (value: string): number =>
  new TextEncoder().encode(value).byteLength;

test('downloadSyncGist fetches raw_url when Gist API marks the file truncated', async () => {
  const rawUrl = 'https://gist.githubusercontent.com/u/abc/raw/netcatty-vault.json';
  const { calls, restore } = installFetchMock((url) => {
    if (url.includes('/gists/') && !url.includes('raw')) {
      return new Response(
        JSON.stringify({
          id: 'gist-1',
          description: SYNC_CONSTANTS.GIST_DESCRIPTION,
          files: {
            [SYNC_CONSTANTS.SYNC_FILE_NAME]: {
              filename: SYNC_CONSTANTS.SYNC_FILE_NAME,
              content: TRUNCATED_CONTENT,
              truncated: true,
              raw_url: rawUrl,
              size: utf8ByteLength(FULL_CONTENT),
            },
          },
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        }),
        { status: 200 },
      );
    }
    if (url === rawUrl) {
      return new Response(FULL_CONTENT, { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });

  try {
    const result = await downloadSyncGist('token-xyz', 'gist-1');
    assert.deepEqual(result, FULL_SYNCED_FILE);
    const rawCall = calls.find((c) => c.url === rawUrl);
    assert.ok(rawCall, 'must fetch raw_url for truncated gist');
    assert.deepEqual(rawCall.headers, {
      Authorization: 'Bearer token-xyz',
      Accept: 'application/vnd.github.raw',
    });
  } finally {
    restore();
  }
});

test('downloadSyncGist falls back to raw_url when embedded content is incomplete JSON', async () => {
  const rawUrl = 'https://gist.githubusercontent.com/u/abc/raw/netcatty-vault.json';
  const { restore } = installFetchMock((url) => {
    if (url.includes('/gists/') && !url.includes('raw')) {
      return new Response(
        JSON.stringify({
          id: 'gist-1',
          description: SYNC_CONSTANTS.GIST_DESCRIPTION,
          files: {
            [SYNC_CONSTANTS.SYNC_FILE_NAME]: {
              filename: SYNC_CONSTANTS.SYNC_FILE_NAME,
              // truncated flag missing (edge case) but content is cut mid-string
              content: TRUNCATED_CONTENT,
              raw_url: rawUrl,
              size: utf8ByteLength(FULL_CONTENT),
            },
          },
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        }),
        { status: 200 },
      );
    }
    if (url === rawUrl) {
      return new Response(FULL_CONTENT, { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });

  try {
    const result = await downloadSyncGist('token-xyz', 'gist-1');
    assert.deepEqual(result, FULL_SYNCED_FILE);
  } finally {
    restore();
  }
});

test('downloadSyncGist uses embedded content when file is not truncated', async () => {
  const small = { meta: { version: 1 }, payload: 'small' };
  const body = JSON.stringify(small);
  let rawFetches = 0;
  const { restore } = installFetchMock((url) => {
    if (url.includes('/gists/')) {
      return new Response(
        JSON.stringify({
          id: 'gist-1',
          description: SYNC_CONSTANTS.GIST_DESCRIPTION,
          files: {
            [SYNC_CONSTANTS.SYNC_FILE_NAME]: {
              filename: SYNC_CONSTANTS.SYNC_FILE_NAME,
              content: body,
              truncated: false,
              raw_url: 'https://gist.githubusercontent.com/u/abc/raw/unused',
              size: utf8ByteLength(body),
            },
          },
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        }),
        { status: 200 },
      );
    }
    rawFetches += 1;
    return new Response('should not fetch', { status: 500 });
  });

  try {
    const result = await downloadSyncGist('token-xyz', 'gist-1');
    assert.deepEqual(result, small);
    assert.equal(rawFetches, 0);
  } finally {
    restore();
  }
});

test('downloadSyncGist keeps embedded multibyte content without raw fetch', async () => {
  const small = {
    meta: {
      version: 1,
      deviceName: '我的电脑',
    },
    payload: 'small',
  };
  const body = JSON.stringify(small);
  // GitHub reports UTF-8 bytes; string.length is smaller for CJK, which must not
  // be treated as truncation.
  assert.ok(utf8ByteLength(body) > body.length);
  let rawFetches = 0;
  const { restore } = installFetchMock((url) => {
    if (url.includes('/gists/')) {
      return new Response(
        JSON.stringify({
          id: 'gist-1',
          description: SYNC_CONSTANTS.GIST_DESCRIPTION,
          files: {
            [SYNC_CONSTANTS.SYNC_FILE_NAME]: {
              filename: SYNC_CONSTANTS.SYNC_FILE_NAME,
              content: body,
              truncated: false,
              raw_url: 'https://gist.githubusercontent.com/u/abc/raw/unused',
              size: utf8ByteLength(body),
            },
          },
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        }),
        { status: 200 },
      );
    }
    rawFetches += 1;
    return new Response('should not fetch', { status: 500 });
  });

  try {
    const result = await downloadSyncGist('token-xyz', 'gist-1');
    assert.deepEqual(result, small);
    assert.equal(rawFetches, 0);
  } finally {
    restore();
  }
});

test('downloadGistRevision also recovers truncated content via raw_url', async () => {
  const rawUrl = 'https://gist.githubusercontent.com/u/abc/raw/rev/netcatty-vault.json';
  const { restore } = installFetchMock((url) => {
    if (url.includes('/gists/gist-1/deadbeef')) {
      return new Response(
        JSON.stringify({
          id: 'gist-1',
          description: SYNC_CONSTANTS.GIST_DESCRIPTION,
          files: {
            [SYNC_CONSTANTS.SYNC_FILE_NAME]: {
              filename: SYNC_CONSTANTS.SYNC_FILE_NAME,
              content: TRUNCATED_CONTENT,
              truncated: true,
              raw_url: rawUrl,
              size: utf8ByteLength(FULL_CONTENT),
            },
          },
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        }),
        { status: 200 },
      );
    }
    if (url === rawUrl) {
      return new Response(FULL_CONTENT, { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });

  try {
    const result = await downloadGistRevision('token-xyz', 'gist-1', 'deadbeef');
    assert.deepEqual(result, FULL_SYNCED_FILE);
  } finally {
    restore();
  }
});

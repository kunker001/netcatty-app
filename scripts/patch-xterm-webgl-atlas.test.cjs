/* global __dirname, process */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const script = path.resolve(__dirname, "patch-xterm-webgl-atlas.cjs");

/** Minimal stand-in for upstream #6055 + #5987 + #6043 (beta.291+). */
function upstreamAllFixedSource() {
  return (
    `for(let c=0;c<e0.length;c++){let u=e0[c];if(Ee(u.config,h))return u.ownedBy.push(i),u.atlas} ` +
    `clearTexture(){if(!(this._pages[0].currentRow.x===0&&this._pages[0].currentRow.y===0)){` +
    `for(let e of this._pages)e.clear();this._cacheMap.clear(),this._cacheMapCombined.clear(),` +
    `this._didWarmUp=!1,this._pageLayoutVersion++} ` +
    `_evictAllPages(){this._pages.length=0} maxAtlasPages ` +
    `t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.LINEAR),` +
    `t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,t.LINEAR),` +
    `t.texImage2D(t.TEXTURE_2D,0,t.RGBA,t.RGBA,t.UNSIGNED_BYTE,r.pages[n].canvas),` +
    `this._atlasTextures[n].version=r.pages[n].version`
  );
}

function makeTmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "netcatty-xterm-webgl-patch-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeWebglVersion(root, version) {
  const packageJson = path.join(root, "node_modules/@xterm/addon-webgl/package.json");
  fs.mkdirSync(path.dirname(packageJson), { recursive: true });
  fs.writeFileSync(packageJson, JSON.stringify({ version }));
}

function writeRawWebglBuild(root, file, source) {
  const abs = path.join(root, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, source);
}

function writeBothBuilds(root, source) {
  writeRawWebglBuild(root, "node_modules/@xterm/addon-webgl/lib/addon-webgl.mjs", source);
  writeRawWebglBuild(root, "node_modules/@xterm/addon-webgl/lib/addon-webgl.js", source);
}

test("accepts packages that ship upstream #6055/#5987/#6043", async (t) => {
  const root = makeTmp(t);
  writeWebglVersion(root, "0.20.0-beta.291");
  writeBothBuilds(root, upstreamAllFixedSource());

  const { stdout, stderr } = await execFileAsync(process.execPath, [script], { cwd: root });

  assert.match(stdout, /verify version=0\.20\.0-beta\.291 ok=2 missing=0/);
  assert.equal(stderr, "");
  // Verify mode must not rewrite node_modules.
  assert.equal(
    fs.readFileSync(path.join(root, "node_modules/@xterm/addon-webgl/lib/addon-webgl.mjs"), "utf8"),
    upstreamAllFixedSource(),
  );
});

test("fails closed when shared-atlas clear fix is missing", async (t) => {
  const root = makeTmp(t);
  writeWebglVersion(root, "0.20.0-beta.219");
  // Capacity + no mipmap, but no pageLayoutVersion on clearTexture.
  writeBothBuilds(
    root,
    `clearTexture(){this._pages[0].clear()} _evictAllPages(){} maxAtlasPages LINEAR`,
  );

  await assert.rejects(execFileAsync(process.execPath, [script], { cwd: root }), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /shared-atlas clear \(#6055\)/);
    assert.match(error.stdout, /ok=0 missing=2/);
    return true;
  });
});

test("fails closed when generateMipmap is still present", async (t) => {
  const root = makeTmp(t);
  writeWebglVersion(root, "0.20.0-beta.291");
  writeBothBuilds(
    root,
    `clearTexture(){this._pageLayoutVersion++} _evictAllPages(){} maxAtlasPages ` +
      `gl.generateMipmap(gl.TEXTURE_2D)`,
  );

  await assert.rejects(execFileAsync(process.execPath, [script], { cwd: root }), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /no atlas mipmaps \(#5987\)/);
    return true;
  });
});

test("fails closed when capacity eviction is missing", async (t) => {
  const root = makeTmp(t);
  writeWebglVersion(root, "0.20.0-beta.291");
  writeBothBuilds(root, `clearTexture(){this._pageLayoutVersion++}`);

  await assert.rejects(execFileAsync(process.execPath, [script], { cwd: root }), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /atlas capacity eviction \(#6043\)/);
    return true;
  });
});

test("fails closed when addon builds are missing", async (t) => {
  const root = makeTmp(t);
  writeWebglVersion(root, "0.20.0-beta.291");

  await assert.rejects(execFileAsync(process.execPath, [script], { cwd: root }), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /not found/);
    assert.match(error.stdout, /ok=0 missing=2/);
    return true;
  });
});

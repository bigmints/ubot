const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('the staged relay image layout serves its packaged installer', () => {
  const staged = fs.mkdtempSync(path.join(os.tmpdir(), 'youbot-relay-package-'));
  try {
    fs.mkdirSync(path.join(staged, 'website'));
    fs.copyFileSync(path.join(__dirname, '../website/serve.cjs'), path.join(staged, 'website/serve.cjs'));
    fs.copyFileSync(path.join(__dirname, '../../../install.sh'), path.join(staged, 'install.sh'));
    const { serveWebsite } = require(path.join(staged, 'website/serve.cjs'));
    let status;
    let headers;
    let body;
    const response = {
      writeHead(value, values) { status = value; headers = values; },
      end(value) { body = value; },
    };
    assert.equal(serveWebsite({ method: 'GET' }, response, '/install.sh'), true);
    assert.equal(status, 200);
    assert.match(headers['Content-Type'], /text\/x-shellscript/);
    assert.match(body.toString('utf8'), /^#!\/usr\/bin\/env bash/);
  } finally {
    fs.rmSync(staged, { recursive: true, force: true });
  }
});

test('the relay build contract copies the canonical installer', () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, '../Dockerfile'), 'utf8');
  const deploy = fs.readFileSync(path.join(__dirname, '../../deploy-relay.sh'), 'utf8');
  assert.match(dockerfile, /^COPY --chown=node:node install\.sh \.$/m);
  assert.match(dockerfile, /^COPY --chown=node:node server\.js \.$/m);
  assert.match(dockerfile, /^COPY --chown=node:node website\/ website\/$/m);
  assert.match(deploy, /install -m 755 "\$SCRIPT_DIR\/\.\.\/install\.sh" "\$BUILD_CONTEXT\/install\.sh"/);
  assert.match(deploy, /--source "\$BUILD_CONTEXT"/);
});

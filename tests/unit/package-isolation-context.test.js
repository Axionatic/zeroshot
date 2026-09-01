const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('published isolation build context', function () {
  const root = path.join(__dirname, '..', '..');
  const manifest = require('../../package.json');

  it('ships .dockerignore so installed builds exclude host dependencies', () => {
    assert.strictEqual(manifest.files.includes('.dockerignore'), true);
  });

  it('ships a locked dependency tree for installed-package image builds', () => {
    const rootLock = fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8');
    const imageLock = fs.readFileSync(
      path.join(root, 'docker', 'zeroshot-cluster', 'package-lock.json'),
      'utf8'
    );
    const dockerfile = fs.readFileSync(
      path.join(root, 'docker', 'zeroshot-cluster', 'Dockerfile'),
      'utf8'
    );

    assert.strictEqual(imageLock, rootLock);
    assert.match(
      dockerfile,
      /COPY --chown=node:node docker\/zeroshot-cluster\/package-lock\.json \/tmp\/zeroshot\/package-lock\.json/
    );
    assert.match(dockerfile, /RUN cd \/tmp\/zeroshot && npm ci && npm link/);
  });
});

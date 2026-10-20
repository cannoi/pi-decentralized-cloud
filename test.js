const assert = require('assert');
const http = require('http');

const PORT = process.env.PORT || 8080;

console.log('Running basic server health check test...');

setTimeout(() => {
  http.get(`http://127.0.0.1:${PORT}/health`, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        assert.strictEqual(json.status, 'ok');
        console.log('Test PASSED: /health responded with ok');
        process.exit(0);
      } catch (err) {
        console.error('Test FAILED:', err);
        process.exit(1);
      }
    });
  }).on('error', (err) => {
    console.error('Test FAILED connecting to server:', err);
    process.exit(1);
  });
}, 2000);

const http = require('http');
const OpenAI = require('openai');

const server = http.createServer((req, res) => {
  console.log('--- Headers Received ---');
  console.log(req.headers);
  console.log('------------------------');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: 'success' } }] }));
});

server.listen(8081, async () => {
  console.log('Server started on 8081');
  const client = new OpenAI({
    baseURL: 'http://localhost:8081',
    apiKey: 'sk-dummy-key',
  });

  try {
    await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hello' }]
    });
  } catch (err) {
    console.error('Client Error:', err.message);
  } finally {
    server.close();
  }
});

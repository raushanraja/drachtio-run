const Client = require('rtpengine-client').Client;
const client = new Client();

client.ping(2223, '127.0.0.1')
  .then((res) => {
    console.log(`received ${JSON.stringify(res)}`); // {result: 'pong'}
  })
  .catch((err) => {
    console.log(`Error: ${err}`);
  });
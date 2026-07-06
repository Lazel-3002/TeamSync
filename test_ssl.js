const https = require('https');
const hosts = [
  { host: 'broker.hivemq.com', port: 8884 },
  { host: 'test.mosquitto.org', port: 8081 },
  { host: 'broker.emqx.io', port: 8084 }
];

hosts.forEach(({host, port}) => {
  const req = https.request({ host, port, method: 'GET', rejectUnauthorized: true }, res => {
    console.log(host + ':' + port + ' SSL OK, status: ' + res.statusCode);
  });
  req.on('error', e => {
    console.log(host + ':' + port + ' SSL ERROR: ' + e.message);
  });
  req.end();
});

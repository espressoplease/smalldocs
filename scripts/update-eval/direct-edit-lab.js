'use strict';
const { startLab } = require('./agent-lab');
let lab;
startLab({ directEdits: true }).then(value => {
  lab = value;
  const stop = () => lab.close().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}).catch(async error => {
  console.error(error);
  if (lab) await lab.close();
  process.exit(1);
});

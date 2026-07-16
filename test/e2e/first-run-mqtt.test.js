// Regression guard: a brand-new user (no saved profile) going through the
// name -> "Ileri" step must end up with a connected global MQTT client,
// otherwise the entire friends/DM/presence system stays silently dead
// for every first-time user.
const { spawnPeer, cleanupPeer, waitFor } = require('./lib/harness');

module.exports = async function run() {
  const a = await spawnPeer({ port: 9305, name: 'FreshUser' });
  try {
    await waitFor(
      a.client,
      `!!(window.state && window.state.globalMqtt && window.state.globalMqtt.connected)`,
      20000,
      'global mqtt connected'
    );
  } catch (e) {
    throw new Error('First-run user never got a connected global MQTT client (friends/DM system would be dead): ' + e.message);
  } finally {
    cleanupPeer(a);
  }
};

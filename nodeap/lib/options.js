const debug = require('debug')('drachtio:test');

module.exports = ({logger}) => {

  return (req, res) => {
    /* TODO: build this out with your logic */
    debug(req.uri, 'got incoming OPTIONS');
    res.send(200, {
      headers: {
        'User-agent': 'test'
      }
    });
  };
};

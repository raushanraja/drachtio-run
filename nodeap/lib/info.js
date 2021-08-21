const debug = require('debug')('drachtio:test');

module.exports = ({logger}) => {

  return (req, res) => {
    /* TODO: build this out with your logic */
    debug(req.uri, 'got incoming INFO');
    res.send(480, 'Under Construction!', {
      headers: {
        'User-agent': 'test'
      }
    });
  };
};

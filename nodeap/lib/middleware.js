const debug = require('debug')('drachtio:test');
const digestAuth = require('drachtio-mw-digest-auth') ;
const parseUri = require('drachtio-srf').parseUri;
const {NAT_EXPIRES} = require('./utils');
module.exports = (logger) => {

  /**
   * initialize req.locals and add a pino logger that will kick out
   * the sip call-id as part of every log statement
   */
  const initLocals = (req, res, next) => {
    req.locals = req.locals || {};
    req.locals.logger = logger.child({
      callId: req.get('Call-ID')
    });
    req.once('cancel', () => req.canceled = true);

    next();
  };

  /**
   * Check active registrations to see if we need to challenge this
   */
  const checkCache = async(req, res, next) => {
    const registration = req.registration;
    if (registration.type === 'unregister') return next();
    const uri = parseUri(registration.aor);
    const aor = `${uri.user}@${uri.host}`;
    const registrar = req.srf.locals.registrar
    const result = await registrar.query(aor);
    const ip = registration.contact[0].uri.split(';')[0]
    req.srf.locals.ipd[aor]=ip
    console.log(req.srf.locals.ipd)
    if (result) {
      /* if known valid registration coming from same address, no need to challenge */
      if (result.proxy === `sip:${req.source_address}:${req.source_port}`) {
        debug(`responding to cached register for ${aor}`);
        res.cached = true;
        res.send(200, {
          headers: {
            'Contact': req.get('Contact').replace(/expires=\d+/, `expires=${NAT_EXPIRES}`),
            'Expires': NAT_EXPIRES
          }
        });
        return req.srf.endSession(req);
      }
    }
    next();
  };

  const challenge = digestAuth({
    realm: (req) => {
      const uri = parseUri(req.uri);
      return uri.host;
    },
    passwordLookup: function(username, realm, callback) {
      /* TODO: replace this with your own password lookup function */
      //if ('drachtio.org' === realm && 'foo' === username) return callback(null, 'bar');
      return callback(null,'password')
      callback('invalid username');
    }
  });

  /* add additional middleware functions as needed */

  return {
    checkCache,
    challenge,
    initLocals
  };
};

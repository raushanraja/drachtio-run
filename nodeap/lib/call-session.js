const Emitter = require('events');
const {parseUri, SipError} = require('drachtio-srf');
const debug = require('debug')('drachtio:test');

class CallSession extends Emitter {
  constructor(req, res) {
    super();
    this.req = req;
    this.res = res;
    this.srf = req.srf;
    this.logger = req.locals.logger;
  }

  async connect() {
    const uri = parseUri(this.req.uri);
    const body = parseUri(this.req);
    const aor = this.req.get('to').replace('<','').replace('>','').split(":")[1]
    const result = this.req.srf.locals.ipd[aor]
    console.log(result)
    //this.logger.info({result}, 'result is');
    //this.logger.info({aor}, 'result is');
    debug({uri, sdp: this.req.body}, 'incoming call received');
    this.logger.info({uri} , 'inbound call accepted for routing');
    //this.logger.info({body} , 'inbound call accepted for routing');

    try {
      const {uas, uac} = await this.srf.createB2BUA(this.req, this.res, result, {localSdpB: this.req.body})
      this.logger.info('call connected successfully');
      [uas, uac].forEach((dlg) => dlg.on('destroy', () => (dlg === uac ? uas : uac).destroy()));
    } catch (err) {
      if (err instanceof SipError) {
        if (487 === err.status) this.logger.info('caller hungup');
        else this.logger.info(`call failed with status ${err.status}`);
      }
      else this.logger.info({err}, 'Error connecting call');
    }
  }
}

module.exports = CallSession;

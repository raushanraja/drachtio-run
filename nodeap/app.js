const Srf = require('drachtio-srf');
const { parseUri, SipError } = require('drachtio-srf');
const registrationParser = require('drachtio-mw-registration-parser');
const digestAuth = require('drachtio-mw-digest-auth');
const config = require('config');
const Rtpengine = require('rtpengine-client').Client;
const rtpengine = new Rtpengine();
const locRtp = config.get('rtpengine');
const { isUacBehindNat, getSipProtocol, NAT_EXPIRES } = require('./utils');
const Emitter = require('events');
const srf = new Srf();
const Registrar = require('@jambonz/mw-registrar');


srf.locals.registrar = new Registrar({
	host: process.env.REDIS_HOST || 'vrmi.link',
	port: process.env.REDIS_PORT || 6379
});


// clean up and free rtpengine resources when either side hangs up
function endCall(dlg1, dlg2, details) {
	let deleted = false;
	[dlg1, dlg2].forEach((dlg) => {
		console.log('call ended');
		dlg.on('destroy', () => {
			(dlg === dlg1 ? dlg2 : dlg1).destroy();
			if (!deleted) {
				rtpengine.delete(locRtp, details);
				deleted = true;
			}
		});
	});
}

// function returning a Promise that resolves with the SDP to offer A leg in 18x/200 answer
function getSdpA(details, remoteSdp, res) {
	return rtpengine.answer(config.get('rtpengine'), Object.assign(details, {
		'sdp': remoteSdp,
		'to-tag': res.getParsedHeader('To').params.tag,
		'ICE': 'remove'
	}))
		.then((response) => {
			if (response.result !== 'ok') throw new Error(`Error calling answer: ${response['error-reason']}`);
			return response.sdp;
		});
}


const checkCache = async (req, res, next) => {
	console.log('inside checkCache')
	const registration = req.registration;
	if (registration.type === 'unregister') return next();
	const uri = parseUri(registration.aor);
	const aor = `${uri.user}@${uri.host}`;
	const registrar = req.srf.locals.registrar;
	const result = await registrar.query(aor);
	if (result) {
		/* if known valid registration coming from same address, no need to challenge */
		if (result.proxy === `sip:${req.source_address}:${req.source_port}`) {
			console.log(`responding to cached register for ${aor}`);
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
	realm: req => {
		const uri = parseUri(req.uri)
		return uri.host
	},
	passwordLookup: (username, realm, callback) => {
		return callback(null, 'password')
	}

})

async function unregister(req, res) {
	const registrar = req.srf.locals.registrar;
	const registration = req.registration;
	console.log(JSON.stringify(registration))
	const uri = parseUri(registration.aor);
	const aor = `${uri.user}@${uri.host}`;
	const result = await registrar.remove(aor);

	console.log({ result }, `successfully unregistered ${req.registration.aor}`);

	res.send(200, {
		headers: {
			'Contact': req.get('Contact'),
			'Expires': 0
		}
	});
}


async function registrationHandler(req, res) {
	console.log(`received ${req.method} from ${req.protocol}/${req.source_address}:${req.source_port}`)
	if (req.registration.type === 'register' && req.registration.expires !== 0) {
		const registrar = req.srf.locals.registrar;
		const registration = req.registration;
		const uri = parseUri(registration.aor);
		const aor = `${uri.user}@${uri.host}`;
		let expires = registration.expires;
		const grantedExpires = expires;
		let contactHdr = req.get('Contact');

		if (isUacBehindNat(req)) {
			expires = NAT_EXPIRES;
			contactHdr = contactHdr.replace(/expires=\d+/, `expires=${expires}`);
		}

		const opts = {
			contact: req.getParsedHeader('Contact')[0].uri,
			sbcAddress: req.server.hostport,
			protocol: getSipProtocol(req),
			proxy: `sip:${req.source_address}:${req.source_port}`
		};

		const result = await registrar.add(aor, opts, grantedExpires)
		console.log(`result ${result} from adding ${JSON.stringify(opts)}`);

		res.send(200, {
			headers: {
				'Contact': contactHdr,
				'Expires': expires
			}
		});
	}
	else {
		await unregister(res, res);
	}
}

srf.use((req, res, next) => { console.log(`incoming ${JSON.stringify(req.method)} from ${req.source_address}`); next(); })
srf.use('register', [registrationParser, checkCache, challenge])



srf.connect({
	host: 'vrmi.link',
	port: 9022,
	secret: 'cymru'
});

srf.on('connect', (err, hostport) => {
	console.log('Connected to server: ', hostport);
});



class CallSession extends Emitter {
	constructor(req, res) {
		super();
		this.req = req;
		this.res = res;
		this.srf = req.srf;
	}

	async connect() {
		const uri = parseUri(this.req.uri)
		console.log(`incoming call received ${uri}, ${this.req.body}`)
		console.log(`${uri} call accepted for routing`)

		try {
			srf.createB2BUA(req, res, 'sip:127@vrmi.link', { localSdpB: this.req.body })
				.then(({ uas, uac }) => {
					console.log('call successfully connected');
					// when one side hangs up, we hang up the other
					uas.on('destroy', () => uac.destroy());
					uac.on('destroy', () => uas.destroy());
				})
				.catch((err) => console.log(`call failed to connect: ${err}`));
			// const { uas, uac } = await this.srf.createB2BUA(this.req, this.response, uri);
			// console.log("Call Connected successfully");
			// console.log(JSON.stringify(uas))
			// console.log(JSON.stringify(uac))
			// [uas, uac].forEach(dialog => {
			// 	console.log('call ended');
			// 	dialog.other.destroy();
			// })

		} catch (err) {
			if (err instanceof SipError) {

				if (487 === err.status) {
					console.log("call hangup")
				}
				else {
					console.log("Call failed with statue", err.status)
				}
				console.log("Error connecting call:", err)
			}

		}

	}



}





	srf.invite((req, res) => {
		const uri = parseUri(req.uri);
		const dest = `sip:${uri.user}@${config.get('destination')}`;
		const from = req.getParsedHeader('From');
		const details = {
			'call-id': req.get('Call-Id'),
			'from-tag': from.params.tag
		};

		console.log(`got invite, sending to ${dest}, ${details}`);

		rtpengine.offer(locRtp, Object.assign(details, { 'sdp': req.body, 'record call': 'yes' }))
			.then((rtpResponse) => {
				console.log(`got response from rtpengine: ${JSON.stringify(rtpResponse)}`);
				if (rtpResponse && rtpResponse.result === 'ok') return rtpResponse.sdp;
				throw new Error('rtpengine failure');
			})
			.then((sdpB) => {
				console.log(`rtpengine offer returned sdp ${sdpB}`);
				return srf.createB2BUA(req, res, dest, {
					localSdpB: sdpB,
					localSdpA: getSdpA.bind(null, details)
				});
			})
			.then(({ uas, uac }) => {
				console.log('call connected with media proxy');
				return endCall(uas, uac, details);
			})
			.catch((err) => {
				console.error(`Error proxying call with media: ${err}: ${err.stack}`);
			});
	});


srf.register(registrationHandler)



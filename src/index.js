var http = require('http'),
	Rx = require('rx');

var server = http.createServer();
var observable = Rx.Observable.fromEvent(server, 'request', function(args) {
	return {request: args[0], response: args[1]};
})
observable = catchError(observable, observable
	.select(makeConfig)
	.select(requireMethod('POST'))
	.selectMany(readBody)
	.select(parseJson)
);
observable.subscribe(
	function(x) {
		x.response.end();
		console.info(x.config);
	},
	function(x) {
		x.response.statusCode = x.error.statusCode || 500;
		x.response.write(http.STATUS_CODES[ x.response.statusCode ])
		x.response.write(': ');
		x.response.write(x.error.name + ': ' + x.error.message);
		x.response.end();
		console.error(x.error, x.error.stack);
	},
	function() {
		console.log('Nothing to see here');
	}
);
server.listen(3000);

function makeConfig(x) {;
	x.config = {
		method: x.request.method,
		url: x.request.url,
		headers: x.request.headers,
	};
	return x;
};
function readBody(x) {
	return Rx.Observable.create(function(observer) {
		var data = '';
		x.request.setEncoding('utf8');
		x.request.on('data', function (chunk) {
			data += chunk;
		});
		x.request.on('end', function() {
			x.config.data = data;
			observer.onNext(x);
			observer.onCompleted();
		});
		x.request.on('error', function(err) {
			observer.onError(err);
		});
	});
};
function parseJson(x) {
	try {
		x.config.data = JSON.parse(x.config.data);
	} catch(e) {
		e.statusCode = 400;
		throw e;
	}
	return x;
};
function requireMethod(method) {
	return function(x) {
		if (x.config.method !== method) {
			var error = new Error(http.STATUS_CODES[405]);
			error.statusCode = 405;
			throw error;
		}
		return x;
	}
};
function catchError(obs1, obs2) {
	return Rx.Observable.zip(obs1, obs2.catch(function(err) {
		return Rx.Observable.return(err);
	}), function(x, y) {
		if (y instanceof Error) {
			x.error = y;
			throw x;
		}
		return y;
	});
};
// jsack: return [statusCode:Integer, body:Rx.Observable, headers:Object]
// jsack-application: return Rx.Observable.return({status: Integer, body: Rx.Observable, headers: Object});

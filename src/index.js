var http = require('http'),
	Rx = require('rx');

function makeRouter() {
	function router(request) {
		return route(request)(request);
	}
	var routes = [];
	var defaultRoute;
	router.when = function(fn, app) {
		routes.push({fn: fn, app: app});
		return this;
	};
	router.otherwise = function(app) {
		defaultRoute = app;
		return this;
	};
	function route(request) {
			console.warn(routes);
		for (var i=0, len=routes.length; i<len; ++i) {
			console.warn(routes[i]);
			if (routes[i].fn(request)) {
				return routes[i].app;
			}
		}
		return defaultRoute || default404;
	}
	function default404(request) {
		var bodyString = '404 Not Found';
		return Rx.Observable.return({
			status: 404,
			headers: {
				'Content-Type': 'text/plain',
				'Content-Length': Buffer.byteLength(bodyString),
			},
			body: Rx.Observable.return(bodyString)
		});
	}
	return router;
};

function app1(request) {
	return Rx.Observable.return({
		status: 200,
		headers: {
			'Content-Type': 'application/json',
		},
		body: Rx.Observable.return(['This', 'is', 'JSON', {a:1, b:2}, true]),
	});
}
var app2 = makeRouter()
	.when(function(request) {
		return /123/.test(request.url);
	}, app2a)
	.when(function(request) {
		return /987/.test(request.url);
	}, app2b)
;
function app2a(request) {
	var bodyString = 'This is 2a';
	return Rx.Observable.return({
		status: 200,
		headers: {
			'Content-Type': 'text/html',
			'Content-Length': Buffer.byteLength(bodyString),
		},
		body: Rx.Observable.return(bodyString),
	});	
};
function app2b(request) {
	var bodyString = 'This is 2b';
	return Rx.Observable.return({
		status: 200,
		headers: {
			'Content-Type': 'text/html',
			'Content-Length': Buffer.byteLength(bodyString),
		},
		body: Rx.Observable.return(bodyString),
	});	
};

var router = makeRouter()
.when(function(request) {
	return /abc/.test(request.url);
}, jsonify(app1))
.when(function(request) {
	return /xyz/.test(request.url);
}, basicAuth(app2))
;

Rx.Observable.return(router).subscribe(startApp);

function basicAuth(app) {
	return function(request) {
		var authorizationHeader = getAuthorizationHeader(request);
		if (authorizationHeader) {
			var credentials = parseCredentials(authorizationHeader);
			if (validCredentials(credentials)) {
				return app(request);
			}
		}
		var authorizationRequiredResponse = {
			status: 401,
			headers: {
				'Content-Type': 'text/plain',
				'WWW-Authenticate': 'Basic',
			},
			body: Rx.Observable.return('Authorization Required.')
		};
		return Rx.Observable.return(authorizationRequiredResponse);
	};
	function getAuthorizationHeader(request) {
		return request.headers['authorization'];
	};
	function parseCredentials(string) {
		var matches = string.match(/Basic (.*)/);
		if (matches) {
			var parts = base64decode(matches[1]).split(':');
			return {
				username: parts[0],
				password: parts[1]
			};
		}
		return;
	}
	function base64decode(string) {
		return new Buffer(string, 'base64').toString('utf-8');
	}
	function validCredentials(credentials) {
		return credentials && credentials.username === credentials.password;
	}
}
function jsonify(app) {
	return function(request) {
		return app(request).selectMany(jsonifyResponse);
	};
	function jsonifyResponse(response) {
		if (response.headers['Content-Type'] && response.headers['Content-Type'] === 'application/json') {
			return response.body.single().map(jsonifyObject);
		}
		else {
			return Rx.Observable.return(response);
		}
		function jsonifyObject(object) {
			var bodyString = JSON.stringify(object);
			response.body = Rx.Observable.return(bodyString);
			response.headers['Content-Length'] = bodyString.length;
			return response;
		}
	}
};
function startApp(app) {
	http.createServer(handleRequest).listen(3000);
	function handleRequest(nodeRequest, nodeResponse) {
		console.info('** handling request...');
		try {
			var jsackRequest = jsackRequestFromNodeRequest(nodeRequest);
			var responseObserver = makeResponseObserver(nodeResponse);
			app(jsackRequest).subscribe(responseObserver);
		} catch(error) {
			console.error('** request completed very abnormally', error.stack);
			var bodyString = 'Internal Server Error. Fire all the developers!';
			var jsackResponse = {
				status: 500,
				headers: {
					'Content-Type': 'text/plain',
					'Content-Length': Buffer.byteLength(bodyString),
				},
				body: Rx.Observable.return(bodyString)
			};
			sendResponse(jsackResponse, nodeResponse);
		}
	};
	function makeResponseObserver(nodeResponse) {
		return {
			onNext: function(jsackResponse) {
				sendResponse(jsackResponse, nodeResponse);
			},
			onError: function(error) {
				console.error('** request completed abnormally', error.stack);
				var bodyString = error.name + ': ' + error.message;
				var jsackResponse = {
					status: error.httpStatusCode || 500,
					headers: {
						'Content-Type': 'text/plain',
						'Content-Length': Buffer.byteLength(bodyString),
					},
					body: Rx.Observable.return(bodyString)
				};
				sendResponse(jsackResponse, nodeResponse);
			},
			onCompleted: function() {
				console.info('** request completed normally');
			}
		};
	}
};
function jsackRequestFromNodeRequest(nodeRequest) {
	return nodeRequest;
};
function sendResponse(jsackResponse, nodeResponse) {
	nodeResponse.writeHeader(jsackResponse.status, jsackResponse.headers);
	jsackResponse.body.subscribe(
		function(chunk) {
			nodeResponse.write(chunk);
		},
		function(error) {
			console.error('** sending response completed abnormally', error.stack);
			nodeResponse.setTimeout(1);
		},
		function() {
			nodeResponse.end();
		}
	);
};

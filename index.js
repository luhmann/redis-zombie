const redis = require('redis');
var _ = require('lodash');
const Zombie = require('zombie');
const assert = require('assert');
const Q = require('q');
const logger = require('./logger');

var templates = {
    url: _.template('<%= host %><%= path %>'),
    jsonUrl: _.template('<%= host%><%= path %>?_format=json')
};

var options = {
    redisHost: '127.0.0.1',
    keyNamespaces: [
        {
            keyPrefix: 'content:v1:de:de:live:',
            templateFunction: templates.url
        },
        //{
        //    keyPrefix: 'buzz:v1:de:de:live:',
        //    templateFunction: templates.jsonUrl
        //},
        {
            keyPrefix: 'content:v1:de:de:live:/_partial',
            templateFunction: templates.jsonUrl
        }
    ],
    host: 'http://www.myvideo.de',
    partialRoutePrefix: '_partial'
};

var selectors = {
    layoutContainer: '.layout--container'
};


/**
 *
 * @param route
 * @returns {boolean}
 */
var shouldResponseBeJson = function (route) {
    return (route.indexOf('_partial=json') !== -1);
};

/**
 *
 * @param redisClient
 * @param namespace
 * @param urlTemplate
 * @returns {Array}
 */
var getRoutesFromRedis = function (redisClient, namespace, urlTemplate) {
    var deferred = Q.defer();
    redisClient.keys(namespace + '*', function (err, replies) {
        if (null !== err) {
            deferred.reject(err);
        }

        var routes = [];
        replies.forEach(function (key) {
            var path = key.replace(namespace, '');
            routes.push(urlTemplate({host: options.host, path: path}));
        });

        deferred.resolve(routes);
    });

    return deferred.promise;
};

/**
 *
 * @returns {promise|*|Q.promise}
 */
var getAllUrlsFromRedis = function () {
    var redisClient = redis.createClient(6379, options.redisHost, {});
    redisClient.on("error", function (err) {
        logger.error("Error " + err);
    });

    var testSuites = [];
    var deferred = Q.defer();
    options.keyNamespaces.forEach(function (namespace) {
        getRoutesFromRedis(redisClient, namespace.keyPrefix, namespace.templateFunction)
            .then(
            function (routes) {
                testSuites.push(routes);

                if (testSuites.length === options.keyNamespaces.length) {
                    deferred.resolve(testSuites);
                    redisClient.quit();
                }
            },
            function (err) {
                console.log(err)
            }
        );
    });

    return deferred.promise;
};

/**
 *
 * @param browser
 * @param route
 * @returns {promise|*|Q.promise}
 */
var testRoute = function (browser, route) {
    var deferred = Q.defer();
    logger.info('Trying route:', route);
    browser.visit(route)
        .then(function () {
            if (browser.assert.status(200) === false) {
                logger.error(route + ' did not give HTTP 200', { httpCode: browser.resources[0].response.statusCode } );
            } else {
                logger.info(route + ' did return HTTP 200', { httpCode: browser.resources[0].response.statusCode } );
            }

            if (true === shouldResponseBeJson(route)) {
                // jsonTests(browser);
            } else {
                if (browser.resources[0].response.headers['content-type'].indexOf('html') === false) {
                    logger.error(route, 'does not seem to return content-type html');
                }

                if(route.indexOf(options.partial) !== -1) {
                    try {
                        browser.assert.element(selectors.layoutContainer);
                    } catch (e) {
                        logger.error(route, 'does not seem to contain a layoutContainer');
                    }
                }
            }
        })
        .then(function () {
            deferred.resolve();
        });

    return deferred.promise;
};

/**
 *
 * @param browser
 * @param urls
 * @param pointer
 */
runUrlTest = function (browser, urls, pointer) {
    testRoute(browser, urls[pointer])
        .then(function () {
            if (pointer < urls.length - 1) {
                runUrlTest(browser, urls, ++pointer);
            } else {
                console.log('All done!');
            }
        });
};

/**
 *
 * @param suites
 */
var runTestSuites = function (suites) {
    Zombie.localhost('myvideo.de', 3000);

    var browser = new Zombie({
        runScripts: false,
        maxWait: 10
    });

    runUrlTest(browser, _.flatten(suites), 0);
};


getAllUrlsFromRedis().then(function (testSuites) {
    runTestSuites(testSuites);
});

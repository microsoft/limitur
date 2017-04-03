const Limiter = require('./');
const redis = require('redis').createClient();

const tcases = [
    {
        name: 'WatchBeam/limitur',
        setup: limit => {
            return new (require('./').Limiter)(redis).rule('foo', {
                limit,
                interval: 60000,
            });
        },
        run: (x, callback) => x.limitBy('foo', callback),
    },
    {
        name: 'tabdigital/redis-rate-limiter',
        setup: limit => {
            return require('redis-rate-limiter').create({
                redis,
                key: () => 'foo',
                rate: `${limit}/minute`,
            });
        },
        run: (x, callback) => x(null, callback),
    },
    {
        name: 'tj/ratelimiter',
        setup: limit => {
            return new (require('ratelimiter'))({
                db: redis,
                max: limit,
                duration: 60000,
                id: 'ratelimiter'
            });
        },
        run: (x, callback) => x.get(callback),
    },
];

set('mintime', 3000);
set('delay', 250);

before(ready => redis.on('connect', ready));

tcases.forEach(tcase => {
    const under = tcase.setup(10000000);
    bench(`under limit: ${tcase.name}`, done => tcase.run(under, done));
    const over = tcase.setup(1);
    bench(`over limit: ${tcase.name}`, done => tcase.run(over, done));
});

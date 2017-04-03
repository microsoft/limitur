# Limitur

[![Build Status](https://travis-ci.org/WatchBeam/limitur.svg)](https://travis-ci.org/WatchBeam/limitur) [![Coverage Status](https://coveralls.io/repos/WatchBeam/limitur/badge.svg?branch=master)](https://coveralls.io/r/WatchBeam/limitur?branch=master)

Limitur is a (very) fast solution to rate limiting your application in under 100 lines of code. It is tailored for use in Redis; for a generic implementation, see [limitus](https://github.com/WatchBeam/limitus). It's written in TypeScript and is type-safe.

### Quickstart

Limitur has a central "store" that contains "rules", which are buckets that can limit specific keyed values. For example, you might use this to rate limit a "login" endpoint in Express for a certain username:

```js
const Limitur = require('limitur');
const redis = require('redis');
const limiter = new Limitur(redis.createClient());

limiter.rule('login', {
    limit: 10,
    interval: 15 * 60 * 1000,
});

app.post('/login', (req, res) => {
    limiter.limit('login', req.body.username).then(result => {
        res.set('X-RateLimit-Limit', result.limit);
        res.set('X-RateLimit-Remaining', result.remaining - 1);
        res.set('X-RateLimit-Reset', result.resetsAt);

        if (result.isLimited) {
            res.send(429, 'Too many requests!');
        } else {
            doLogin(req, res);
        }
    });
});
```

#### Benchmarks

Limitur is the fastest Redis rate limiting solution for Node that I'm aware of. You can run benchmarks using `npm run bench`. These below results were run on a Windows 10 machine using Redis 3.2 and Node 6.

```
{ limitur }  » matcha benchmark.js

          20,243 op/s » under limit: WatchBeam/limitur
          20,987 op/s » over limit: WatchBeam/limitur

          15,307 op/s » under limit: tabdigital/redis-rate-limiter
          15,955 op/s » over limit: tabdigital/redis-rate-limiter

          14,494 op/s » under limit: tj/ratelimiter
          14,576 op/s » over limit: tj/ratelimiter

          13,475 op/s » under limit: WatchBeam/limitus
          13,627 op/s » over limit: WatchBeam/limitus

  Suites:  0
  Benches: 6
  Elapsed: 29,479.43 ms
```

import { readFileSync } from 'fs';

const script = readFileSync(`${__dirname}/incrpx.lua`, 'utf8');
const murmur = require('imurmurhash');

/**
 * IRedisClient is a partial interface for a Redis client. Both ioredis and
 * node_redis are assignable to IRedisClient.
 */
export interface IRedisClient {
    eval(args: any[], callback: (err: any, data: any) => void): any;
}

/**
 * ClientProvider gets passed into the Limiter. It should be a Redis client,
 * or a function that's called every time we want to rate limit and calls
 * back with a Redis client.
 */
export type ClientProvider = IRedisClient | ((callback: (err: Error, client: IRedisClient) => void) => void);

/**
 * IRuleOptions are passed in when we want to define a rule.
 */
export interface IRuleOptions<T> {
    // max number of requests to accept...
    limit: number;
    // in this interval (in milliseconds)
    interval: number;
    // hash function to use for getting IDs of the "key" passed in. Defaults
    // to doing a murmur hash on the JSON value (or using the value itself)
    // if it's small enough.
    hasher?: (value: T) => string;
}

/**
 * ILimitResult is resolved from the Limiter.limit function.
 */
export interface ILimitResult {
    // limit is the total request limit in the rule.
    limit: number;
    // the remaining requests that can be made.
    remaining: number;
    // the date that the bucket expires, usually provided in an
    // X-RateLimit-Reset header.
    resetsAt: Date;
    // Set to true rue if the user has exceeded their rate limit
    isLimited: boolean;
}

export type LimitCallback = (err: Error | null, result?: ILimitResult) => void;

/**
 * Simple, default hashing function when one is not otherwise provided.
 */
function hasher(value: any): string {
    if (typeof value === 'object') {
        value = JSON.stringify(value);
    } else {
        value = String(value);
    }

    if (value.length > 16) {
        value = String(murmur(value).result());
    }

    return value;
}

/**
 * Limiter is the rate limiter parent client. You can define rules on it.
 */
export class Limiter {

    private rules: { [name: string]: Rule<any> } = Object.create(null);

    constructor(
        public readonly client: ClientProvider,
        public readonly namespace: string = 'limitur',
    ) {}

    /**
     * Defines a new role on the class.
     */
    rule<T>(name: string, options: IRuleOptions<T>): Rule<T> {
        return this.rules[name] = new Rule(name, this, options);
    }

    /**
     * Runs a limit with the give rule.
     * Throws if the rule is not previously defined.
     */
    limit(name: string, value: any, callback: LimitCallback): void;
    limit(name: string, value: any): Promise<ILimitResult>;
    limit(name: string, value: any, callback?: LimitCallback): void | Promise<ILimitResult> {
        const rule = this.rules[name];
        if (!rule) {
            throw new Error(`Attempted to limit on non-existant rule "${name}"`);
        }

        if (callback) {
            return rule.limitBy(value, callback);
        }

        return new Promise((resolve, reject) => {
            rule.limitBy(value, (err, result) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(result);
                }
            });
        });
    }
}

/**
 * Rule is a "bucket" that can be limited upon.
 */
export class Rule<T> {

    public readonly interval: number;
    public readonly limit: number;
    private readonly hasher: (value: T) => string;

    constructor(
        private name: string,
        private limiter: Limiter,
        options: IRuleOptions<T>,
    ) {
        this.interval = options.interval;
        this.limit = options.limit;
        this.hasher = options.hasher || hasher;
    }

    /**
     * limitBy applies a limit to the provided value.
     */
    public limitBy(value: T, callback: LimitCallback) {
        if (typeof this.limiter.client !== 'function') {
            return this.limitWithClient(value, this.limiter.client, callback);
        }

        this.limiter.client((err, client) => {
            if (err) {
                callback(err);
            } else {
                this.limitWithClient(value, client, callback);
            }
        });
    }

    /**
     * Returns the Redis key where the counter for the value will be stored.
     */
    public getKeyFor(value: T): string {
        return `${this.limiter.namespace}:${this.name}:${this.hasher(value)}`;
    }

    private limitWithClient(value: T, client: IRedisClient, callback: LimitCallback) {
        const { limit, interval } = this;

        client.eval([script, 1, this.getKeyFor(value), interval], (err, result) => {
            if (err) {
                return callback(err);
            }

            const [count, ttl] = <string[]> result;
            callback(null, {
                limit,
                resetsAt: new Date(Date.now() + Number(ttl)),
                remaining: Math.max(0, limit - Number(count)),
                isLimited: Number(count) > limit,
            });
        });
    }
}

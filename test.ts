import * as IORedis from 'ioredis';
import * as NRedis from 'redis';
import * as sinon from 'sinon';
import { expect } from 'chai';

import * as Limitur from './';

const baseClient = new IORedis();
const clients: { [name: string]: Limitur.IRedisClient } = {
    'luin/ioredis': baseClient,
    'NodeRedis/node_redis': NRedis.createClient(),
};

describe('base behavior', () => {
    let mockClient: { eval: sinon.SinonStub };
    let limitur: Limitur.Limiter;
    let stringRule: Limitur.Rule<string>;
    let anyRule: Limitur.Rule<any>;
    let clock: sinon.SinonFakeTimers;

    beforeEach(() => {
        mockClient = { eval: sinon.stub() };
        limitur = new Limitur.Limiter(mockClient);
        stringRule = limitur.rule<string>('foo', {
            interval: 30000,
            limit: 2,
        });
        anyRule = limitur.rule<string>('bar', {
            interval: 10000,
            limit: 1,
        });
        clock = sinon.useFakeTimers();
    });

    afterEach(() => clock.restore());

    it('operates in callback mode', done => {
        mockClient.eval.yields(null, [1, 1234]);
        limitur.limit('foo', 42, (_err, res) => {
            expect(res).to.deep.equal({
                limit: 2,
                remaining: 1,
                resetsAt: new Date(Date.now() + 1234),
                isLimited: false,
            });
            done();
        });
    });

    it('operates in promise mode', () => {
        mockClient.eval.yields(null, [1, 1234]);
        return limitur.limit('foo', 42).then(res => {
            expect(res).to.deep.equal({
                limit: 2,
                remaining: 1,
                resetsAt: new Date(Date.now() + 1234),
                isLimited: false,
            });
        });
    });

    it('bubbles errors', () => {
        const expectedErr = new Error('oh no!');
        mockClient.eval.yields(expectedErr);
        return limitur.limit('foo', 42)
            .then(() => { throw new Error('expected to throw') })
            .catch(err => expect(err).to.equal(expectedErr));
    });

    it('throws on rules that don\'t exist', () => {
        expect(() => limitur.limit('wat', 42)).to.throw(/non-existant rule/);
    });

    it('generates short keys correctly', () => {
        expect(stringRule.getKeyFor('asdf')).to.equal('limitur:foo:asdf');
    });

    it('murmur hashes longer keys, objects', () => {
        expect(stringRule.getKeyFor('lorem ipsum dolor sit amset consectur'))
            .to.equal('limitur:foo:3966672936');
    });

    it('stringifies objects as keys', () => {
        expect(anyRule.getKeyFor({ 1: '2' }))
            .to.equal('limitur:bar:{"1":"2"}');
    });

    it('murmurs large objects', () => {
        expect(anyRule.getKeyFor({ hello: 'lorem ipsum dolor' }))
            .to.equal('limitur:bar:3139731057');
    });
})

Object.keys(clients).forEach(name => {
    const client = clients[name];

    describe(`works with client: ${name}`, () => {
        let limitur: Limitur.Limiter;
        let rule: Limitur.Rule<number>;

        before(() => {
            limitur = new Limitur.Limiter(client);
            rule = limitur.rule<number>('foo', {
                interval: 30000,
                limit: 2,
            });
        });

        afterEach(() => baseClient.flushall());

        const runTimes = (n: number, results: Limitur.ILimitResult[] = []): Promise<Limitur.ILimitResult[]> => {
            if (n === 0) {
                return Promise.resolve(results);
            }

            return limitur.limit('foo', 42)
                .then(res => runTimes(n - 1, results.concat(res)));
        }

        it('allows initially', () => {
            return runTimes(1).then(([res]) => {
                expect(res).to.deep.equal({
                    limit: 2,
                    remaining: 1,
                    resetsAt: res.resetsAt,
                    isLimited: false,
                });
            });
        });

        it('decrements', () => {
            return runTimes(2).then(([, res]) => {
                expect(res).to.deep.equal({
                    limit: 2,
                    remaining: 0,
                    resetsAt: res.resetsAt,
                    isLimited: false,
                });
            });
        });

        it('blocks after expiring', () => {
            return runTimes(3).then(([,, res]) => {
                expect(res).to.deep.equal({
                    limit: 2,
                    remaining: 0,
                    resetsAt: res.resetsAt,
                    isLimited: true,
                });
            });
        });

        it('sets ttls correctly', () => {
            const reset = Date.now() + rule.interval;
            const wiggleRoom = 5000;
            return runTimes(1).then(([res]) => {
                expect(res.resetsAt.getTime()).to.be.within(reset - wiggleRoom, reset);
                return (<any> baseClient).pttl(rule.getKeyFor(42));
            }).then(ttl => {
                expect(ttl).to.be.within(rule.interval - wiggleRoom, rule.interval);
            });
        });
    });
});

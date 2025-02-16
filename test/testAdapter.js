/* jshint -W097 */
/* jshint strict: false */
/* jslint node: true */
/* jshint expr: true */
const expect = require('chai').expect;
const setup  = require('./lib/setup');

let objects = null;
let states  = null;
let onStateChanged = null;
let sendToID = 1;

const adapterShortName = setup.adapterName.substring(setup.adapterName.indexOf('.') + 1);

let now;

function checkConnectionOfAdapter(cb, counter) {
    counter = counter || 0;
    console.log('Try check #' + counter);
    if (counter > 30) {
        cb && cb('Cannot check connection');
        return;
    }

    console.log('Checking alive key for key : ' + adapterShortName);
    states.getState(`system.adapter.${adapterShortName}.0.alive`, (err, state) => {
        err && console.error(err);
        if (state && state.val) {
            cb && cb();
        } else {
            setTimeout(() =>
                checkConnectionOfAdapter(cb, counter + 1)
            , 1000);
        }
    });
}

function checkValueOfState(id, value, cb, counter) {
    counter = counter || 0;
    if (counter > 20) {
        cb && cb('Cannot check value Of State ' + id);
        return;
    }

    states.getState(id, (err, state) => {
        err && console.error(err);
        if (value === null && !state) {
            cb && cb();
        } else
        if (state && (value === undefined || state.val === value)) {
            cb && cb();
        } else {
            setTimeout(() =>
                checkValueOfState(id, value, cb, counter + 1)
            , 500);
        }
    });
}

function sendTo(target, command, message, callback) {
    onStateChanged = function (id, state) {
        if (id === 'messagebox.system.adapter.test.0') {
            callback(state.message);
        }
    };

    states.pushMessage('system.adapter.' + target, {
        command:    command,
        message:    message,
        from:       'system.adapter.test.0',
        callback: {
            message: message,
            id:      sendToID++,
            ack:     false,
            time:    Date.now()
        }
    });
}

describe(`Test ${adapterShortName} adapter`, function () {
    before(`Test ${adapterShortName} adapter: Start js-controller`, function (_done) {
        this.timeout(600000); // because of first install from npm

        setup.setupController(async () => {
            const config = await setup.getAdapterConfig();
            // enable adapter
            config.common.enabled  = true;
            config.common.loglevel = 'debug';

            if (process.env.INFLUXDB2) {
                const authToken = JSON.parse(process.env.AUTHTOKEN).token;
                console.log('AUTHTOKEN=' + process.env.AUTHTOKEN);
                console.log('extracted token =' + authToken);
                config.native.dbversion = '2.x';

                let secret = await setup.getSecret();
                if (secret === null) {
                    secret = 'Zgfr56gFe87jJOM';
                }

                console.log(`############SECRET: ${secret}`);
                config.native.token = setup.encrypt(secret, 'test-token'); //authToken;
                config.native.organization = 'test-org';
            } else if (process.env.INFLUX_DB1_HOST) {
                config.native.host = process.env.INFLUX_DB1_HOST;
            }

            await setup.setAdapterConfig(config.common, config.native);

            setup.startController(
                true,
                (id, obj) => {},
                (id, state) => onStateChanged && onStateChanged(id, state),
                (_objects, _states) => {
                    objects = _objects;
                    states  = _states;
                    objects.extendObject('influxdb.0.memRss', {
                        common: {
                            type: 'number',
                            role: 'state',
                            custom: {
                                'influxdb.0': {
                                    enabled: true,
                                    changesOnly:  true,
                                    debounce:     0,
                                    retention:    31536000,
                                    maxLength:    3,
                                    changesMinDelta: 0.5
                                }
                            }
                        },
                        type: 'state'
                    }, _done);
                });
        });
    });

    it(`Test ${adapterShortName} adapter: Check if adapter started`, function (done) {
        this.timeout(60000);

        checkConnectionOfAdapter(res => {
            res && console.log(res);
            expect(res).not.to.be.equal('Cannot check connection');
            objects.setObject('system.adapter.test.0', {common: {}, type: 'instance'},
            () => {
                states.subscribeMessage('system.adapter.test.0');

                sendTo('influxdb.0', 'enableHistory', {
                    id: 'system.adapter.influxdb.0.memHeapTotal',
                    options: {
                        changesOnly:  true,
                        debounce:     0,
                        retention:    31536000,
                        storageType: 'String'
                    }
                }, result => {
                    expect(result.error).to.be.undefined;
                    expect(result.success).to.be.true;

                    sendTo('influxdb.0', 'enableHistory', {
                        id: 'system.adapter.influxdb.0.uptime',
                        options: {
                            changesOnly:  false,
                            debounce:     0,
                            retention:    31536000,
                            storageType: 'Boolean'
                        }
                    }, result => {
                        expect(result.error).to.be.undefined;
                        expect(result.success).to.be.true;

                        sendTo('influxdb.0', 'enableHistory', {
                            id: 'system.adapter.influxdb.0.memHeapUsed',
                            options: {
                                changesOnly:  false,
                                debounce:     0,
                                retention:    31536000,
                            }
                        }, result => {
                            expect(result.error).to.be.undefined;
                            expect(result.success).to.be.true;

                            objects.setObject('influxdb.0.testValue2', {
                                common: {
                                    type: 'number',
                                    role: 'state'
                                },
                                type: 'state'
                            },
                            () => {
                                sendTo('influxdb.0', 'enableHistory', {
                                    id: 'influxdb.0.testValue2',
                                    options: {
                                        changesOnly:  true,
                                        debounce:     0,
                                        retention:    31536000,
                                        maxLength:    3,
                                        changesMinDelta: 0.5,
                                        aliasId: 'influxdb.0.testValue2-alias'
                                    }
                                }, result => {
                                    expect(result.error).to.be.undefined;
                                    expect(result.success).to.be.true;

                                    // wait till adapter receives the new settings
                                    setTimeout(() =>
                                        done(), 2000);
                                });
                            });
                        });
                    });
                });
            });
        });
    });

    it(`Test ${adapterShortName}: Write string value for memHeapUsed into DB to force a type conflict`, function (done) {
        this.timeout(5000);
        now = Date.now();

        states.setState('system.adapter.influxdb.0.memHeapUsed', {val: 'Blubb', ts: now - 20000, from: 'test.0'}, err => {
            err && console.log(err);
            done();
        });
    });

    it(`Test ${adapterShortName}: Check Enabled Points after Enable`, function (done) {
        this.timeout(5000);

        sendTo('influxdb.0', 'getEnabledDPs', {}, result => {
            console.log(JSON.stringify(result));
            expect(Object.keys(result).length).to.be.equal(5);
            expect(result['influxdb.0.memRss'].enabled).to.be.true;
            done();
        });
    });

    it(`Test ${adapterShortName}: Write values into DB`, function (done) {
        this.timeout(45000);
        now = Date.now();

        states.setState('influxdb.0.memRss', {val: 2, ts: now - 20000, from: 'test.0'}, err => {
            err && console.log(err);

            setTimeout(() => {
                states.setState('influxdb.0.memRss', {val: true, ts: now - 10000, from: 'test.0'}, err => {
                    err && console.log(err);

                    setTimeout(() => {
                        states.setState('influxdb.0.memRss', {val: 2, ts: now - 5000, from: 'test.0'}, err => {
                            err && console.log(err);

                            setTimeout(() => {
                                states.setState('influxdb.0.memRss', {val: 2.2, ts: now - 4000, from: 'test.0'}, err => {
                                    err && console.log(err);

                                    setTimeout(() => {
                                        states.setState('influxdb.0.memRss', {val: 2.3, ts: now - 3500, from: 'test.0'}, err => {
                                            err && console.log(err);

                                            setTimeout(() => {
                                                states.setState('influxdb.0.memRss', {val: '2.5', ts: now - 3000, from: 'test.0'}, err => {
                                                    err && console.log(err);

                                                    setTimeout(() => {
                                                        states.setState('influxdb.0.memRss', {val: 3, ts: now - 1000, from: 'test.0'}, err => {
                                                            err && console.log(err);

                                                            setTimeout(() => {
                                                                states.setState('influxdb.0.memRss', {val: 'Test', ts: now - 500, from: 'test.0'}, err => {
                                                                    err && console.log(err);

                                                                    setTimeout(() => {
                                                                        states.setState('influxdb.0.testValue2', {val: 1, ts: now - 2000, from: 'test.0'}, err => {
                                                                            err && console.log(err);

                                                                            setTimeout(() => {
                                                                                states.setState('influxdb.0.testValue2', {val: 3, ts: now - 1000, from: 'test.0'}, err => {
                                                                                    err && console.log(err);

                                                                                    setTimeout(done, 20000);
                                                                                });
                                                                            }, 100);
                                                                        });
                                                                    }, 100);
                                                                });
                                                            }, 100);
                                                        });
                                                    }, 100);
                                                });
                                            }, 100);
                                        });
                                    }, 100);
                                });
                            }, 100);
                        });
                    }, 100);
                });
            }, 100);
        });
    });

    it(`Test ${adapterShortName}: Read values from DB using query`, function (done) {
        this.timeout(10000);

        let query = 'SELECT * FROM "influxdb.0.memRss"';
        if (process.env.INFLUXDB2) {
            query = 'from(bucket: "iobroker") |> range(start:-1h) |> filter(fn: (r) => r._measurement == "influxdb.0.memRss") |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")';
        }
        sendTo('influxdb.0', 'query', query, result => {
            console.log(JSON.stringify(result.result, null, 2));
            expect(result.result[0].length).to.be.at.least(5);
            let found = 0;
            for (let i = 0; i < result.result[0].length; i++) {
                if (result.result[0][i].value >= 1 && result.result[0][i].value <= 3) {
                    found ++;
                }
            }
            expect(found).to.be.equal(7);

            done();
        });
    });

    it(`Test ${adapterShortName}: Read values from DB using GetHistory`, function (done) {
        this.timeout(10000);

        sendTo('influxdb.0', 'getHistory', {
            id: 'influxdb.0.memRss',
            options: {
                start:     now - 30000,
                count:     50,
                aggregate: 'none'
            }
        }, result => {
            console.log(JSON.stringify(result.result, null, 2));
            expect(result.result.length).to.be.at.least(5);
            let found = 0;
            let found22 = false;
            let found23 = false;
            for (let i = 0; i < result.result.length; i++) {
                if (result.result[i].val >= 1 && result.result[i].val <= 3) {
                    found ++;
                }
                if (result.result[i].val === 2.2) {
                    found22 = true;
                }
                if (result.result[i].val === 2.3) {
                    found23 = true;
                }
            }
            expect(found).to.be.equal(7);
            expect(found22).to.be.false;
            expect(found23).to.be.true;

            sendTo('influxdb.0', 'getHistory', {
                id: 'influxdb.0.memRss',
                options: {
                    start:     now - 15000,
                    count:     2,
                    aggregate: 'none'
                }
            }, result => {
                console.log(JSON.stringify(result.result, null, 2));
                expect(result.result.length).to.be.equal(2);
                expect(result.result[0].id).to.be.undefined;

                const latestTs = result.result[result.result.length - 1].ts;

                sendTo('influxdb.0', 'getHistory', {
                    id: 'influxdb.0.memRss',
                    options: {
                        start:     now - 15000,
                        count:     2,
                        aggregate: 'none',
                        addId: true,
                        returnNewestEntries: true
                    }
                }, result => {
                    console.log(JSON.stringify(result.result, null, 2));
                    expect(result.result.length).to.be.equal(2);
                    expect(result.result[0].ts > latestTs).to.be.true;
                    expect(result.result[0].id).to.be.equal('influxdb.0.memRss');
                    done();
                });
            });
        });
    });

    it(`Test ${adapterShortName}: Read average values from DB using GetHistory`, function (done) {
        this.timeout(10000);

        sendTo('influxdb.0', 'getHistory', {
            id: 'influxdb.0.memRss',
            options: {
                start:     now - 30000,
                end:       now,
                count:     4,
                aggregate: 'average',
                addId: true
            }
        }, result => {
            console.log(JSON.stringify(result.result, null, 2));
            expect(result.result.length).to.be.at.least(6);
            expect(result.result[0].id).to.be.equal('influxdb.0.memRss');
            done();
        });
    });

    it(`Test ${adapterShortName}: Read minmax values from DB using GetHistory`, function (done) {
        this.timeout(10000);

        sendTo('influxdb.0', 'getHistory', {
            id: 'influxdb.0.memRss',
            options: {
                start:     now - 30000,
                end:       now + 30000,
                count:     4,
                aggregate: 'minmax',
                addId: true
            }
        }, result => {
            console.log(JSON.stringify(result.result, null, 2));
            expect(result.result.length).to.be.at.least(6);
            expect(result.result[0].id).to.be.equal('influxdb.0.memRss');
            done();
        });
    });

    it(`Test ${adapterShortName}: Check Datapoint Types`, function (done) {
        this.timeout(65000);

        if (process.env.INFLUXDB2) {
            // TODO: FIndFlux equivalent!
            return done();
        }

        setTimeout(function() {
            let query = 'SHOW FIELD KEYS FROM "influxdb.0.memRss"';
            sendTo('influxdb.0', 'query', query, result => {
                console.log('result: ' + JSON.stringify(result.result, null, 2));
                let found = false;
                for (let i = 0; i < result.result[0].length; i++) {
                    if (result.result[0][i].fieldKey === 'value') {
                        found = true;
                        expect(result.result[0][i].fieldType).to.be.equal('float');
                        break;
                    }
                }
                expect(found).to.be.true;

                sendTo('influxdb.0', 'query', 'SHOW FIELD KEYS FROM "system.adapter.influxdb.0.memHeapTotal"', result2 => {
                    console.log('result2: ' + JSON.stringify(result2.result, null, 2));
                    let found = false;
                    for (let i = 0; i < result2.result[0].length; i++) {
                        if (result2.result[0][i].fieldKey === 'value') {
                            found = true;
                            expect(result2.result[0][i].fieldType).to.be.equal('string');
                            break;
                        }
                    }
                    expect(found).to.be.true;

                    sendTo('influxdb.0', 'query', 'SHOW FIELD KEYS FROM "system.adapter.influxdb.0.uptime"', result3 => {
                        console.log('result3: ' + JSON.stringify(result3.result, null, 2));
                        let found = false;
                        for (let i = 0; i < result3.result[0].length; i++) {
                            if (result3.result[0][i].fieldKey === 'value') {
                                found = true;
                                expect(result3.result[0][i].fieldType).to.be.equal('boolean');
                                break;
                            }
                        }
                        expect(found).to.be.true;

                        setTimeout(() =>
                            done(), 3000);
                    });
                });
            });
        }, 60000);
    });

    it(`Test ${adapterShortName}: Read values from DB using GetHistory for aliased testValue2`, function (done) {
        this.timeout(25000);

        sendTo('influxdb.0', 'getHistory', {
            id: 'influxdb.0.testValue2',
            options: {
                start:     now - 5000,
                end:       now,
                count:     50,
                aggregate: 'none'
            }
        }, result => {
            console.log(JSON.stringify(result.result, null, 2));
            expect(result.result.length).to.be.equal(2);

            sendTo('influxdb.0', 'getHistory', {
                id: 'influxdb.0.testValue2-alias',
                options: {
                    start:     now - 5000,
                    end:       now,
                    count:     50,
                    aggregate: 'none'
                }
            }, result2 => {
                console.log(JSON.stringify(result2.result, null, 2));
                expect(result2.result.length).to.be.equal(2);
                for (let i = 0; i < result2.result.length; i++) {
                    expect(result2.result[i].val).to.be.equal(result.result[i].val);
                }

                done();
            });
        });
    });

    it(`Test ${adapterShortName}: Remove Alias-ID`, function (done) {
        this.timeout(5000);

        sendTo('influxdb.0', 'enableHistory', {
            id: 'influxdb.0.testValue2',
            options: {
                aliasId: ''
            }
        }, result => {
            expect(result.error).to.be.undefined;
            expect(result.success).to.be.true;
            // wait till adapter receives the new settings
            setTimeout(() =>
                done(), 2000);
        });
    });

    it(`Test ${adapterShortName}: Add Alias-ID again`, function (done) {
        this.timeout(5000);

        sendTo('influxdb.0', 'enableHistory', {
            id: 'influxdb.0.testValue2',
            options: {
                aliasId: 'this.is.a.test-value'
            }
        }, result => {
            expect(result.error).to.be.undefined;
            expect(result.success).to.be.true;
            // wait till adapter receives the new settings
            setTimeout(() =>
                done(), 2000);
        });
    });

    it(`Test ${adapterShortName}: Change Alias-ID`, function (done) {
        this.timeout(5000);

        sendTo('influxdb.0', 'enableHistory', {
            id: 'influxdb.0.testValue2',
            options: {
                aliasId: 'this.is.another.test-value'
            }
        }, result => {
            expect(result.error).to.be.undefined;
            expect(result.success).to.be.true;
            // wait till adapter receives the new settings
            setTimeout(() =>
                done(), 2000);
        });
    });

    it(`Test ${adapterShortName}: Disable Datapoint again`, function (done) {
        this.timeout(5000);

        sendTo('influxdb.0', 'disableHistory', {
            id: 'influxdb.0.memRss',
        }, result => {
            expect(result.error).to.be.undefined;
            expect(result.success).to.be.true;
            done();
        });
    });

    it(`Test ${adapterShortName}: Check Enabled Points after Disable`, function (done) {
        this.timeout(5000);

        sendTo('influxdb.0', 'getEnabledDPs', {}, result => {
            console.log(JSON.stringify(result));
            expect(Object.keys(result).length).to.be.equal(4);
            done();
        });
    });

    it(`Test ${adapterShortName}: Check that storageType is set now for memHeapUsed`, function (done) {
        this.timeout(5000);

        objects.getObject('system.adapter.influxdb.0.memHeapUsed', (err, obj) => {
            expect(obj.common.custom['influxdb.0'].storageType).to.be.equal('String');
            expect(err).to.be.null;
            done();
        });
    });

    after(`Test ${adapterShortName} adapter: Stop js-controller`, function (done) {
        this.timeout(12000);

        setup.stopController(normalTerminated => {
            console.log('Adapter normal terminated: ' + normalTerminated);
            setTimeout(done, 2000);
        });
    });
});

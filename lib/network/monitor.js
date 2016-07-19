'use strict';

var Network = require('./index');
var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var assert = require('assert');
var merge = require('merge');
var async = require('async');
var request = require('request');

/**
 * Wraps a {@link Network} instance and provides events for gathering
 * statistics about node operation
 * @constructor
 * @param {Network} network - The network interface to monitor
 * @param {Object} options
 */
function Monitor(network, options) {
  if (!(this instanceof Monitor)) {
    return new Monitor(network, options);
  }

  assert(network instanceof Network, 'Invalid network instance supplied');

  this._source = network;
  this._options = merge(Object.create(Monitor.DEFAULTS), options);
  this._statistics = {};
  this._collectors = {
    soft: [
      Monitor.getConnectedPeers,
      Monitor.getDiskUtilization
    ],
    hard: [
      Monitor.getContractsDetails,
      Monitor.getPaymentAddressBalances
    ]
  };

  EventEmitter.call(this);
}

inherits(Monitor, EventEmitter);

Monitor.DEFAULTS = {
  softInterval: 10000, // NB: Interval for simple jobs
  hardInterval: 3 * 60 * 1000 // NB: Interval for resource heavy jobs
};

/**
 * Starts the network monitor
 * @returns {Monitor}
 */
Monitor.prototype.start = function() {
  if (this._softInterval && this._hardInterval) {
    return false;
  }

  this._softInterval = setInterval(
    this._collectSoftStats.bind(this),
    this._options.softInterval
  );

  this._hardInterval = setInterval(
    this._collectHardStats.bind(this),
    this._options.hardInterval
  );

  return true;
};

/**
 * Stops the network monitor
 * @returns {Monitor}
 */
Monitor.prototype.stop = function() {
  if (!this._softInterval && !this._hardInterval) {
    return false;
  }

  clearInterval(this._softInterval);
  clearInterval(this._hardInterval);

  delete this._softInterval;
  delete this._hardInterval;

  return true;
};

/**
 * Returns the current snapshot
 * @returns {Object} snapshot
 */
Monitor.prototype.getSnapshot = function() {
  return merge(Object.create(this._statistics), {
    timestamp: new Date()
  });
};

/**
 * Collects the soft stats
 * @private
 */
Monitor.prototype._collectStats = function(collectors) {
  var self = this;

  async.parallel(collectors.map(function(collector) {
    return collector.bind(null, self._source);
  }), function(err, results) {
    results.forEach(function(result) {
      self._statistics = merge(self._statistics, result);
    });
    self.emit('update', self.getSnapshot());
  });
};

/**
 * Collects the soft stats
 * @private
 */
Monitor.prototype._collectSoftStats = function() {
  this._collectStats(this._collectors.soft);
};

/**
 * Collects the hard stats
 * @private
 */
Monitor.prototype._collectHardStats = function() {
  this._collectStats(this._collectors.hard);
};

/**
 * Gets the list of currently known {@link Contact}s
 * @static
 * @param {Network} source - The network instance to use
 * @param {Function} callback
 */
Monitor.getConnectedPeers = function(source, callback) {
  var stats = { connected: 0 };
  var buckets = source._router._buckets;

  for (var k in buckets) {
    stats.connected += buckets[k].getSize();
  }

  callback(null, { peers: stats });
};

/**
 * Gets the amount of used space compared to amount shared
 * @static
 * @param {Network} source - The network instance to use
 * @param {Function} callback
 */
Monitor.getDiskUtilization = function(source, callback) {
  var stats = { free: source._manager._options.maxCapacity };

  source._manager._storage.size(function(err, bytes) {
    if (err) {
      return callback(null, {
        disk: merge(stats, { used: 0, free: stats.free })
      });
    }

    callback(null, {
      disk: merge(stats, { used: bytes, free: stats.free - bytes })
    });
  });
};

/**
 * Gets the balance of SJCX/SJCT from a {@link FarmerInterface}
 * @static
 * @param {Network} source - The network instance to use
 * @param {Function} callback
 */
Monitor.getPaymentAddressBalances = function(source, callback) {
  var stats = { balances: { sjcx: 0, sjct: 0 } };
  var address = source._keypair.getAddress();

  if (source._options.payment && source._options.payment.address) {
    address = source._options.payment.address.trim();
  }

  var url = 'https://counterpartychain.io/api/balances/' + address;

  request({ url: url, json: true }, function(err, res, body) {
    if (err || res.statusCode !== 200) {
      return callback(null, { payments: stats });
    }

    if (body && body.data) {
      for (var balance = 0; balance < body.data.length; balance++) {
        stats.balances[body.data[balance].asset.toLowerCase()] = Number(
          body.data[balance].amount
        );
      }
    }

    callback(null, { payments: stats });
  });
};

/**
 * Gets the total contracts stored
 * @static
 * @param {Network} source - The network instance to use
 * @param {Function} callback
 */
Monitor.getContractsDetails = function(source, callback) {
  var stats = { total: 0 };

  source._manager._storage._keys(function(err, keys) {
    if (err) {
      return callback(null, { contracts: stats });
    }

    callback(null, { contracts: merge(stats, { total: keys.length }) });
  });
};

module.exports = Monitor;
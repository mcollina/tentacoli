'use strict'

var inherits = require('inherits')
var protobuf = require('protocol-buffers')
var fs = require('fs')
var schema = fs.readFileSync(__dirname + '/schema.proto')
var messages = protobuf(schema)
var Multiplex = require('multiplex')
var uuid = require('uuid')
var nos = require('net-object-stream')
var callbackStream = require('callback-stream')
var UUIDregexp = /[^-]{8}-[^-]{4}-[^-]{4}-[^-]{4}-[^-]{12}/

function Tentacoli (opts) {
  if (!(this instanceof Tentacoli)) {
    return new Tentacoli(opts)
  }

  this._requests = {}
  this._opts = opts
  this._waiting = {}
  // TODO clean up waiting streams that are left there

  var that = this
  Multiplex.call(this, function (stream, id) {

    stream.halfOpen = true

    if (id.match(UUIDregexp)) {
      this._waiting[id] = stream
      return
    }

    stream.pipe(callbackStream(function (err, list) {
      if (err) {
        that.emit('headerError', err)
        stream.destroy()
        return
      }

      var decoded = messages.Message.decode(Buffer.concat(list))
      var restream

      if (that._waiting[decoded.id]) {
        restream = that._waiting[decoded.id]
        delete that._waiting[decoded.id]
      } else {
        restream = that.receiveStream(decoded.id, { halfOpen: true })
      }

      var dataStream = nos(restream, that._opts)
      var response = {
        id: decoded.id,
        ack: {
          error: null
        }
      }

      dataStream.pipe(callbackStream({ objectMode: true }, function (err, list) {
        if (err) {
          that.emit('requestError', err)
          response.ack.error = err.message
          stream.end(messages.Message.encode(response))
          return
        }

        var toCall = list
        if (list.length === 1) {
          toCall = list[0]
        }

        that.emit('request', toCall, function reply (err, result) {
          if (err) {
            that.emit('responseError', err)
            response.ack.error = err.message
            stream.end(messages.Message.encode(response))
            return
          }

          stream.end(messages.Message.encode(response))
          dataStream.end(result)
        })
      }))
    }))
  })
}

inherits(Tentacoli, Multiplex)

Tentacoli.prototype.request = function (msg, callback) {
  var that = this
  var req = {
    id: uuid.v4(),
    callback: callback,
    acked: false
  }
  var encoded = messages.Message.encode(req)

  this._requests[req.id] = req

  var stream = this.createStream(null, { halfOpen: true })

  stream.end(encoded)

  stream.pipe(callbackStream(function (err, list) {
    if (err) {
      // TODO cleanup request stream?
      return callback(err)
    }

    var decoded = messages.Message.decode(Buffer.concat(list))
    if (!req.acked && decoded.ack && decoded.ack.error) {
      callback(new Error(decoded.ack.error))
    }
  }))

  stream.on('finish', function () {
    req.stream = nos(that.createStream(req.id, { halfOpen: true }), that._opts)

    req.stream.pipe(callbackStream({ objectMode: true }, function (err, list) {
      if (err) {
        // TODO cleanup other stream?
        return callback(err)
      }

      if (!req.acked && list.length > 0) {
        req.acked = true
        list.unshift(null)
        callback.apply(null, list)
      }
    }))

    req.stream.end(msg)
  })

  return this
}

module.exports = Tentacoli

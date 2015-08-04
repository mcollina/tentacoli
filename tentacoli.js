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
var copy = require('shallow-copy')
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
      var restream = waitingOrReceived(that, decoded.id)

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

          if (result && result.streams$) {
            response.streams = Object.keys(result.streams$)
              .map(mapStream, result.streams$)
              .map(pipeStream, that)

            result = copy(result)
            delete result.streams$
          }

          stream.end(messages.Message.encode(response))
          dataStream.end(result)
        })
      }))
    }))
  })
}

function mapStream (key) {
  // this is the streams$ object
  return {
    id: uuid.v4(),
    name: key,
    objectMode: this[key]._readableState.objectMode,
    stream: this[key]
  }
}

function pipeStream (container) {
  // this is the tentacoli instance
  var dest = this.createStream(container.id)
  if (container.objectMode) {
    dest = nos(dest)
  }
  container.stream.pipe(dest)
  return container
}

function waitingOrReceived (that, id) {
  var stream

  if (that._waiting[id]) {
    stream = that._waiting[id]
    delete that._waiting[id]
  } else {
    stream = that.receiveStream(id, { halfOpen: true })
  }

  return stream
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
  var decoded
  var result

  stream.end(encoded)

  stream.pipe(callbackStream(function (err, list) {
    if (err) {
      // TODO cleanup request stream?
      return callback(err)
    }

    decoded = messages.Message.decode(Buffer.concat(list))

    if (!req.acked && decoded.ack && decoded.ack.error) {
      req.acked = true
      req.stream.destroy()
      callback(new Error(decoded.ack.error))
    } else {
      doResponse()
    }
  }))

  stream.on('finish', function () {
    req.stream = nos(that.createStream(req.id, { halfOpen: true }), that._opts)

    req.stream.pipe(callbackStream({ objectMode: true }, function (err, list) {
      if (err) {
        // TODO cleanup other stream?
        return callback(err)
      }

      result = list

      doResponse()
    }))

    req.stream.end(msg)
  })

  function doResponse () {
    if (!decoded || !result || req.acked) {
      // wait for the other
      return
    }

    if (decoded.streams.length > 0) {
      result[0].streams$ = decoded.streams.reduce(function (acc, container) {
        var stream = waitingOrReceived(that, container.id)
        if (container.objectMode) {
          stream = nos(stream)
        }
        acc[container.name] = stream
        return acc
      }, {})
    }

    req.acked = true
    result.unshift(null)
    callback.apply(null, result)
  }

  return this
}

module.exports = Tentacoli

'use strict'

var inherits = require('inherits')
var protobuf = require('protocol-buffers')
var fs = require('fs')
var path = require('path')
var schema = fs.readFileSync(path.join(__dirname, 'schema.proto'), 'utf8')
var messages = protobuf(schema)
var Multiplex = require('multiplex')
var nos = require('net-object-stream')
var copy = require('shallow-copy')
var pump = require('pump')
var reusify = require('reusify')
var fastq = require('fastq')
var streamRegexp = /stream-[\d]+/
var messageCodec = {
  codec: messages.Message
}

function Tentacoli (opts) {
  if (!(this instanceof Tentacoli)) {
    return new Tentacoli(opts)
  }

  this._requests = {}
  this._opts = opts || {}
  this._waiting = {}
  this._replyPool = reusify(Reply)
  this._nextId = 0

  this._opts.codec = this._opts.codec || {
    encode: JSON.stringify,
    decode: JSON.parse
  }
  // TODO clean up waiting streams that are left there

  var that = this

  var qIn = this._qIn = fastq(workIn, that._opts.maxInflight || 100)

  function workIn (msg, cb) {
    msg.callback = cb
    that.emit('request', msg.toCall, msg.func)
  }

  Multiplex.call(this, function newStream (stream, id) {
    if (id.match(streamRegexp)) {
      this._waiting[id] = stream
      return
    }

    var parser = nos.parser(messageCodec)

    parser.on('message', function (decoded) {
      var response = new Response(decoded.id)
      var toCall = that._opts.codec.decode(decoded.data)
      unwrapStreams(that, toCall, decoded)

      var reply = that._replyPool.get()

      reply.toCall = toCall
      reply.stream = stream
      reply.response = response
      qIn.push(reply, noop)
    })

    stream.on('readable', parseInBatch)

    function parseInBatch () {
      var data = stream.read(null)
      parser.parse(data)
    }
  })

  var main = this._main = this.createStream(null)

  var parser = this._parser = nos.parser(messageCodec)

  this._parser.on('message', function (msg) {
    var req = that._requests[msg.id]
    var err = null
    var data = null

    delete that._requests[msg.id]

    if (msg.error) {
      err = new Error(msg.error)
    } else if (msg.data) {
      data = that._opts.codec.decode(msg.data)
      unwrapStreams(that, data, msg)
    }

    req.callback(err, data)
  })

  this._main.on('readable', parseBatch)

  function parseBatch (err) {
    if (err) {
      that.emit('error', err)
      return
    }
    parser.parse(main.read(null))
  }

  this._main.on('error', this.emit.bind(this, 'error'))
  this._parser.on('error', this.emit.bind(this, 'error'))

  var self = this
  function Reply () {
    this.response = null
    this.stream = null
    this.callback = noop
    this.toCall = null

    var that = this

    this.func = function reply (err, result) {
      if (err) {
        self.emit('responseError', err)
        self.response = self.response || {}
        self.response.error = err.message
      } else {
        wrapStreams(self, result, that.response)
      }
      nos.writeToStream(that.response, messageCodec, that.stream)
      var cb = that.callback
      that.response = null
      that.stream = null
      that.callback = noop
      that.toCall = null
      self._replyPool.release(that)
      cb()
    }
  }
}

function Response (id) {
  this.id = id
  this.error = null
}

function wrapStreams (that, data, msg) {
  if (data && data.streams) {
    msg.streams = Object.keys(data.streams)
      .map(mapStream, data.streams)
      .map(pipeStream, that)

    data = copy(data)
    delete data.streams
  }

  msg.data = that._opts.codec.encode(data)

  return msg
}

function mapStream (key) {
  var stream = this[key]
  var objectMode = false
  var type

  if (!stream._transform && stream._readableState && stream._writableState) {
    type = messages.StreamType.Duplex
    objectMode = stream._readableState.objectMode || stream._writableState.objectMode
  } else if (!stream._writableState || stream._readableState && stream._readableState.pipesCount === 0) {
    type = messages.StreamType.Readable
    objectMode = stream._readableState.objectMode
  } else {
    type = messages.StreamType.Writable
    objectMode = stream._writableState.objectMode
  }

  // this is the streams object
  return {
    id: null,
    name: key,
    objectMode: objectMode,
    stream: stream,
    type: type
  }
}

function pipeStream (container) {
  // this is the tentacoli instance
  container.id = 'stream-' + this._nextId++
  var dest = this.createStream(container.id)

  if (container.type === messages.StreamType.Readable ||
      container.type === messages.StreamType.Duplex) {
    if (container.objectMode) {
      pump(
        container.stream,
        nos.encoder(this._opts),
        dest)
    } else {
      pump(
        container.stream,
        dest)
    }
  }

  if (container.type === messages.StreamType.Writable ||
      container.type === messages.StreamType.Duplex) {
    if (container.objectMode) {
      pump(
        dest,
        nos.decoder(this._opts),
        container.stream)
    } else {
      pump(
        dest,
        container.stream)
    }
  }

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

  stream.halfOpen = true

  return stream
}

function unwrapStreams (that, data, decoded) {
  if (decoded.streams.length > 0) {
    data.streams = decoded.streams.reduce(function (acc, container) {
      var stream = waitingOrReceived(that, container.id)
      var writable
      if (container.objectMode) {
        if (container.type === messages.StreamType.Duplex) {
          stream = nos(stream)
        } else if (container.type === messages.StreamType.Readable) {
          // if it is a readble, we close this side
          stream.end()
          stream = pump(stream, nos.decoder(that._opts))
        } else if (container.type === messages.StreamType.Writable) {
          writable = nos.encoder(that._opts)
          pump(writable, stream)
          stream = writable
        }
      }
      acc[container.name] = stream
      return acc
    }, {})
  }
}

inherits(Tentacoli, Multiplex)

function Request (parent, callback) {
  this.id = 'req-' + parent._nextId++
  this.callback = callback
  this.data = null
}

Tentacoli.prototype.request = function (data, callback) {
  var that = this
  var req = new Request(this, callback)

  wrapStreams(that, data, req)

  this._requests[req.id] = req

  nos.writeToStream(req, messageCodec, this._main)

  return this
}

function noop () {}

module.exports = Tentacoli

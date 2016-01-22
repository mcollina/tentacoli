'use strict'

var inherits = require('inherits')
var protobuf = require('protocol-buffers')
var fs = require('fs')
var schema = fs.readFileSync(__dirname + '/schema.proto', 'utf8')
var messages = protobuf(schema)
var Multiplex = require('multiplex')
var uuid = require('uuid')
var nos = require('net-object-stream')
var copy = require('shallow-copy')
var pump = require('pump')
var reusify = require('reusify')
var UUIDregexp = /[^-]{8}-[^-]{4}-[^-]{4}-[^-]{4}-[^-]{12}/
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

  this._opts.codec = this._opts.codec || {
    encode: JSON.stringify,
    decode: JSON.parse
  }
  // TODO clean up waiting streams that are left there

  var that = this
  Multiplex.call(this, function newStream (stream, id) {

    if (id.match(UUIDregexp)) {
      this._waiting[id] = stream
      return
    }

    var decoder = nos.decoder(messageCodec)
    var encoder = nos.encoder(messageCodec)

    pump(stream, decoder)
    pump(encoder, stream)

    // TODO use fastq instead
    decoder.on('data', function decodeAndParse (decoded) {
      var response = new Response(decoded.id)

      var toCall = that._opts.codec.decode(decoded.data)

      unwrapStreams(that, toCall, decoded)

      var reply = that._replyPool.get()

      reply.encoder = encoder
      reply.response = response

      that.emit('request', toCall, reply.func)
    })
  })

  this._main = this.createStream(null)
  this._mainWritable = nos.encoder(messageCodec)
  pump(this._mainWritable, this._main)
  this._mainReadable = pump(this._main, nos.decoder(messageCodec))

  // use fastq instead
  this._mainReadable.on('data', function (msg) {
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

  var self = this
  function Reply () {
    this.response = null
    this.encoder = null

    var that = this

    this.func = function reply (err, result) {
      if (err) {
        self.emit('responseError', err)
        self.response.error = err.message
      } else {
        wrapStreams(self, result, that.response)
      }
      that.encoder.write(that.response)
      that.response = null
      that.encoder = null
      self._replyPool.release(that)
    }
  }
}

function Response (id) {
  this.id = id
  this.error = null
}

function wrapStreams (that, data, msg) {
  if (data && data.streams$) {
    msg.streams = Object.keys(data.streams$)
      .map(mapStream, data.streams$)
      .map(pipeStream, that)

    data = copy(data)
    delete data.streams$
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

  // this is the streams$ object
  return {
    id: uuid.v4(),
    name: key,
    objectMode: objectMode,
    stream: stream,
    type: type
  }
}

function pipeStream (container) {
  // this is the tentacoli instance
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
    data.streams$ = decoded.streams.reduce(function (acc, container) {
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

Tentacoli.prototype.request = function (data, callback) {
  var that = this
  var req = {
    id: uuid.v4(),
    callback: callback
  }

  wrapStreams(that, data, req)

  this._requests[req.id] = req

  this._mainWritable.write(req)

  return this
}

module.exports = Tentacoli

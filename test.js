'use strict'

var test = require('tape')
var tentacoli = require('./')
var from = require('from2')
var callback = require('callback-stream')
var Writable = require('stream').Writable
var through = require('through2')

test('can issue a request', function (t) {
  t.plan(3)

  var sender = tentacoli()
  var receiver = tentacoli()
  var msg = 'the answer to life, the universe and everything'
  var expected = '42'

  sender.pipe(receiver).pipe(sender)

  sender.request(msg, function (err, res) {
    t.error(err, 'no error')
    t.deepEqual(res, expected, 'response matches')
  })

  receiver.on('request', function (req, reply) {
    t.deepEqual(req, msg, 'request matches')
    reply(null, expected)
  })
})

test('can pass through an object', function (t) {
  t.plan(3)

  var sender = tentacoli()
  var receiver = tentacoli()
  var msg = { cmd: 'the answer to life, the universe and everything' }
  var expected = { res: '42' }

  sender.pipe(receiver).pipe(sender)

  sender.request(msg, function (err, res) {
    t.error(err, 'no error')
    t.deepEqual(res, expected, 'response matches')
  })

  receiver.on('request', function (req, reply) {
    t.deepEqual(req, msg, 'request matches')
    reply(null, expected)
  })
})

test('can pass through object readable streams', function (t) {
  t.plan(3)

  var sender = tentacoli()
  var receiver = tentacoli()
  var msg = { cmd: 'subscribe' }

  sender.pipe(receiver).pipe(sender)

  sender.request(msg, function (err, res) {
    t.error(err, 'no error')
    res.streams$.result.pipe(callback.obj(function (err, list) {
      t.error(err, 'no error')
      t.deepEqual(list, ['hello', 'streams'], 'is passed through correctly')
    }))
  })

  receiver.on('request', function (req, reply) {
    reply(null, {
      streams$: {
        result: from.obj(['hello', 'streams'])
      }
    })
  })
})

test('can pass through object writable streams', function (t) {
  t.plan(2)

  var sender = tentacoli()
  var receiver = tentacoli()
  var msg = { cmd: 'publish' }

  sender.pipe(receiver).pipe(sender)

  sender.request(null, function (err, res) {
    t.error(err, 'no error')
    res.streams$.writable.end(msg)
  })

  receiver.on('request', function (req, reply) {
    var writable = new Writable({ objectMode: true })
    writable._write = function (chunk, enc, cb) {
      t.deepEqual(chunk, msg, 'msg match')
      cb()
    }
    reply(null, {
      streams$: {
        writable: writable
      }
    })
  })
})

test('can pass through a transform stream as a writable', function (t) {
  t.plan(2)

  var sender = tentacoli()
  var receiver = tentacoli()
  var msg = { cmd: 'publish' }

  sender.pipe(receiver).pipe(sender)

  sender.request(null, function (err, res) {
    t.error(err, 'no error')
    res.streams$.writable.end(msg)
  })

  receiver.on('request', function (req, reply) {
    var writable = new Writable({ objectMode: true })
    writable._write = function (chunk, enc, cb) {
      t.deepEqual(chunk, msg, 'msg match')
    }
    var transform = through.obj()

    transform.pipe(writable)

    reply(null, {
      streams$: {
        writable: transform
      }
    })
  })
})

test('can pass through a transform stream as a readable streams', function (t) {
  t.plan(3)

  var sender = tentacoli()
  var receiver = tentacoli()
  var msg = { cmd: 'subscribe' }

  sender.pipe(receiver).pipe(sender)

  sender.request(msg, function (err, res) {
    t.error(err, 'no error')
    res.streams$.result.pipe(callback.obj(function (err, list) {
      t.error(err, 'no error')
      t.deepEqual(list, ['hello', 'streams'], 'is passed through correctly')
    }))
  })

  receiver.on('request', function (req, reply) {
    reply(null, {
      streams$: {
        result: from.obj(['hello', 'streams']).pipe(through.obj(function (chunk, enc, cb) {
          console.log(chunk)
          cb(null, chunk)
        }))
      }
    })
  })
})

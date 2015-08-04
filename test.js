'use strict'

var test = require('tape')
var tentacoli = require('./')
var from = require('from2')
var callback = require('callback-stream')

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
    res.streams$.result.pipe(callback({ objectMode: true }, function (err, list) {
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

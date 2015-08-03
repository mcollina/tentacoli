'use strict'

var test = require('tape')
var tentacoli = require('./')

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

'use strict'

var Buffer = require('safe-buffer').Buffer
var test = require('tape')
var tentacoli = require('./')
var from = require('from2')
var callback = require('callback-stream')
var Writable = require('stream').Writable
var through = require('through2')
var msgpack = require('msgpack5')

function setup (opts) {
  var sender = tentacoli(opts)
  var receiver = tentacoli(opts)

  sender.pipe(receiver).pipe(sender)

  return {
    sender: sender,
    receiver: receiver
  }
}

test('can issue a request', function (t) {
  t.plan(3)

  var s = setup()
  var msg = 'the answer to life, the universe and everything'
  var expected = '42'

  s.sender.request(msg, function (err, res) {
    t.error(err, 'no error')
    t.deepEqual(res, expected, 'response matches')
  })

  s.receiver.on('request', function (req, reply) {
    t.deepEqual(req, msg, 'request matches')
    reply(null, expected)
  })
})

test('can pass through an object', function (t) {
  t.plan(3)

  var s = setup()
  var msg = { cmd: 'the answer to life, the universe and everything' }
  var expected = { res: '42' }

  s.sender.request(msg, function (err, res) {
    t.error(err, 'no error')
    t.deepEqual(res, expected, 'response matches')
  })

  s.receiver.on('request', function (req, reply) {
    t.deepEqual(req, msg, 'request matches')
    reply(null, expected)
  })
})

test('can handle an error response from a request', function (t) {
  t.plan(4)

  var s = setup()
  var msg = 'the answer to life, the universe and everything'

  s.sender.request(msg, function (err, res) {
    t.ok(err instanceof Error, 'there is an error')
    t.equal(err.message, 'something went wrong')
  })

  s.receiver.on('request', function (req, reply) {
    t.deepEqual(req, msg, 'request matches')
    reply(new Error('something went wrong'))
  })

  s.receiver.on('responseError', function (err) {
    t.ok(err, 'error exists')
  })
})

test('can pass from receiver to sender an object readable stream', function (t) {
  t.plan(3)

  var s = setup()
  var msg = { cmd: 'subscribe' }

  s.sender.request(msg, function (err, res) {
    t.error(err, 'no error')
    res.streams.result.pipe(callback.obj(function (err, list) {
      t.error(err, 'no error')
      t.deepEqual(list, ['hello', 'streams'], 'is passed through correctly')
    }))
  })

  s.receiver.on('request', function (req, reply) {
    reply(null, {
      streams: {
        result: from.obj(['hello', 'streams'])
      }
    })
  })
})

test('can pass from receiver to sender a writable stream', function (t) {
  t.plan(2)

  var s = setup()
  var msg = { cmd: 'publish' }

  s.sender.request(null, function (err, res) {
    t.error(err, 'no error')
    res.streams.writable.end(msg)
  })

  s.receiver.on('request', function (req, reply) {
    var writable = new Writable({ objectMode: true })
    writable._write = function (chunk, enc, cb) {
      t.deepEqual(chunk, msg, 'msg match')
      cb()
    }
    reply(null, {
      streams: {
        writable: writable
      }
    })
  })
})

test('can pass from receiver to sender a transform stream as a writable', function (t) {
  t.plan(2)

  var s = setup()
  var msg = { cmd: 'publish' }

  s.sender.request(null, function (err, res) {
    t.error(err, 'no error')
    res.streams.writable.end(msg)
  })

  s.receiver.on('request', function (req, reply) {
    var writable = new Writable({ objectMode: true })
    writable._write = function (chunk, enc, cb) {
      t.deepEqual(chunk, msg, 'msg match')
    }
    var transform = through.obj()

    transform.pipe(writable)

    reply(null, {
      streams: {
        writable: transform
      }
    })
  })
})

test('can pass from receiver to sender a transform stream as a readable streams', function (t) {
  t.plan(3)

  var s = setup()
  var msg = { cmd: 'subscribe' }

  s.sender.request(msg, function (err, res) {
    t.error(err, 'no error')
    res.streams.result.pipe(callback.obj(function (err, list) {
      t.error(err, 'no error')
      t.deepEqual(list, ['hello', 'streams'], 'is passed through correctly')
    }))
  })

  s.receiver.on('request', function (req, reply) {
    reply(null, {
      streams: {
        result: from.obj(['hello', 'streams']).pipe(through.obj(function (chunk, enc, cb) {
          cb(null, chunk)
        }))
      }
    })
  })
})

test('can pass from sender to receiver an object readable stream', function (t) {
  t.plan(3)

  var s = setup()
  var msg = {
    cmd: 'publish',
    streams: {
      events: from.obj(['hello', 'streams'])
    }
  }

  s.sender.request(msg, function (err, res) {
    t.error(err, 'no error')
  })

  s.receiver.on('request', function (req, reply) {
    req.streams.events.pipe(callback.obj(function (err, list) {
      t.error(err, 'no error')
      t.deepEqual(list, ['hello', 'streams'], 'is passed through correctly')
      reply()
    }))
  })
})

test('can pass from sender to receiver an object writable stream', function (t) {
  t.plan(2)

  var s = setup()
  var writable = new Writable({ objectMode: true })

  writable._write = function (chunk, enc, cb) {
    t.deepEqual(chunk, 'hello', 'chunk match')
    cb()
  }

  var msg = {
    cmd: 'subscribe',
    streams: {
      events: writable
    }
  }

  s.sender.request(msg, function (err, res) {
    t.error(err, 'no error')
  })

  s.receiver.on('request', function (req, reply) {
    req.streams.events.end('hello')
    reply()
  })
})

test('supports custom encodings', function (t) {
  t.plan(3)

  var s = setup({ codec: msgpack() })
  var msg = { cmd: 'subscribe' }
  var expected = [
    Buffer.from('hello'),
    Buffer.from('streams')
  ]

  s.sender.request(msg, function (err, res) {
    t.error(err, 'no error')
    res.streams.result.pipe(callback.obj(function (err, list) {
      t.error(err, 'no error')
      t.deepEqual(list, expected, 'is passed through correctly')
    }))
  })

  s.receiver.on('request', function (req, reply) {
    reply(null, {
      streams: {
        result: from.obj(expected).pipe(through.obj(function (chunk, enc, cb) {
          cb(null, chunk)
        }))
      }
    })
  })
})

test('can reply with null', function (t) {
  t.plan(3)

  var s = setup()
  var msg = 'the answer to life, the universe and everything'

  s.sender.request(msg, function (err, res) {
    t.error(err, 'no error')
    t.notOk(res, 'empty response')
  })

  s.receiver.on('request', function (req, reply) {
    t.deepEqual(req, msg, 'request matches')
    reply()
  })
})

test('errors if piping something errors', function (t) {
  t.plan(1)

  var s = setup()
  var writable = new Writable({ objectMode: true })
  var throwErr

  writable.on('pipe', function () {
    throwErr = new Error('something goes wrong')
    throw throwErr
  })

  var msg = {
    cmd: 'subscribe',
    streams: {
      events: writable
    }
  }

  s.sender.request(msg, function (err, res) {
    t.equal(err, throwErr, 'an error happens')
  })

  s.receiver.on('request', function (req, reply) {
    t.fail('it never happens')
  })
})

test('errors if the connection end', function (t) {
  t.plan(2)

  var s = setup()
  var msg = 'the answer to life, the universe and everything'

  s.sender.request(msg, function (err) {
    t.ok(err, 'should error')
  })

  s.receiver.on('request', function (req, reply) {
    t.deepEqual(req, msg, 'request matches')
    s.receiver.end()
  })
})

test('errors if the receiver is destroyed', function (t) {
  t.plan(3)

  var s = setup()
  var msg = 'the answer to life, the universe and everything'

  s.sender.request(msg, function (err) {
    t.ok(err, 'should error')
  })

  s.receiver.on('error', function (err) {
    t.ok(err, 'should error')
  })

  s.receiver.on('request', function (req, reply) {
    t.deepEqual(req, msg, 'request matches')
    s.receiver.destroy(new Error('kaboom'))
  })
})

test('errors if the sender is destroyed with error', function (t) {
  t.plan(3)

  var s = setup()
  var msg = 'the answer to life, the universe and everything'

  s.sender.request(msg, function (err) {
    t.ok(err, 'should error')
  })

  s.sender.on('error', function (err) {
    t.ok(err, 'should error')
  })

  s.receiver.on('request', function (req, reply) {
    t.deepEqual(req, msg, 'request matches')
    s.sender.destroy(new Error('kaboom'))
  })
})

test('errors if the sender is destroyed', function (t) {
  t.plan(2)

  var s = setup()
  var msg = 'the answer to life, the universe and everything'

  s.sender.request(msg, function (err) {
    t.ok(err, 'should error')
  })

  s.receiver.on('request', function (req, reply) {
    t.deepEqual(req, msg, 'request matches')
    s.sender.destroy()
  })
})

test('fire and forget - send string', function (t) {
  t.plan(1)

  var s = setup()
  var msg = 'the answer to life, the universe and everything'

  s.sender.fire(msg)

  s.receiver.on('request', function (req) {
    t.deepEqual(req, msg, 'request matches')
  })
})

test('fire and forget - the error callback should not be called', function (t) {
  t.plan(1)

  var s = setup()
  var msg = 'the answer to life, the universe and everything'

  s.sender.fire(msg, () => t.fail('this should not be called'))

  s.receiver.on('request', function (req) {
    t.deepEqual(req, msg, 'request matches')
  })
})

test('fire and forget - if reply is called, nothing should happen in the sender', function (t) {
  t.plan(1)

  var s = setup()
  var msg = 'the answer to life, the universe and everything'

  s.sender.fire(msg, () => t.fail('this should not be called'))

  s.receiver.on('request', function (req, reply) {
    t.deepEqual(req, msg, 'request matches')
    reply(null, 'hello!')
  })
})

test('fire and forget - send object', function (t) {
  t.plan(1)

  var s = setup()
  var msg = { cmd: 'the answer to life, the universe and everything' }

  s.sender.fire(msg)

  s.receiver.on('request', function (req) {
    t.deepEqual(req, msg, 'request matches')
  })
})

test('fire and forget - can pass from sender to receiver an object readable stream', function (t) {
  t.plan(2)

  var s = setup()
  var msg = {
    cmd: 'publish',
    streams: {
      events: from.obj(['hello', 'streams'])
    }
  }

  s.sender.fire(msg)

  s.receiver.on('request', function (req, reply) {
    req.streams.events.pipe(callback.obj(function (err, list) {
      t.error(err, 'no error')
      t.deepEqual(list, ['hello', 'streams'], 'is passed through correctly')
    }))
  })
})

test('fire and forget - can pass from sender to receiver an object writable stream', function (t) {
  t.plan(1)

  var s = setup()
  var writable = new Writable({ objectMode: true })

  writable._write = function (chunk, enc, cb) {
    t.deepEqual(chunk, 'hello', 'chunk match')
    cb()
  }

  var msg = {
    cmd: 'subscribe',
    streams: {
      events: writable
    }
  }

  s.sender.fire(msg)

  s.receiver.on('request', function (req, reply) {
    req.streams.events.end('hello')
  })
})

test('fire and forget - should not care if the connection end', function (t) {
  t.plan(1)

  var s = setup()
  var msg = 'the answer to life, the universe and everything'

  s.sender.fire(msg)

  s.receiver.on('request', function (req, reply) {
    t.deepEqual(req, msg, 'request matches')
    s.receiver.end()
  })
})

test('fire and forget - should not care if the receiver is destroyed', function (t) {
  t.plan(2)

  var s = setup()
  var msg = 'the answer to life, the universe and everything'

  s.sender.fire(msg)

  s.receiver.on('error', function (err) {
    t.ok(err, 'should error')
  })

  s.receiver.on('request', function (req, reply) {
    t.deepEqual(req, msg, 'request matches')
    s.receiver.destroy(new Error('kaboom'))
  })
})

test('fire and forget - should not care about errors', function (t) {
  t.plan(1)

  var s = setup()
  var msg = { cmd: 'the answer to life, the universe and everything' }

  s.sender.fire(msg)

  s.receiver.on('request', function (req) {
    t.deepEqual(req, msg, 'request matches')
    s.sender.destroy()
  })
})

test('fire and forget - if a writable stream is passed to reply it should be destroyed', function (t) {
  t.plan(1)

  var s = setup()
  var msg = { cmd: 'subscribe' }
  var writable = new Writable({ objectMode: true })

  s.sender.fire(msg)

  writable.on('error', function (err) {
    t.ok(err)
  })

  writable.on('finish', function () {
    t.pass('stream closed')
  })

  s.receiver.on('request', function (req, reply) {
    reply(null, {
      streams: writable
    })
  })
})

test('fire and forget - if a writable stream is passed to reply it should be destroyed', function (t) {
  t.plan(1)

  var s = setup()
  var msg = { cmd: 'subscribe' }
  var readable = from.obj(['hello', 'streams'])

  s.sender.fire(msg)

  readable.on('close', function () {
    t.pass('stream closed')
  })

  s.receiver.on('request', function (req, reply) {
    reply(null, {
      streams: readable
    })
  })
})

'use strict'

var test = require('tape')
var tentacoli = require('./')
var ws = require('websocket-stream')
var pump = require('pump')
var from = require('from2')
var URL = require('url')
var serverOpts = URL.parse(document.URL)
serverOpts.path = undefined
serverOpts.pathname = undefined
serverOpts.protocol = 'ws'
var server = URL.format(serverOpts)

test('browser req/res', function (t) {
  var stream = ws(server)
  var instance = tentacoli()
  var msg = { hello: 'world' }

  pump(stream, instance, stream)

  instance.request(msg, function (err, data) {
    t.error(err)
    t.deepEqual(data, msg, 'echo the message')
    t.end()
    stream.destroy()
  })
})

test('browser streams', function (t) {
  var stream = ws(server)
  var instance = tentacoli()

  pump(stream, instance, stream)

  instance.request({
    streams$: {
      inStream: from.obj(['hello', 'world'])
    }
  }, function (err, data) {
    t.error(err)

    var res = data.streams$.inStream
    res.once('data', function (chunk) {
      t.deepEqual(chunk, 'hello')
      res.once('data', function (chunk) {
        t.deepEqual(chunk, 'world')
        t.end()
        stream.destroy()
      })
    })
  })
})
